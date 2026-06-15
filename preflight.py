#!/usr/bin/env python3
"""
preflight.py — pre-push sanity checks for the BAMA ERP frontend.

Acorn checks SYNTAX (does it parse). This checks INTENT classes that
Acorn misses and that have actually bitten us before:

  1. SYNTAX        — every <script> block (no src=) parses via Acorn (module mode)
  2. DOM ORPHANS   — getElementById('x') in JS where no id="x" exists in the
                     same file's HTML  → "modal never opened" class of bug
  3. ASYNC NO-AWAIT— calls to known async functions written without `await`
                     (and not assigned to a var that's awaited)  → "[object Promise]" bug
  4. ONCLICK GHOSTS— onclick="foo(" / onchange="foo(" handlers with no `function foo`
                     defined anywhere in the same file  → "nothing happens on click"

Usage:
    python3 preflight.py                 # check every *.html in repo
    python3 preflight.py dashboard.html quote-builder.html   # check specific files

Exit code 0 = clean, 1 = problems found. Warnings (likely-but-not-certain)
never fail the build; only ERRORS do.

NOTE: this is heuristic, not a compiler. It is tuned to favour FEWER false
positives over catching everything — a noisy checker gets ignored. When in
doubt it warns rather than errors. Treat a clean run as "no obvious foot-guns",
not "provably correct".
"""

import sys, os, re, glob, subprocess, tempfile

# ── locate acorn (installed under the user's global npm modules) ──────────────
def find_acorn():
    candidates = [
        os.path.expanduser('~/.npm-global/lib/node_modules/ts-node/node_modules/acorn/bin/acorn'),
        os.path.expanduser('~/.npm-global/lib/node_modules/acorn/bin/acorn'),
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    # fallback: search
    try:
        out = subprocess.run(['find', '/', '-name', 'acorn', '-type', 'f', '-path', '*bin*'],
                             capture_output=True, text=True, timeout=20)
        for line in out.stdout.splitlines():
            if line.strip():
                return line.strip()
    except Exception:
        pass
    return None

ACORN = find_acorn()

# script blocks WITHOUT a src= attribute (inline JS only)
SCRIPT_RE = re.compile(r'<script(?![^>]*\bsrc=)[^>]*>(.*?)</script>', re.DOTALL | re.IGNORECASE)

def extract_inline_js(html):
    return '\n'.join(SCRIPT_RE.findall(html))

# ── CHECK 1: syntax via Acorn ─────────────────────────────────────────────────
def check_syntax(js, fname):
    if not ACORN:
        return [("WARN", "Acorn not found — skipping syntax check")]
    with tempfile.NamedTemporaryFile('w', suffix='.js', delete=False, encoding='utf-8') as tf:
        tf.write(js)
        path = tf.name
    try:
        r = subprocess.run(['node', ACORN, '--ecma2021', '--module', path],
                           capture_output=True, text=True, timeout=60)
        if r.returncode != 0:
            msg = (r.stderr or r.stdout or 'parse error').strip().splitlines()
            return [("ERROR", "Syntax: " + (msg[0] if msg else 'parse error'))]
        return []
    finally:
        os.unlink(path)

# ── CHECK 2: getElementById orphans ──────────────────────────────────────────
# Collect all id="..." present in the HTML, then flag getElementById('x') / ("x")
# where x is a plain literal not present. Skip dynamic ids (template literals,
# concatenation, variables).
ID_ATTR_RE   = re.compile(r'\bid\s*=\s*["\']([^"\']+)["\']')
GET_BY_ID_RE = re.compile(r"""getElementById\(\s*(['"])([^'"]+?)\1\s*\)""")

def check_dom_orphans(html, fname):
    defined = set(ID_ATTR_RE.findall(html))
    out = []
    seen = set()
    for m in GET_BY_ID_RE.finditer(html):
        wanted = m.group(2)
        if wanted in seen:
            continue
        seen.add(wanted)
        if not re.match(r'^[A-Za-z0-9_\-:.]+$', wanted):
            continue
        if wanted not in defined:
            # Is the call followed by optional chaining (?.) or guarded?
            # `getElementById('x')?.value` → silent (undefined), WARN
            # `getElementById('x').value` → crashes, ERROR
            tail = html[m.end():m.end()+3]
            if tail.startswith('?.'):
                out.append(("WARN",
                    f"getElementById('{wanted}') — no id=\"{wanted}\" in {fname} (uses ?. so no crash, but value never read → silent bug)"))
            else:
                out.append(("ERROR",
                    f"getElementById('{wanted}').<...> — no id=\"{wanted}\" in {fname} → will throw on access"))
    return out

# ── CHECK 3: async functions called without await ────────────────────────────
# Find `async function NAME` and `const NAME = async`, then look for call sites
# `NAME(` that are NOT preceded by await / .then / = (assignment is often fine
# but we still warn) and not part of the definition line.
ASYNC_DECL_RE = re.compile(r'\basync\s+function\s+([A-Za-z_$][\w$]*)')
ASYNC_ARROW_RE = re.compile(r'\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*async\b')

# functions that are async but intentionally fire-and-forget everywhere —
# warning on these is pure noise. Add to this list as patterns are confirmed safe.
FIRE_AND_FORGET = {
    'saveAll', 'autosave', 'loadTrackerData', 'initDashGate', 'generateBriefing',
    'loadTenderRegister', 'loadTenderFolderFiles', 'openEmsDrawer', 'trLoadContacts',
    'loadClientBookFromSQL', 'loadQuotesFromSQL', 'readPlanswiftPDF', 'renderClientHistory',
    'selectQuote',
    # NOTE: qbFetch / trFetch deliberately NOT here — a missing await on a fetch
    # is exactly the nextQuoteRef() class of bug. Better to warn and eyeball.
}

def check_async_no_await(js, fname):
    async_names = (set(ASYNC_DECL_RE.findall(js)) | set(ASYNC_ARROW_RE.findall(js))) - FIRE_AND_FORGET
    out = []
    lines = js.split('\n')
    for name in sorted(async_names):
        call_re = re.compile(r'(?<![\w$.])' + re.escape(name) + r'\s*\(')
        for i, line in enumerate(lines, 1):
            # skip the definition itself
            if re.search(r'\basync\s+function\s+' + re.escape(name) + r'\b', line):
                continue
            if re.search(r'\b' + re.escape(name) + r'\s*=\s*async\b', line):
                continue
            for cm in call_re.finditer(line):
                start = cm.start()
                before = line[:start]
                # ok patterns: await NAME(  /  return await  / .then chaining /
                # passing as callback (e.g. onclick="NAME()" is fine — fire&forget) /
                # awaited via Promise.all([NAME()]) etc.
                stripped = before.rstrip()
                if stripped.endswith('await'):
                    continue
                # inside an onclick/onchange HTML attribute → fire-and-forget, fine
                if 'onclick=' in line or 'onchange=' in line or 'oninput=' in line or 'onsubmit=' in line:
                    continue
                # Promise.all / Promise.race / .map(...) contexts → usually intended
                if 'Promise.all' in line or 'Promise.race' in line or '.then(' in line:
                    continue
                # assigned to a variable WITHOUT await → the classic bug
                # e.g.  const ref = nextQuoteRef();
                assign_m = re.search(r'(?:const|let|var)\s+[\w$]+\s*=\s*$', stripped)
                if assign_m:
                    out.append(("ERROR",
                        f"line {i}: `{line.strip()[:80]}` — {name}() is async but assigned without await → result is a Promise"))
                    continue
                # bare expression statement call without await → warn (could be
                # intentional fire-and-forget, but often a missed await)
                if stripped == '' or stripped.endswith(('{', ';', ')', '&&', '||', '(')):
                    out.append(("WARN",
                        f"line {i}: `{line.strip()[:80]}` — {name}() async, no await (fire-and-forget? verify)"))
    return out

# ── CHECK 4: onclick/onchange handlers with no function defined ───────────────
HANDLER_RE = re.compile(r'\bon(?:click|change|input|submit|mouseover|mouseout|blur|focus)\s*=\s*["\']([^"\']+)["\']')
CALL_NAME_RE = re.compile(r'([A-Za-z_$][\w$]*)\s*\(')

def check_onclick_ghosts(html, js, fname):
    # gather defined function names (declarations + arrow assignments + obj methods)
    defined = set(re.findall(r'\bfunction\s+([A-Za-z_$][\w$]*)', js))
    defined |= set(re.findall(r'\b(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:function|\()', js))
    defined |= set(re.findall(r'\bwindow\.([A-Za-z_$][\w$]*)\s*=', js))
    # also accept names assigned as window.x or hoisted via shared.js (can't see) →
    # so this is WARN, never ERROR (shared.js defines many handlers cross-file)
    out = []
    seen = set()
    # builtins / DOM globals that are fine
    GLOBALS = {'event','this','window','document','alert','confirm','prompt','console',
               'parseInt','parseFloat','setTimeout','setInterval','JSON','Math','Date',
               'String','Number','Array','Object','location','history','open','close',
               'sendPrompt','if','for','while','switch','return','typeof','new','void','delete'}
    for m in HANDLER_RE.finditer(html):
        expr = m.group(1)
        for cm in CALL_NAME_RE.finditer(expr):
            name = cm.group(1)
            # skip method calls — preceded by a dot (e.g. JSON.stringify, x.replace)
            if cm.start() > 0 and expr[cm.start()-1] == '.':
                continue
            if name in seen or name in GLOBALS or name in defined:
                continue
            seen.add(name)
            out.append(("WARN",
                f"on-handler calls {name}() — not defined in {fname} (ok if it lives in shared.js, else broken)"))
    return out

# ── runner ────────────────────────────────────────────────────────────────────
def check_file(path):
    fname = os.path.basename(path)
    with open(path, encoding='utf-8') as f:
        html = f.read()
    js = extract_inline_js(html)
    findings = []
    findings += check_syntax(js, fname)
    findings += check_dom_orphans(html, fname)
    findings += check_async_no_await(js, fname)
    findings += check_onclick_ghosts(html, js, fname)
    return findings

def main():
    args = [a for a in sys.argv[1:] if a.endswith('.html')]
    if args:
        files = args
    else:
        files = sorted(glob.glob(os.path.join(os.path.dirname(os.path.abspath(__file__)), '*.html')))
    # steel-database.html and hub.html don't load shared.js and are mostly static —
    # still check syntax but onclick-ghost warnings there are noise; we keep them.

    total_errors = 0
    total_warns = 0
    print(f"preflight: checking {len(files)} file(s)\n" + "=" * 60)
    for path in files:
        fname = os.path.basename(path)
        findings = check_file(path)
        errors = [f for f in findings if f[0] == "ERROR"]
        warns  = [f for f in findings if f[0] == "WARN"]
        total_errors += len(errors)
        total_warns  += len(warns)
        if not findings:
            print(f"✓ {fname}")
            continue
        status = "✗" if errors else "⚠"
        print(f"{status} {fname}  ({len(errors)} error, {len(warns)} warn)")
        for level, msg in errors:
            print(f"    ERROR  {msg}")
        for level, msg in warns:
            print(f"    warn   {msg}")
    print("=" * 60)
    print(f"TOTAL: {total_errors} error(s), {total_warns} warning(s)")
    if total_errors:
        print("\n❌ ERRORS must be fixed before push.")
        return 1
    print("\n✓ No blocking errors. Review warnings above (may be false positives).")
    return 0

if __name__ == '__main__':
    sys.exit(main())

#!/usr/bin/env bash
# BAMA ERP — the pre-deploy gate. Run by the CI "verify" job in BOTH workflows
# and usable locally: `bash tests/run-gates.sh`. Red = deploy blocked.
#
#   1. node --check shared.js                    (syntax; one error breaks every page)
#   2. python3 preflight.py                      (Acorn syntax on inline <script> + intent checks; ERRORS only)
#   3. node tests/*.js                           (every self-contained gate; see SKIP)
#
# SKIP: gates that need network, local fixtures or optional deps. Everything else
# in tests/*.js runs automatically — a new test file joins the gate by existing.
#   ifc-harness.js  — needs web-ifc + real customer geometry in tests/fixtures/
#   test_takeoff.py — same fixtures (pytest, not node)
set -u
cd "$(dirname "$0")/.."
SKIP=("ifc-harness.js")

fail=0
step() { printf '\n\033[1m== %s\033[0m\n' "$*"; }

step "node --check shared.js"
node --check shared.js || fail=1

step "python3 preflight.py (strict)"
if [ -z "${ACORN_BIN:-}" ]; then
  # Try the global npm root, then anything preflight.py can find on its own.
  g="$(npm root -g 2>/dev/null)/acorn/bin/acorn"
  [ -f "$g" ] && export ACORN_BIN="$g"
fi
PREFLIGHT_STRICT="${PREFLIGHT_STRICT:-1}" python3 preflight.py > /tmp/preflight.out 2>&1
rc=$?
grep -E '^(TOTAL|✗|❌|    ERROR)' /tmp/preflight.out || tail -3 /tmp/preflight.out
[ $rc -eq 0 ] || fail=1

step "node tests/*.js"
for t in tests/*.js; do
  b="$(basename "$t")"
  skip=0; for s in "${SKIP[@]}"; do [ "$b" = "$s" ] && skip=1; done
  if [ $skip -eq 1 ]; then printf '  skip %s (needs fixtures/deps)\n' "$b"; continue; fi
  if out="$(node "$t" 2>&1)"; then
    printf '  ok   %-28s %s\n' "$b" "$(printf '%s\n' "$out" | grep -E 'passed|Golden' | tail -1)"
  else
    printf '  FAIL %s\n' "$b"; printf '%s\n' "$out" | tail -25; fail=1
  fi
done

echo
if [ $fail -ne 0 ]; then echo "❌ GATES RED — deploy blocked"; exit 1; fi
echo "✓ all gates green"

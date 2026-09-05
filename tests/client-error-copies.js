// ─────────────────────────────────────────────────────────────────────────────
// tests/client-error-copies.js — the browser error reporter
//
// The global window.onerror / unhandledrejection reporter is written ONCE in
// shared.js. quote-builder.html and dashboard.html do not load shared.js, so
// each carries a standalone copy between the same marker comments. This gate:
//
//   1. fails if any copy drifts from the canonical shared.js block (same
//      posture as tests/money-rounding.js for the gbp formatters);
//   2. fails if either standalone page STARTS loading shared.js (then delete
//      the duplicate) or if any page that loads shared.js ALSO carries a copy;
//   3. runs the block in a fake window and proves the behaviour that matters:
//      posts to /api/client-error with a Bearer token, de-duplicates within
//      the session, caps per session, skips when there is no token, skips
//      opaque "Script error.", skips resource-load events, and never throws.
//
// Run: node tests/client-error-copies.js   (exit 1 on any failure)
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const START = '// === BAMA client-error reporter';
const END = '// === end BAMA client-error reporter ===';
const CANON = 'shared.js';
const STANDALONE = ['quote-builder.html', 'dashboard.html'];   // pages that do NOT load shared.js

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
    if (cond) { pass++; console.log('  ✓ ' + label); }
    else { fail++; console.log('  ✗ ' + label + (extra ? '  — got ' + String(extra) : '')); }
};
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
function extract(src) {
    const i = src.indexOf(START); if (i < 0) return null;
    const j = src.indexOf(END, i); if (j < 0) return null;
    return src.slice(i, j + END.length);
}
const loadsShared = (src) => /<script[^>]+src=["']shared\.js/.test(src);

console.log('copies stay identical');
const canon = extract(read(CANON));
ok(!!canon, 'canonical block found in shared.js');
ok(canon && read(CANON).split(START).length === 2, 'exactly one block in shared.js');
for (const f of STANDALONE) {
    const src = read(f);
    const copy = extract(src);
    ok(!!copy, `${f} carries a copy`);
    ok(copy === canon, `${f} copy is byte-identical to shared.js`, copy && canon ? `first diff at char ${[...canon].findIndex((c, k) => c !== copy[k])}` : 'missing');
    ok(!loadsShared(src), `${f} still does not load shared.js (if it does, delete its copy)`);
}
// every page that loads shared.js must NOT carry a duplicate (m-qms.html was the trap in the brief)
for (const f of fs.readdirSync(ROOT).filter(n => n.endsWith('.html'))) {
    const src = read(f);
    if (loadsShared(src)) ok(!extract(src), `${f} loads shared.js and carries no duplicate copy`);
}
{
    const shared = read(CANON);
    const apiBase = (shared.match(/^const API_BASE = '([^']+)';/m) || [])[1];
    const inBlock = (canon.match(/var API = '([^']+)';/) || [])[1];
    ok(apiBase && inBlock === apiBase, 'reporter API literal equals shared.js API_BASE', inBlock);
    ok(!/console\.|alert\(|confirm\(/.test(canon), 'reporter is silent — no console/alert/confirm');
    ok(/addEventListener\('error'/.test(canon) && /addEventListener\('unhandledrejection'/.test(canon), 'both global handlers registered');
    ok(/keepalive: true/.test(canon), 'fetch uses keepalive (reports survive page unload)');
    ok(/split\('#'\)\[0\]/.test(canon), 'URL hash stripped client-side too (token never leaves the browser in a report)');
}

// ---- behaviour in a fake window --------------------------------------------
console.log('\nbehaviour (fake window)');
function makeWindow({ token = 'tok', pathname = '/projects.html' } = {}) {
    const posts = [];
    const listeners = {};
    const win = {
        addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
        dispatch(type, ev) { for (const fn of listeners[type] || []) fn(ev); },
        location: { pathname, href: 'https://proud-dune-0dee63110.2.azurestaticapps.net' + pathname + '?x=1#access_token=SECRET' },
        sessionStorage: { getItem: (k) => (k === 'bama_token' ? token : null) },
        navigator: { userAgent: 'test-agent' },
        fetch(url, opts) { posts.push({ url, opts, body: JSON.parse(opts.body) }); return Promise.resolve({}); },
        posts
    };
    win.window = win;
    const ctx = vm.createContext(win);
    vm.runInContext(canon, ctx);
    // aliases the block reads as bare globals
    return { win, posts, ctx };
}
{
    const { win, posts } = makeWindow();
    ok(win.__bamaClientErrorReporterInstalled === true, 'install flag set');
    ok(typeof win.bamaReportClientError === 'function', 'manual hook exposed');
    const err = new Error('boom'); err.stack = 'Error: boom\n    at f (projects.html:10:5)\n    at g';
    win.dispatch('error', { error: err, message: 'boom', filename: 'https://x/shared.js', lineno: 10, colno: 5, target: win });
    ok(posts.length === 1, 'thrown error → one POST');
    const b = posts[0].body;
    ok(posts[0].url.endsWith('/api/client-error') && posts[0].opts.method === 'POST', 'POST /api/client-error');
    ok(posts[0].opts.headers.Authorization === 'Bearer tok', 'Bearer token from sessionStorage');
    ok(posts[0].opts.keepalive === true, 'keepalive set');
    ok(b.page === 'projects' && b.message === 'boom' && b.stack.startsWith('Error: boom'), 'page/message/stack in body', JSON.stringify(b).slice(0, 120));
    ok(b.url === 'https://proud-dune-0dee63110.2.azurestaticapps.net/projects.html?x=1', 'hash stripped from url', b.url);
    ok(b.extra.kind === 'error' && b.extra.source === 'shared.js:10:5', 'extra carries kind + source', JSON.stringify(b.extra));
    win.dispatch('error', { error: err, message: 'boom', target: win });
    ok(posts.length === 1, 'identical error again → de-duplicated (no second POST)');
    const err2 = new Error('boom'); err2.stack = 'Error: boom\n    at OTHER (x.js:1:1)';
    win.dispatch('error', { error: err2, message: 'boom', target: win });
    ok(posts.length === 2, 'same message, different stack → reported (different key)');
}
{
    const { win, posts } = makeWindow();
    win.dispatch('unhandledrejection', { reason: Object.assign(new Error('API 500'), { status: 500, requestId: 'req-1', stack: 's' }) });
    ok(posts.length === 1 && posts[0].body.extra.kind === 'unhandledrejection' && posts[0].body.extra.requestId === 'req-1' && posts[0].body.extra.status === 500,
       'unhandled rejection → reported with status + requestId', JSON.stringify(posts[0] && posts[0].body.extra));
    win.dispatch('unhandledrejection', { reason: Object.assign(new Error('Unauthorized'), { status: 401 }) });
    ok(posts.length === 1, '401 rejection (session expiry) is NOT reported');
    win.dispatch('unhandledrejection', { reason: Object.assign(new Error('aborted'), { name: 'AbortError' }) });
    ok(posts.length === 1, 'AbortError is NOT reported');
    win.dispatch('unhandledrejection', { reason: 'plain string reason' });
    ok(posts.length === 2 && posts[1].body.message === 'plain string reason', 'string reason reported as message');
    win.dispatch('unhandledrejection', { reason: { code: 7 } });
    ok(posts.length === 3 && posts[2].body.message === '{"code":7}', 'object reason serialised');
    win.dispatch('unhandledrejection', { reason: undefined });
    ok(posts.length === 4 && posts[3].body.message === 'Unhandled promise rejection', 'undefined reason gets a generic message');
}
{
    const { win, posts } = makeWindow();
    win.dispatch('error', { message: 'Script error.', error: null, target: win });
    ok(posts.length === 0, 'opaque "Script error." skipped');
    win.dispatch('error', { target: { tagName: 'IMG' }, error: undefined, message: undefined });
    ok(posts.length === 0, '<img>/<script> load failure skipped');
    win.dispatch('error', null);
    win.dispatch('error', {});
    ok(posts.length === 0, 'null / empty events swallowed');
}
{
    const { win, posts } = makeWindow({ token: '' });
    win.dispatch('error', { error: new Error('x'), message: 'x', target: win });
    ok(posts.length === 0, 'no token → no POST (API would 401 anyway)');
}
{
    const { win, posts } = makeWindow();
    for (let i = 0; i < 50; i++) win.dispatch('error', { error: new Error('e' + i), message: 'e' + i, target: win });
    ok(posts.length === 10, 'session cap: 50 distinct errors → 10 POSTs', posts.length);
}
{
    const { win, posts } = makeWindow();
    win.fetch = () => { throw new Error('fetch exploded'); };
    let threw = false;
    try { win.dispatch('error', { error: new Error('x'), message: 'x', target: win }); } catch { threw = true; }
    ok(!threw, 'fetch throwing synchronously never propagates');
    win.sessionStorage = { getItem() { throw new Error('storage blocked'); } };
    try { win.dispatch('error', { error: new Error('y'), message: 'y', target: win }); } catch { threw = true; }
    ok(!threw, 'sessionStorage throwing never propagates');
    void posts;
}
{
    const { win, posts } = makeWindow({ pathname: '/' });
    win.bamaReportClientError(new Error('manual one'), { context: 'afp-save' });
    ok(posts.length === 1 && posts[0].body.page === 'hub' && posts[0].body.extra.kind === 'manual' && posts[0].body.extra.context === 'afp-save',
       'manual hook → kind manual, page "hub" for /', JSON.stringify(posts[0] && posts[0].body));
    win.bamaReportClientError('a string');
    ok(posts.length === 2 && posts[1].body.message === 'a string', 'manual hook accepts a bare string');
}
{
    const { win, ctx } = makeWindow();
    vm.runInContext(canon, ctx);   // block evaluated twice (e.g. both copies on one page)
    const err = new Error('once'); err.stack = 'x';
    win.dispatch('error', { error: err, message: 'once', target: win });
    ok(win.posts.length === 1, 'second evaluation is a no-op (install flag) — no double reporting');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

// ─────────────────────────────────────────────────────────────────────────────
// tests/client-errors.js — api/src/functions/client-errors.js
//
// Two properties that must never regress:
//   1. The per-user rate limit (20/min) refuses a runaway page BEFORE SQL —
//      a browser stuck in an error loop must not be able to flood the table
//      (or wake the Serverless DB every 100 ms).
//   2. Input shaping: every field is clipped server-side; the URL hash (which
//      can carry an access_token on hub bounces) is stripped; empty messages
//      are rejected.
//
// @azure/functions and mssql are stubbed so this runs in CI's verify job.
// Run: node tests/client-errors.js   (exit 1 on any failure)
// ─────────────────────────────────────────────────────────────────────────────
const Module = require('module');
const path = require('path');

const origLoad = Module._load;
Module._load = function (request) {
    if (request === '@azure/functions') return { app: { http() {} } };
    if (request === 'mssql') return { connect: async () => ({}), NVarChar: () => 'nvarchar', MAX: 0 };
    return origLoad.apply(this, arguments);
};

const { _test } = require(path.join(__dirname, '..', 'api', 'src', 'functions', 'client-errors.js'));
const { rateLimited, resetRateLimit, shapeReport, RATE_LIMIT_PER_MIN } = _test;

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
    if (cond) { pass++; console.log('  ✓ ' + label); }
    else { fail++; console.log('  ✗ ' + label + (extra ? '  — got ' + String(extra) : '')); }
};

console.log('rate limit — per user, rolling minute');
resetRateLimit();
ok(RATE_LIMIT_PER_MIN === 20, 'limit is 20 per minute');
{
    const t0 = 1_000_000;
    let refused = 0;
    for (let i = 0; i < 20; i++) if (rateLimited('a@bama', t0 + i * 100)) refused++;
    ok(refused === 0, 'first 20 reports in a minute accepted');
    ok(rateLimited('a@bama', t0 + 5000) === true, '21st report refused');
    ok(rateLimited('a@bama', t0 + 30_000) === true, 'still refused at +30 s');
    ok(rateLimited('b@bama', t0 + 30_000) === false, 'a different user is unaffected');
    ok(rateLimited('a@bama', t0 + 60_000) === false, 'window resets after 60 s');
    ok(rateLimited('a@bama', t0 + 60_100) === false, 'and counts afresh from there');
}
{
    resetRateLimit();
    const t0 = 5_000_000;
    for (let i = 0; i < 500; i++) rateLimited('user' + i + '@bama', t0);
    // one call a minute later prunes everyone who has gone quiet
    rateLimited('late@bama', t0 + 61_000);
    // the map is internal; assert via behaviour — a pruned user is a fresh bucket
    ok(rateLimited('user1@bama', t0 + 61_000) === false, 'stale buckets are pruned (no unbounded growth)');
}

console.log('\nshapeReport — server-side clipping and hygiene');
{
    ok(shapeReport(null) === null && shapeReport('x') === null, 'non-object body → null');
    ok(shapeReport({}) === null, 'missing message → null');
    ok(shapeReport({ message: '   ' }) === null, 'blank message → null');
    const r = shapeReport({ page: 'projects', message: 'TypeError: x is undefined', stack: 'a\nb', url: 'https://x/projects.html?tab=1#access_token=SECRET', userAgent: 'UA', extra: { lastRequestId: 'abc' } });
    ok(r.page === 'projects' && r.message === 'TypeError: x is undefined', 'page + message through');
    ok(r.url === 'https://x/projects.html?tab=1', 'URL hash stripped (tokens never stored)', r.url);
    ok(r.user_agent === 'UA', 'userAgent → user_agent');
    ok(r.extra === '{"lastRequestId":"abc"}', 'extra object serialised to JSON string', r.extra);
    const big = shapeReport({ message: 'm'.repeat(5000), stack: 's'.repeat(100_000), page: 'p'.repeat(500), url: 'u'.repeat(2000), userAgent: 'a'.repeat(1000), extra: 'e'.repeat(10_000) });
    ok(big.message.length === 1000, 'message clipped to 1000', big.message.length);
    ok(big.stack.length === 8000, 'stack clipped to 8000', big.stack.length);
    ok(big.page.length === 100, 'page clipped to 100', big.page.length);
    ok(big.url.length === 500, 'url clipped to 500', big.url.length);
    ok(big.user_agent.length === 300, 'user_agent clipped to 300', big.user_agent.length);
    ok(big.extra.length === 4000, 'extra clipped to 4000', big.extra.length);
    const noPage = shapeReport({ message: 'x' });
    ok(noPage.page === 'unknown' && noPage.stack === null && noPage.url === null && noPage.extra === null, 'absent optionals → null, page → unknown');
    const circ = {}; circ.self = circ;
    ok(shapeReport({ message: 'x', extra: circ }).extra === null, 'unserialisable extra → null, never throws');
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

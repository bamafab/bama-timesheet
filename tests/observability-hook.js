// ─────────────────────────────────────────────────────────────────────────────
// tests/observability-hook.js — api/src/functions/observability.js
//
// The postInvocation hook is the ONLY place that (a) stamps X-Request-Id on
// every HTTP response, (b) logs route + user email on any 5xx, and (c) turns
// an uncaught throw into a CORS'd JSON 500. If it regresses, nothing tells
// anyone the API is failing — which is the exact state Session 2 fixes.
//
// No network, no @azure/functions install needed: the module is stubbed so
// the gate runs in CI's verify job (which has no api/node_modules).
// Run: node tests/observability-hook.js   (exit 1 on any failure)
// ─────────────────────────────────────────────────────────────────────────────
const Module = require('module');
const path = require('path');

let registeredHook = null;
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (request === '@azure/functions') {
        return { app: { http() {}, hook: { postInvocation(fn) { registeredHook = fn; } } } };
    }
    return origLoad.apply(this, arguments);
};

const obs = require(path.join(__dirname, '..', 'api', 'src', 'functions', 'observability.js'));
const auth = require(path.join(__dirname, '..', 'api', 'src', 'auth.js'));
const { afterInvocation, stampRequestId, REQUEST_ID_HEADER } = obs;

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
    if (cond) { pass++; console.log('  ✓ ' + label); }
    else { fail++; console.log('  ✗ ' + label + (extra ? '  — got ' + String(extra) : '')); }
};

// ---- fakes ---------------------------------------------------------------
function fakeRequest(method = 'GET', pathname = '/api/projects', origin = 'https://proud-dune-0dee63110.2.azurestaticapps.net') {
    return {
        method,
        url: 'https://bama-erp-api-deauckd2cja7ebd5.uksouth-01.azurewebsites.net' + pathname,
        headers: { get: (k) => (k.toLowerCase() === 'origin' ? origin : null) }
    };
}
function fakeIc(invocationId = '0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b', triggerType = 'httpTrigger') {
    const logs = { error: [], warn: [] };
    return {
        invocationId,
        options: { trigger: { type: triggerType, name: 'req' } },
        error: (...a) => logs.error.push(a),
        warn: (...a) => logs.warn.push(a),
        _logs: logs
    };
}
function run(hookCtx) { afterInvocation(hookCtx); return hookCtx; }

// ---- 1. registration -----------------------------------------------------
console.log('hook registration');
ok(typeof registeredHook === 'function', 'postInvocation hook registered on load');
ok(REQUEST_ID_HEADER === 'X-Request-Id', 'header name is X-Request-Id');

// ---- 2. request-id stamping ----------------------------------------------
console.log('\nX-Request-Id on every HTTP response');
{
    const req = fakeRequest(); const ic = fakeIc();
    const ctx = run({ inputs: [req], result: { status: 200, jsonBody: [], headers: { 'Content-Type': 'application/json' } }, error: undefined, invocationContext: ic });
    ok(ctx.result.headers[REQUEST_ID_HEADER] === ic.invocationId, '200 response stamped with the invocationId');
    ok(ctx.result.headers['Content-Type'] === 'application/json', 'existing headers untouched');
    ok(ctx.result.status === 200, 'status untouched');
    ok(ic._logs.error.length === 0, 'no error log on a 200');
}
{
    const req = fakeRequest('OPTIONS'); const ic = fakeIc();
    const ctx = run({ inputs: [req], result: { status: 204, headers: {} }, error: undefined, invocationContext: ic });
    ok(ctx.result.headers[REQUEST_ID_HEADER] === ic.invocationId, 'preflight 204 stamped too (harmless, consistent)');
}
{
    const ic = fakeIc();
    const ctx = run({ inputs: [fakeRequest()], result: { status: 200, jsonBody: {} }, error: undefined, invocationContext: ic });
    ok(ctx.result.headers && ctx.result.headers[REQUEST_ID_HEADER] === ic.invocationId, 'result with no headers object gets one created');
}
{
    const ic = fakeIc();
    const hdrs = new Map(); hdrs.set = hdrs.set.bind(hdrs);
    const ctx = run({ inputs: [fakeRequest()], result: { status: 200, headers: hdrs }, error: undefined, invocationContext: ic });
    ok(hdrs.get(REQUEST_ID_HEADER) === ic.invocationId, 'Headers-like object (has .set) is used via .set');
}
{
    const ic = fakeIc();
    const ctx = run({ inputs: [fakeRequest()], result: 'plain string body', error: undefined, invocationContext: ic });
    ok(ctx.result === 'plain string body', 'non-object result left exactly as returned');
}
{
    const ic = fakeIc();
    const ctx = run({ inputs: [fakeRequest()], result: undefined, error: undefined, invocationContext: ic });
    ok(ctx.result === undefined, 'undefined result left undefined (host default)');
}
ok(stampRequestId({ status: 200 }, 'abc').headers['X-Request-Id'] === 'abc', 'stampRequestId helper direct');

// ---- 3. 5xx logging with route + user -------------------------------------
console.log('\n5xx responses log route + user email + reqId');
{
    const req = fakeRequest('POST', '/api/invoices'); const ic = fakeIc();
    const ctx = run({ inputs: [req], result: { status: 500, jsonBody: { error: 'Failed' }, headers: {} }, error: undefined, invocationContext: ic });
    ok(ic._logs.error.length === 1, 'exactly one [5xx] log line on a returned 500');
    const line = String(ic._logs.error[0][0]);
    ok(/^\[5xx\] POST \/api\/invoices status=500 /.test(line), 'line carries METHOD + route + status', line);
    ok(/user=anonymous/.test(line), 'no auth user → user=anonymous (never undefined)', line);
    ok(line.includes('reqId=' + ic.invocationId), 'line carries the invocationId', line);
    ok(ctx.result.status === 500 && ctx.result.jsonBody.error === 'Failed', 'handler body preserved (not rewritten)');
    ok(ctx.result.headers[REQUEST_ID_HEADER] === ic.invocationId, '500 also stamped with request id');
}
{
    // email path — requireAuth stores the user in a WeakMap keyed by request;
    // the hook reads it via auth.getAuthUser at call time (seam).
    const req = fakeRequest('PUT', '/api/projects/12'); const ic = fakeIc();
    ok(auth.getAuthUser(req) === null, 'getAuthUser → null before requireAuth has run');
    ok(auth.getAuthUser(null) === null && auth.getAuthUser('x') === null, 'getAuthUser tolerates non-object input');
    const realGet = auth.getAuthUser;
    auth.getAuthUser = (r) => (r === req ? { email: 'natasza@bamafabrication.co.uk', name: 'Natasza Laucis', userId: 'oid-1' } : null);
    try {
        run({ inputs: [req], result: { status: 500, jsonBody: { error: 'x' }, headers: {} }, error: undefined, invocationContext: ic });
        const line = String(ic._logs.error[0][0]);
        ok(/user=natasza@bamafabrication\.co\.uk/.test(line), 'authenticated user → email on the line', line);
        ok(!/Natasza Laucis/.test(line) && !/oid-1/.test(line), 'only the email — no name / oid (PII rule)', line);
    } finally { auth.getAuthUser = realGet; }
}
{
    const req = fakeRequest('GET', '/api/health-check'); const ic = fakeIc();
    const ctx = run({ inputs: [req], result: { status: 503, jsonBody: { error: 'db' }, headers: {} }, error: undefined, invocationContext: ic });
    ok(ic._logs.error.length === 1 && /status=503/.test(String(ic._logs.error[0][0])), '503 counts as 5xx');
    void ctx;
}
{
    const req = fakeRequest('GET', '/api/x'); const ic = fakeIc();
    run({ inputs: [req], result: { status: 404, jsonBody: { error: 'nf' }, headers: {} }, error: undefined, invocationContext: ic });
    ok(ic._logs.error.length === 0, '404 is not logged as a server error');
    run({ inputs: [req], result: { status: 401, jsonBody: {}, headers: {} }, error: undefined, invocationContext: ic });
    ok(ic._logs.error.length === 0, '401 is not logged as a server error');
}

// ---- 4. uncaught throw → CORS'd JSON 500 -----------------------------------
console.log('\nuncaught throw becomes a CORS\'d JSON 500');
{
    const req = fakeRequest('POST', '/api/job-assemblies'); const ic = fakeIc();
    const boom = new TypeError("Cannot read properties of undefined (reading 'quantity')");
    const ctx = run({ inputs: [req], result: undefined, error: boom, invocationContext: ic });
    ok(ctx.error === undefined, 'error cleared so the host returns our response');
    ok(ctx.result && ctx.result.status === 500, 'result is a 500');
    ok(ctx.result.jsonBody.error === 'Internal server error', 'generic message — stack never sent to the browser');
    ok(ctx.result.jsonBody.request_id === ic.invocationId.replace(/-/g, '').slice(0, 8), 'body carries short request_id for support');
    ok(ctx.result.headers['Access-Control-Allow-Origin'] === 'https://proud-dune-0dee63110.2.azurestaticapps.net', 'CORS origin header present (browser can read the 500)');
    ok(ctx.result.headers['Access-Control-Expose-Headers'] === 'X-Request-Id', 'X-Request-Id exposed to the browser');
    ok(ctx.result.headers[REQUEST_ID_HEADER] === ic.invocationId, 'full request id in the header');
    ok(ic._logs.error.length === 1, 'exactly one error log');
    const [line, err] = ic._logs.error[0];
    ok(/UNHANDLED/.test(line) && /POST \/api\/job-assemblies/.test(line), 'log line marked UNHANDLED with route', line);
    ok(err === boom, 'the thrown error object itself is passed to context.error (stack reaches App Insights)');
}

// ---- 5. non-HTTP invocations pass straight through --------------------------
console.log('\nnon-HTTP invocations untouched');
{
    const ic = fakeIc('abc', 'timerTrigger');
    const timerErr = new Error('timer boom');
    const ctx = run({ inputs: [{ isPastDue: false }], result: undefined, error: timerErr, invocationContext: ic });
    ok(ctx.error === timerErr, 'timer trigger error left alone (host handles it)');
    ok(ctx.result === undefined, 'timer result left alone');
    ok(ic._logs.error.length === 0, 'no HTTP-shaped logging for a timer');
}
{
    const ic = fakeIc();
    const ctx = run({ inputs: [], result: { status: 200 }, error: undefined, invocationContext: ic });
    ok(!ctx.result.headers, 'http trigger with no request input → nothing stamped (defensive)');
}
{
    const ic = fakeIc();
    ic.options = undefined;
    const ctx = run({ inputs: [fakeRequest()], result: { status: 500 }, error: undefined, invocationContext: ic });
    ok(ic._logs.error.length === 0 && !ctx.result.headers, 'missing options → treated as non-HTTP, untouched');
}

// ---- 6. the registered wrapper never throws --------------------------------
console.log('\nthe hook itself can never fail a request');
{
    const ic = fakeIc();
    let threw = false;
    try { registeredHook({ inputs: null, result: null, error: null, invocationContext: null }); } catch { threw = true; }
    ok(!threw, 'garbage hook context swallowed (warn attempted, no throw)');
    void ic;
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

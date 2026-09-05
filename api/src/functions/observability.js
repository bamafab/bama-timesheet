// ─────────────────────────────────────────────────────────────────────────────
// observability.js — one hook, every HTTP function (Session 2, 2026-09-05)
//
// Registers an @azure/functions v4 postInvocation hook so that, without
// touching any of the ~57 handler files:
//
//   1. Every HTTP response carries `X-Request-Id: <invocationId>`. The same
//      id is `operation_Id` on the request/trace/exception rows in Application
//      Insights, so a user quoting "ref 1a2b3c4d" from an error lets support
//      jump straight to the matching invocation. Exposed to the browser via
//      Access-Control-Expose-Headers (responses.js).
//
//   2. Any response with status >= 500 — whether the handler returned
//      serverError() after its own context.error(), or threw — gets ONE extra
//      log line that carries what the handler-level messages don't:
//         [5xx] METHOD /api/route status=500 user=<email> reqId=<id>
//      No PII beyond the email. The handler's own exception trace shares the
//      invocationId, so the two join in App Insights.
//
//   3. An uncaught throw is converted into a CORS'd JSON 500
//      `{ error, request_id }`. Left alone, the host answers with a bare 500
//      that has no CORS headers, which the browser reports as "Failed to
//      fetch" — indistinguishable from the network being down. The exception
//      is still logged via context.error (route + user + stack), and the
//      response is still a 500, so the Function App's `Http 5xx` metric (the
//      alert rule) counts it exactly as before.
//
// Nothing here touches SQL — the Serverless auto-pause rule is unaffected.
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const auth = require('../auth');   // resolved at call time (test seam: auth.getAuthUser)
const { serverError } = require('../responses');

const REQUEST_ID_HEADER = 'X-Request-Id';

function isHttpInvocation(invocationContext) {
    const type = invocationContext?.options?.trigger?.type;
    return typeof type === 'string' && /^httpTrigger$/i.test(type);
}

// The handler's first input is the HttpRequest; guard because timer triggers
// (keep-warm) and anything else pass through the same hook.
function requestOf(inputs) {
    const r = Array.isArray(inputs) ? inputs[0] : null;
    return r && typeof r === 'object' && typeof r.method === 'string' && typeof r.url === 'string' ? r : null;
}

function routeOf(request) {
    try { return new URL(request.url).pathname; } catch { return String(request.url || ''); }
}

// Plain-object results (`{ status, jsonBody, headers }`) are what every helper
// in responses.js returns. Anything else (an HttpResponse instance, a string,
// undefined) is left exactly as the handler produced it.
function stampRequestId(result, requestId) {
    if (!result || typeof result !== 'object' || Array.isArray(result)) return result;
    if (typeof result.status !== 'number' && result.jsonBody === undefined && result.body === undefined) return result;
    const headers = result.headers;
    if (headers && typeof headers.set === 'function') {
        headers.set(REQUEST_ID_HEADER, requestId);
    } else if (headers && typeof headers === 'object' && !Array.isArray(headers)) {
        headers[REQUEST_ID_HEADER] = requestId;
    } else if (headers === undefined || headers === null) {
        result.headers = { [REQUEST_ID_HEADER]: requestId };
    }
    return result;
}

function statusOf(result) {
    if (!result || typeof result !== 'object') return 200;
    const s = Number(result.status);
    return Number.isFinite(s) ? s : 200;
}

function shortId(id) {
    return String(id || '').replace(/-/g, '').slice(0, 8) || 'unknown';
}

// Exported for tests/observability-hook.js — the hook body without the
// @azure/functions plumbing. `hookCtx` mirrors PostInvocationContext:
// { inputs, result, error, invocationContext }.
function afterInvocation(hookCtx) {
    const ic = hookCtx.invocationContext;
    if (!isHttpInvocation(ic)) return;
    const request = requestOf(hookCtx.inputs);
    if (!request) return;

    const requestId = ic.invocationId || '';
    const user = auth.getAuthUser(request);
    const who = (user && user.email) || 'anonymous';
    const route = routeOf(request);

    if (hookCtx.error) {
        const err = hookCtx.error;
        ic.error(`[5xx] ${request.method} ${route} status=500 user=${who} reqId=${requestId} UNHANDLED`, err);
        hookCtx.error = undefined;
        const res = serverError('Internal server error', request);
        res.jsonBody = { ...res.jsonBody, request_id: shortId(requestId) };
        hookCtx.result = stampRequestId(res, requestId);
        return;
    }

    const status = statusOf(hookCtx.result);
    if (status >= 500) {
        ic.error(`[5xx] ${request.method} ${route} status=${status} user=${who} reqId=${requestId}`);
    }
    hookCtx.result = stampRequestId(hookCtx.result, requestId);
}

if (app && app.hook && typeof app.hook.postInvocation === 'function') {
    app.hook.postInvocation((ctx) => {
        // The hook must never be the thing that fails a request.
        try { afterInvocation(ctx); } catch (e) {
            try { ctx.invocationContext.warn('observability hook failed:', e && e.message); } catch { /* ignore */ }
        }
    });
}

module.exports = { afterInvocation, stampRequestId, REQUEST_ID_HEADER, _shortId: shortId };

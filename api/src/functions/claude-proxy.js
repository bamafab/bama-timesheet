// Claude API Proxy
//
// Forwards requests from the frontend to Anthropic's API, adding the
// server-side API key. Exists because browsers cannot call api.anthropic.com
// directly (no CORS headers, and the API key must not be exposed client-side).
//
// POST /api/claude-proxy
// Body: standard Anthropic messages request body (model, max_tokens, system, messages)
// Returns: Anthropic response JSON as-is

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { ok, badRequest, serverError, preflight } = require('../responses');

app.http('claude-proxy', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'claude-proxy',
    handler: async (request) => {
        if (request.method === 'OPTIONS') return preflight(request);

        const auth = await requireAuth(request);
        if (auth.status) return auth;

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) {
            return serverError('ANTHROPIC_API_KEY not configured', request);
        }

        let body;
        try {
            body = await request.json();
        } catch {
            return badRequest('Invalid JSON body', request);
        }

        // Safety guard — only allow claude-* models to prevent misuse
        if (!body.model || !String(body.model).startsWith('claude-')) {
            return badRequest('Invalid model', request);
        }

        try {
            const upstream = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type':         'application/json',
                    'x-api-key':            apiKey,
                    'anthropic-version':    '2023-06-01'
                },
                body: JSON.stringify(body)
            });

            const data = await upstream.json();

            if (!upstream.ok) {
                // Surface Anthropic error detail without leaking the key
                return serverError(
                    `Anthropic API error ${upstream.status}: ${data?.error?.message || 'unknown'}`,
                    request
                );
            }

            return ok(data, request);
        } catch (e) {
            return serverError('Failed to reach Anthropic API: ' + e.message, request);
        }
    }
});

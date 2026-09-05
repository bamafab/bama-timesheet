// Claude API Proxy
//
// Forwards requests from the frontend to Anthropic's API, adding the
// server-side API key. Exists because browsers cannot call api.anthropic.com
// directly (no CORS headers, and the API key must not be exposed client-side).
//
// POST /api/claude-proxy
// Body: standard Anthropic messages request body (model, max_tokens, system, messages);
//       `model` optional — defaults to AI_MODEL_DEFAULT env / claude-sonnet-4-6
// Returns: Anthropic response JSON as-is

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { ok, badRequest, serverError, preflight, corsHeaders } = require('../responses');

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

        // Server-side model default (2026-09-05): pages that load shared.js send
        // AI_MODEL; standalone pages (quote-builder, dashboard) send none and take
        // env AI_MODEL_DEFAULT, falling back to the pinned model below.
        if (!body.model) body.model = process.env.AI_MODEL_DEFAULT || 'claude-sonnet-4-6';
        // Safety guard — only allow claude-* models to prevent misuse
        if (!String(body.model).startsWith('claude-')) {
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
                // Forward Anthropic's status code (e.g. 429 rate-limit, 529
                // overloaded) so the client's retry logic still fires. The body
                // carries only the error detail — the API key is never exposed.
                return {
                    status: upstream.status,
                    jsonBody: { error: { message: data?.error?.message || 'Anthropic API error', type: data?.error?.type || 'api_error' } },
                    headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
                };
            }

            return ok(data, request);
        } catch (e) {
            return serverError('Failed to reach Anthropic API: ' + e.message, request);
        }
    }
});

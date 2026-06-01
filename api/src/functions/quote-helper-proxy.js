// Quote Helper Proxy — no auth required, rate-limited by API key only
// Separate from claude-proxy which requires Microsoft login.
// Called from quote-builder.html which has no MSAL session.

const { app } = require('@azure/functions');
const { ok, serverError, preflight } = require('../responses');

app.http('quote-helper-proxy', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'quote-helper-proxy',
    handler: async (request) => {
        if (request.method === 'OPTIONS') return preflight(request);

        const apiKey = process.env.ANTHROPIC_API_KEY;
        if (!apiKey) return serverError('ANTHROPIC_API_KEY not configured', request);

        let body;
        try { body = await request.json(); }
        catch { return serverError('Invalid JSON', request); }

        if (!body.model || !String(body.model).startsWith('claude-')) {
            return serverError('Invalid model', request);
        }

        try {
            const upstream = await fetch('https://api.anthropic.com/v1/messages', {
                method: 'POST',
                headers: {
                    'Content-Type':      'application/json',
                    'x-api-key':         apiKey,
                    'anthropic-version': '2023-06-01'
                },
                body: JSON.stringify(body)
            });
            const data = await upstream.json();
            if (!upstream.ok) return serverError(`Anthropic ${upstream.status}: ${data?.error?.message || 'unknown'}`, request);
            return ok(data, request);
        } catch(e) {
            return serverError('Upstream error: ' + e.message, request);
        }
    }
});

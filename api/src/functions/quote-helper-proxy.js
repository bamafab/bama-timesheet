// Quote Helper Proxy
//
// Server-side proxy for the quote-builder.html Quote Helper feature.
// Forwards PDF analysis requests to Anthropic with the server API key.
// Uses Azure SWA x-ms-client-principal header for auth (no Bearer token needed).
// This keeps the API key server-side and avoids browser rate limits.

const { app } = require('@azure/functions');
const { ok, serverError, preflight, unauthorized } = require('../responses');

app.http('quote-helper-proxy', {
    methods: ['POST', 'OPTIONS'],
    authLevel: 'anonymous',
    route: 'quote-helper-proxy',
    handler: async (request) => {
        if (request.method === 'OPTIONS') return preflight(request);

        // Auth via Azure SWA — check x-ms-client-principal header
        const principal = request.headers.get('x-ms-client-principal');
        if (!principal) {
            return unauthorized('Not authenticated', request);
        }

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
            if (!upstream.ok) return serverError(`Anthropic error ${upstream.status}: ${data?.error?.message || 'unknown'}`, request);
            return ok(data, request);
        } catch(e) {
            return serverError('Failed to reach Anthropic: ' + e.message, request);
        }
    }
});

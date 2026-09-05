// BAMA ERP — API authentication (Microsoft identity platform).
//
// The frontend (hub.html, implicit flow) sends a *Graph-scoped* access token.
// Microsoft deliberately makes Graph tokens unverifiable by third parties: the
// JWT header carries a `nonce`, and the signature is computed over the header
// with `nonce` replaced by base64url(SHA-256(nonce)). We therefore verify in two
// stages (decision 2026-09-05, "B+C"):
//
//   B. Local RS256 verification against Microsoft's JWKS — raw header first, then
//      the nonce-normalised header. Cryptographically real, no network per token.
//   C. Graph introspection fallback — ONLY for a token that carries a header nonce
//      and fails B (i.e. Microsoft changed the nonce scheme). GET /v1.0/me with the
//      token; Graph verifies the signature for us; we require /me.id === payload.oid.
//      Result cached by SHA-256(token) until exp (negatives for 5 min).
//
// A token is NEVER accepted without B or C succeeding. Permanent fix (queued):
// expose an API-audience scope and request an API token alongside the Graph one,
// then delete the nonce handling and the introspection path — see CLAUDE.md.

const crypto = require('crypto');

const TENANT_ID = process.env.AZURE_TENANT_ID || 'c92626f5-e391-499a-9059-0113bd07da2d';
const CLIENT_ID = process.env.AZURE_CLIENT_ID || '04b702fd-c53c-4f38-94bc-0334ce91d954';

// JWKS URIs for Microsoft identity platform (v1 and v2)
const JWKS_URIS = [
    `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`,
    `https://login.microsoftonline.com/common/discovery/keys`
];
const GRAPH_ME_URI = 'https://graph.microsoft.com/v1.0/me?$select=id';

const KEY_CACHE_DURATION = 3600000;        // 1 hour
const INTROSPECT_NEGATIVE_TTL = 300000;    // 5 min for a rejected token
const INTROSPECT_CACHE_MAX = 2000;

let cachedKeys = null;
let keysCachedAt = 0;
let jwksRefreshing = null;                 // in-flight forced refresh (dedupe)
const introspectCache = new Map();         // sha256(token) -> { user|null, until }

// ---------- encoding helpers ----------
function base64urlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return Buffer.from(str, 'base64');
}
function base64urlEncode(buf) {
    return Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function sha256(input) {
    return crypto.createHash('sha256').update(input).digest();
}

// ---------- JWKS ----------
async function defaultFetchJwks() {
    const allKeys = [];
    for (const uri of JWKS_URIS) {
        try {
            const response = await fetch(uri);
            if (response.ok) {
                const data = await response.json();
                allKeys.push(...(data.keys || []));
            }
        } catch (e) {
            // Continue with other URIs
        }
    }
    if (allKeys.length === 0) throw new Error('Failed to fetch any JWKS keys');
    return allKeys;
}
let fetchJwks = defaultFetchJwks;

async function getSigningKeys(force) {
    if (!force && cachedKeys && Date.now() - keysCachedAt < KEY_CACHE_DURATION) {
        return cachedKeys;
    }
    if (force && jwksRefreshing) return jwksRefreshing;
    const p = (async () => {
        const keys = await fetchJwks();
        cachedKeys = keys;
        keysCachedAt = Date.now();
        return keys;
    })();
    if (force) {
        jwksRefreshing = p;
        p.finally(() => { jwksRefreshing = null; });
    }
    return p;
}

// Find the JWK for header.kid; on a miss refresh the JWKS ONCE (key rotation)
// before giving up. Returns null when the kid is unknown after refresh.
async function findSigningKey(kid) {
    if (!kid) return null;
    let keys = await getSigningKeys(false);
    let key = keys.find(k => k.kid === kid);
    if (key) return key;
    keys = await getSigningKeys(true);
    key = keys.find(k => k.kid === kid);
    return key || null;
}

// ---------- signature ----------
function verifyRs256(header, parts, jwk) {
    if (!header || header.alg !== 'RS256') return false;
    if (!jwk || jwk.kty !== 'RSA' || !jwk.n || !jwk.e) return false;
    let publicKey;
    try {
        publicKey = crypto.createPublicKey({ key: { kty: 'RSA', n: jwk.n, e: jwk.e }, format: 'jwk' });
    } catch (e) {
        return false;
    }
    const signature = base64urlDecode(parts[2]);
    if (signature.length === 0) return false;

    const candidates = [parts[0]];
    if (typeof header.nonce === 'string' && header.nonce.length) {
        // Graph access token: the signed header carries SHA-256(nonce), not the nonce.
        const normalised = { ...header, nonce: base64urlEncode(sha256(header.nonce)) };
        candidates.push(base64urlEncode(Buffer.from(JSON.stringify(normalised))));
    }
    for (const encodedHeader of candidates) {
        try {
            const data = Buffer.from(`${encodedHeader}.${parts[1]}`);
            if (crypto.verify('RSA-SHA256', data, publicKey, signature)) return true;
        } catch (e) {
            // try next candidate
        }
    }
    return false;
}

// ---------- Graph introspection (fallback C) ----------
async function defaultIntrospect(token) {
    try {
        const res = await fetch(GRAPH_ME_URI, { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) return null;
        const me = await res.json();
        return me && me.id ? { id: me.id } : null;
    } catch (e) {
        return null;
    }
}
let introspect = defaultIntrospect;

function pruneIntrospectCache(now) {
    if (introspectCache.size < INTROSPECT_CACHE_MAX) return;
    for (const [k, v] of introspectCache) {
        if (v.until <= now) introspectCache.delete(k);
    }
    if (introspectCache.size >= INTROSPECT_CACHE_MAX) {
        // Still full: drop the oldest entries.
        const drop = introspectCache.size - INTROSPECT_CACHE_MAX + 1;
        let i = 0;
        for (const k of introspectCache.keys()) { if (i++ >= drop) break; introspectCache.delete(k); }
    }
}

async function introspectWithGraph(token, payload) {
    const now = Date.now();
    const cacheKey = sha256(token).toString('hex');
    const hit = introspectCache.get(cacheKey);
    if (hit && hit.until > now) return hit.accepted;

    const me = await introspect(token);
    const accepted = !!(me && me.id && payload.oid && me.id === payload.oid);
    const until = accepted
        ? (payload.exp ? payload.exp * 1000 : now + INTROSPECT_NEGATIVE_TTL)
        : now + INTROSPECT_NEGATIVE_TTL;
    pruneIntrospectCache(now);
    introspectCache.set(cacheKey, { accepted, until });
    return accepted;
}

// ---------- token validation ----------
function userFromPayload(payload) {
    return {
        userId: payload.oid || payload.sub,
        name: payload.name || payload.preferred_username,
        email: payload.preferred_username || payload.email || payload.upn,
        roles: payload.roles || [],
        raw: payload
    };
}

async function validateToken(token) {
    if (!token) return null;

    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;

        const header = JSON.parse(base64urlDecode(parts[0]).toString());
        const payload = JSON.parse(base64urlDecode(parts[1]).toString());
        if (!header || typeof header !== 'object' || !payload || typeof payload !== 'object') return null;

        // Check expiry
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp && payload.exp < now) {
            return null;
        }

        // Check not-before
        if (payload.nbf && payload.nbf > now + 300) {
            return null;
        }

        // Check audience (accept our app ID or Graph API — the frontend token is Graph-scoped)
        const validAudiences = [
            CLIENT_ID,
            'https://graph.microsoft.com',
            '00000003-0000-0000-c000-000000000000' // Graph API app ID
        ];
        if (!validAudiences.includes(payload.aud)) {
            return null;
        }

        // Check issuer (must be our tenant — accept both v1 and v2 formats)
        const validIssuers = [
            `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
            `https://sts.windows.net/${TENANT_ID}/`,
            `https://login.microsoftonline.com/${TENANT_ID}/`
        ];
        if (!validIssuers.includes(payload.iss)) {
            return null;
        }

        // Only RS256 is ever issued by Microsoft; refuse anything else (incl. "none").
        if (header.alg !== 'RS256') return null;

        // B. Local signature verification against the matching JWKS key.
        const jwk = await findSigningKey(header.kid);
        if (jwk && verifyRs256(header, parts, jwk)) {
            return userFromPayload(payload);
        }

        // C. Graph introspection — only for a nonce-carrying (Graph) token.
        if (typeof header.nonce === 'string' && header.nonce.length) {
            if (await introspectWithGraph(token, payload)) {
                return userFromPayload(payload);
            }
        }

        return null;
    } catch (err) {
        return null;
    }
}

// Extract token from Authorization header
function extractToken(request) {
    const authHeader = request.headers.get('authorization') || '';
    if (authHeader.startsWith('Bearer ')) {
        return authHeader.slice(7);
    }
    return null;
}

// Middleware: returns user or null
async function authenticate(request) {
    const token = extractToken(request);
    if (!token) return null;
    return validateToken(token);
}

// Middleware: returns user or sends 401
async function requireAuth(request) {
    const user = await authenticate(request);
    if (!user) {
        const { unauthorized } = require('./responses');
        return unauthorized('Unauthorized — valid Microsoft token required', request);
    }
    // Remembered per request (WeakMap — released with the request) so the
    // observability hook can stamp route + user email on 5xx logs without
    // every handler having to pass the user around. No PII beyond email.
    if (request && typeof request === 'object') authUsers.set(request, user);
    return user;
}

const authUsers = new WeakMap();
function getAuthUser(request) {
    return (request && typeof request === 'object' && authUsers.get(request)) || null;
}

// Test seams (tests/auth-token.js). Not used by any route.
const _test = {
    setJwksFetcher(fn) { fetchJwks = fn || defaultFetchJwks; },
    setIntrospector(fn) { introspect = fn || defaultIntrospect; },
    resetCaches() { cachedKeys = null; keysCachedAt = 0; jwksRefreshing = null; introspectCache.clear(); },
    TENANT_ID, CLIENT_ID
};

module.exports = { authenticate, requireAuth, getAuthUser, validateToken, extractToken, _test };

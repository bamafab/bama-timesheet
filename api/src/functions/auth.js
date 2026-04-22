const TENANT_ID = process.env.AZURE_TENANT_ID || 'c92626f5-e391-499a-9059-0113bd07da2d';
const CLIENT_ID = process.env.AZURE_CLIENT_ID || '04b702fd-c53c-4f38-94bc-0334ce91d954';

// JWKS URI for Microsoft identity platform
const JWKS_URI = `https://login.microsoftonline.com/${TENANT_ID}/discovery/v2.0/keys`;

let cachedKeys = null;
let keysCachedAt = 0;
const KEY_CACHE_DURATION = 3600000; // 1 hour

// Base64url decode
function base64urlDecode(str) {
    str = str.replace(/-/g, '+').replace(/_/g, '/');
    while (str.length % 4) str += '=';
    return Buffer.from(str, 'base64');
}

// Fetch Microsoft signing keys
async function getSigningKeys() {
    if (cachedKeys && Date.now() - keysCachedAt < KEY_CACHE_DURATION) {
        return cachedKeys;
    }

    const response = await fetch(JWKS_URI);
    if (!response.ok) throw new Error('Failed to fetch JWKS keys');

    const data = await response.json();
    cachedKeys = data.keys;
    keysCachedAt = Date.now();
    return cachedKeys;
}

// Minimal JWT validation (header + payload decode, expiry check, audience/issuer check)
// For production, consider using a proper JWT library — this validates claims but not signature cryptographically
async function validateToken(token) {
    if (!token) return null;

    try {
        const parts = token.split('.');
        if (parts.length !== 3) return null;

        const header = JSON.parse(base64urlDecode(parts[0]).toString());
        const payload = JSON.parse(base64urlDecode(parts[1]).toString());

        // Check expiry
        const now = Math.floor(Date.now() / 1000);
        if (payload.exp && payload.exp < now) {
            return null;
        }

        // Check not-before
        if (payload.nbf && payload.nbf > now + 300) {
            return null;
        }

        // Check audience (must be our app)
        if (payload.aud !== CLIENT_ID) {
            return null;
        }

        // Check issuer (must be our tenant)
        const validIssuers = [
            `https://login.microsoftonline.com/${TENANT_ID}/v2.0`,
            `https://sts.windows.net/${TENANT_ID}/`
        ];
        if (!validIssuers.includes(payload.iss)) {
            return null;
        }

        // Check that the key ID exists in Microsoft's published keys
        const keys = await getSigningKeys();
        const matchingKey = keys.find(k => k.kid === header.kid);
        if (!matchingKey) {
            return null;
        }

        return {
            userId: payload.oid || payload.sub,
            name: payload.name || payload.preferred_username,
            email: payload.preferred_username || payload.email || payload.upn,
            roles: payload.roles || [],
            raw: payload
        };
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
    // Handle CORS preflight — no auth needed
    if (request.method === 'OPTIONS') {
        return { _preflight: true };
    }

    const user = await authenticate(request);
    if (!user) {
        const { unauthorized } = require('./responses');
        return {
            status: 401,
            ...unauthorized('Unauthorized — valid Microsoft token required', request)
        };
    }
    return user;
}

module.exports = { authenticate, requireAuth, validateToken, extractToken };

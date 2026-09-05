#!/usr/bin/env node
// Gate: api/src/auth.js token validation (RS256 + Graph-nonce normalisation +
// introspection fallback). No network: JWKS and the Graph introspector are
// injected through auth._test. Run: node tests/auth-token.js
'use strict';
const crypto = require('crypto');
const path = require('path');
const auth = require(path.join(__dirname, '..', 'api', 'src', 'auth.js'));
const { TENANT_ID, CLIENT_ID } = auth._test;

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const enc = (obj) => b64u(Buffer.from(JSON.stringify(obj)));
const sha256b64u = (s) => b64u(crypto.createHash('sha256').update(s).digest());

function keypair(kid) {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
    const jwk = publicKey.export({ format: 'jwk' });
    return { kid, privateKey, jwk: { kty: 'RSA', use: 'sig', kid, n: jwk.n, e: jwk.e } };
}
const keyA = keypair('kid-A');
const keyB = keypair('kid-B');   // rotated-in key, not in the initial JWKS
const keyX = keypair('kid-A');   // attacker's key claiming kid-A

const now = Math.floor(Date.now() / 1000);
const OID = '11111111-2222-3333-4444-555555555555';
function payload(over = {}) {
    return {
        aud: '00000003-0000-0000-c000-000000000000',
        iss: `https://sts.windows.net/${TENANT_ID}/`,
        iat: now - 60, nbf: now - 60, exp: now + 3600,
        oid: OID, name: 'Test User', upn: 'test@bamafabrication.co.uk',
        ...over
    };
}
// sign(header, payload, key, {graphStyle}) — graphStyle signs over the header
// with nonce replaced by SHA-256(nonce), exactly as Microsoft does for Graph tokens.
function sign(header, pl, key, opts = {}) {
    const h = enc(header);
    const p = enc(pl);
    let signedHeader = h;
    if (opts.graphStyle) signedHeader = enc({ ...header, nonce: sha256b64u(header.nonce) });
    const sig = crypto.sign('RSA-SHA256', Buffer.from(`${signedHeader}.${p}`), key.privateKey);
    return `${h}.${p}.${b64u(sig)}`;
}
const HDR = (kid, extra = {}) => ({ typ: 'JWT', alg: 'RS256', kid, ...extra });

// ---- injected JWKS + introspector ----
let jwks = [keyA.jwk];
let jwksFetches = 0;
let introspectCalls = 0;
let introspectResult = null;
auth._test.setJwksFetcher(async () => { jwksFetches++; return jwks.slice(); });
auth._test.setIntrospector(async () => { introspectCalls++; return introspectResult; });

let pass = 0, fail = 0;
function check(name, cond, detail = '') {
    if (cond) { pass++; console.log(`  ok   ${name}`); }
    else { fail++; console.log(`  FAIL ${name}${detail ? ' — ' + detail : ''}`); }
}
function reset() { auth._test.resetCaches(); jwksFetches = 0; introspectCalls = 0; introspectResult = null; jwks = [keyA.jwk]; }

(async () => {
    console.log('auth-token gate');

    // 1. Properly signed, no nonce (id/app-style token) -> accepted
    reset();
    let u = await auth.validateToken(sign(HDR('kid-A'), payload({ aud: CLIENT_ID }), keyA));
    check('valid RS256 token (aud=client) accepted', u && u.userId === OID);
    check('  ...without touching Graph', introspectCalls === 0);

    // 2. Graph-style token: header nonce plain, signature over hashed nonce -> accepted locally
    reset();
    u = await auth.validateToken(sign(HDR('kid-A', { nonce: 'abc123nonce' }), payload(), keyA, { graphStyle: true }));
    check('Graph-style nonce token verifies locally', u && u.userId === OID);
    check('  ...introspector not called', introspectCalls === 0);

    // 3. Valid shape, unsigned (garbage / empty signature) -> rejected
    reset();
    const h = enc(HDR('kid-A')), p = enc(payload());
    check('unsigned token (empty signature) rejected', await auth.validateToken(`${h}.${p}.`) === null);
    check('unsigned token (garbage signature) rejected', await auth.validateToken(`${h}.${p}.${b64u(crypto.randomBytes(256))}`) === null);

    // 4. Tampered payload (valid signature over the original) -> rejected
    reset();
    const good = sign(HDR('kid-A'), payload(), keyA);
    const [th, , ts] = good.split('.');
    const tampered = `${th}.${enc(payload({ oid: '99999999-0000-0000-0000-000000000000', name: 'Attacker' }))}.${ts}`;
    check('tampered payload rejected', await auth.validateToken(tampered) === null);

    // 5. Expired -> rejected (even though correctly signed)
    reset();
    check('expired token rejected', await auth.validateToken(sign(HDR('kid-A'), payload({ exp: now - 10 }), keyA)) === null);

    // 6. alg none / HS256 -> rejected
    reset();
    check('alg=none rejected', await auth.validateToken(`${enc({ typ: 'JWT', alg: 'none', kid: 'kid-A' })}.${p}.`) === null);
    check('alg=HS256 rejected', await auth.validateToken(sign(HDR('kid-A', { alg: 'HS256' }), payload(), keyA)) === null);

    // 7. Forged: attacker's own key, claiming a real kid -> rejected
    reset();
    check('forged token (attacker key, real kid) rejected', await auth.validateToken(sign(HDR('kid-A'), payload(), keyX)) === null);
    check('  ...and no Graph call for a nonce-less token', introspectCalls === 0);

    // 8. Unknown kid -> one forced JWKS refresh, then rejected
    reset();
    await auth.validateToken(sign(HDR('kid-A'), payload(), keyA)); // warm cache (1 fetch)
    check('unknown kid rejected', await auth.validateToken(sign(HDR('kid-ZZZ'), payload(), keyA)) === null);
    check('  ...after exactly one JWKS refresh', jwksFetches === 2, `fetches=${jwksFetches}`);

    // 9. Key rotation: unknown kid, refresh brings the new key -> accepted
    reset();
    await auth.validateToken(sign(HDR('kid-A'), payload(), keyA)); // warm cache with only kid-A
    jwks = [keyA.jwk, keyB.jwk];
    u = await auth.validateToken(sign(HDR('kid-B'), payload(), keyB));
    check('rotated key accepted after refresh', u && u.userId === OID);
    check('  ...with one refresh fetch', jwksFetches === 2, `fetches=${jwksFetches}`);

    // 10. Introspection fallback: nonce token, local verify fails (scheme changed), Graph confirms oid
    reset();
    const badLocal = sign(HDR('kid-A', { nonce: 'n1' }), payload(), keyX, { graphStyle: true });
    introspectResult = { id: OID };
    u = await auth.validateToken(badLocal);
    check('nonce token failing locally accepted via Graph /me', u && u.userId === OID);
    check('  ...introspector called once', introspectCalls === 1);
    await auth.validateToken(badLocal);
    check('  ...second call served from cache', introspectCalls === 1, `calls=${introspectCalls}`);

    // 11. Introspection: /me id != oid -> rejected (and negative cached)
    reset();
    introspectResult = { id: 'someone-else' };
    const mism = sign(HDR('kid-A', { nonce: 'n2' }), payload(), keyX, { graphStyle: true });
    check('Graph /me id mismatch rejected', await auth.validateToken(mism) === null);
    await auth.validateToken(mism);
    check('  ...negative result cached', introspectCalls === 1, `calls=${introspectCalls}`);

    // 12. Introspection: Graph rejects (forged nonce token) -> rejected
    reset();
    introspectResult = null;
    check('forged nonce token rejected when Graph rejects', await auth.validateToken(sign(HDR('kid-A', { nonce: 'n3' }), payload(), keyX)) === null);

    // 13. Wrong audience / issuer still rejected before any crypto
    reset();
    check('wrong aud rejected', await auth.validateToken(sign(HDR('kid-A'), payload({ aud: 'other-app' }), keyA)) === null);
    check('wrong iss rejected', await auth.validateToken(sign(HDR('kid-A'), payload({ iss: 'https://sts.windows.net/other-tenant/' }), keyA)) === null);
    check('  ...no JWKS fetch for rejected claims', jwksFetches === 0);

    console.log(`\n${pass}/${pass + fail} passed`);
    process.exit(fail ? 1 : 0);
})();

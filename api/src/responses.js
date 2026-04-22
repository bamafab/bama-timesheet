const ALLOWED_ORIGINS = [
    'https://proud-dune-0dee63110.2.azurestaticapps.net',
    'https://portal.azure.com',
    'http://localhost:4280'  // local dev
];

function corsHeaders(request) {
    const origin = request?.headers?.get?.('origin') || '';
    const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
    return {
        'Access-Control-Allow-Origin': allowedOrigin,
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Authorization, Content-Type',
        'Access-Control-Allow-Credentials': 'true',
        'Access-Control-Max-Age': '86400'
    };
}

function preflight(request) {
    return {
        status: 204,
        headers: corsHeaders(request)
    };
}

function ok(data, request) {
    return {
        status: 200,
        jsonBody: data,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    };
}

function created(data, request) {
    return {
        status: 201,
        jsonBody: data,
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    };
}

function badRequest(message, request) {
    return {
        status: 400,
        jsonBody: { error: message },
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    };
}

function notFound(message = 'Not found', request) {
    return {
        status: 404,
        jsonBody: { error: message },
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    };
}

function unauthorized(message = 'Unauthorized', request) {
    return {
        status: 401,
        jsonBody: { error: message },
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    };
}

function serverError(message = 'Internal server error', request) {
    return {
        status: 500,
        jsonBody: { error: message },
        headers: { 'Content-Type': 'application/json', ...corsHeaders(request) }
    };
}

module.exports = { ok, created, badRequest, notFound, unauthorized, serverError, preflight, corsHeaders };

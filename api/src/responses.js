function ok(data) {
    return {
        status: 200,
        jsonBody: data,
        headers: { 'Content-Type': 'application/json' }
    };
}

function created(data) {
    return {
        status: 201,
        jsonBody: data,
        headers: { 'Content-Type': 'application/json' }
    };
}

function badRequest(message) {
    return {
        status: 400,
        jsonBody: { error: message },
        headers: { 'Content-Type': 'application/json' }
    };
}

function notFound(message = 'Not found') {
    return {
        status: 404,
        jsonBody: { error: message },
        headers: { 'Content-Type': 'application/json' }
    };
}

function unauthorized(message = 'Unauthorized') {
    return {
        status: 401,
        jsonBody: { error: message },
        headers: { 'Content-Type': 'application/json' }
    };
}

function serverError(message = 'Internal server error') {
    return {
        status: 500,
        jsonBody: { error: message },
        headers: { 'Content-Type': 'application/json' }
    };
}

module.exports = { ok, created, badRequest, notFound, unauthorized, serverError };

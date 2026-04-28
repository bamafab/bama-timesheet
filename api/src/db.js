const sql = require('mssql');

let pool = null;

async function getPool() {
    // Cheap liveness check — uses the library's own connection state,
    // not a round-trip to SQL. The previous implementation ran
    // `SELECT 1` here which doubled every query and (combined with the
    // keep-warm timer) prevented the Serverless DB from ever auto-pausing.
    if (pool && pool.connected) {
        return pool;
    }

    const connectionString = process.env.SQL_CONNECTION_STRING;
    if (!connectionString) {
        throw new Error('SQL_CONNECTION_STRING environment variable is not set');
    }

    pool = await sql.connect(connectionString);
    return pool;
}

async function query(sqlText, params = {}) {
    try {
        const db = await getPool();
        const request = db.request();

        for (const [name, value] of Object.entries(params)) {
            if (value === null || value === undefined) {
                request.input(name, sql.NVarChar, null);
            } else {
                request.input(name, value);
            }
        }

        return await request.query(sqlText);
    } catch (err) {
        // If the pool died (network blip, DB resumed from pause, etc.),
        // null it out so the next call reconnects cleanly.
        if (err && (err.code === 'ECONNCLOSED' || err.code === 'ENOTOPEN' ||
                    err.code === 'ETIMEOUT' || err.code === 'ESOCKET')) {
            pool = null;
        }
        throw err;
    }
}

module.exports = { getPool, query, sql };

const sql = require('mssql');

let pool = null;

async function getPool() {
    if (pool) {
        try {
            // Test if connection is still alive
            await pool.request().query('SELECT 1');
            return pool;
        } catch (err) {
            pool = null;
        }
    }

    const connectionString = process.env.SQL_CONNECTION_STRING;
    if (!connectionString) {
        throw new Error('SQL_CONNECTION_STRING environment variable is not set');
    }

    pool = await sql.connect(connectionString);
    return pool;
}

async function query(sqlText, params = {}) {
    const db = await getPool();
    const request = db.request();

    for (const [name, value] of Object.entries(params)) {
        if (value === null || value === undefined) {
            request.input(name, sql.NVarChar, null);
        } else {
            request.input(name, value);
        }
    }

    return request.query(sqlText);
}

module.exports = { getPool, query, sql };

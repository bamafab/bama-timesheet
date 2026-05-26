// ─────────────────────────────────────────────────────────────────────────────
// reconcile.js — Bank Reconciliation API
// ─────────────────────────────────────────────────────────────────────────────
//
// Endpoints:
//
//   Bank Accounts:
//     GET    /api/bank-accounts           — list all + per-account stats
//     POST   /api/bank-accounts           — create
//     PUT    /api/bank-accounts/:id       — edit / deactivate
//
// Commit 2 will add statement upload + transaction CRUD.
// Commit 3 will add document attach + match/unmatch/clear.
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

// ─── CORS preflights ──────────────────────────────────────────────────────────
app.http('bank-accounts-preflight', {
  methods: ['OPTIONS'], route: 'bank-accounts',
  handler: async () => preflight()
});
app.http('bank-account-preflight', {
  methods: ['OPTIONS'], route: 'bank-accounts/{id}',
  handler: async () => preflight()
});

// ─── GET /api/bank-accounts ───────────────────────────────────────────────────
// Returns all active banks with transaction stats per account.
app.http('bank-accounts-list', {
  methods: ['GET'], route: 'bank-accounts',
  handler: async (request) => {
    const auth = await requireAuth(request);
    if (auth.status) return auth;

    try {
      const rows = await query(`
        SELECT
          ba.id,
          ba.bank_name,
          ba.account_number,
          ba.sort_code,
          ba.account_type,
          ba.is_active,
          ba.created_at,
          COUNT(bt.id)                                          AS total_transactions,
          COALESCE(SUM(CASE WHEN bt.status IN ('matched','manual_match','cleared') THEN 1 ELSE 0 END), 0)
                                                                AS resolved_transactions,
          COALESCE(SUM(CASE WHEN bt.status = 'unmatched'                THEN 1 ELSE 0 END), 0)
                                                                AS unmatched_transactions
        FROM dbo.BankAccounts ba
        LEFT JOIN dbo.BankTransactions bt ON bt.bank_account_id = ba.id
        WHERE ba.is_active = 1
        GROUP BY ba.id, ba.bank_name, ba.account_number, ba.sort_code,
                 ba.account_type, ba.is_active, ba.created_at
        ORDER BY ba.bank_name
      `);
      return ok(rows);
    } catch (err) {
      return serverError(err.message);
    }
  }
});

// ─── POST /api/bank-accounts ─────────────────────────────────────────────────
app.http('bank-accounts-create', {
  methods: ['POST'], route: 'bank-accounts',
  handler: async (request) => {
    const auth = await requireAuth(request);
    if (auth.status) return auth;

    let body;
    try { body = await request.json(); } catch { return badRequest('Invalid JSON'); }

    const { bank_name, account_number, sort_code, account_type } = body;
    if (!bank_name || !bank_name.trim()) return badRequest('bank_name is required');

    const validTypes = ['current', 'savings', 'credit_card'];
    const acctType = validTypes.includes(account_type) ? account_type : 'current';

    try {
      const result = await query(`
        INSERT INTO dbo.BankAccounts (bank_name, account_number, sort_code, account_type)
        OUTPUT INSERTED.*
        VALUES (@bank_name, @account_number, @sort_code, @account_type)
      `, {
        bank_name:      bank_name.trim(),
        account_number: (account_number || '').trim() || null,
        sort_code:      (sort_code || '').trim() || null,
        account_type:   acctType
      });
      return created(result[0]);
    } catch (err) {
      return serverError(err.message);
    }
  }
});

// ─── PUT /api/bank-accounts/:id ──────────────────────────────────────────────
app.http('bank-account-update', {
  methods: ['PUT'], route: 'bank-accounts/{id}',
  handler: async (request) => {
    const auth = await requireAuth(request);
    if (auth.status) return auth;

    const id = request.params.id;
    let body;
    try { body = await request.json(); } catch { return badRequest('Invalid JSON'); }

    const fields = {};
    if (body.bank_name      !== undefined) fields.bank_name      = body.bank_name.trim();
    if (body.account_number !== undefined) fields.account_number = (body.account_number || '').trim() || null;
    if (body.sort_code      !== undefined) fields.sort_code      = (body.sort_code || '').trim() || null;
    if (body.account_type   !== undefined) fields.account_type   = body.account_type;
    if (body.is_active      !== undefined) fields.is_active      = body.is_active ? 1 : 0;

    if (!Object.keys(fields).length) return badRequest('No valid fields to update');

    try {
      const existing = await query('SELECT id FROM dbo.BankAccounts WHERE id = @id', { id });
      if (!existing.length) return notFound('Bank account not found');

      const setClause = Object.keys(fields).map(k => `${k} = @${k}`).join(', ');
      const params = { id, ...fields };
      const updated = await query(
        `UPDATE dbo.BankAccounts SET ${setClause} OUTPUT INSERTED.* WHERE id = @id`,
        params
      );
      return ok(updated[0]);
    } catch (err) {
      return serverError(err.message);
    }
  }
});

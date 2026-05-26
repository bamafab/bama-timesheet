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
      const result = await query(`
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
      return ok(result.recordset);
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
      return created(result.recordset[0]);
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
      if (!existing.recordset.length) return notFound('Bank account not found');

      const setClause = Object.keys(fields).map(k => `${k} = @${k}`).join(', ');
      const params = { id, ...fields };
      const updated = await query(
        `UPDATE dbo.BankAccounts SET ${setClause} OUTPUT INSERTED.* WHERE id = @id`,
        params
      );
      return ok(updated.recordset[0]);
    } catch (err) {
      return serverError(err.message);
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Commit 2 — Statements + Transactions
// ─────────────────────────────────────────────────────────────────────────────

// ─── CORS preflights ──────────────────────────────────────────────────────────
app.http('bank-statements-preflight', {
  methods: ['OPTIONS'], route: 'bank-statements',
  handler: async () => preflight()
});
app.http('bank-statement-preflight', {
  methods: ['OPTIONS'], route: 'bank-statements/{id}',
  handler: async () => preflight()
});
app.http('bank-transactions-preflight', {
  methods: ['OPTIONS'], route: 'bank-transactions',
  handler: async () => preflight()
});
app.http('bank-transaction-match-preflight', {
  methods: ['OPTIONS'], route: 'bank-transactions/{id}/match',
  handler: async () => preflight()
});

// ─── GET /api/bank-statements?bank_account_id= ───────────────────────────────
app.http('bank-statements-list', {
  methods: ['GET'], route: 'bank-statements',
  handler: async (request) => {
    const auth = await requireAuth(request);
    if (auth.status) return auth;

    const bankAccountId = new URL(request.url).searchParams.get('bank_account_id');
    if (!bankAccountId) return badRequest('bank_account_id is required');

    try {
      const result = await query(`
        SELECT
          bs.id, bs.bank_account_id, bs.filename, bs.sharepoint_url,
          bs.date_from, bs.date_to, bs.total_transactions, bs.matched_count,
          bs.uploaded_by, bs.uploaded_at,
          ba.bank_name
        FROM dbo.BankStatements bs
        JOIN dbo.BankAccounts ba ON ba.id = bs.bank_account_id
        WHERE bs.bank_account_id = @bank_account_id
        ORDER BY bs.uploaded_at DESC
      `, { bank_account_id: Number(bankAccountId) });
      return ok(result.recordset);
    } catch (err) {
      return serverError(err.message);
    }
  }
});

// ─── POST /api/bank-statements ───────────────────────────────────────────────
// Body: { bank_account_id, filename, date_from, date_to, transactions[] }
// transactions[]: { transaction_date, description, reference, transaction_type,
//                   amount, original_amount, original_currency,
//                   spending_category, cardholder }
app.http('bank-statements-create', {
  methods: ['POST'], route: 'bank-statements',
  handler: async (request) => {
    const auth = await requireAuth(request);
    if (auth.status) return auth;

    let body;
    try { body = await request.json(); } catch { return badRequest('Invalid JSON'); }

    const { bank_account_id, filename, date_from, date_to, transactions, sharepoint_url } = body;
    if (!bank_account_id) return badRequest('bank_account_id is required');
    if (!Array.isArray(transactions) || !transactions.length) return badRequest('transactions array is required');

    try {
      // 1. Insert the statement header
      const stmtResult = await query(`
        INSERT INTO dbo.BankStatements
          (bank_account_id, filename, sharepoint_url, date_from, date_to,
           total_transactions, matched_count, uploaded_by)
        OUTPUT INSERTED.*
        VALUES (@bank_account_id, @filename, @sharepoint_url, @date_from, @date_to,
                @total_transactions, 0, @uploaded_by)
      `, {
        bank_account_id:    Number(bank_account_id),
        filename:           filename || 'statement',
        sharepoint_url:     sharepoint_url || null,
        date_from:          date_from || null,
        date_to:            date_to || null,
        total_transactions: transactions.length,
        uploaded_by:        auth.name || auth.email || 'unknown'
      });
      const stmt = stmtResult.recordset[0];

      // 2. Bulk-insert transactions in batches of 50
      const BATCH = 50;
      let inserted = 0;
      for (let i = 0; i < transactions.length; i += BATCH) {
        const batch = transactions.slice(i, i + BATCH);
        for (const t of batch) {
          await query(`
            INSERT INTO dbo.BankTransactions
              (statement_id, bank_account_id, transaction_date, description,
               reference, transaction_type, amount, original_amount,
               original_currency, spending_category, cardholder, status)
            VALUES
              (@statement_id, @bank_account_id, @transaction_date, @description,
               @reference, @transaction_type, @amount, @original_amount,
               @original_currency, @spending_category, @cardholder, 'unmatched')
          `, {
            statement_id:      stmt.id,
            bank_account_id:   Number(bank_account_id),
            transaction_date:  t.transaction_date,
            description:       (t.description || '').substring(0, 500),
            reference:         (t.reference || null),
            transaction_type:  (t.transaction_type || null),
            amount:            Number(t.amount),
            original_amount:   t.original_amount != null ? Number(t.original_amount) : null,
            original_currency: t.original_currency || null,
            spending_category: t.spending_category || null,
            cardholder:        t.cardholder || null
          });
          inserted++;
        }
      }

      return created({ statement: stmt, inserted });
    } catch (err) {
      return serverError(err.message);
    }
  }
});

// ─── DELETE /api/bank-statements/:id ─────────────────────────────────────────
app.http('bank-statement-delete', {
  methods: ['DELETE'], route: 'bank-statements/{id}',
  handler: async (request) => {
    const auth = await requireAuth(request);
    if (auth.status) return auth;
    const id = Number(request.params.id);
    try {
      // Cascade: delete docs → transactions → statement
      await query(`DELETE FROM dbo.BankTransactionDocs WHERE transaction_id IN
        (SELECT id FROM dbo.BankTransactions WHERE statement_id = @id)`, { id });
      await query(`DELETE FROM dbo.BankTransactions WHERE statement_id = @id`, { id });
      await query(`DELETE FROM dbo.BankStatements WHERE id = @id`, { id });
      return ok({ deleted: true });
    } catch (err) {
      return serverError(err.message);
    }
  }
});

// ─── GET /api/bank-transactions ──────────────────────────────────────────────
// ?bank_account_id= &statement_id= &status= &months= (default 2)
app.http('bank-transactions-list', {
  methods: ['GET'], route: 'bank-transactions',
  handler: async (request) => {
    const auth = await requireAuth(request);
    if (auth.status) return auth;

    const params = new URL(request.url).searchParams;
    const bankAccountId = params.get('bank_account_id');
    const statementId   = params.get('statement_id');
    const status        = params.get('status');
    const months        = parseInt(params.get('months') || '2', 10);

    if (!bankAccountId) return badRequest('bank_account_id is required');

    try {
      const cutoff = new Date();
      cutoff.setMonth(cutoff.getMonth() - months);
      const cutoffStr = cutoff.toISOString().slice(0, 10);

      let whereClause = 'WHERE bt.bank_account_id = @bank_account_id AND bt.transaction_date >= @cutoff';
      const qParams = { bank_account_id: Number(bankAccountId), cutoff: cutoffStr };

      if (statementId) {
        whereClause += ' AND bt.statement_id = @statement_id';
        qParams.statement_id = Number(statementId);
      }
      if (status) {
        whereClause += ' AND bt.status = @status';
        qParams.status = status;
      }

      const result = await query(`
        SELECT
          bt.*,
          COUNT(btd.id) AS doc_count
        FROM dbo.BankTransactions bt
        LEFT JOIN dbo.BankTransactionDocs btd ON btd.transaction_id = bt.id
        ${whereClause}
        GROUP BY bt.id, bt.statement_id, bt.bank_account_id, bt.transaction_date,
                 bt.description, bt.reference, bt.transaction_type, bt.amount,
                 bt.original_amount, bt.original_currency, bt.spending_category,
                 bt.cardholder, bt.status, bt.clear_reason, bt.matched_to_type,
                 bt.matched_to_id, bt.matched_at, bt.matched_by, bt.created_at
        ORDER BY bt.transaction_date DESC, bt.id DESC
      `, qParams);

      return ok(result.recordset);
    } catch (err) {
      return serverError(err.message);
    }
  }
});

// ─── PUT /api/bank-transactions/:id/match ────────────────────────────────────
// Body: { status, clear_reason?, matched_by? }
app.http('bank-transaction-match', {
  methods: ['PUT'], route: 'bank-transactions/{id}/match',
  handler: async (request) => {
    const auth = await requireAuth(request);
    if (auth.status) return auth;
    const id = Number(request.params.id);

    let body;
    try { body = await request.json(); } catch { return badRequest('Invalid JSON'); }

    const validStatuses = ['unmatched', 'matched', 'manual_match', 'cleared'];
    if (!validStatuses.includes(body.status)) return badRequest('Invalid status');

    try {
      const result = await query(`
        UPDATE dbo.BankTransactions
        SET status         = @status,
            clear_reason   = @clear_reason,
            matched_by     = @matched_by,
            matched_at     = CASE WHEN @status != 'unmatched' THEN GETUTCDATE() ELSE NULL END
        OUTPUT INSERTED.*
        WHERE id = @id
      `, {
        id,
        status:       body.status,
        clear_reason: body.clear_reason || null,
        matched_by:   body.matched_by || auth.name || null
      });
      if (!result.recordset.length) return notFound('Transaction not found');

      // Update statement matched_count
      await query(`
        UPDATE dbo.BankStatements
        SET matched_count = (
          SELECT COUNT(*) FROM dbo.BankTransactions
          WHERE statement_id = (SELECT statement_id FROM dbo.BankTransactions WHERE id = @id)
          AND status IN ('matched','manual_match','cleared')
        )
        WHERE id = (SELECT statement_id FROM dbo.BankTransactions WHERE id = @id)
      `, { id });

      return ok(result.recordset[0]);
    } catch (err) {
      return serverError(err.message);
    }
  }
});

// ─── GET /api/bank-transactions/check-duplicates ─────────────────────────────
// Body sent as POST for convenience (array of {transaction_date, amount, description})
// Returns array of indices that are duplicates of existing DB rows
app.http('bank-transactions-check-dupes-preflight', {
  methods: ['OPTIONS'], route: 'bank-transactions/check-duplicates',
  handler: async () => preflight()
});
app.http('bank-transactions-check-dupes', {
  methods: ['POST'], route: 'bank-transactions/check-duplicates',
  handler: async (request) => {
    const auth = await requireAuth(request);
    if (auth.status) return auth;

    let body;
    try { body = await request.json(); } catch { return badRequest('Invalid JSON'); }

    const { bank_account_id, transactions } = body;
    if (!bank_account_id || !Array.isArray(transactions)) return badRequest('bank_account_id and transactions required');

    try {
      const dupeIndices = [];
      for (let i = 0; i < transactions.length; i++) {
        const t = transactions[i];
        const check = await query(`
          SELECT TOP 1 id FROM dbo.BankTransactions
          WHERE bank_account_id = @bank_account_id
            AND transaction_date = @transaction_date
            AND amount = @amount
            AND description = @description
        `, {
          bank_account_id: Number(bank_account_id),
          transaction_date: t.transaction_date,
          amount: Number(t.amount),
          description: (t.description || '').substring(0, 500)
        });
        if (check.recordset.length > 0) dupeIndices.push(i);
      }
      return ok({ dupeIndices });
    } catch (err) {
      return serverError(err.message);
    }
  }
});

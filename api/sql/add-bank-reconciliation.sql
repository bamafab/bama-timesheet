-- ─────────────────────────────────────────────────────────────────────────────
-- add-bank-reconciliation.sql — Reconcile page schema
-- ─────────────────────────────────────────────────────────────────────────────
-- Creates:
--   1. BankAccounts          — one row per bank/account
--   2. BankStatements        — uploaded statements per account
--   3. BankTransactions      — parsed transactions from statements
--   4. BankTransactionDocs   — documents attached to transactions (receipts etc.)
--   5. UserPermissions.reconcile — new permission column
--
-- All idempotent. Paste into Azure SQL Query Editor and run.
-- After running, restart the Function App (cached schema).
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. BankAccounts ─────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE Name = 'BankAccounts')
BEGIN
  CREATE TABLE dbo.BankAccounts (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    bank_name       NVARCHAR(100) NOT NULL,
    account_number  NVARCHAR(20)  NULL,
    sort_code       NVARCHAR(10)  NULL,
    account_type    NVARCHAR(20)  NOT NULL DEFAULT 'current',  -- current | savings | credit_card
    is_active       BIT           NOT NULL DEFAULT 1,
    created_at      DATETIME2     NOT NULL DEFAULT GETUTCDATE()
  );
END
GO

-- ─── 2. BankStatements ───────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE Name = 'BankStatements')
BEGIN
  CREATE TABLE dbo.BankStatements (
    id                  INT IDENTITY(1,1) PRIMARY KEY,
    bank_account_id     INT           NOT NULL REFERENCES dbo.BankAccounts(id),
    filename            NVARCHAR(260) NOT NULL,
    sharepoint_url      NVARCHAR(500) NULL,
    date_from           DATE          NULL,
    date_to             DATE          NULL,
    total_transactions  INT           NOT NULL DEFAULT 0,
    matched_count       INT           NOT NULL DEFAULT 0,
    uploaded_by         NVARCHAR(200) NULL,
    uploaded_at         DATETIME2     NOT NULL DEFAULT GETUTCDATE()
  );
END
GO

-- ─── 3. BankTransactions ─────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE Name = 'BankTransactions')
BEGIN
  CREATE TABLE dbo.BankTransactions (
    id                  INT IDENTITY(1,1) PRIMARY KEY,
    statement_id        INT             NOT NULL REFERENCES dbo.BankStatements(id),
    bank_account_id     INT             NOT NULL REFERENCES dbo.BankAccounts(id),
    transaction_date    DATE            NOT NULL,
    description         NVARCHAR(500)   NOT NULL DEFAULT '',
    reference           NVARCHAR(200)   NULL,
    transaction_type    NVARCHAR(50)    NULL,   -- FASTER PAYMENT, DIRECT DEBIT, etc.
    amount              DECIMAL(14,2)   NOT NULL,  -- negative = debit, positive = credit
    original_amount     DECIMAL(14,2)   NULL,
    original_currency   NVARCHAR(5)     NULL,
    spending_category   NVARCHAR(100)   NULL,   -- from Starling / Capital On Tap
    cardholder          NVARCHAR(200)   NULL,   -- credit card accounts only
    status              NVARCHAR(20)    NOT NULL DEFAULT 'unmatched',
                        -- unmatched | matched | manual_match | cleared
    clear_reason        NVARCHAR(500)   NULL,
    matched_to_type     NVARCHAR(50)    NULL,   -- invoice | po | receipt | null
    matched_to_id       INT             NULL,
    matched_at          DATETIME2       NULL,
    matched_by          NVARCHAR(200)   NULL,
    created_at          DATETIME2       NOT NULL DEFAULT GETUTCDATE()
  );
  CREATE INDEX IX_BankTransactions_Account  ON dbo.BankTransactions(bank_account_id);
  CREATE INDEX IX_BankTransactions_Statement ON dbo.BankTransactions(statement_id);
  CREATE INDEX IX_BankTransactions_Status    ON dbo.BankTransactions(status);
  CREATE INDEX IX_BankTransactions_Date      ON dbo.BankTransactions(transaction_date);
END
GO

-- ─── 4. BankTransactionDocs ──────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE Name = 'BankTransactionDocs')
BEGIN
  CREATE TABLE dbo.BankTransactionDocs (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    transaction_id  INT           NOT NULL REFERENCES dbo.BankTransactions(id),
    filename        NVARCHAR(260) NOT NULL,
    sharepoint_url  NVARCHAR(500) NULL,
    parsed_supplier NVARCHAR(200) NULL,
    parsed_date     DATE          NULL,
    parsed_amount   DECIMAL(14,2) NULL,
    parsed_net      DECIMAL(14,2) NULL,
    parsed_vat      DECIMAL(14,2) NULL,
    uploaded_by     NVARCHAR(200) NULL,
    uploaded_at     DATETIME2     NOT NULL DEFAULT GETUTCDATE()
  );
  CREATE INDEX IX_BankTransactionDocs_Txn ON dbo.BankTransactionDocs(transaction_id);
END
GO

-- ─── 5. UserPermissions.reconcile ────────────────────────────────────────────
IF NOT EXISTS (
  SELECT 1 FROM sys.columns
  WHERE Name = 'reconcile' AND Object_ID = Object_ID('dbo.UserPermissions')
)
  ALTER TABLE dbo.UserPermissions ADD reconcile BIT NOT NULL DEFAULT 0;
GO

-- ─── Verification ─────────────────────────────────────────────────────────────
-- Run after migration to confirm 5 results = 1:
--
-- SELECT 'BankAccounts'              AS check_name, COUNT(*) AS ok FROM sys.tables WHERE Name = 'BankAccounts'
-- UNION ALL
-- SELECT 'BankStatements',           COUNT(*) FROM sys.tables WHERE Name = 'BankStatements'
-- UNION ALL
-- SELECT 'BankTransactions',         COUNT(*) FROM sys.tables WHERE Name = 'BankTransactions'
-- UNION ALL
-- SELECT 'BankTransactionDocs',      COUNT(*) FROM sys.tables WHERE Name = 'BankTransactionDocs'
-- UNION ALL
-- SELECT 'UserPermissions.reconcile',COUNT(*) FROM sys.columns
--   WHERE Name = 'reconcile' AND Object_ID = Object_ID('dbo.UserPermissions');

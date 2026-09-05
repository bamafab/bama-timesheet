-- ─────────────────────────────────────────────────────────────────────────────
-- create-client-errors.sql  (Session 2 — monitoring, 2026-09-05)
--
-- Browser-side errors reported by the global window.onerror /
-- unhandledrejection handler (shared.js + standalone copies in
-- quote-builder.html / dashboard.html) via POST /api/client-error.
-- Surfaced in ED › Health › "Client errors (last 7 days)".
--
-- Retention is JOB-FREE: nothing purges on a timer (SQL Serverless cost rule,
-- 2026-08-10). Every read is date-bounded (default 7 days, max 90), so old
-- rows simply fall out of view; they can be deleted by hand if the table ever
-- gets big. No PII beyond the user's login email.
--
-- New table => NO Function App restart needed. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ClientErrors')
BEGIN
    CREATE TABLE dbo.ClientErrors (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        occurred_at  DATETIME2       NOT NULL DEFAULT SYSUTCDATETIME(),
        page         NVARCHAR(100)   NOT NULL,   -- 'projects' | 'quote-builder' | 'dashboard' | ...
        message      NVARCHAR(1000)  NOT NULL,   -- error message (truncated server-side)
        stack        NVARCHAR(MAX)   NULL,       -- first ~8000 chars of the stack
        url          NVARCHAR(500)   NULL,       -- page URL without hash/query
        user_agent   NVARCHAR(300)   NULL,
        user_email   NVARCHAR(200)   NULL,       -- from the Microsoft token, never typed
        extra        NVARCHAR(MAX)   NULL,       -- JSON: last failed API request id, app version, etc.
        request_id   NVARCHAR(60)    NULL        -- invocationId of the report itself (X-Request-Id)
    );
    CREATE INDEX IX_ClientErrors_occurred ON dbo.ClientErrors (occurred_at DESC);
    CREATE INDEX IX_ClientErrors_page     ON dbo.ClientErrors (page, occurred_at DESC);
    PRINT 'ClientErrors table created.';
END
ELSE
    PRINT 'ClientErrors already exists — nothing to do.';

SELECT COUNT(*) AS table_count FROM sys.tables WHERE name = 'ClientErrors';

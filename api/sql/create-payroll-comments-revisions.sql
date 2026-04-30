-- Payroll comments and revisions tracking.
--
-- PayrollComments: free-text instructions tied to a specific payroll week.
-- Visible below the payroll table for that week, included in the email body
-- when the payroll is sent. Wiped/scoped per week.
--
-- PayrollRevisions: audit log of every time a payroll PDF was generated for
-- a given week. Revision 0 is the original, 1 is rev1, etc. Auto-incremented
-- by the API based on the highest existing revision_number for the week.
--
-- Each statement is wrapped in EXEC() so it compiles in its own batch,
-- which lets us run the whole script without GO separators (Azure SQL
-- portal editor doesn't support GO). Fully idempotent.

-- ── PayrollComments ────────────────────────────────────────────────────────

IF OBJECT_ID('PayrollComments', 'U') IS NULL
EXEC('CREATE TABLE PayrollComments (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    week_commencing DATE NOT NULL,
    comment         NVARCHAR(2000) NOT NULL,
    created_by      NVARCHAR(255) NOT NULL,
    created_at      DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    updated_by      NVARCHAR(255) NULL,
    updated_at      DATETIME2 NULL
)');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PayrollComments_week' AND object_id = OBJECT_ID('PayrollComments'))
EXEC('CREATE INDEX IX_PayrollComments_week ON PayrollComments(week_commencing)');

-- ── PayrollRevisions ───────────────────────────────────────────────────────

IF OBJECT_ID('PayrollRevisions', 'U') IS NULL
EXEC('CREATE TABLE PayrollRevisions (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    week_commencing DATE NOT NULL,
    revision_number INT  NOT NULL,
    file_name       NVARCHAR(500) NOT NULL,
    file_url        NVARCHAR(1000) NULL,
    created_by      NVARCHAR(255) NOT NULL,
    created_at      DATETIME2 NOT NULL DEFAULT GETUTCDATE()
)');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PayrollRevisions_week' AND object_id = OBJECT_ID('PayrollRevisions'))
EXEC('CREATE INDEX IX_PayrollRevisions_week ON PayrollRevisions(week_commencing)');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_PayrollRevisions_week_rev' AND object_id = OBJECT_ID('PayrollRevisions'))
EXEC('CREATE UNIQUE INDEX UX_PayrollRevisions_week_rev ON PayrollRevisions(week_commencing, revision_number)');

-- Payroll comments and revisions tracking.
--
-- PayrollComments: free-text instructions tied to a specific payroll week.
-- Visible below the payroll table for that week, included in the email body
-- when the payroll is sent. They are wiped/scoped per week (when you change
-- weeks, you only see that week's comments).
--
-- PayrollRevisions: audit log of every time a payroll PDF was generated for
-- a given week. Revision 0 is the original, 1 is rev1, 2 is rev2, etc. The
-- system auto-increments based on the highest existing revision_number for
-- the week.
--
-- Idempotent: safe to run multiple times.
--
-- Note: CREATE INDEX statements are wrapped in EXEC() so SQL Server defers
-- their compilation to runtime — otherwise the batch would fail to parse on
-- a fresh database where the table doesn't yet exist.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PayrollComments')
BEGIN
    CREATE TABLE PayrollComments (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        week_commencing DATE NOT NULL,
        comment         NVARCHAR(2000) NOT NULL,
        created_by      NVARCHAR(255) NOT NULL,
        created_at      DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
        updated_by      NVARCHAR(255) NULL,
        updated_at      DATETIME2 NULL
    );
    EXEC('CREATE INDEX IX_PayrollComments_week ON PayrollComments(week_commencing)');
END

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PayrollRevisions')
BEGIN
    CREATE TABLE PayrollRevisions (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        week_commencing DATE NOT NULL,
        revision_number INT  NOT NULL,    -- 0 = original, 1 = rev1, etc.
        file_name       NVARCHAR(500) NOT NULL,
        file_url        NVARCHAR(1000) NULL,    -- SharePoint webUrl
        created_by      NVARCHAR(255) NOT NULL,
        created_at      DATETIME2 NOT NULL DEFAULT GETUTCDATE()
    );
    EXEC('CREATE INDEX IX_PayrollRevisions_week ON PayrollRevisions(week_commencing)');
    EXEC('CREATE UNIQUE INDEX UX_PayrollRevisions_week_rev ON PayrollRevisions(week_commencing, revision_number)');
END

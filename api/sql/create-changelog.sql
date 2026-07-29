-- ─────────────────────────────────────────────────────────────────────────────
-- create-changelog.sql  (Fault Register F6 / Phase B3)
--
-- Audit trail: who changed what, when, from what to what. Written by the
-- logChange() helper (api/src/changelog.js), wired into quote status changes,
-- hard deletes, mark-won, AFP certify/un-certify, and invoice void/delete.
--
-- New table => NO Function App restart needed. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ChangeLog')
BEGIN
    CREATE TABLE dbo.ChangeLog (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        entity_type  NVARCHAR(40)  NOT NULL,   -- 'qb_quote' | 'application' | 'invoice' | ...
        entity_id    INT           NULL,
        entity_ref   NVARCHAR(60)  NULL,       -- Q260712 / AFP05 / INV-0031
        action       NVARCHAR(60)  NOT NULL,   -- 'status_change' | 'hard_delete' | 'certified' | ...
        old_value    NVARCHAR(400) NULL,
        new_value    NVARCHAR(400) NULL,
        changed_by   NVARCHAR(120) NOT NULL,
        changed_at   DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_ChangeLog_entity  ON dbo.ChangeLog (entity_type, entity_id);
    CREATE INDEX IX_ChangeLog_changed ON dbo.ChangeLog (changed_at DESC);
    PRINT 'ChangeLog table created.';
END
ELSE
    PRINT 'ChangeLog already exists — nothing to do.';

SELECT COUNT(*) AS table_count FROM sys.tables WHERE name = 'ChangeLog';

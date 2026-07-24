-- Soft-delete flag for approval revisions. A deleted revision disappears from
-- the UI, but its revision number stays retired (never reused). Numbering is
-- MAX(number)+1 over ALL rows incl. deleted, so deleting a rejected P01 still
-- yields P02 next.
SET NOCOUNT ON;
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.DrawingApprovalRevisions') AND name = 'is_deleted'
)
BEGIN
    ALTER TABLE dbo.DrawingApprovalRevisions
        ADD is_deleted BIT NOT NULL CONSTRAINT DF_DAR_IsDeleted DEFAULT 0;
    PRINT 'Added is_deleted.';
END
ELSE
    PRINT 'is_deleted already present.';

-- Verify
SELECT COUNT(*) AS column_count FROM sys.columns
WHERE object_id = OBJECT_ID('dbo.DrawingApprovalRevisions') AND name = 'is_deleted';

-- Migration: widen DrawingApprovalRevisions.status for the new approval
-- outcomes (Status A/B/C). Adds 'minor' and 'major'; keeps 'rejected' so
-- legacy rows stay valid (UI treats legacy 'rejected' the same as 'major').
-- Safe to run more than once.
SET NOCOUNT ON;

-- 1. Drop the current CHECK constraint on the status column (named
--    CK_DAR_Status by the create script, resolved dynamically to be safe).
DECLARE @ck sysname;
SELECT @ck = cc.name
FROM sys.check_constraints cc
WHERE cc.parent_object_id = OBJECT_ID('dbo.DrawingApprovalRevisions')
  AND cc.definition LIKE '%status%';

IF @ck IS NOT NULL
BEGIN
    DECLARE @sql nvarchar(max) =
        N'ALTER TABLE dbo.DrawingApprovalRevisions DROP CONSTRAINT ' + QUOTENAME(@ck) + N';';
    EXEC sp_executesql @sql;
    PRINT 'Dropped constraint ' + @ck;
END
ELSE
    PRINT 'No existing status CHECK constraint found (already dropped?).';

-- 2. Recreate with the expanded value set.
IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.DrawingApprovalRevisions')
      AND name = 'CK_DAR_Status'
)
BEGIN
    ALTER TABLE dbo.DrawingApprovalRevisions
        ADD CONSTRAINT CK_DAR_Status
        CHECK (status IN ('sent','approved','minor','major','rejected'));
    PRINT 'Added CK_DAR_Status with expanded value set.';
END
ELSE
    PRINT 'CK_DAR_Status already present.';

-- 3. Verify
SELECT cc.name AS constraint_name, cc.definition
FROM sys.check_constraints cc
WHERE cc.parent_object_id = OBJECT_ID('dbo.DrawingApprovalRevisions');

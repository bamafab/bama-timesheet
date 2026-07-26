-- Migration: widen JobBomItems.status CHECK to allow 'on_site'.
--
-- Root cause of the 500 on POST /api/job-bom-items/generate-sdn: the Site
-- Delivery Note allocator flips selected items to status 'on_site', but the
-- original CK_JobBomItems_Status CHECK only permits
--   ('pending','at_supplier','ready_for_despatch','despatched')
-- so the UPDATE violates the constraint and SQL Server throws. The backend
-- and frontend have always assumed 'on_site' exists; the constraint was never
-- widened to match. This adds it.
--
-- 'despatched' is kept (supplier-DN terminal state); 'on_site' is the site-DN
-- terminal state. All existing rows stay valid.
--
-- Run via Azure Portal Query Editor against the bama-erp database (office IP —
-- home IP is blocked). Safe to run more than once.
SET NOCOUNT ON;

-- 1. Drop the current status CHECK (named CK_JobBomItems_Status by the create
--    script, but resolved dynamically so a differently-named one is handled).
DECLARE @ck sysname;
SELECT @ck = cc.name
FROM sys.check_constraints cc
WHERE cc.parent_object_id = OBJECT_ID('dbo.JobBomItems')
  AND cc.definition LIKE '%status%';

IF @ck IS NOT NULL
BEGIN
    DECLARE @sql nvarchar(max) =
        N'ALTER TABLE dbo.JobBomItems DROP CONSTRAINT ' + QUOTENAME(@ck) + N';';
    EXEC sp_executesql @sql;
    PRINT 'Dropped constraint ' + @ck;
END
ELSE
    PRINT 'No existing status CHECK constraint found (already dropped?).';

-- 2. Recreate with 'on_site' added.
IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.JobBomItems')
      AND name = 'CK_JobBomItems_Status'
)
BEGIN
    ALTER TABLE dbo.JobBomItems
        ADD CONSTRAINT CK_JobBomItems_Status
        CHECK (status IN ('pending','at_supplier','ready_for_despatch','despatched','on_site'));
    PRINT 'Added CK_JobBomItems_Status with on_site included.';
END
ELSE
    PRINT 'CK_JobBomItems_Status already present.';

-- 3. Verify
SELECT cc.name AS constraint_name, cc.definition
FROM sys.check_constraints cc
WHERE cc.parent_object_id = OBJECT_ID('dbo.JobBomItems');

-- ============================================================
-- BAMA ERP: Backfill PO → Project links
-- Run against: bama-erp
-- ============================================================
-- The PO import (import-po-tracker-2026.sql) inserted 206 POs with
-- the project reference stuffed into cost_centre + job_number, but
-- never set project_id. As a result, Project Tracker can't find the
-- POs that belong to a project. This script links them up.
--
-- Idempotent — re-running affects no rows since the WHERE filters
-- to project_id IS NULL only.
-- ============================================================

SET NOCOUNT ON;

-- 1. PREVIEW: what would be linked, and to which project, before any write.
SELECT
    po.id            AS po_id,
    po.reference     AS po_ref,
    po.job_number    AS po_job_number,
    po.cost_centre   AS current_cost_centre,
    p.id             AS will_link_to_project_id,
    p.project_number AS will_link_to_project_number,
    p.project_name   AS will_link_to_project_name
FROM dbo.PurchaseOrders po
JOIN dbo.Projects p ON p.project_number = po.job_number
WHERE po.project_id IS NULL
ORDER BY p.project_number, po.reference;

-- 2. SUMMARY by project — how many POs each Project will gain.
SELECT
    p.project_number,
    p.project_name,
    COUNT(*) AS pos_to_link,
    SUM(po.total_value) AS combined_total_value
FROM dbo.PurchaseOrders po
JOIN dbo.Projects p ON p.project_number = po.job_number
WHERE po.project_id IS NULL
GROUP BY p.project_number, p.project_name
ORDER BY pos_to_link DESC;

-- ============================================================
-- 3. THE ACTUAL UPDATE
-- Read the previews above first. When you're happy, run this block.
-- ============================================================

BEGIN TRANSACTION;

UPDATE po
   SET po.project_id  = p.id,
       po.cost_centre = NULL,           -- XOR constraint: exactly one of project_id / cost_centre
       po.updated_at  = GETUTCDATE()
  FROM dbo.PurchaseOrders po
  JOIN dbo.Projects p ON p.project_number = po.job_number
 WHERE po.project_id IS NULL;

PRINT CONCAT('Rows linked: ', @@ROWCOUNT);

-- Sanity check — verify the XOR is still satisfied across the whole table.
DECLARE @bad INT = (
    SELECT COUNT(*) FROM dbo.PurchaseOrders
    WHERE (project_id IS NOT NULL AND cost_centre IS NOT NULL)
       OR (project_id IS NULL     AND cost_centre IS NULL)
);

IF @bad > 0
BEGIN
    PRINT CONCAT('XOR violation detected on ', @bad, ' rows — rolling back.');
    ROLLBACK TRANSACTION;
END
ELSE
BEGIN
    PRINT 'XOR constraint OK — committing.';
    COMMIT TRANSACTION;
END

-- ============================================================
-- 4. VERIFY (run after commit)
-- ============================================================
SELECT
    p.project_number,
    p.project_name,
    COUNT(po.id)              AS po_count,
    SUM(po.total_value)       AS total_gross_value
FROM dbo.Projects p
LEFT JOIN dbo.PurchaseOrders po ON po.project_id = p.id
WHERE p.project_number LIKE 'S%'
GROUP BY p.project_number, p.project_name
ORDER BY p.project_number;

-- And specifically S1965:
SELECT id, reference, supplier_id, job_number, project_id, total_value, status, created_at
  FROM dbo.PurchaseOrders
 WHERE project_id = (SELECT id FROM dbo.Projects WHERE project_number = 'S1965')
 ORDER BY reference;

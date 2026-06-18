-- ─────────────────────────────────────────────────────────────────────────────
-- Add construction_number to DrawingApprovalRevisions
--
-- Independent per-job counter assigned when a revision is "approved-ish":
--   - any CO upload, OR
--   - a PO with status flipped to 'approved'
-- It's monotonic and persistent: once assigned to a revision, it stays
-- (even on un-approval). Re-approving keeps the same number; approving a
-- different revision gets MAX+1. No renumbering ever happens.
--
-- This decouples the C-prefix label from the PO sequence number, so the first
-- approved revision is always C01 regardless of how many PO rounds preceded
-- it (was previously PO6 → C06; now PO6 → C01 if it's the first approval).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Add the column (idempotent)
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('DrawingApprovalRevisions')
      AND name = 'construction_number'
)
BEGIN
    ALTER TABLE DrawingApprovalRevisions ADD construction_number INT NULL;
END;

-- 2. Backfill existing approved / CO revisions in chronological upload order,
--    per job, starting from MAX+1 of any number already assigned.
WITH job_max AS (
    SELECT job_id, ISNULL(MAX(construction_number), 0) AS current_max
    FROM DrawingApprovalRevisions
    GROUP BY job_id
),
to_assign AS (
    SELECT
        r.id,
        r.job_id,
        ROW_NUMBER() OVER (PARTITION BY r.job_id ORDER BY r.uploaded_at, r.id) AS rn
    FROM DrawingApprovalRevisions r
    WHERE r.construction_number IS NULL
      AND (r.revision_type = 'CO' OR r.status = 'approved')
)
UPDATE r
SET construction_number = jm.current_max + ta.rn
FROM DrawingApprovalRevisions r
INNER JOIN to_assign ta ON ta.id = r.id
INNER JOIN job_max jm ON jm.job_id = r.job_id;

-- ============================================================
-- BAMA ERP: Backfill PO approval flags
-- Run against: bama-erp
-- ============================================================
-- Going forward, every new PO is auto-approved at creation time
-- (approved_at = GETUTCDATE(), approved_by = created_by) — see
-- api/src/functions/purchase-orders.js POST handler.
--
-- But the 206 POs imported from the spreadsheet have
-- approved_at = NULL despite many being demonstrably actioned
-- (status = Closed, paid, etc.). This script backfills them
-- so the workflow display shows '✅ Approved by ...' for the
-- creator and date, matching the new convention.
--
-- Strategy:
--   • approved_at  = created_at  (we don't know the exact approval
--                                 time, but creation date is the
--                                 best proxy and is correct in spirit
--                                 since approval was implicit at raise)
--   • approved_by  = created_by
--
-- Idempotent — filters to approved_at IS NULL only. Safe to re-run.
-- ============================================================

SET NOCOUNT ON;

-- 1. PREVIEW — what would be backfilled.
SELECT
    id,
    reference,
    created_at,
    created_by,
    status,
    CASE WHEN paid_at IS NOT NULL THEN 'paid'
         WHEN invoice_received_at IS NOT NULL THEN 'invoiced'
         WHEN delivery_received_at IS NOT NULL THEN 'delivered'
         ELSE 'open'
    END AS lifecycle_state
FROM dbo.PurchaseOrders
WHERE approved_at IS NULL
ORDER BY created_at;

-- 2. COUNT
SELECT COUNT(*) AS pos_to_backfill FROM dbo.PurchaseOrders WHERE approved_at IS NULL;

-- ============================================================
-- 3. THE UPDATE
-- ============================================================

BEGIN TRANSACTION;

UPDATE dbo.PurchaseOrders
   SET approved_at = created_at,
       approved_by = created_by,
       updated_at  = GETUTCDATE()
 WHERE approved_at IS NULL;

PRINT CONCAT('POs backfilled with approval: ', @@ROWCOUNT);

COMMIT TRANSACTION;

-- ============================================================
-- 4. VERIFY
-- ============================================================
SELECT COUNT(*) AS remaining_unapproved
  FROM dbo.PurchaseOrders
 WHERE approved_at IS NULL;
-- Should be 0.

SELECT TOP 10 id, reference, created_at, created_by, approved_at, approved_by, status
  FROM dbo.PurchaseOrders
 ORDER BY id;

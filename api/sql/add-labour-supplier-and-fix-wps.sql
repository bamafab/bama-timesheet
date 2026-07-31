-- ═══════════════════════════════════════════════════════════════════════════
-- Labour supplier flag + WPS reclassification  (2026-07-31)
--
--   Problem: WPS Special Projects Ltd is a LABOUR AGENCY (a limited company
--   that supplies its own PAYE workers — Ryan Daly, Lee Kirtley — to BAMA).
--   It has NO CIS deduction and invoices under reverse-charge VAT. The bulk
--   importer wrongly classed it, and its invoices, as a CIS SUBCONTRACTOR.
--
--   Fix (per Mateusz, 2026-07-31):
--     1. WPS becomes a normal SUPPLIER   (is_subcontractor = 0)
--     2. Its invoices become invoice_type = 'supplier', CIS fields nulled
--     3. New Suppliers.is_labour_supplier flag tags it (and any future labour
--        agency) as a LABOUR cost so the new Labour & Subcontractor Payments
--        report can pick it up alongside the CIS subcontractors.
--
--   is_labour_supplier is a plain tag — it does NOT change VAT or CIS handling.
--   A supplier can be a normal supplier AND a labour supplier at once.
--
-- ⚠ ADD COLUMN migration — RESTART THE FUNCTION APP after running.
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. New tag column ─────────────────────────────────────────────────────────
IF COL_LENGTH('Suppliers', 'is_labour_supplier') IS NULL
    ALTER TABLE Suppliers ADD is_labour_supplier BIT NOT NULL DEFAULT 0;
GO

-- 2. Reclassify the WPS supplier record ─────────────────────────────────────
--    Match on name (case/whitespace-insensitive contains 'wps special').
UPDATE Suppliers
   SET is_subcontractor  = 0,      -- no longer a CIS subcontractor
       is_labour_supplier = 1,     -- but IS a labour cost (agency)
       cis_rate          = NULL,
       utr_number        = NULL,
       updated_at        = GETUTCDATE()
 WHERE LOWER(REPLACE(supplier_name, ' ', '')) LIKE '%wpsspecial%';

-- 3. Reclassify every WPS invoice: supplier type + strip CIS figures ─────────
--    Their gross is the amount payable; there was never a real CIS deduction,
--    so labour_gross / cis_* are cleared to keep subcontractor/HMRC totals clean.
UPDATE si
   SET si.invoice_type  = 'supplier',
       si.labour_gross  = NULL,
       si.cis_rate      = NULL,
       si.cis_deduction = NULL,
       si.updated_at    = GETUTCDATE()
  FROM SupplierInvoices si
  JOIN Suppliers s ON s.id = si.supplier_id
 WHERE LOWER(REPLACE(s.supplier_name, ' ', '')) LIKE '%wpsspecial%';

-- 4. Verify ─────────────────────────────────────────────────────────────────
SELECT s.id, s.supplier_name, s.is_subcontractor, s.is_labour_supplier,
       s.cis_rate, s.utr_number
  FROM Suppliers s
 WHERE LOWER(REPLACE(s.supplier_name, ' ', '')) LIKE '%wpsspecial%';

SELECT si.id, si.invoice_ref, si.invoice_date, si.gross,
       si.invoice_type, si.labour_gross, si.cis_rate, si.cis_deduction
  FROM SupplierInvoices si
  JOIN Suppliers s ON s.id = si.supplier_id
 WHERE LOWER(REPLACE(s.supplier_name, ' ', '')) LIKE '%wpsspecial%'
 ORDER BY si.invoice_date;

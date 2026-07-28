-- ═══════════════════════════════════════════════════════════════════════════
-- Subcontractor / CIS support  (2026-07-28)
--   Suppliers:        is_subcontractor, utr_number, cis_rate, bank details
--   SupplierInvoices: invoice_type, labour_gross, cis_rate, cis_deduction
--
-- ⚠ ADD COLUMN migration — RESTART THE FUNCTION APP after running.
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

IF COL_LENGTH('Suppliers', 'is_subcontractor') IS NULL
    ALTER TABLE Suppliers ADD is_subcontractor BIT NOT NULL DEFAULT 0;
IF COL_LENGTH('Suppliers', 'utr_number') IS NULL
    ALTER TABLE Suppliers ADD utr_number NVARCHAR(20) NULL;
IF COL_LENGTH('Suppliers', 'cis_rate') IS NULL
    ALTER TABLE Suppliers ADD cis_rate DECIMAL(5,2) NULL;   -- 0 / 20 / 30
IF COL_LENGTH('Suppliers', 'bank_sort_code') IS NULL
    ALTER TABLE Suppliers ADD bank_sort_code NVARCHAR(10) NULL;
IF COL_LENGTH('Suppliers', 'bank_account_no') IS NULL
    ALTER TABLE Suppliers ADD bank_account_no NVARCHAR(15) NULL;

IF COL_LENGTH('SupplierInvoices', 'invoice_type') IS NULL
    ALTER TABLE SupplierInvoices ADD invoice_type NVARCHAR(20) NOT NULL DEFAULT 'supplier'; -- supplier | subcontractor
IF COL_LENGTH('SupplierInvoices', 'labour_gross') IS NULL
    ALTER TABLE SupplierInvoices ADD labour_gross DECIMAL(12,2) NULL;   -- CIS: invoice subtotal before deduction
IF COL_LENGTH('SupplierInvoices', 'cis_rate') IS NULL
    ALTER TABLE SupplierInvoices ADD cis_rate DECIMAL(5,2) NULL;
IF COL_LENGTH('SupplierInvoices', 'cis_deduction') IS NULL
    ALTER TABLE SupplierInvoices ADD cis_deduction DECIMAL(12,2) NULL;  -- retained for HMRC; gross stays = amount payable

SELECT 'Suppliers' AS t, COL_LENGTH('Suppliers','is_subcontractor') AS is_sub, COL_LENGTH('Suppliers','utr_number') AS utr
UNION ALL
SELECT 'SupplierInvoices', COL_LENGTH('SupplierInvoices','invoice_type'), COL_LENGTH('SupplierInvoices','cis_deduction');

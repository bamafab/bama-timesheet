-- ═══════════════════════════════════════════════════════════════════════════
-- Credit notes on the supplier invoice ledger
-- ═══════════════════════════════════════════════════════════════════════════
-- Suppliers issue credit notes against earlier invoices (returned material,
-- wrong grade, price corrections). These are stored as NEGATIVE ledger rows
-- (net/vat/gross < 0) so every sum in the system — PO reconciliation,
-- payments due, payment runs, aged creditors — nets off naturally.
--
-- This migration adds the link back to the invoice being credited:
--   credits_invoice_id → SupplierInvoices.id of the original invoice
--
-- ⚠ ADD COLUMN — REQUIRES A FUNCTION APP RESTART after running.
-- ═══════════════════════════════════════════════════════════════════════════

IF NOT EXISTS (SELECT 1 FROM sys.columns
                WHERE object_id = OBJECT_ID('SupplierInvoices')
                  AND name = 'credits_invoice_id')
BEGIN
    ALTER TABLE SupplierInvoices ADD credits_invoice_id INT NULL;
    PRINT 'Added SupplierInvoices.credits_invoice_id';
END
ELSE
    PRINT 'credits_invoice_id already exists — skipped';
GO

IF NOT EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'FK_SupInv_Credits')
BEGIN
    ALTER TABLE SupplierInvoices
        ADD CONSTRAINT FK_SupInv_Credits
        FOREIGN KEY (credits_invoice_id) REFERENCES SupplierInvoices(id);
    PRINT 'Added FK_SupInv_Credits';
END
GO

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT name, system_type_id FROM sys.columns
 WHERE object_id = OBJECT_ID('SupplierInvoices') AND name = 'credits_invoice_id';

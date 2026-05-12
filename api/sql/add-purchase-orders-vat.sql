-- Purchase Orders: add VAT (Nett / Gross split) — Phase 1a follow-up
--
-- Business context: BAMA is VAT-registered, so every PO needs to record:
--   Nett   = sum(line totals) + delivery_charge + collection_charge
--   VAT    = Nett × vat_rate / 100
--   Gross  = Nett + VAT          (matches "Sub Total" on PUR001 Rev.00)
--
-- We keep `total_value` as the Gross figure (matches the existing
-- printed PO template and the "what gets paid" number). Nett is derived
-- by subtraction; VAT amount stored alongside the rate so we don't have
-- to recompute on every read.
--
-- vat_rate defaults to 20.00 (UK standard). Set to 0 for zero-rated
-- goods (e.g. exports, certain steel categories), 5 for reduced-rated.
--
-- Idempotent: gated on sys.columns.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE  object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'vat_rate'
)
BEGIN
    ALTER TABLE dbo.PurchaseOrders
        ADD vat_rate DECIMAL(5, 2) NULL
            CONSTRAINT DF_PurchaseOrders_vat_rate DEFAULT 20.00;
END

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE  object_id = OBJECT_ID('dbo.PurchaseOrders') AND name = 'vat_amount'
)
BEGIN
    ALTER TABLE dbo.PurchaseOrders
        ADD vat_amount DECIMAL(18, 2) NULL;
END

PRINT 'Purchase Orders VAT columns added.';

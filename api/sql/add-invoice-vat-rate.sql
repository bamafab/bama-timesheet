-- Migration: add Invoices.vat_rate (20 / 5 / 0). NULL = legacy 20%.
-- Applies to standard VAT and to the CIS reverse-charge notice figure
-- (2026-08-17, e.g. INV0316 confirmed at 5%). Safe to run more than once.
SET NOCOUNT ON;

IF NOT EXISTS (SELECT 1 FROM sys.columns
               WHERE object_id = OBJECT_ID('dbo.Invoices') AND name = 'vat_rate')
BEGIN
    ALTER TABLE dbo.Invoices ADD vat_rate DECIMAL(5,2) NULL;
    PRINT 'Added Invoices.vat_rate';
END
ELSE
    PRINT 'Invoices.vat_rate already exists — nothing to do';

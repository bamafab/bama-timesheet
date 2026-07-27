-- Remittance advice + retention release invoicing (2026-07-27)
-- PurchaseOrders.paid_ref     — payment reference recorded when marking supplier invoices paid
-- Invoices.is_retention_release — flags an invoice raised to release retention held under parent_invoice_id
-- ⚠ ADD COLUMN migration → RESTART the Function App after running.

IF NOT EXISTS (SELECT 1 FROM sys.columns
               WHERE object_id = OBJECT_ID('PurchaseOrders') AND name = 'paid_ref')
BEGIN
    ALTER TABLE PurchaseOrders ADD paid_ref NVARCHAR(100) NULL;
END;

IF NOT EXISTS (SELECT 1 FROM sys.columns
               WHERE object_id = OBJECT_ID('Invoices') AND name = 'is_retention_release')
BEGIN
    ALTER TABLE Invoices ADD is_retention_release BIT NOT NULL
        CONSTRAINT DF_Invoices_is_retention_release DEFAULT 0;
END;

-- Verify
SELECT 'PurchaseOrders.paid_ref' AS col, COUNT(*) AS column_count FROM sys.columns
 WHERE object_id = OBJECT_ID('PurchaseOrders') AND name = 'paid_ref'
UNION ALL
SELECT 'Invoices.is_retention_release', COUNT(*) FROM sys.columns
 WHERE object_id = OBJECT_ID('Invoices') AND name = 'is_retention_release';

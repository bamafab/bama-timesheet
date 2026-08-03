-- ═══════════════════════════════════════════════════════════════════════════
-- SupplierInvoicePOAllocations — many-to-many between supplier invoices & POs
-- ═══════════════════════════════════════════════════════════════════════════
-- Why: suppliers sometimes send ONE invoice covering SEVERAL POs (consolidated
-- billing), and sometimes SEVERAL invoices against ONE PO (staged deliveries).
-- The single SupplierInvoices.po_id column can only model the second case, so
-- consolidated invoices land under one PO and per-PO / per-job cost reports
-- are wrong. This table holds the split: each row says "£X net of invoice A
-- belongs to PO B".
--
-- SupplierInvoices.po_id is KEPT as a denormalised "primary PO" (= the first
-- allocation) so old queries and displays keep working, but reconciliation
-- and reporting read THIS table from now on.
--
-- Reconciliation is now compared NET-to-NET (allocated net vs PO net =
-- total_value − vat_amount), per Mateusz 2026-08-03.
--
-- NEW TABLE ONLY — no Function App restart required.
-- ═══════════════════════════════════════════════════════════════════════════

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SupplierInvoicePOAllocations')
BEGIN
    CREATE TABLE SupplierInvoicePOAllocations (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        invoice_id  INT           NOT NULL,     -- SupplierInvoices.id
        po_id       INT           NOT NULL,     -- PurchaseOrders.id
        net         DECIMAL(12,2) NULL,         -- net £ of the invoice allocated to this PO
        vat         DECIMAL(12,2) NULL,         -- pro-rata VAT share
        gross       DECIMAL(12,2) NOT NULL,     -- net + vat share
        created_by  NVARCHAR(200) NULL,
        created_at  DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
        updated_at  DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
        CONSTRAINT FK_SipAlloc_Invoice FOREIGN KEY (invoice_id) REFERENCES SupplierInvoices(id),
        CONSTRAINT FK_SipAlloc_PO      FOREIGN KEY (po_id)      REFERENCES PurchaseOrders(id),
        CONSTRAINT UQ_SipAlloc_InvPo   UNIQUE (invoice_id, po_id)
    );
    CREATE INDEX IX_SipAlloc_Invoice ON SupplierInvoicePOAllocations(invoice_id);
    CREATE INDEX IX_SipAlloc_PO      ON SupplierInvoicePOAllocations(po_id);
    PRINT 'Created SupplierInvoicePOAllocations';
END
ELSE
    PRINT 'SupplierInvoicePOAllocations already exists — skipped';
GO

-- ── Backfill: every existing single-PO link becomes one full allocation ─────
-- Idempotent: only inserts pairs not already present.
INSERT INTO SupplierInvoicePOAllocations (invoice_id, po_id, net, vat, gross, created_by)
SELECT si.id, si.po_id, si.net, si.vat, si.gross, 'backfill'
  FROM SupplierInvoices si
 WHERE si.po_id IS NOT NULL
   AND si.is_deleted = 0
   AND NOT EXISTS (SELECT 1 FROM SupplierInvoicePOAllocations a
                    WHERE a.invoice_id = si.id AND a.po_id = si.po_id);

PRINT 'Backfill complete: ' + CAST(@@ROWCOUNT AS NVARCHAR(10)) + ' allocation(s) created';
GO

-- ── Verify ───────────────────────────────────────────────────────────────────
SELECT
    (SELECT COUNT(*) FROM SupplierInvoices WHERE po_id IS NOT NULL AND is_deleted = 0) AS invoices_with_po,
    (SELECT COUNT(*) FROM SupplierInvoicePOAllocations)                                AS allocations;

-- ═══════════════════════════════════════════════════════════════════════════
-- Supplier Invoices ledger  (2026-07-28)
--
-- Moves supplier invoices from one-per-PO columns on PurchaseOrders to a
-- proper ledger table:
--   • many invoices per PO (Barrett / AJN send several per order)
--   • standalone invoices with no PO (manual entry)
--   • optional link to a BabcockQuotes row
--   • due_date auto-computed from Suppliers payment terms (NULL for DD)
--   • BACS payment runs (SupplierPaymentRuns)
--
-- Backfills every existing PurchaseOrders.supplier_invoice_* record.
-- Legacy columns are left in place (read-compat); new writes go to the ledger
-- and the API keeps the PO aggregate columns in sync.
--
-- New tables only — NO Function App restart required.
-- Idempotent: safe to re-run.
-- ═══════════════════════════════════════════════════════════════════════════

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SupplierPaymentRuns')
BEGIN
    CREATE TABLE SupplierPaymentRuns (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        run_ref       NVARCHAR(50)  NULL,
        run_date      DATE          NOT NULL,
        method        NVARCHAR(30)  NOT NULL DEFAULT 'BACS',
        period_from   DATE          NULL,
        period_to     DATE          NULL,
        invoice_count INT           NOT NULL DEFAULT 0,
        total_gross   DECIMAL(12,2) NOT NULL DEFAULT 0,
        notes         NVARCHAR(MAX) NULL,
        created_by    NVARCHAR(200) NULL,
        created_at    DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    PRINT 'Created SupplierPaymentRuns';
END

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SupplierInvoices')
BEGIN
    CREATE TABLE SupplierInvoices (
        id                  INT IDENTITY(1,1) PRIMARY KEY,
        supplier_id         INT           NOT NULL,
        po_id               INT           NULL,   -- PurchaseOrders.id (nullable = unmatched / manual)
        babcock_quote_id    INT           NULL,   -- BabcockQuotes.id (optional link)
        invoice_ref         NVARCHAR(100) NULL,
        invoice_date        DATE          NULL,
        net                 DECIMAL(12,2) NULL,
        vat                 DECIMAL(12,2) NULL,
        gross               DECIMAL(12,2) NOT NULL,
        due_date            DATE          NULL,   -- computed from supplier terms; NULL for DD
        is_dd               BIT           NOT NULL DEFAULT 0,
        paid_at             DATETIME2     NULL,
        paid_by             NVARCHAR(200) NULL,
        paid_ref            NVARCHAR(200) NULL,
        payment_run_id      INT           NULL,   -- SupplierPaymentRuns.id
        sharepoint_file_id  NVARCHAR(300) NULL,
        sharepoint_file_url NVARCHAR(1000) NULL,
        filename            NVARCHAR(300) NULL,
        notes               NVARCHAR(MAX) NULL,
        source              NVARCHAR(20)  NOT NULL DEFAULT 'parsed', -- parsed | manual | backfill
        created_by          NVARCHAR(200) NULL,
        created_at          DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
        updated_at          DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
        is_deleted          BIT           NOT NULL DEFAULT 0,
        CONSTRAINT FK_SupInv_Supplier   FOREIGN KEY (supplier_id)      REFERENCES Suppliers(id),
        CONSTRAINT FK_SupInv_PO         FOREIGN KEY (po_id)            REFERENCES PurchaseOrders(id),
        CONSTRAINT FK_SupInv_Babcock    FOREIGN KEY (babcock_quote_id) REFERENCES BabcockQuotes(id),
        CONSTRAINT FK_SupInv_PayRun     FOREIGN KEY (payment_run_id)   REFERENCES SupplierPaymentRuns(id)
    );
    CREATE INDEX IX_SupInv_Supplier ON SupplierInvoices(supplier_id) WHERE is_deleted = 0;
    CREATE INDEX IX_SupInv_PO       ON SupplierInvoices(po_id)       WHERE is_deleted = 0;
    CREATE INDEX IX_SupInv_Due      ON SupplierInvoices(due_date)    WHERE is_deleted = 0;
    PRINT 'Created SupplierInvoices';
END

-- ── Backfill from PurchaseOrders legacy columns ─────────────────────────────
-- One row per PO that has a received supplier invoice, carrying paid state.
-- Due date computed from the supplier's current payment terms.
IF NOT EXISTS (SELECT 1 FROM SupplierInvoices WHERE source = 'backfill')
BEGIN
    INSERT INTO SupplierInvoices
        (supplier_id, po_id, invoice_ref, invoice_date, net, vat, gross,
         due_date, is_dd, paid_at, paid_by, paid_ref,
         sharepoint_file_id, sharepoint_file_url, filename,
         notes, source, created_by, created_at)
    SELECT
        po.supplier_id,
        po.id,
        po.supplier_invoice_ref,
        po.supplier_invoice_date,
        po.supplier_invoice_net,
        po.supplier_invoice_vat,
        COALESCE(po.supplier_invoice_gross, po.total_value, 0),
        CASE
            WHEN s.payment_dd = 1 THEN NULL
            WHEN po.supplier_invoice_date IS NULL THEN NULL
            WHEN s.payment_term_type = 'days_from_invoice'
                THEN DATEADD(DAY, ISNULL(s.payment_term_days, 30), po.supplier_invoice_date)
            WHEN s.payment_term_type = 'days_eom'
                THEN DATEADD(DAY, ISNULL(s.payment_term_days, 30), EOMONTH(po.supplier_invoice_date))
            WHEN s.payment_term_type = 'days_following_month'
                THEN CASE
                        WHEN ISNULL(s.payment_term_days, 30) >= DAY(EOMONTH(po.supplier_invoice_date, 1))
                            THEN EOMONTH(po.supplier_invoice_date, 1)
                        ELSE DATEFROMPARTS(
                                YEAR(DATEADD(MONTH, 1, po.supplier_invoice_date)),
                                MONTH(DATEADD(MONTH, 1, po.supplier_invoice_date)),
                                ISNULL(s.payment_term_days, 30))
                     END
            ELSE NULL
        END,
        ISNULL(s.payment_dd, 0),
        po.paid_at, po.paid_by, po.paid_ref,
        att.sharepoint_file_id, att.sharepoint_file_url, att.filename,
        po.reconciliation_notes,
        'backfill',
        'migration',
        ISNULL(po.supplier_invoice_received_at, GETUTCDATE())
    FROM PurchaseOrders po
    JOIN Suppliers s ON s.id = po.supplier_id
    OUTER APPLY (
        SELECT TOP 1 pa.sharepoint_file_id, pa.sharepoint_file_url, pa.filename
        FROM POAttachments pa
        WHERE pa.po_id = po.id AND pa.kind = 'supplier_invoice'
        ORDER BY pa.id DESC
    ) att
    WHERE po.supplier_invoice_received_at IS NOT NULL
      AND po.supplier_id IS NOT NULL;

    PRINT 'Backfilled ' + CAST(@@ROWCOUNT AS NVARCHAR(10)) + ' supplier invoices from PurchaseOrders';
END

-- Verification
SELECT source, COUNT(*) AS row_count, SUM(gross) AS total_gross
FROM SupplierInvoices WHERE is_deleted = 0 GROUP BY source;

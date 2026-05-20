-- ─────────────────────────────────────────────────────────────────────────────
-- Invoice Tracker — Schema migration (Phase 1)
-- ─────────────────────────────────────────────────────────────────────────────
-- Run on bama-erp BEFORE deploying the API + frontend.
--
-- Adds the four tables behind the new Invoice Tracker:
--   1. Applications          — AFPs (Applications for Payment) per project
--   2. ApplicationLineItems  — SOV snapshot for each AFP
--   3. Invoices              — sales invoices, pro formas and credit notes
--   4. InvoiceLineItems      — line items per invoice
--   5. InvoicePayments       — payments received against an invoice
--   6. Receipts              — non-PO purchases (receipt reconciliation)
--   7. InvoiceAttachments    — polymorphic file attachments
--
-- Extends PurchaseOrders with supplier-invoice columns (the Supplier
-- Invoices tab is a filtered view of POs).
--
-- Adds an `invoicing` permission to UserPermissions and updates the
-- AccessControl default block.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Applications (AFPs)
-- ─────────────────────────────────────────────────────────────────────────────
-- One row per Application for Payment ("valuation") submitted to a client.
-- Numbered AFP01, AFP02… within the scope of a single project.
-- Lifecycle: Draft → Submitted → Certified → Invoiced. Cancellable from any
-- pre-Invoiced state.
CREATE TABLE Applications (
    id INT IDENTITY(1,1) PRIMARY KEY,
    project_id INT NOT NULL,                      -- always linked to a project
    application_no INT NOT NULL,                  -- 1, 2, 3… within project
    ref NVARCHAR(20) NOT NULL,                    -- 'AFP01', 'AFP02'…
    period_label NVARCHAR(100) NULL,              -- 'Apr 2026' or '2026-04-01 to 2026-04-30'
    status NVARCHAR(30) NOT NULL DEFAULT 'Draft', -- Draft|Submitted|Certified|Invoiced|Cancelled

    -- Applied-for figures (what we ask for)
    applied_value_net DECIMAL(14,2) NULL,
    applied_vat DECIMAL(14,2) NULL,
    applied_retention DECIMAL(14,2) NULL,
    applied_gross DECIMAL(14,2) NULL,

    -- Certified figures (what the client agreed to pay)
    certified_value_net DECIMAL(14,2) NULL,
    certified_vat DECIMAL(14,2) NULL,
    certified_retention DECIMAL(14,2) NULL,
    certified_gross DECIMAL(14,2) NULL,

    -- Certificate metadata (parsed via Claude OCR on upload)
    certificate_ref NVARCHAR(100) NULL,           -- their cert number
    certificate_date DATE NULL,
    certificate_received_at DATETIME2 NULL,
    certificate_attachment_id INT NULL,           -- FK to InvoiceAttachments

    -- Generated AFP PDF (stored under per-project Valuations folder)
    sharepoint_pdf_id NVARCHAR(255) NULL,
    sharepoint_pdf_url NVARCHAR(500) NULL,

    -- Set when an Invoice is generated from this certified AFP
    invoice_id INT NULL,

    notes NVARCHAR(MAX) NULL,
    created_by NVARCHAR(255) NULL,
    created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    submitted_at DATETIME2 NULL,
    certified_at DATETIME2 NULL,
    invoiced_at DATETIME2 NULL,
    cancelled_at DATETIME2 NULL,

    CONSTRAINT FK_Applications_Project
        FOREIGN KEY (project_id) REFERENCES Projects(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX UX_Applications_project_no ON Applications(project_id, application_no);
CREATE INDEX IX_Applications_status ON Applications(status);
CREATE INDEX IX_Applications_invoice ON Applications(invoice_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ApplicationLineItems  (SOV snapshot for an AFP)
-- ─────────────────────────────────────────────────────────────────────────────
-- Frozen snapshot of the Schedule of Values at the time the AFP was created.
-- source_quote_line_item_id NULL = manual / change-order line.
CREATE TABLE ApplicationLineItems (
    id INT IDENTITY(1,1) PRIMARY KEY,
    application_id INT NOT NULL,
    line_no INT NOT NULL,
    source_quote_line_item_id INT NULL,           -- FK to QuoteLineItems (nullable)
    description NVARCHAR(255) NOT NULL,
    contract_value DECIMAL(14,2) NOT NULL DEFAULT 0,
    previous_pct_complete DECIMAL(5,2) NOT NULL DEFAULT 0,   -- from last AFP (or 0 if first)
    this_app_pct_complete DECIMAL(5,2) NOT NULL DEFAULT 0,   -- entered for this AFP
    this_app_value DECIMAL(14,2) NOT NULL DEFAULT 0,         -- = contract_value × (this − previous)%
    created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

    CONSTRAINT FK_ApplicationLineItems_App
        FOREIGN KEY (application_id) REFERENCES Applications(id) ON DELETE CASCADE,
    CONSTRAINT FK_ApplicationLineItems_QuoteLine
        FOREIGN KEY (source_quote_line_item_id) REFERENCES QuoteLineItems(id)
);
CREATE INDEX IX_ApplicationLineItems_app ON ApplicationLineItems(application_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Invoices
-- ─────────────────────────────────────────────────────────────────────────────
-- Master table for all customer-facing financial documents: invoices, pro
-- formas, credit notes. Refs are sequential per `kind`:
--   invoice    → INV0258, INV0259, …
--   pro_forma  → PRO0258, … (burns an INV slot it may later convert into)
--   credit_note→ CN0001, CN0002, …
-- See api/src/functions/invoicing.js for the allocator implementation.
CREATE TABLE Invoices (
    id INT IDENTITY(1,1) PRIMARY KEY,
    ref NVARCHAR(20) NOT NULL,
    kind NVARCHAR(20) NOT NULL DEFAULT 'invoice', -- invoice|pro_forma|credit_note

    -- Optional origins
    source_afp_id INT NULL,                       -- born from a certified AFP
    parent_invoice_id INT NULL,                   -- credit note → its invoice, or pro_forma → invoice

    -- Customer + project linkage (BOTH optional — invoices can be standalone)
    project_id INT NULL,
    client_id INT NULL,
    customer_text NVARCHAR(255) NULL,             -- free-text fallback when no client_id

    -- Dates
    invoice_date DATE NOT NULL,
    due_date DATE NULL,
    issued_at DATETIME2 NULL,

    -- VAT / CIS handling (matches the spreadsheet's two-column model)
    vat_applies BIT NOT NULL DEFAULT 0,           -- "VAT YES" column
    cis_reverse_charge BIT NOT NULL DEFAULT 0,    -- "Reverse charge" column

    -- Amounts (all gross-pence-as-decimal style)
    net_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    vat_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    reverse_charge_amount DECIMAL(14,2) NOT NULL DEFAULT 0, -- displayed but not added to gross
    retention_pct DECIMAL(5,2) NULL,              -- if entered as %
    retention_amount DECIMAL(14,2) NULL,          -- final retention £ (computed or raw)
    retention_due_date DATE NULL,
    gross_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    total_outstanding DECIMAL(14,2) NOT NULL DEFAULT 0,

    -- Status workflow
    status NVARCHAR(30) NOT NULL DEFAULT 'Draft', -- Draft|Issued|Partially Paid|Paid|Cancelled|Void

    -- Generated PDF
    sharepoint_pdf_id NVARCHAR(255) NULL,
    sharepoint_pdf_url NVARCHAR(500) NULL,

    notes NVARCHAR(MAX) NULL,
    created_by NVARCHAR(255) NULL,
    created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    voided_at DATETIME2 NULL,
    cancelled_at DATETIME2 NULL,

    CONSTRAINT FK_Invoices_Project FOREIGN KEY (project_id) REFERENCES Projects(id),
    CONSTRAINT FK_Invoices_Client FOREIGN KEY (client_id) REFERENCES Clients(id),
    CONSTRAINT FK_Invoices_AFP FOREIGN KEY (source_afp_id) REFERENCES Applications(id),
    CONSTRAINT FK_Invoices_Parent FOREIGN KEY (parent_invoice_id) REFERENCES Invoices(id),
    CONSTRAINT CK_Invoices_Kind CHECK (kind IN ('invoice','pro_forma','credit_note'))
);
CREATE UNIQUE INDEX UX_Invoices_ref ON Invoices(ref);
CREATE INDEX IX_Invoices_kind_status ON Invoices(kind, status);
CREATE INDEX IX_Invoices_project ON Invoices(project_id);
CREATE INDEX IX_Invoices_client ON Invoices(client_id);
CREATE INDEX IX_Invoices_afp ON Invoices(source_afp_id);

-- Now that Invoices exists, wire up the back-pointer FK on Applications
ALTER TABLE Applications
    ADD CONSTRAINT FK_Applications_Invoice
        FOREIGN KEY (invoice_id) REFERENCES Invoices(id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. InvoiceLineItems
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE InvoiceLineItems (
    id INT IDENTITY(1,1) PRIMARY KEY,
    invoice_id INT NOT NULL,
    line_no INT NOT NULL,
    description NVARCHAR(500) NOT NULL,
    quantity DECIMAL(12,3) NOT NULL DEFAULT 1,
    unit NVARCHAR(20) NULL,
    unit_price DECIMAL(14,4) NOT NULL DEFAULT 0,
    line_total DECIMAL(14,2) NOT NULL DEFAULT 0,
    created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    CONSTRAINT FK_InvoiceLineItems_Invoice
        FOREIGN KEY (invoice_id) REFERENCES Invoices(id) ON DELETE CASCADE
);
CREATE INDEX IX_InvoiceLineItems_invoice ON InvoiceLineItems(invoice_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. InvoicePayments
-- ─────────────────────────────────────────────────────────────────────────────
-- Tracks partial + full payments against an invoice. Allows retention to be
-- received as a separate later payment.
CREATE TABLE InvoicePayments (
    id INT IDENTITY(1,1) PRIMARY KEY,
    invoice_id INT NOT NULL,
    payment_date DATE NOT NULL,
    amount DECIMAL(14,2) NOT NULL,
    method NVARCHAR(30) NULL,                     -- bank_transfer|cheque|cash|card|other
    is_retention_release BIT NOT NULL DEFAULT 0,  -- flag for retention payments
    reference NVARCHAR(255) NULL,
    notes NVARCHAR(MAX) NULL,
    created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    created_by NVARCHAR(255) NULL,
    CONSTRAINT FK_InvoicePayments_Invoice
        FOREIGN KEY (invoice_id) REFERENCES Invoices(id) ON DELETE CASCADE
);
CREATE INDEX IX_InvoicePayments_invoice ON InvoicePayments(invoice_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Receipts  (non-PO purchases)
-- ─────────────────────────────────────────────────────────────────────────────
-- Standalone purchases without a PO trail — fuel receipts, ad-hoc cash, etc.
-- Project_id and cost_centre are XOR-optional (a receipt can be tied to a
-- project, an overhead cost centre, or neither).
CREATE TABLE Receipts (
    id INT IDENTITY(1,1) PRIMARY KEY,
    receipt_date DATE NOT NULL,
    supplier_text NVARCHAR(255) NULL,             -- free-text (receipts rarely tie to Suppliers)
    category NVARCHAR(50) NOT NULL DEFAULT 'Other', -- Fuel|Materials|Consumables|PPE|Equipment|Rent|Insurance|Professional Services|Galvanise|Food & Water|Stationery|Travel|Other
    project_id INT NULL,
    cost_centre NVARCHAR(50) NULL,
    net_amount DECIMAL(14,2) NULL,
    vat_amount DECIMAL(14,2) NULL,
    gross_amount DECIMAL(14,2) NOT NULL DEFAULT 0,
    payment_method NVARCHAR(30) NOT NULL DEFAULT 'other', -- credit_card|cash|company_account|personal|other
    paid_by_employee_id INT NULL,                 -- non-null when payment_method='personal'
    reimbursed_at DATETIME2 NULL,
    is_reconciled BIT NOT NULL DEFAULT 0,
    notes NVARCHAR(MAX) NULL,
    attachment_id INT NULL,                       -- the receipt image / PDF
    created_by NVARCHAR(255) NULL,
    created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    updated_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

    CONSTRAINT FK_Receipts_Project FOREIGN KEY (project_id) REFERENCES Projects(id),
    CONSTRAINT FK_Receipts_Employee FOREIGN KEY (paid_by_employee_id) REFERENCES Employees(id)
);
CREATE INDEX IX_Receipts_date ON Receipts(receipt_date);
CREATE INDEX IX_Receipts_category ON Receipts(category);
CREATE INDEX IX_Receipts_project ON Receipts(project_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. InvoiceAttachments  (polymorphic file index)
-- ─────────────────────────────────────────────────────────────────────────────
-- Attaches files (PDFs, images) to AFPs, Invoices, or Receipts. The
-- (parent_kind, parent_id) pair identifies what the file belongs to.
CREATE TABLE InvoiceAttachments (
    id INT IDENTITY(1,1) PRIMARY KEY,
    parent_kind NVARCHAR(30) NOT NULL,            -- 'application' | 'invoice' | 'receipt' | 'application_certificate'
    parent_id INT NOT NULL,
    kind NVARCHAR(50) NOT NULL,                   -- 'pdf' | 'certificate' | 'receipt' | 'other'
    filename NVARCHAR(255) NULL,
    sharepoint_id NVARCHAR(255) NULL,
    sharepoint_url NVARCHAR(500) NULL,
    uploaded_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),
    uploaded_by NVARCHAR(255) NULL,
    CONSTRAINT CK_InvoiceAttachments_ParentKind
        CHECK (parent_kind IN ('application','invoice','receipt','application_certificate'))
);
CREATE INDEX IX_InvoiceAttachments_parent ON InvoiceAttachments(parent_kind, parent_id);

-- Wire up FK on Applications now that the attachment table exists
ALTER TABLE Applications
    ADD CONSTRAINT FK_Applications_Cert
        FOREIGN KEY (certificate_attachment_id) REFERENCES InvoiceAttachments(id);

-- Wire up FK on Receipts
ALTER TABLE Receipts
    ADD CONSTRAINT FK_Receipts_Attachment
        FOREIGN KEY (attachment_id) REFERENCES InvoiceAttachments(id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8. PurchaseOrders — extend with supplier invoice columns
-- ─────────────────────────────────────────────────────────────────────────────
-- The Supplier Invoices tab is a filtered view over PurchaseOrders where
-- supplier_invoice_received_at IS NOT NULL.
ALTER TABLE PurchaseOrders
    ADD supplier_invoice_ref NVARCHAR(100) NULL,
        supplier_invoice_date DATE NULL,
        supplier_invoice_net DECIMAL(14,2) NULL,
        supplier_invoice_vat DECIMAL(14,2) NULL,
        supplier_invoice_gross DECIMAL(14,2) NULL,
        supplier_invoice_received_at DATETIME2 NULL,
        supplier_invoice_attachment_id INT NULL, -- FK to POAttachments (the existing table)
        reconciliation_status NVARCHAR(20) NULL, -- unmatched|matched|discrepancy
        reconciliation_notes NVARCHAR(MAX) NULL;
GO

-- The filtered index must run in a separate batch from the ALTER TABLE above —
-- SQL Server parses the WHERE clause at compile time and won't see the new
-- column otherwise. (Hit this when running on Azure SQL.)
CREATE INDEX IX_PurchaseOrders_supplier_invoice_received
    ON PurchaseOrders(supplier_invoice_received_at)
    WHERE supplier_invoice_received_at IS NOT NULL;
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- 9. Permissions — add `invoicing` key
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE UserPermissions
    ADD invoicing BIT NOT NULL DEFAULT 0;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10. Invoice numbering seed (so first INV ref allocated is INV0258)
-- ─────────────────────────────────────────────────────────────────────────────
-- The allocator picks MAX(seq) + 1 from existing rows where ref matches the
-- pattern. We insert a single "ghost" Invoices row at INV0257 marked
-- status='Void' so the next allocation lands on INV0258. This also matches
-- the user's note that "our last number for today is INV0257".
--
-- This insert is wrapped in IF NOT EXISTS so re-running the migration is safe.
IF NOT EXISTS (SELECT 1 FROM Invoices WHERE ref = 'INV0257')
BEGIN
    INSERT INTO Invoices (
        ref, kind, customer_text, invoice_date, status, gross_amount,
        notes, created_by, created_at
    )
    VALUES (
        'INV0257', 'invoice', 'Bama South West',
        '2026-05-19', 'Void', 50.00,
        'Seed row — see api/sql/add-invoicing.sql. Marks the last invoice issued before ERP go-live so the allocator starts at INV0258.',
        'system-seed', GETUTCDATE()
    );
END;

-- ─────────────────────────────────────────────────────────────────────────────
-- Done.
-- After running this script:
--   • Deploy the API (api/src/functions/invoicing.js will register routes)
--   • Push the frontend (invoice-tracker.html + shared.js updates)
--   • Grant the `invoicing` permission to relevant users
-- ─────────────────────────────────────────────────────────────────────────────

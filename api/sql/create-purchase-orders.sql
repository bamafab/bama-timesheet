-- Purchase Orders — Phase 1a
--
-- Three tables to model raised POs, optional line items, and uploaded
-- attachments (delivery notes / supplier invoices / other files).
--
-- Reference format: P{YY}{MM}-NNNN, resets monthly (e.g. P2605-0001 → P2605-0002
-- → June starts at P2606-0001). Allocated server-side.
--
-- project_id is NULL for overhead POs; cost_centre is set in that case.
-- A check constraint enforces "exactly one of project_id or cost_centre".
--
-- Status is the UI-level summary ('Open' | 'Received' | 'Closed').
-- The underlying truth lives in the timestamp/flag columns:
--   approved_at / approved_by      — set when office approves the draft
--   sent_at / sent_by              — set when PDF emailed to supplier
--   delivery_received_at           — set when goods/services confirmed received
--   invoice_received_at + invoice_value + invoice_ref
--                                  — set when supplier invoice uploaded
--   paid_at                        — set when invoice paid; transitions to Closed
--
-- Idempotent: gated on OBJECT_ID lookups so re-running is safe.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;

-------------------------------------------------------------------------------
-- 1. PurchaseOrders
-------------------------------------------------------------------------------
IF OBJECT_ID('dbo.PurchaseOrders', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.PurchaseOrders (
        id                      INT IDENTITY(1,1) PRIMARY KEY,
        reference               NVARCHAR(20)   NOT NULL,
        supplier_id             INT            NOT NULL,
        project_id              INT            NULL,
        cost_centre             NVARCHAR(100)  NULL,
        total_value             DECIMAL(18, 2) NULL,           -- authoritative when no line items
        description             NVARCHAR(MAX)  NULL,
        status                  NVARCHAR(20)   NOT NULL DEFAULT 'Open',
                                -- Allowed: 'Open', 'Received', 'Closed', 'Cancelled'

        -- Template fields (PUR001 Rev.00)
        job_number              NVARCHAR(50)   NULL,           -- Defaults to Projects.project_number,
                                                               -- editable for legacy refs (S####) or overhead POs
        delivery_date           DATE           NULL,
        delivery_address        NVARCHAR(500)  NULL,           -- Defaults to BAMA HQ, editable per-PO
        delivery_charge         DECIMAL(18, 2) NULL,
        collection_charge       DECIMAL(18, 2) NULL,

        -- Underlying state flags / timestamps
        approved_at             DATETIME2      NULL,
        approved_by             NVARCHAR(255)  NULL,
        sent_at                 DATETIME2      NULL,
        sent_by                 NVARCHAR(255)  NULL,

        delivery_received_at    DATETIME2      NULL,
        delivery_received_by    NVARCHAR(255)  NULL,

        invoice_received_at     DATETIME2      NULL,
        invoice_value           DECIMAL(18, 2) NULL,
        invoice_ref             NVARCHAR(100)  NULL,
        invoice_received_by     NVARCHAR(255)  NULL,

        paid_at                 DATETIME2      NULL,
        paid_by                 NVARCHAR(255)  NULL,

        cancelled_at            DATETIME2      NULL,
        cancelled_by            NVARCHAR(255)  NULL,
        cancelled_reason        NVARCHAR(500)  NULL,

        -- SharePoint — PO PDF (supplier-facing)
        sharepoint_folder_id    NVARCHAR(200)  NULL,           -- the {PO-ref}/ folder under {C-ref} or Overhead/{cc}/
        sharepoint_pdf_id       NVARCHAR(200)  NULL,           -- the PO PDF itself
        sharepoint_pdf_url      NVARCHAR(500)  NULL,
        -- SharePoint — delivery note (internal, lives in project 07 - Deliveries
        -- for project POs; alongside PO PDF for overhead POs)
        sharepoint_dn_id        NVARCHAR(200)  NULL,
        sharepoint_dn_url       NVARCHAR(500)  NULL,

        -- Meta
        created_by              NVARCHAR(255)  NULL,
        created_at              DATETIME2      NOT NULL DEFAULT GETUTCDATE(),
        updated_at              DATETIME2      NOT NULL DEFAULT GETUTCDATE(),

        CONSTRAINT FK_PurchaseOrders_Supplier
            FOREIGN KEY (supplier_id) REFERENCES dbo.Suppliers(id),
        CONSTRAINT FK_PurchaseOrders_Project
            FOREIGN KEY (project_id)  REFERENCES dbo.Projects(id),
        -- Exactly one of project_id / cost_centre must be set.
        CONSTRAINT CK_PurchaseOrders_ProjectXorCostCentre
            CHECK (
                (project_id IS NOT NULL AND cost_centre IS NULL)
             OR (project_id IS NULL     AND cost_centre IS NOT NULL)
            ),
        CONSTRAINT CK_PurchaseOrders_Status
            CHECK (status IN ('Open', 'Received', 'Closed', 'Cancelled'))
    );

    CREATE UNIQUE INDEX UX_PurchaseOrders_reference  ON dbo.PurchaseOrders(reference);
    CREATE INDEX IX_PurchaseOrders_project_id        ON dbo.PurchaseOrders(project_id);
    CREATE INDEX IX_PurchaseOrders_supplier_id       ON dbo.PurchaseOrders(supplier_id);
    CREATE INDEX IX_PurchaseOrders_status            ON dbo.PurchaseOrders(status);
    CREATE INDEX IX_PurchaseOrders_created_at        ON dbo.PurchaseOrders(created_at DESC);
END

-------------------------------------------------------------------------------
-- 2. POLineItems
-------------------------------------------------------------------------------
IF OBJECT_ID('dbo.POLineItems', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.POLineItems (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        po_id           INT            NOT NULL,
        description     NVARCHAR(500)  NOT NULL,
        quantity        DECIMAL(18, 3) NULL,
        unit            NVARCHAR(50)   NULL,                -- 'each', 'm', 'kg', 'hr' etc.
        unit_price      DECIMAL(18, 4) NULL,
        line_total      DECIMAL(18, 2) NULL,                -- computed by API; stored for fast aggregation
        sort_order      INT            NOT NULL DEFAULT 0,

        CONSTRAINT FK_POLineItems_PO
            FOREIGN KEY (po_id) REFERENCES dbo.PurchaseOrders(id) ON DELETE CASCADE
    );

    CREATE INDEX IX_POLineItems_po_id ON dbo.POLineItems(po_id);
END

-------------------------------------------------------------------------------
-- 3. POAttachments
-------------------------------------------------------------------------------
IF OBJECT_ID('dbo.POAttachments', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.POAttachments (
        id                  INT IDENTITY(1,1) PRIMARY KEY,
        po_id               INT            NOT NULL,
        kind                NVARCHAR(30)   NOT NULL,        -- 'delivery_note' | 'supplier_invoice' | 'other'
        filename            NVARCHAR(500)  NOT NULL,
        sharepoint_file_id  NVARCHAR(200)  NULL,
        sharepoint_file_url NVARCHAR(500)  NULL,
        uploaded_by         NVARCHAR(255)  NULL,
        uploaded_at         DATETIME2      NOT NULL DEFAULT GETUTCDATE(),

        CONSTRAINT FK_POAttachments_PO
            FOREIGN KEY (po_id) REFERENCES dbo.PurchaseOrders(id) ON DELETE CASCADE,
        CONSTRAINT CK_POAttachments_Kind
            CHECK (kind IN ('delivery_note', 'supplier_invoice', 'other'))
    );

    CREATE INDEX IX_POAttachments_po_id ON dbo.POAttachments(po_id);
    CREATE INDEX IX_POAttachments_kind  ON dbo.POAttachments(kind);
END

-------------------------------------------------------------------------------
-- 4. Seed cost centres into Settings (idempotent)
-- Settings stores values as JSON-encoded strings (parsed on read).
-------------------------------------------------------------------------------
IF NOT EXISTS (SELECT 1 FROM dbo.Settings WHERE [key] = 'purchase_order_cost_centres')
BEGIN
    INSERT INTO dbo.Settings ([key], value, updated_at)
    VALUES (
        'purchase_order_cost_centres',
        '["Office","Workshop","Tools","Vehicles","IT","Consumables"]',
        GETUTCDATE()
    );
END

-------------------------------------------------------------------------------
-- 5. UserPermissions: add viewPurchaseOrders + editPurchaseOrders columns
-------------------------------------------------------------------------------
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE  object_id = OBJECT_ID('dbo.UserPermissions') AND name = 'view_purchase_orders'
)
BEGIN
    ALTER TABLE dbo.UserPermissions
        ADD view_purchase_orders BIT NOT NULL CONSTRAINT DF_UserPermissions_view_purchase_orders DEFAULT 0;
END

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE  object_id = OBJECT_ID('dbo.UserPermissions') AND name = 'edit_purchase_orders'
)
BEGIN
    ALTER TABLE dbo.UserPermissions
        ADD edit_purchase_orders BIT NOT NULL CONSTRAINT DF_UserPermissions_edit_purchase_orders DEFAULT 0;
END

PRINT 'Purchase Orders migration complete.';

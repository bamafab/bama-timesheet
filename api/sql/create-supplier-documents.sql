-- ─────────────────────────────────────────────────────────────────────────────
-- create-supplier-documents.sql  (D2 — Supplier records, 2026-07-30)
--
-- FPC layer on the existing Suppliers table: approval status (FPC s9 —
-- "materials must only be sourced from approved suppliers") + per-supplier
-- document register (insurances, quality certs, CIS letters) with expiry
-- tracking, mirroring the D1 CompanyDocuments pattern. Files live in
-- SharePoint under BAMA / 04 - Suppliers & Subcontractors / <Supplier>.
--
-- NOTE: the ALTER TABLE section adds columns to Suppliers ⇒ the Function App
-- needs a restart to see them — the deploy that ships this feature restarts
-- it anyway, so run this script and you're done.
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Approval columns on Suppliers
IF COL_LENGTH('Suppliers', 'approval_status') IS NULL
    ALTER TABLE Suppliers ADD approval_status NVARCHAR(20) NOT NULL DEFAULT 'unapproved';
IF COL_LENGTH('Suppliers', 'approval_review_due') IS NULL
    ALTER TABLE Suppliers ADD approval_review_due DATE NULL;
IF COL_LENGTH('Suppliers', 'approved_by') IS NULL
    ALTER TABLE Suppliers ADD approved_by NVARCHAR(120) NULL;
IF COL_LENGTH('Suppliers', 'approved_at') IS NULL
    ALTER TABLE Suppliers ADD approved_at DATETIME2 NULL;

-- 2) Supplier document register
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SupplierDocuments')
BEGIN
    CREATE TABLE SupplierDocuments (
        id                  INT IDENTITY(1,1) PRIMARY KEY,
        supplier_id         INT NOT NULL,
        doc_type            NVARCHAR(30)  NOT NULL,   -- insurance_el | insurance_pl | insurance_pi | quality | cis | hs | other
        title               NVARCHAR(200) NOT NULL,
        doc_ref             NVARCHAR(100) NULL,
        issuer              NVARCHAR(150) NULL,
        issue_date          DATE          NULL,
        expiry_date         DATE          NULL,
        reminder_days       INT           NOT NULL DEFAULT 60,
        file_name           NVARCHAR(255) NULL,
        sharepoint_file_id  NVARCHAR(120) NULL,
        drive_id            NVARCHAR(140) NULL,
        web_url             NVARCHAR(1000) NULL,
        notes               NVARCHAR(MAX) NULL,
        is_archived         BIT           NOT NULL DEFAULT 0,
        superseded_by       INT           NULL,
        is_deleted          BIT           NOT NULL DEFAULT 0,
        uploaded_by         NVARCHAR(120) NULL,
        created_at          DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at          DATETIME2     NULL
    );
    CREATE INDEX IX_SupplierDocuments_Supplier ON SupplierDocuments (supplier_id) WHERE is_deleted = 0;
    CREATE INDEX IX_SupplierDocuments_Expiry ON SupplierDocuments (expiry_date) WHERE is_deleted = 0 AND is_archived = 0;
    PRINT 'SupplierDocuments created';
END
ELSE
    PRINT 'SupplierDocuments already exists — no change';

-- Verification
SELECT COL_LENGTH('Suppliers','approval_status') AS approval_col,
       (SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('SupplierDocuments')) AS supdoc_cols;

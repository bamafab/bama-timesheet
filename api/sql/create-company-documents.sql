-- ─────────────────────────────────────────────────────────────────────────────
-- create-company-documents.sql  (D1 — Company Document Library, 2026-07-29)
--
-- One register of company-level documents (insurances, policies,
-- accreditations, H&S docs) with first-class expiry tracking. Files live in
-- SharePoint under 00 - BAMA / 01 - Company Management (SP_TAX taxonomy);
-- this table holds the metadata + reminder logic surfaced on the
-- Estimating Dashboard "Docs" tab.
--
-- NEW TABLE ⇒ no Function App restart needed.
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CompanyDocuments')
BEGIN
    CREATE TABLE CompanyDocuments (
        id                  INT IDENTITY(1,1) PRIMARY KEY,
        category            NVARCHAR(30)  NOT NULL,   -- insurance | policy | accreditation | hs | other
        title               NVARCHAR(200) NOT NULL,
        doc_ref             NVARCHAR(100) NULL,       -- policy / certificate number
        issuer              NVARCHAR(150) NULL,       -- insurer / issuing body
        issue_date          DATE          NULL,
        expiry_date         DATE          NULL,       -- NULL = never expires (e.g. a policy doc)
        reminder_days       INT           NOT NULL DEFAULT 60,
        file_name           NVARCHAR(255) NULL,
        sharepoint_file_id  NVARCHAR(120) NULL,
        drive_id            NVARCHAR(140) NULL,
        web_url             NVARCHAR(1000) NULL,
        notes               NVARCHAR(MAX) NULL,
        is_archived         BIT           NOT NULL DEFAULT 0,  -- old versions after renewal
        superseded_by       INT           NULL,                -- id of the renewal row
        is_deleted          BIT           NOT NULL DEFAULT 0,  -- soft delete
        uploaded_by         NVARCHAR(120) NULL,
        created_at          DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at          DATETIME2     NULL
    );
    CREATE INDEX IX_CompanyDocuments_Expiry
        ON CompanyDocuments (expiry_date)
        WHERE is_deleted = 0 AND is_archived = 0;
    PRINT 'CompanyDocuments created';
END
ELSE
    PRINT 'CompanyDocuments already exists — no change';

-- Verification
SELECT COUNT(*) AS column_count
FROM sys.columns
WHERE object_id = OBJECT_ID('CompanyDocuments');

-- ─────────────────────────────────────────────────────────────────────────────
-- create-policies.sql  (Policy Studio, 2026-08-08)
--
-- ERP-owned company policies: content lives here as structured sections,
-- the PDF is regenerated on demand in the house style with the director
-- authorisation block ON the document. Re-issuing the SAME revision
-- overwrites the same SharePoint file (stable file id → staff signatures
-- persist); a revision bump creates a new file (signatures reset).
-- New tables only — no Function App restart required.
-- ─────────────────────────────────────────────────────────────────────────────

IF OBJECT_ID('dbo.Policies', 'U') IS NULL
CREATE TABLE dbo.Policies (
    id                   INT IDENTITY(1,1) PRIMARY KEY,
    ref                  NVARCHAR(30)  NULL,            -- POL001 etc
    title                NVARCHAR(200) NOT NULL,
    category             NVARCHAR(20)  NOT NULL DEFAULT 'policy',  -- policy | hs | ra_ssow
    revision             INT           NOT NULL DEFAULT 1,
    review_months        INT           NOT NULL DEFAULT 12,
    sections             NVARCHAR(MAX) NULL,            -- JSON [{heading, body}]
    history              NVARCHAR(MAX) NULL,            -- JSON [{revision, issued_at, issued_by, note}]
    status               NVARCHAR(20)  NOT NULL DEFAULT 'draft',   -- draft | issued
    company_document_id  INT           NULL,            -- linked CompanyDocuments register row
    sharepoint_file_id   NVARCHAR(200) NULL,            -- current issued PDF (stable per revision)
    drive_id             NVARCHAR(200) NULL,
    web_url              NVARCHAR(500) NULL,
    file_name            NVARCHAR(300) NULL,
    issued_at            DATETIME2     NULL,
    issued_by            NVARCHAR(100) NULL,
    is_deleted           BIT           NOT NULL DEFAULT 0,
    created_at           DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at           DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);

-- Stored director signature for one-click signing. Latest active row wins;
-- replacing a signature deactivates the previous one (kept for audit).
IF OBJECT_ID('dbo.DirectorSignatures', 'U') IS NULL
CREATE TABLE dbo.DirectorSignatures (
    id           INT IDENTITY(1,1) PRIMARY KEY,
    signer_name  NVARCHAR(100) NOT NULL,
    signature    NVARCHAR(MAX) NOT NULL,                -- PNG data URI
    is_active    BIT           NOT NULL DEFAULT 1,
    created_at   DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- create-rams-documents.sql — RAMS register (numbering + revisions + merges)
--
-- Persists every generated RAMS so it can be REVISED (same number, rev+1)
-- instead of rebuilt. rams_no is sequential per project (printed 001, 002…);
-- doc_no is the full printed number "<project> - 001 - <title>". job_ids is a
-- JSON array — one RAMS can cover several jobs. rams_data is the complete
-- modal state (sections, risks, personnel, site plan) used to prefill the
-- modal on revision. Earlier revisions stay in the table (superseded = 1)
-- with their SharePoint file ids for the audit trail.
--
-- NEW TABLE => no Function App restart needed.
-- ─────────────────────────────────────────────────────────────────────────────

IF OBJECT_ID('RamsDocuments', 'U') IS NULL
BEGIN
    CREATE TABLE RamsDocuments (
        id            INT IDENTITY(1,1) PRIMARY KEY,
        project_id    INT            NOT NULL,
        rams_no       INT            NOT NULL,              -- 1, 2, 3… per project
        revision      INT            NOT NULL DEFAULT 0,    -- 0 = first issue
        title         NVARCHAR(300)  NULL,                  -- e.g. 'Handrails & Balustrades'
        doc_no        NVARCHAR(160)  NULL,                  -- '260533 - 001 - Handrails'
        job_ids       NVARCHAR(MAX)  NULL,                  -- JSON array of job ids
        rams_data     NVARCHAR(MAX)  NULL,                  -- full modal state (JSON)
        pdf_file_id   NVARCHAR(200)  NULL,
        pdf_drive_id  NVARCHAR(200)  NULL,
        pdf_web_url   NVARCHAR(1000) NULL,
        docx_file_id  NVARCHAR(200)  NULL,
        docx_drive_id NVARCHAR(200)  NULL,
        docx_web_url  NVARCHAR(1000) NULL,
        superseded    BIT            NOT NULL DEFAULT 0,
        created_at    DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        created_by    NVARCHAR(200)  NULL
    );
    CREATE UNIQUE INDEX UX_Rams_Project_No_Rev ON RamsDocuments(project_id, rams_no, revision);
    CREATE INDEX IX_Rams_Project ON RamsDocuments(project_id, superseded);
END;

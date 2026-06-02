-- ─────────────────────────────────────────────────────────────────────────────
-- Drawings Blob → SQL Migration
-- Moves Approval revisions, Parts files, Site data, and Element notes
-- out of the SharePoint JSON blob and into SQL.
-- All tables are additive — existing DrawingJobs / JobAssemblies data untouched.
-- Safe to re-run (all blocks idempotent).
-- ─────────────────────────────────────────────────────────────────────────────
-- IMPORTANT: Restart the Function App after running this migration.
-- ─────────────────────────────────────────────────────────────────────────────

SET XACT_ABORT ON;
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. DrawingApprovalRevisions
--    One row per PO or CO revision submitted for a job.
-- ─────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID('DrawingApprovalRevisions', 'U') IS NULL
BEGIN
    CREATE TABLE DrawingApprovalRevisions (
        id              INT IDENTITY PRIMARY KEY,
        job_id          INT           NOT NULL,
        revision_type   NVARCHAR(8)   NOT NULL,  -- 'PO' | 'CO'
        revision_number INT           NOT NULL,
        status          NVARCHAR(32)  NOT NULL CONSTRAINT DF_DAR_Status DEFAULT 'sent',
        status_updated_at DATETIME2   NULL,
        uploaded_at     DATETIME2     NOT NULL CONSTRAINT DF_DAR_UploadedAt DEFAULT SYSUTCDATETIME(),
        uploaded_by     NVARCHAR(256) NULL,
        CONSTRAINT FK_DAR_Job FOREIGN KEY (job_id) REFERENCES DrawingJobs(id) ON DELETE CASCADE,
        CONSTRAINT CK_DAR_Type   CHECK (revision_type IN ('PO','CO')),
        CONSTRAINT CK_DAR_Status CHECK (status IN ('sent','approved','rejected'))
    );
    CREATE INDEX IX_DAR_Job ON DrawingApprovalRevisions(job_id);
END;
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. DrawingRevisionFiles
--    Files attached to an approval revision.
-- ─────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID('DrawingRevisionFiles', 'U') IS NULL
BEGIN
    CREATE TABLE DrawingRevisionFiles (
        id                  INT IDENTITY PRIMARY KEY,
        revision_id         INT            NOT NULL,
        blob_id             NVARCHAR(64)   NULL,      -- original Date.now() id from blob
        display_name        NVARCHAR(256)  NOT NULL,
        file_name           NVARCHAR(256)  NOT NULL,
        sharepoint_file_id  NVARCHAR(256)  NULL,
        sharepoint_drive_id NVARCHAR(256)  NULL,
        web_url             NVARCHAR(1024) NULL,
        uploaded_at         DATETIME2      NOT NULL CONSTRAINT DF_DRF_UploadedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_DRF_Revision FOREIGN KEY (revision_id) REFERENCES DrawingApprovalRevisions(id) ON DELETE CASCADE
    );
    CREATE INDEX IX_DRF_Revision ON DrawingRevisionFiles(revision_id);
END;
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. DrawingElementFiles
--    Files for Parts (sections/plates) and Site sections.
--    context: 'parts-sections' | 'parts-plates' | 'site'
-- ─────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID('DrawingElementFiles', 'U') IS NULL
BEGIN
    CREATE TABLE DrawingElementFiles (
        id                  INT IDENTITY PRIMARY KEY,
        job_id              INT            NOT NULL,
        context             NVARCHAR(32)   NOT NULL,
        blob_id             NVARCHAR(64)   NULL,
        display_name        NVARCHAR(256)  NOT NULL,
        file_name           NVARCHAR(256)  NOT NULL,
        sharepoint_file_id  NVARCHAR(256)  NULL,
        sharepoint_drive_id NVARCHAR(256)  NULL,
        web_url             NVARCHAR(1024) NULL,
        uploaded_at         DATETIME2      NOT NULL CONSTRAINT DF_DEF_UploadedAt DEFAULT SYSUTCDATETIME(),
        uploaded_by         NVARCHAR(256)  NULL,
        CONSTRAINT FK_DEF_Job FOREIGN KEY (job_id) REFERENCES DrawingJobs(id) ON DELETE CASCADE,
        CONSTRAINT CK_DEF_Context CHECK (context IN ('parts-sections','parts-plates','site'))
    );
    CREATE INDEX IX_DEF_Job_Context ON DrawingElementFiles(job_id, context);
END;
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. DrawingElementNotes
--    Notes for approval, parts-sections, parts-plates, site, bom contexts.
--    note_type: 'draftsman' | 'workshop'
-- ─────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID('DrawingElementNotes', 'U') IS NULL
BEGIN
    CREATE TABLE DrawingElementNotes (
        id          INT IDENTITY PRIMARY KEY,
        job_id      INT            NOT NULL,
        context     NVARCHAR(32)   NOT NULL,
        note_type   NVARCHAR(16)   NOT NULL,
        author      NVARCHAR(256)  NOT NULL,
        note_text   NVARCHAR(MAX)  NOT NULL,
        blob_id     NVARCHAR(64)   NULL,
        created_at  DATETIME2      NOT NULL CONSTRAINT DF_DEN_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_DEN_Job FOREIGN KEY (job_id) REFERENCES DrawingJobs(id) ON DELETE CASCADE,
        CONSTRAINT CK_DEN_Context CHECK (context IN ('approval','parts-sections','parts-plates','site','bom')),
        CONSTRAINT CK_DEN_NoteType CHECK (note_type IN ('draftsman','workshop'))
    );
    CREATE INDEX IX_DEN_Job_Context ON DrawingElementNotes(job_id, context);
END;
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. DrawingJobSite
--    Site completion metadata — one optional row per job.
-- ─────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID('DrawingJobSite', 'U') IS NULL
BEGIN
    CREATE TABLE DrawingJobSite (
        id           INT IDENTITY PRIMARY KEY,
        job_id       INT            NOT NULL UNIQUE,
        completed_at DATETIME2      NULL,
        completed_by NVARCHAR(256)  NULL,
        created_at   DATETIME2      NOT NULL CONSTRAINT DF_DJS_CreatedAt DEFAULT SYSUTCDATETIME(),
        CONSTRAINT FK_DJS_Job FOREIGN KEY (job_id) REFERENCES DrawingJobs(id) ON DELETE CASCADE
    );
END;
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT 'DrawingApprovalRevisions' AS tbl, COUNT(*) AS cnt FROM sys.tables WHERE name = 'DrawingApprovalRevisions';
-- SELECT 'DrawingRevisionFiles'     AS tbl, COUNT(*) AS cnt FROM sys.tables WHERE name = 'DrawingRevisionFiles';
-- SELECT 'DrawingElementFiles'      AS tbl, COUNT(*) AS cnt FROM sys.tables WHERE name = 'DrawingElementFiles';
-- SELECT 'DrawingElementNotes'      AS tbl, COUNT(*) AS cnt FROM sys.tables WHERE name = 'DrawingElementNotes';
-- SELECT 'DrawingJobSite'           AS tbl, COUNT(*) AS cnt FROM sys.tables WHERE name = 'DrawingJobSite';

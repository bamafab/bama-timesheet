-- ─────────────────────────────────────────────────────────────────────────────
-- create-delivery-note-register.sql — deliveries register (DN + SDN)
--
-- One row per generated delivery note, written by the frontend right after
-- the PDF upload. Covers BOTH kinds: 'supplier' (DN-xxxx, steel out for
-- finishing) and 'site' (SDN-xxxx, goods to the installation site).
-- job_ids is a JSON array — multi-job notes list on every covered job's
-- Site Installation register. Supplier DNs previously had NO ledger at all
-- (refs stamped on item rows get overwritten by later shipments), so this
-- is the durable per-note record with the SharePoint link.
--
-- NEW TABLE => no Function App restart needed.
-- ─────────────────────────────────────────────────────────────────────────────

IF OBJECT_ID('DeliveryNoteRegister', 'U') IS NULL
BEGIN
    CREATE TABLE DeliveryNoteRegister (
        id                  INT IDENTITY(1,1) PRIMARY KEY,
        ref                 NVARCHAR(32)   NOT NULL,          -- 'DN-0042' / 'SDN-0007'
        kind                NVARCHAR(16)   NOT NULL,          -- 'supplier' | 'site'
        project_id          INT            NULL,              -- Projects.id (dbId)
        job_ids             NVARCHAR(MAX)  NULL,              -- JSON array of DrawingJobs ids
        destination         NVARCHAR(300)  NULL,              -- supplier name / site name
        line_count          INT            NULL,
        total_qty           INT            NULL,
        sharepoint_file_id  NVARCHAR(256)  NULL,
        sharepoint_drive_id NVARCHAR(256)  NULL,
        sharepoint_web_url  NVARCHAR(1024) NULL,
        file_name           NVARCHAR(256)  NULL,
        created_at          DATETIME2      NOT NULL DEFAULT SYSUTCDATETIME(),
        created_by          NVARCHAR(256)  NULL,
        CONSTRAINT CK_DNReg_Kind CHECK (kind IN ('supplier','site'))
    );
    CREATE UNIQUE INDEX UX_DNReg_Ref ON DeliveryNoteRegister(ref);
    CREATE INDEX IX_DNReg_Project ON DeliveryNoteRegister(project_id);
END;

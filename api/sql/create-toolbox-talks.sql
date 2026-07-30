-- ─────────────────────────────────────────────────────────────────────────────
-- create-toolbox-talks.sql  (toolbox talks, 2026-07-30)
--
-- Two tables, because a talk and a delivery of that talk are different things:
--   ToolboxTalks          — the library. One row per talk topic, reusable.
--   ToolboxTalkDeliveries — each time a talk was actually given: when, where,
--                           by whom, to whom.
--
-- Attendee names live in the delivery row as JSON; SIGNATURE IMAGES DO NOT
-- TOUCH THE DATABASE. Same rule as the QMS engine: the signed PDF is filed to
-- SharePoint and is the evidence; the register holds who and when. Storing
-- base64 signature PNGs in NVARCHAR(MAX) bloats the DB for no benefit.
--
-- Near-miss trending is what a 45001 auditor asks for, and they ask the same of
-- toolbox talks: not "do you do them" but "show me who attended which one".
--
-- NEW TABLES ONLY — no Function App restart needed. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ToolboxTalks')
BEGIN
    CREATE TABLE ToolboxTalks (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        talk_ref    NVARCHAR(40)  NOT NULL,          -- TBT-001
        title       NVARCHAR(200) NOT NULL,
        category    NVARCHAR(40)  NOT NULL DEFAULT 'general',
            -- general | height | manual_handling | hot_works | ppe | lifting
            -- | plant | coshh | electrical | site_traffic | environment | welfare
        summary     NVARCHAR(500) NULL,              -- one line, for the picker
        content     NVARCHAR(MAX) NULL,              -- the talk itself (markdown-ish plain text)
        key_points  NVARCHAR(MAX) NULL,              -- JSON array of bullet points
        source      NVARCHAR(40)  NOT NULL DEFAULT 'library',   -- library | drafted | custom
        review_due  DATE          NULL,
        is_active   BIT           NOT NULL DEFAULT 1,
        is_deleted  BIT           NOT NULL DEFAULT 0,
        created_by  NVARCHAR(120) NULL,
        created_at  DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at  DATETIME2     NULL
    );
    CREATE UNIQUE INDEX UX_ToolboxTalks_Ref ON ToolboxTalks (talk_ref) WHERE is_deleted = 0;
    PRINT 'ToolboxTalks created';
END
ELSE
    PRINT 'ToolboxTalks already exists — no change';

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ToolboxTalkDeliveries')
BEGIN
    CREATE TABLE ToolboxTalkDeliveries (
        id                 INT IDENTITY(1,1) PRIMARY KEY,
        talk_id            INT           NOT NULL,
        talk_ref           NVARCHAR(40)  NULL,       -- snapshot
        talk_title         NVARCHAR(200) NULL,       -- snapshot: the library row may be edited later
        job_id             INT           NULL,
        job_number         NVARCHAR(60)  NULL,
        location           NVARCHAR(200) NULL,
        delivered_on       DATE          NOT NULL,
        delivered_by       NVARCHAR(200) NOT NULL,
        attendees          NVARCHAR(MAX) NULL,       -- JSON [{name, role, signed}]
        attendee_count     INT           NOT NULL DEFAULT 0,
        notes              NVARCHAR(MAX) NULL,       -- questions raised, actions
        file_name          NVARCHAR(255)  NULL,
        sharepoint_file_id NVARCHAR(120)  NULL,
        drive_id           NVARCHAR(140)  NULL,
        web_url            NVARCHAR(1000) NULL,
        is_deleted         BIT           NOT NULL DEFAULT 0,
        created_by         NVARCHAR(120) NULL,
        created_at         DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_TBTDeliv_Talk ON ToolboxTalkDeliveries (talk_id) WHERE is_deleted = 0;
    CREATE INDEX IX_TBTDeliv_Date ON ToolboxTalkDeliveries (delivered_on) WHERE is_deleted = 0;
    CREATE INDEX IX_TBTDeliv_Job  ON ToolboxTalkDeliveries (job_id) WHERE is_deleted = 0;
    PRINT 'ToolboxTalkDeliveries created';
END
ELSE
    PRINT 'ToolboxTalkDeliveries already exists — no change';

SELECT (SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('ToolboxTalks')) AS talk_cols,
       (SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('ToolboxTalkDeliveries')) AS delivery_cols;

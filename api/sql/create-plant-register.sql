-- ─────────────────────────────────────────────────────────────────────────────
-- create-plant-register.sql  (Plant Register, 2026-07-30)
--
-- Company plant & equipment register with statutory-inspection tracking:
-- LOLER thorough examination, PUWER inspection, PAT test, calibration,
-- service, MOT/insurance — one due-date column per regime (NULL = regime
-- not applicable to that item). Per-item document register (inspection
-- certs, service reports, manuals) mirrors the D1/D2/D3 pattern; files live
-- in SharePoint under BAMA / 02 - Quality (QMS) / 07 - Plant & Equipment /
-- <Ref - Name>. Metadata only here.
--
-- NEW TABLES ONLY — no Function App restart needed.
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Plant items
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PlantItems')
BEGIN
    CREATE TABLE PlantItems (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        plant_ref       NVARCHAR(30)  NOT NULL,        -- e.g. P-001 (human ref, unique among live rows)
        name            NVARCHAR(150) NOT NULL,        -- e.g. 'Genie GS-1932 Scissor Lift'
        category        NVARCHAR(30)  NOT NULL DEFAULT 'machine',
            -- lifting_equipment | lifting_accessory | access | welding | machine
            -- | power_tool | vehicle | measuring | other
        make            NVARCHAR(80)  NULL,
        model           NVARCHAR(80)  NULL,
        serial_no       NVARCHAR(100) NULL,
        location        NVARCHAR(120) NULL,            -- Workshop / site name / person
        ownership       NVARCHAR(10)  NOT NULL DEFAULT 'owned',   -- owned | hired
        hire_company    NVARCHAR(120) NULL,
        purchase_date   DATE          NULL,
        status          NVARCHAR(20)  NOT NULL DEFAULT 'in_service',
            -- in_service | under_repair | quarantined | off_hired | disposed
        -- Statutory / maintenance regimes — next-due dates (NULL = n/a)
        loler_due       DATE NULL,                     -- LOLER thorough examination
        puwer_due       DATE NULL,                     -- PUWER inspection
        pat_due         DATE NULL,                     -- PAT test
        calib_due       DATE NULL,                     -- Calibration
        service_due     DATE NULL,                     -- Service / maintenance
        mot_due         DATE NULL,                     -- MOT / insurance (vehicles)
        notes           NVARCHAR(MAX) NULL,
        is_deleted      BIT NOT NULL DEFAULT 0,
        created_by      NVARCHAR(120) NULL,
        created_at      DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at      DATETIME2 NULL
    );
    CREATE INDEX IX_PlantItems_Status ON PlantItems (status) WHERE is_deleted = 0;
    PRINT 'PlantItems created';
END
ELSE
    PRINT 'PlantItems already exists — no change';

-- 2) Plant document register (inspection certs, service reports, manuals)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PlantDocuments')
BEGIN
    CREATE TABLE PlantDocuments (
        id                  INT IDENTITY(1,1) PRIMARY KEY,
        plant_id            INT NOT NULL,
        doc_type            NVARCHAR(30)  NOT NULL,
            -- loler | puwer | pat | calibration | service | mot | manual | other
        title               NVARCHAR(200) NOT NULL,
        doc_ref             NVARCHAR(100) NULL,        -- certificate / report number
        issuer              NVARCHAR(150) NULL,        -- inspection body / engineer
        issue_date          DATE          NULL,
        expiry_date         DATE          NULL,        -- next-due as printed on cert
        reminder_days       INT           NOT NULL DEFAULT 30,
        file_name           NVARCHAR(255) NULL,
        sharepoint_file_id  NVARCHAR(120) NULL,
        drive_id            NVARCHAR(140) NULL,
        web_url             NVARCHAR(1000) NULL,
        notes               NVARCHAR(MAX) NULL,
        is_archived         BIT NOT NULL DEFAULT 0,
        superseded_by       INT NULL,
        is_deleted          BIT NOT NULL DEFAULT 0,
        uploaded_by         NVARCHAR(120) NULL,
        created_at          DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at          DATETIME2 NULL
    );
    CREATE INDEX IX_PlantDocuments_Plant ON PlantDocuments (plant_id) WHERE is_deleted = 0;
    CREATE INDEX IX_PlantDocuments_Expiry ON PlantDocuments (expiry_date) WHERE is_deleted = 0 AND is_archived = 0;
    PRINT 'PlantDocuments created';
END
ELSE
    PRINT 'PlantDocuments already exists — no change';

-- Verification
SELECT
    (SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('PlantItems'))     AS plant_cols,
    (SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('PlantDocuments')) AS plantdoc_cols;

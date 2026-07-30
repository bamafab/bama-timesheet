-- ─────────────────────────────────────────────────────────────────────────────
-- create-inspection-plans.sql  (E2 — inspection & NDT sampling, 2026-07-30)
--
-- Sampled inspection instead of signing off every piece.
--
-- TWO THINGS THAT MUST NOT BE CONFUSED:
--   • VISUAL inspection is 100% of welds at EVERY execution class. It is not
--     sampled, and this module does not let you sample it.
--   • SUPPLEMENTARY NDT (UT / RT / MT / PT) IS sampled, by percentage, and the
--     percentage depends on execution class, weld category and utilisation
--     (EN 1090-2 Table 24).
--
-- THE PERCENTAGES LIVE IN DATA, NOT IN CODE, AND START UNVERIFIED.
-- NdtExtentRules is seeded with the categories and indicative values, every row
-- flagged verified = 0. The UI shows a warning until a row is verified, and
-- Mateusz edits the percentages against BAMA's own copy of EN 1090-2 Table 24
-- / the QMS manual. Nothing in the ERP asserts a compliance figure that a human
-- has not confirmed — same principle as never letting AI invent a hazard score.
--
-- NEW TABLES ONLY — no Function App restart needed. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Rules: how much supplementary NDT, by class / category / utilisation
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'NdtExtentRules')
BEGIN
    CREATE TABLE NdtExtentRules (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        exec_class     NVARCHAR(10)  NOT NULL,        -- EXC1 | EXC2 | EXC3 | EXC4
        weld_category  NVARCHAR(80)  NOT NULL,        -- see seed below
        utilisation    NVARCHAR(20)  NULL,            -- 'U>=0.5' | 'U<0.5' | NULL
        pct_required   DECIMAL(5,2)  NOT NULL,        -- 0 = no supplementary NDT
        method_hint    NVARCHAR(60)  NULL,            -- 'UT or RT', 'MT or PT'
        source_note    NVARCHAR(300) NULL,
        verified       BIT           NOT NULL DEFAULT 0,   -- Mateusz confirms
        verified_by    NVARCHAR(120) NULL,
        verified_at    DATETIME2     NULL,
        is_deleted     BIT           NOT NULL DEFAULT 0,
        created_at     DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at     DATETIME2     NULL
    );
    CREATE UNIQUE INDEX UX_NdtExtentRules ON NdtExtentRules (exec_class, weld_category, utilisation)
        WHERE is_deleted = 0;
    PRINT 'NdtExtentRules created';
END
ELSE
    PRINT 'NdtExtentRules already exists — no change';

-- 2) One plan per job
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'JobInspectionPlans')
BEGIN
    CREATE TABLE JobInspectionPlans (
        id                INT IDENTITY(1,1) PRIMARY KEY,
        job_id            INT           NOT NULL,
        exec_class        NVARCHAR(10)  NOT NULL DEFAULT 'EXC2',
        -- Weld population for the job, entered or estimated by the fabricator.
        -- Counts of welds by category — the denominator the percentage applies to.
        weld_counts       NVARCHAR(MAX) NULL,          -- JSON { category: count }
        notes             NVARCHAR(MAX) NULL,
        status            NVARCHAR(20)  NOT NULL DEFAULT 'open',   -- open | complete
        is_deleted        BIT           NOT NULL DEFAULT 0,
        created_by        NVARCHAR(120) NULL,
        created_at        DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at        DATETIME2     NULL
    );
    CREATE UNIQUE INDEX UX_JobInspectionPlans_Job ON JobInspectionPlans (job_id) WHERE is_deleted = 0;
    PRINT 'JobInspectionPlans created';
END
ELSE
    PRINT 'JobInspectionPlans already exists — no change';

-- 3) Individual inspections carried out against a plan
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'JobInspectionRecords')
BEGIN
    CREATE TABLE JobInspectionRecords (
        id                 INT IDENTITY(1,1) PRIMARY KEY,
        plan_id            INT           NOT NULL,
        job_id             INT           NOT NULL,
        assembly_id        INT           NULL,          -- JobAssemblies.id when known
        assembly_mark      NVARCHAR(64)  NULL,
        weld_category      NVARCHAR(80)  NOT NULL,
        inspection_type    NVARCHAR(20)  NOT NULL,      -- visual | UT | RT | MT | PT
        weld_count         INT           NOT NULL DEFAULT 1,   -- welds covered by this record
        result             NVARCHAR(20)  NOT NULL DEFAULT 'pass',  -- pass | fail | repaired
        inspector          NVARCHAR(200) NULL,
        welder_name        NVARCHAR(200) NULL,
        inspected_on       DATE          NULL,
        report_ref         NVARCHAR(120) NULL,          -- NDT subcontractor report number
        qms_submission_id  INT           NULL,          -- link to a BAMA FAB 001 submission
        file_name          NVARCHAR(255)  NULL,
        sharepoint_file_id NVARCHAR(120)  NULL,
        drive_id           NVARCHAR(140)  NULL,
        web_url            NVARCHAR(1000) NULL,
        notes              NVARCHAR(MAX) NULL,
        is_deleted         BIT           NOT NULL DEFAULT 0,
        created_by         NVARCHAR(120) NULL,
        created_at         DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_JobInspRecords_Plan ON JobInspectionRecords (plan_id) WHERE is_deleted = 0;
    CREATE INDEX IX_JobInspRecords_Job  ON JobInspectionRecords (job_id)  WHERE is_deleted = 0;
    PRINT 'JobInspectionRecords created';
END
ELSE
    PRINT 'JobInspectionRecords already exists — no change';

-- ─── Seed the rule categories, ALL UNVERIFIED ────────────────────────────────
-- These are starting points so the grid has rows to edit — they are NOT an
-- authority. Every one is verified = 0 and the UI says so until Mateusz has
-- checked the figure against EN 1090-2 Table 24 and pressed Verify.
IF NOT EXISTS (SELECT 1 FROM NdtExtentRules)
BEGIN
    INSERT INTO NdtExtentRules (exec_class, weld_category, utilisation, pct_required, method_hint, source_note)
    VALUES
    -- EXC1
    ('EXC1', 'Transverse butt / partial penetration, tension', 'U>=0.5', 0,  'UT or RT', 'UNVERIFIED — check EN 1090-2 Table 24'),
    ('EXC1', 'Transverse butt / partial penetration, tension', 'U<0.5',  0,  'UT or RT', 'UNVERIFIED — check EN 1090-2 Table 24'),
    ('EXC1', 'Transverse butt, compression',                   NULL,     0,  'UT or RT', 'UNVERIFIED — check EN 1090-2 Table 24'),
    ('EXC1', 'Transverse fillet / partial pen (throat >12mm)', NULL,     0,  'MT or PT', 'UNVERIFIED — check EN 1090-2 Table 24'),
    ('EXC1', 'Longitudinal welds and welds to stiffeners',     NULL,     0,  'MT or PT', 'UNVERIFIED — check EN 1090-2 Table 24'),
    -- EXC2
    ('EXC2', 'Transverse butt / partial penetration, tension', 'U>=0.5', 10, 'UT or RT', 'UNVERIFIED — indicative only, check EN 1090-2 Table 24'),
    ('EXC2', 'Transverse butt / partial penetration, tension', 'U<0.5',  0,  'UT or RT', 'UNVERIFIED — indicative only, check EN 1090-2 Table 24'),
    ('EXC2', 'Transverse butt, compression',                   NULL,     0,  'UT or RT', 'UNVERIFIED — indicative only, check EN 1090-2 Table 24'),
    ('EXC2', 'Transverse fillet / partial pen (throat >12mm)', NULL,     0,  'MT or PT', 'UNVERIFIED — indicative only, check EN 1090-2 Table 24'),
    ('EXC2', 'Longitudinal welds and welds to stiffeners',     NULL,     0,  'MT or PT', 'UNVERIFIED — indicative only, check EN 1090-2 Table 24'),
    -- EXC3
    ('EXC3', 'Transverse butt / partial penetration, tension', 'U>=0.5', 20, 'UT or RT', 'UNVERIFIED — indicative only, check EN 1090-2 Table 24'),
    ('EXC3', 'Transverse butt / partial penetration, tension', 'U<0.5',  10, 'UT or RT', 'UNVERIFIED — indicative only, check EN 1090-2 Table 24'),
    ('EXC3', 'Transverse butt, compression',                   NULL,     5,  'UT or RT', 'UNVERIFIED — indicative only, check EN 1090-2 Table 24'),
    ('EXC3', 'Transverse fillet / partial pen (throat >12mm)', NULL,     5,  'MT or PT', 'UNVERIFIED — indicative only, check EN 1090-2 Table 24'),
    ('EXC3', 'Longitudinal welds and welds to stiffeners',     NULL,     0,  'MT or PT', 'UNVERIFIED — indicative only, check EN 1090-2 Table 24'),
    -- EXC4
    ('EXC4', 'Transverse butt / partial penetration, tension', 'U>=0.5', 100,'UT or RT', 'UNVERIFIED — indicative only, check EN 1090-2 Table 24'),
    ('EXC4', 'Transverse butt / partial penetration, tension', 'U<0.5',  50, 'UT or RT', 'UNVERIFIED — indicative only, check EN 1090-2 Table 24'),
    ('EXC4', 'Transverse butt, compression',                   NULL,     10, 'UT or RT', 'UNVERIFIED — indicative only, check EN 1090-2 Table 24'),
    ('EXC4', 'Transverse fillet / partial pen (throat >12mm)', NULL,     10, 'MT or PT', 'UNVERIFIED — indicative only, check EN 1090-2 Table 24'),
    ('EXC4', 'Longitudinal welds and welds to stiffeners',     NULL,     10, 'MT or PT', 'UNVERIFIED — indicative only, check EN 1090-2 Table 24');
    PRINT 'NdtExtentRules seeded (20 rows, ALL UNVERIFIED — verify each against EN 1090-2 Table 24)';
END
ELSE
    PRINT 'NdtExtentRules already has rows — seed skipped';

SELECT exec_class, weld_category, utilisation, pct_required, verified FROM NdtExtentRules ORDER BY exec_class, weld_category;

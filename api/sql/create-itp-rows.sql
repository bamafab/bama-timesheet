-- ─────────────────────────────────────────────────────────────────────────────
-- create-itp-rows.sql  (F1a — Inspection & Test Plan rows, 2026-07-30)
--
-- One ITP per job, hung off the existing JobInspectionPlans row so the ITP and
-- the actual NDT sampling CANNOT DISAGREE — they read the same exec class and
-- the same verified NdtExtentRules percentages.
--
-- Rows are generated deterministically (no AI: everything here is derived from
-- the plan, the rules table and a standard activity list) and are then EDITABLE,
-- because every contract has its own client hold points. `is_auto` marks a
-- generated row so regeneration can refresh those and leave hand-added ones
-- alone — regenerating must never silently bin a client's witness point.
--
-- Intervention types (the standard set):
--   H = Hold      — work stops until inspected/released
--   W = Witness   — client invited; may proceed if they don't attend
--   S = Surveillance — monitored, no notification required
--   R = Review    — records reviewed only
--
-- NEW TABLE ONLY — no Function App restart needed. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'JobInspectionPlans')
BEGIN
    RAISERROR('JobInspectionPlans does not exist — run create-inspection-plans.sql first.', 16, 1);
    RETURN;
END

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ItpRows')
BEGIN
    CREATE TABLE ItpRows (
        id                INT IDENTITY(1,1) PRIMARY KEY,
        plan_id           INT           NOT NULL,
        job_id            INT           NOT NULL,
        seq               INT           NOT NULL DEFAULT 0,
        stage             NVARCHAR(60)  NULL,        -- Material / Fabrication / Welding / Inspection / Finishing / Despatch
        activity          NVARCHAR(300) NOT NULL,
        ref_doc           NVARCHAR(200) NULL,        -- standard, WPS, drawing, procedure
        acceptance        NVARCHAR(300) NULL,        -- acceptance criteria
        intervention      NVARCHAR(4)   NOT NULL DEFAULT 'S',   -- H | W | S | R
        frequency         NVARCHAR(80)  NULL,        -- '100%', '10% of category', 'each delivery'
        responsibility    NVARCHAR(120) NULL,        -- BAMA / Client / Third party NDT
        record_ref        NVARCHAR(120) NULL,        -- e.g. 'BAMA FAB 001'
        ndt_category      NVARCHAR(80)  NULL,        -- links the row to a weld category for live progress
        inspection_type   NVARCHAR(20)  NULL,        -- visual | UT | RT | MT | PT
        is_auto           BIT           NOT NULL DEFAULT 1,   -- generated (refreshable) vs hand-added
        notes             NVARCHAR(MAX) NULL,
        is_deleted        BIT           NOT NULL DEFAULT 0,
        created_at        DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at        DATETIME2     NULL
    );
    CREATE INDEX IX_ItpRows_Plan ON ItpRows (plan_id, seq) WHERE is_deleted = 0;
    PRINT 'ItpRows created';
END
ELSE
    PRINT 'ItpRows already exists — no change';

SELECT (SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('ItpRows')) AS itp_cols;

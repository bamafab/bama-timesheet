-- ─────────────────────────────────────────────────────────────────────────────
-- create-steel-test-certs.sql  (Material traceability rework, 2026-07-31)
--
-- Replaces the MAT 001 "material receiving inspection" form as the heat-number
-- source. The heat/cast numbers for EN 1090 traceability come from the mill's
-- 3.1 test certificate, not a hand-keyed form — the DN already proves receipt.
--
-- Flow: drag the steel test cert PDF onto the job → Claude reads the heat lines
-- → the cert file is filed to SharePoint (02 - Quality (QMS) / material certs)
-- and its heat lines flow into the EXISTING AssemblyHeatAllocations table (so
-- the CoC / DoP / Traceability chain is unchanged downstream), now linked to a
-- SteelTestCerts row instead of a QMS submission.
--
-- NEW TABLE + one nullable column ⇒ the ADD COLUMN needs a Function App restart
-- (the deploy that ships this restarts it anyway). Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) The filed steel test certificate (one row per uploaded cert PDF)
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SteelTestCerts')
BEGIN
    CREATE TABLE SteelTestCerts (
        id                  INT IDENTITY(1,1) PRIMARY KEY,
        job_id              INT           NOT NULL,   -- DrawingJobs.id (where assemblies live)
        project_number      NVARCHAR(20)  NULL,       -- snapshot for cross-package reads
        cert_no             NVARCHAR(120) NULL,       -- the mill's certificate number
        supplier            NVARCHAR(200) NULL,       -- steel supplier / stockholder
        po_number           NVARCHAR(60)  NULL,       -- our PO it arrived against
        cert_date           DATE          NULL,
        standard            NVARCHAR(80)  NULL,       -- e.g. EN 10025-2, EN 10204 3.1
        heat_count          INT           NOT NULL DEFAULT 0,  -- how many heat lines read
        file_name           NVARCHAR(255) NULL,
        sharepoint_file_id  NVARCHAR(120) NULL,
        web_url             NVARCHAR(1000) NULL,
        notes               NVARCHAR(MAX) NULL,
        is_deleted          BIT           NOT NULL DEFAULT 0,
        created_by          NVARCHAR(120) NULL,
        created_at          DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_SteelTestCerts_Job ON SteelTestCerts (job_id) WHERE is_deleted = 0;
    CREATE INDEX IX_SteelTestCerts_Proj ON SteelTestCerts (project_number) WHERE is_deleted = 0;
    PRINT 'SteelTestCerts created';
END ELSE PRINT 'SteelTestCerts exists';

-- 2) Link heat allocations to a steel cert (alongside the legacy qms_submission_id)
IF COL_LENGTH('AssemblyHeatAllocations', 'steel_cert_id') IS NULL
BEGIN
    ALTER TABLE AssemblyHeatAllocations ADD steel_cert_id INT NULL;
    PRINT 'Added AssemblyHeatAllocations.steel_cert_id';
END ELSE PRINT 'AssemblyHeatAllocations.steel_cert_id exists';
GO

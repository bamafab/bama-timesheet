-- ─────────────────────────────────────────────────────────────────────────────
-- create-heat-allocations.sql  (material traceability, 2026-07-30)
--
-- THE MISSING LINK. Before this the ERP knew:
--   • which heat/cast numbers arrived on a job  (BAMA MAT 001 submissions)
--   • which assemblies were fabricated, by whom, on which machine
--     (JobAssemblies + JobAssemblyActions)
--   • what was despatched                        (JobBomDespatches, DNs)
-- …but nothing joined a heat number to an assembly, so traceability could only
-- ever be stated at CONTRACT level ("these heats went into this job").
--
-- Contract-level is generally accepted at EXC2. EXC3 and anything with a
-- client traceability clause usually wants piece level. This table makes piece
-- level possible WITHOUT forcing it: allocate heats where it matters and leave
-- the rest, and the report says honestly which level each assembly reaches.
--
-- Many-to-many on purpose: one assembly can contain several heats, and one heat
-- can appear in many assemblies.
--
-- NEW TABLE ONLY — no Function App restart needed. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'AssemblyHeatAllocations')
BEGIN
    CREATE TABLE AssemblyHeatAllocations (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        job_id         INT           NOT NULL,
        assembly_id    INT           NULL,          -- JobAssemblies.id when known
        assembly_mark  NVARCHAR(64)  NULL,          -- snapshot; survives re-import
        heat_no        NVARCHAR(100) NOT NULL,
        section        NVARCHAR(120) NULL,          -- as recorded on receipt
        grade          NVARCHAR(60)  NULL,
        supplier       NVARCHAR(200) NULL,
        po_number      NVARCHAR(60)  NULL,
        qms_submission_id INT        NULL,          -- the MAT 001 receipt it came from
        qty            NVARCHAR(40)  NULL,          -- free text: '6', '2 off', '12m'
        notes          NVARCHAR(MAX) NULL,
        is_deleted     BIT           NOT NULL DEFAULT 0,
        created_by     NVARCHAR(120) NULL,
        created_at     DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_HeatAlloc_Job      ON AssemblyHeatAllocations (job_id) WHERE is_deleted = 0;
    CREATE INDEX IX_HeatAlloc_Assembly ON AssemblyHeatAllocations (assembly_id) WHERE is_deleted = 0;
    CREATE INDEX IX_HeatAlloc_Heat     ON AssemblyHeatAllocations (heat_no) WHERE is_deleted = 0;
    PRINT 'AssemblyHeatAllocations created';
END
ELSE
    PRINT 'AssemblyHeatAllocations already exists — no change';

SELECT (SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('AssemblyHeatAllocations')) AS alloc_cols;

-- ─────────────────────────────────────────────────────────────────────────────
-- Job & Fabrication Rework — Schema migration (Commit 1 of 12)
-- ─────────────────────────────────────────────────────────────────────────────
-- Run on bama-erp BEFORE deploying any new API or frontend code.
-- This migration is purely additive — it lands new columns and new tables
-- without touching any existing data. The old draftsman flow continues to
-- work because nothing reads the new tables yet.
--
-- ───────────────────────────────────────────────────────────────────────
-- IMPORTANT: After this migration completes, restart the Function App.
-- New columns on existing tables (DrawingJobs.created_by /
-- sharepoint_folder_id, ServiceTypes.is_finish) need a fresh `mssql`
-- connection pool so cached query plans pick up the new schema. See
-- CLAUDE.md → "Restart the Function App after ALTER TABLE ADD COLUMN".
-- ───────────────────────────────────────────────────────────────────────
--
-- Notes on shape:
--   * Each ALTER + dependent INSERT pair is split across GO batches so
--     the SQL Server batch-compiler sees the new columns before parsing
--     statements that reference them. (Without GO, a single batch parses
--     all statements against the OLD schema and rejects the new column
--     names at compile time, even if the ALTER appears first.)
--   * GO batches can't be wrapped in a single BEGIN TRANSACTION. Every
--     block is idempotent (IF NOT EXISTS / OBJECT_ID checks) so the
--     script is safe to re-run if any batch fails partway.
--   * FK_JobBomItems_Assembly uses NO ACTION (default), NOT SET NULL,
--     to avoid "multiple cascade paths" — both DrawingJobs → JobBomItems
--     (direct CASCADE) and DrawingJobs → JobAssemblies → JobBomItems
--     would otherwise touch the same target. The direct cascade is
--     sufficient for job deletion. The API must null source_assembly_id
--     on dependent BOM rows in the same transaction before deleting a
--     JobAssemblies row.
--
-- What this script does:
--   1. Extend DrawingJobs            — add created_by, sharepoint_folder_id
--   2. Extend ServiceTypes           — add is_finish + seed finishing services
--   3. Create JobAssemblies          — one row per uploaded assembly PDF
--   4. Create JobAssemblyParts       — one row per part in the assembly's table
--   5. Create JobBomItems            — unified BOM / despatch queue
--   6. Seed Settings.dn_next_seq     — delivery note reference allocator
--
-- See docs/SPEC-job-fabrication-rework.md for full design.
-- ─────────────────────────────────────────────────────────────────────────────

SET XACT_ABORT ON;
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. DrawingJobs: extend (already exists)
-- ─────────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('DrawingJobs') AND name = 'created_by'
)
BEGIN
    ALTER TABLE DrawingJobs ADD created_by NVARCHAR(256) NULL;
END;
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('DrawingJobs') AND name = 'sharepoint_folder_id'
)
BEGIN
    ALTER TABLE DrawingJobs ADD sharepoint_folder_id NVARCHAR(256) NULL;
END;
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ServiceTypes: extend (already exists) — add column in its own batch
-- ─────────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('ServiceTypes') AND name = 'is_finish'
)
BEGIN
    ALTER TABLE ServiceTypes
        ADD is_finish BIT NOT NULL CONSTRAINT DF_ServiceTypes_IsFinish DEFAULT 0;
END;
GO

-- Seed common finishing services (separate batch so parser sees is_finish)
IF NOT EXISTS (SELECT 1 FROM ServiceTypes WHERE name = 'Galvanising')
    INSERT INTO ServiceTypes (name, is_active, is_finish) VALUES ('Galvanising',    1, 1);
IF NOT EXISTS (SELECT 1 FROM ServiceTypes WHERE name = 'Painting')
    INSERT INTO ServiceTypes (name, is_active, is_finish) VALUES ('Painting',       1, 1);
IF NOT EXISTS (SELECT 1 FROM ServiceTypes WHERE name = 'Powder Coating')
    INSERT INTO ServiceTypes (name, is_active, is_finish) VALUES ('Powder Coating', 1, 1);
IF NOT EXISTS (SELECT 1 FROM ServiceTypes WHERE name = 'Shot Blasting')
    INSERT INTO ServiceTypes (name, is_active, is_finish) VALUES ('Shot Blasting',  1, 1);
IF NOT EXISTS (SELECT 1 FROM ServiceTypes WHERE name = 'Priming')
    INSERT INTO ServiceTypes (name, is_active, is_finish) VALUES ('Priming',        1, 1);

-- Backfill is_finish=1 on any pre-existing rows matching the seed names
UPDATE ServiceTypes SET is_finish = 1
WHERE name IN ('Galvanising','Painting','Powder Coating','Shot Blasting','Priming')
  AND is_finish = 0;
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. JobAssemblies (NEW) — one row per uploaded assembly PDF
-- ─────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID('JobAssemblies', 'U') IS NULL
BEGIN
    CREATE TABLE JobAssemblies (
        id                    INT IDENTITY PRIMARY KEY,
        job_id                INT          NOT NULL,
        assembly_mark         NVARCHAR(64) NOT NULL,
        quantity              INT          NOT NULL,
        finish_service_id     INT          NULL,
        finish_label_raw      NVARCHAR(128) NULL,
        total_area_m2         DECIMAL(10,3) NULL,
        total_weight_kg       DECIMAL(10,3) NULL,
        sharepoint_file_id    NVARCHAR(256) NOT NULL,
        sharepoint_drive_id   NVARCHAR(256) NOT NULL,
        sharepoint_web_url    NVARCHAR(1024) NULL,
        file_name             NVARCHAR(256) NOT NULL,
        status                NVARCHAR(32)  NOT NULL
                              CONSTRAINT DF_JobAssemblies_Status DEFAULT 'pending',
        fabricated_at         DATETIME2     NULL,
        fabricated_by         NVARCHAR(256) NULL,
        welder_id             INT           NULL,
        welding_machine_id    INT           NULL,
        created_at            DATETIME2     NOT NULL
                              CONSTRAINT DF_JobAssemblies_Created DEFAULT SYSUTCDATETIME(),
        created_by            NVARCHAR(256) NULL,
        CONSTRAINT FK_JobAssemblies_Job
            FOREIGN KEY (job_id) REFERENCES DrawingJobs(id) ON DELETE CASCADE,
        CONSTRAINT FK_JobAssemblies_Finish
            FOREIGN KEY (finish_service_id) REFERENCES ServiceTypes(id),
        CONSTRAINT FK_JobAssemblies_Welder
            FOREIGN KEY (welder_id) REFERENCES Employees(id),
        CONSTRAINT FK_JobAssemblies_Machine
            FOREIGN KEY (welding_machine_id) REFERENCES WeldingMachines(id),
        CONSTRAINT UQ_JobAssemblies_JobMark UNIQUE (job_id, assembly_mark),
        CONSTRAINT CK_JobAssemblies_Status CHECK (status IN ('pending','fabricated'))
    );

    CREATE INDEX IX_JobAssemblies_Status ON JobAssemblies(status, fabricated_at);
    CREATE INDEX IX_JobAssemblies_Job    ON JobAssemblies(job_id);
END;
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. JobAssemblyParts (NEW) — one row per line in the assembly's top-right table
-- ─────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID('JobAssemblyParts', 'U') IS NULL
BEGIN
    CREATE TABLE JobAssemblyParts (
        id            INT IDENTITY PRIMARY KEY,
        assembly_id   INT           NOT NULL,
        part_mark     NVARCHAR(64)  NOT NULL,
        quantity      INT           NOT NULL,
        profile       NVARCHAR(128) NOT NULL,
        length_mm     DECIMAL(10,2) NULL,
        material      NVARCHAR(64)  NULL,
        area_m2       DECIMAL(10,3) NULL,
        weight_kg     DECIMAL(10,3) NULL,
        sort_order    INT           NOT NULL
                      CONSTRAINT DF_JobAssemblyParts_Sort DEFAULT 0,
        CONSTRAINT FK_JobAssemblyParts_Assembly
            FOREIGN KEY (assembly_id) REFERENCES JobAssemblies(id) ON DELETE CASCADE
    );

    CREATE INDEX IX_JobAssemblyParts_Assembly ON JobAssemblyParts(assembly_id, sort_order);
END;
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. JobBomItems (NEW) — unified BOM queue, manual + assembly-sourced
-- ─────────────────────────────────────────────────────────────────────────────
-- NOTE on FK_JobBomItems_Assembly: NO ACTION (default), NOT SET NULL.
-- SQL Server rejects multiple cascade paths to a single target table, and
-- both DrawingJobs → JobBomItems (direct CASCADE) and DrawingJobs →
-- JobAssemblies → JobBomItems would touch JobBomItems. The direct cascade
-- is sufficient for job deletion. Assembly deletion must be handled in the
-- API: null out source_assembly_id on dependent BOM rows in the same
-- transaction before deleting the JobAssemblies row.
-- ─────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID('JobBomItems', 'U') IS NULL
BEGIN
    CREATE TABLE JobBomItems (
        id                    INT IDENTITY PRIMARY KEY,
        job_id                INT           NOT NULL,
        source                NVARCHAR(16)  NOT NULL,
        source_assembly_id    INT           NULL,
        description           NVARCHAR(256) NOT NULL,
        quantity              INT           NOT NULL,
        finish_service_id     INT           NULL,
        status                NVARCHAR(32)  NOT NULL
                              CONSTRAINT DF_JobBomItems_Status DEFAULT 'pending',
        sharepoint_file_id    NVARCHAR(256) NULL,
        sharepoint_drive_id   NVARCHAR(256) NULL,
        sharepoint_web_url    NVARCHAR(1024) NULL,
        file_name             NVARCHAR(256) NULL,
        supplier_id           INT           NULL,
        delivery_note_id      INT           NULL,
        sent_at               DATETIME2     NULL,
        returned_at           DATETIME2     NULL,
        despatched_at         DATETIME2     NULL,
        created_at            DATETIME2     NOT NULL
                              CONSTRAINT DF_JobBomItems_Created DEFAULT SYSUTCDATETIME(),
        created_by            NVARCHAR(256) NULL,
        CONSTRAINT FK_JobBomItems_Job
            FOREIGN KEY (job_id) REFERENCES DrawingJobs(id) ON DELETE CASCADE,
        CONSTRAINT FK_JobBomItems_Assembly
            FOREIGN KEY (source_assembly_id) REFERENCES JobAssemblies(id),
        CONSTRAINT FK_JobBomItems_Finish
            FOREIGN KEY (finish_service_id) REFERENCES ServiceTypes(id),
        CONSTRAINT FK_JobBomItems_Supplier
            FOREIGN KEY (supplier_id) REFERENCES Suppliers(id),
        CONSTRAINT CK_JobBomItems_Source CHECK (source IN ('manual','assembly')),
        CONSTRAINT CK_JobBomItems_SourceAssembly CHECK (
            (source = 'manual'   AND source_assembly_id IS NULL) OR
            (source = 'assembly' AND source_assembly_id IS NOT NULL)
        ),
        CONSTRAINT CK_JobBomItems_Status CHECK (
            status IN ('pending','at_supplier','ready_for_despatch','despatched')
        )
    );

    CREATE INDEX IX_JobBomItems_Job_Status ON JobBomItems(job_id, status);
    CREATE INDEX IX_JobBomItems_Supplier   ON JobBomItems(supplier_id)
        WHERE supplier_id IS NOT NULL;
END;
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Seed Settings.dn_next_seq (delivery note reference allocator)
-- ─────────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM Settings WHERE [key] = 'dn_next_seq')
BEGIN
    INSERT INTO Settings ([key], value, updated_at)
    VALUES ('dn_next_seq', '1', SYSUTCDATETIME());
END;
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification — run after the migration completes (paste separately).
-- Expected column_count values are noted on the right.
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT 'DrawingJobs.created_by'           AS what, COUNT(*) AS column_count
--   FROM sys.columns WHERE object_id = OBJECT_ID('DrawingJobs') AND name = 'created_by';            -- 1
-- SELECT 'DrawingJobs.sharepoint_folder_id' AS what, COUNT(*) AS column_count
--   FROM sys.columns WHERE object_id = OBJECT_ID('DrawingJobs') AND name = 'sharepoint_folder_id';  -- 1
-- SELECT 'ServiceTypes.is_finish'           AS what, COUNT(*) AS column_count
--   FROM sys.columns WHERE object_id = OBJECT_ID('ServiceTypes') AND name = 'is_finish';            -- 1
-- SELECT 'JobAssemblies'    AS what, COUNT(*) AS column_count FROM sys.tables WHERE name = 'JobAssemblies';     -- 1
-- SELECT 'JobAssemblyParts' AS what, COUNT(*) AS column_count FROM sys.tables WHERE name = 'JobAssemblyParts';  -- 1
-- SELECT 'JobBomItems'      AS what, COUNT(*) AS column_count FROM sys.tables WHERE name = 'JobBomItems';       -- 1
-- SELECT * FROM ServiceTypes WHERE is_finish = 1 ORDER BY name;                                                -- 5+ rows
-- SELECT [key], value FROM Settings WHERE [key] = 'dn_next_seq';                                               -- value = '1'

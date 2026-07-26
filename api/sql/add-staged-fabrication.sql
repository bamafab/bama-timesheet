-- ─────────────────────────────────────────────────────────────────────────────
-- Staged / Partial Fabrication — Schema migration (Commit 1 of build)
-- ─────────────────────────────────────────────────────────────────────────────
-- Extends the assembly-driven fabrication pipeline (add-job-fabrication.sql)
-- from a single binary "fabricated" flag into staged, partial-quantity
-- tracking: an assembly of Q pieces can be fabbed, welded, or completed in
-- batches, by different operators on different days.
--
-- Run on bama-erp BEFORE deploying the new API / frontend for this feature.
-- Purely additive — it lands new columns and one new table without touching
-- existing rows. The current fabricate flow keeps working: a legacy
-- status='fabricated' assembly reads as fully complete (backfill below sets
-- its qty_* counts to match its quantity).
--
-- ───────────────────────────────────────────────────────────────────────
-- IMPORTANT: After this migration completes, RESTART the Function App.
-- New columns on JobAssemblies need a fresh mssql connection pool so cached
-- query plans pick up the new schema. See CLAUDE.md → "Restart the Function
-- App after ALTER TABLE ADD COLUMN".
-- ───────────────────────────────────────────────────────────────────────
--
-- Notes on shape:
--   * Each ALTER + dependent statement is split across GO batches so the
--     batch-compiler sees the new columns before parsing statements that
--     reference them.
--   * Every block is idempotent (IF NOT EXISTS / OBJECT_ID / col_length
--     checks) so the script is safe to re-run if any batch fails partway.
--
-- The staged model (three running counts on JobAssemblies):
--   qty_fabbed     — pieces fabricated so far (0..quantity)
--   qty_welded     — pieces welded so far      (0..qty_fabbed)
--   qty_completed  — pieces completed DIRECTLY (0..quantity), i.e. via the
--                    "Complete" button rather than the fab→weld path.
--   Derived (not stored):
--     ready_to_weld  = qty_fabbed - qty_welded
--     to_fab         = quantity  - qty_fabbed
--     bom_qty        = qty_welded + qty_completed   (pieces that have hit BOM)
--   Both welding a piece AND completing a piece directly push it onto BOM.
--
-- Status now has three values:
--   'pending'      — nothing done yet (bom_qty = 0 AND qty_fabbed = 0)
--   'in_progress'  — some work done but not all pieces on BOM
--   'fabricated'   — every piece is on BOM (bom_qty = quantity). Kept as the
--                    terminal name so existing reads (kiosk 24h window,
--                    projects progress rollups, confirmCloseJob) still work.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. JobAssemblies — add the three running counts
-- ─────────────────────────────────────────────────────────────────────────────
IF COL_LENGTH('JobAssemblies', 'qty_fabbed') IS NULL
    ALTER TABLE JobAssemblies
        ADD qty_fabbed INT NOT NULL
            CONSTRAINT DF_JobAssemblies_QtyFabbed DEFAULT 0;
GO
IF COL_LENGTH('JobAssemblies', 'qty_welded') IS NULL
    ALTER TABLE JobAssemblies
        ADD qty_welded INT NOT NULL
            CONSTRAINT DF_JobAssemblies_QtyWelded DEFAULT 0;
GO
IF COL_LENGTH('JobAssemblies', 'qty_completed') IS NULL
    ALTER TABLE JobAssemblies
        ADD qty_completed INT NOT NULL
            CONSTRAINT DF_JobAssemblies_QtyCompleted DEFAULT 0;
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. JobAssemblies — relax the status CHECK to allow 'in_progress'
--    (drop-and-recreate; SQL Server has no ALTER CHECK CONSTRAINT).
-- ─────────────────────────────────────────────────────────────────────────────
IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_JobAssemblies_Status')
    ALTER TABLE JobAssemblies DROP CONSTRAINT CK_JobAssemblies_Status;
GO
ALTER TABLE JobAssemblies
    ADD CONSTRAINT CK_JobAssemblies_Status
        CHECK (status IN ('pending', 'in_progress', 'fabricated'));
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Backfill legacy rows — a pre-existing status='fabricated' assembly
--    predates staged tracking and means "all pieces done via fab→weld".
--    Set its counts so it reads as fully complete under the new model.
--    (Runs once; the WHERE guard makes it a no-op on re-run.)
-- ─────────────────────────────────────────────────────────────────────────────
UPDATE JobAssemblies
   SET qty_fabbed    = quantity,
       qty_welded    = quantity,
       qty_completed = 0
 WHERE status = 'fabricated'
   AND qty_fabbed = 0
   AND qty_welded = 0
   AND qty_completed = 0;
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. JobBomItems — allow the fabricate/complete flows to find and TOP UP an
--    existing open BOM row instead of spawning duplicate lines. No schema
--    change needed for the merge itself (we group on source_assembly_id +
--    status), but add an index so the "open row for this assembly" lookup
--    is cheap. "Open" = status NOT IN ('at_supplier','despatched','on_site')
--    i.e. no DN raised yet. Once a DN is raised the row is frozen and new
--    completions start a fresh line (a genuinely separate delivery batch).
-- ─────────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_JobBomItems_AssemblyOpen')
    CREATE INDEX IX_JobBomItems_AssemblyOpen
        ON JobBomItems(source_assembly_id, status)
        WHERE source_assembly_id IS NOT NULL;
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. JobAssemblyActions (NEW) — the full per-action audit trail. One row per
--    button press: which stage, how many pieces, who, which machine, when.
--    The running counts on JobAssemblies are the fast-read cache; this table
--    is the source of truth for history ("3 fabbed by Ann, 2 by Bob").
--    Never deleted except by job/assembly cascade.
-- ─────────────────────────────────────────────────────────────────────────────
IF OBJECT_ID('JobAssemblyActions', 'U') IS NULL
BEGIN
    CREATE TABLE JobAssemblyActions (
        id                  INT IDENTITY PRIMARY KEY,
        assembly_id         INT          NOT NULL,
        stage               NVARCHAR(16) NOT NULL,   -- 'fab' | 'weld' | 'complete'
        qty                 INT          NOT NULL,   -- pieces in THIS action (>0)
        operator_id         INT          NULL,       -- fabricator/welder (Employees.id)
        operator_name       NVARCHAR(256) NULL,      -- denormalised display name
        welding_machine_id  INT          NULL,       -- weld/complete only
        bom_item_id         INT          NULL,       -- BOM row this action fed (weld/complete)
        performed_at        DATETIME2    NOT NULL
            CONSTRAINT DF_JobAssemblyActions_At DEFAULT SYSUTCDATETIME(),
        performed_by        NVARCHAR(256) NULL,      -- auth.name of who clicked
        CONSTRAINT FK_JobAssemblyActions_Assembly
            FOREIGN KEY (assembly_id) REFERENCES JobAssemblies(id) ON DELETE CASCADE,
        CONSTRAINT FK_JobAssemblyActions_Operator
            FOREIGN KEY (operator_id) REFERENCES Employees(id),
        CONSTRAINT FK_JobAssemblyActions_Machine
            FOREIGN KEY (welding_machine_id) REFERENCES WeldingMachines(id),
        -- bom_item_id is intentionally NOT FK'd: a BOM row can be deleted/
        -- recreated independently, and the action history should survive that.
        CONSTRAINT CK_JobAssemblyActions_Stage
            CHECK (stage IN ('fab', 'weld', 'complete')),
        CONSTRAINT CK_JobAssemblyActions_Qty
            CHECK (qty > 0)
    );

    CREATE INDEX IX_JobAssemblyActions_Assembly
        ON JobAssemblyActions(assembly_id, performed_at);
END;
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- Verification — run after the migration completes (paste separately).
-- ─────────────────────────────────────────────────────────────────────────────
-- SELECT 'JobAssemblies.qty_fabbed'    AS what, COUNT(*) AS column_count
--   FROM sys.columns WHERE object_id = OBJECT_ID('JobAssemblies') AND name = 'qty_fabbed';     -- 1
-- SELECT 'JobAssemblies.qty_welded'    AS what, COUNT(*) AS column_count
--   FROM sys.columns WHERE object_id = OBJECT_ID('JobAssemblies') AND name = 'qty_welded';     -- 1
-- SELECT 'JobAssemblies.qty_completed' AS what, COUNT(*) AS column_count
--   FROM sys.columns WHERE object_id = OBJECT_ID('JobAssemblies') AND name = 'qty_completed';  -- 1
-- SELECT name AS status_check_def FROM sys.check_constraints WHERE name = 'CK_JobAssemblies_Status';
-- SELECT 'JobAssemblyActions' AS what, COUNT(*) AS column_count FROM sys.tables WHERE name = 'JobAssemblyActions';  -- 1
-- SELECT id, assembly_mark, quantity, qty_fabbed, qty_welded, qty_completed, status
--   FROM JobAssemblies ORDER BY id;  -- legacy fabricated rows should show qty_fabbed = qty_welded = quantity

-- ─────────────────────────────────────────────────────────────────────────────
-- migrate-welding-machines-into-plant.sql  (F3, 2026-07-30)
--
-- Mateusz's decision: welding machines live in the Plant Register, not on their
-- own sidebar tab. One place, one fewer line in Office.
--
-- NOTHING IS DESTROYED. WeldingMachines is NOT dropped and its rows are NOT
-- deleted, because two foreign keys point at it:
--     JobAssemblies.welding_machine_id  (add-job-fabrication.sql:134)
--     JobAssemblies.welding_machine_id  (add-staged-fabrication.sql:136)
-- and every fabrication record in history depends on those ids resolving. The
-- kiosk also reads /api/welding-machines, so keeping the table alive and in
-- sync means the workshop kiosk needs NO change at all — the safest possible
-- migration for a shop-floor tool.
--
-- What changes:
--   • PlantItems gains a row per welding machine (category 'welding')
--   • WeldingMachines gains plant_id linking to it
--   • PlantItems becomes the editing surface; the API keeps WeldingMachines in
--     step so assemblies and the kiosk carry on working
--   • WeldingMachineWelders (authorised welders per machine) is UNTOUCHED and
--     still surfaced — in the plant modal instead of the old tab
--
-- Field mapping (WeldingMachines → PlantItems):
--   machine_name   → name
--   serial_number  → serial_no
--   expiry_date    → calib_due   (a welding machine's expiry IS its calibration
--                                 / verification due date — BAM VER 001)
--   notes          → notes
--   is_active = 0  → status 'disposed'  (retired, history preserved)
--
-- ⚠ CONTAINS ALTER TABLE ⇒ **FUNCTION APP RESTART REQUIRED** after running.
-- Idempotent — safe to re-run.
-- ─────────────────────────────────────────────────────────────────────────────

-- Guard: PlantItems must exist first
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'PlantItems')
BEGIN
    RAISERROR('PlantItems does not exist — run create-plant-register.sql first.', 16, 1);
    RETURN;
END
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'WeldingMachines')
BEGIN
    PRINT 'WeldingMachines does not exist — nothing to migrate.';
    RETURN;
END

-- 1) Link column
IF COL_LENGTH('WeldingMachines', 'plant_id') IS NULL
BEGIN
    ALTER TABLE WeldingMachines ADD plant_id INT NULL;
    PRINT 'WeldingMachines.plant_id added — FUNCTION APP RESTART REQUIRED';
END
ELSE
    PRINT 'WeldingMachines.plant_id already exists — no change';
GO

-- 2) Backfill a PlantItems row per unlinked machine.
--    Refs continue the existing P-NNN sequence; welding machines get a W- prefix
--    so they are recognisable at a glance in the register.
IF EXISTS (SELECT 1 FROM WeldingMachines WHERE plant_id IS NULL)
BEGIN
    DECLARE @id INT, @name NVARCHAR(200), @serial NVARCHAR(200),
            @expiry DATE, @notes NVARCHAR(MAX), @active BIT, @newPlantId INT, @seq INT, @ref NVARCHAR(30);

    -- Continue from the highest existing W- ref
    SELECT @seq = ISNULL(MAX(TRY_CONVERT(INT, SUBSTRING(plant_ref, 3, 10))), 0)
    FROM PlantItems WHERE is_deleted = 0 AND plant_ref LIKE 'W-%';

    DECLARE mach CURSOR LOCAL FAST_FORWARD FOR
        SELECT id, machine_name, serial_number, expiry_date, notes, is_active
        FROM WeldingMachines WHERE plant_id IS NULL ORDER BY id;
    OPEN mach;
    FETCH NEXT FROM mach INTO @id, @name, @serial, @expiry, @notes, @active;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @seq = @seq + 1;
        SET @ref = 'W-' + RIGHT('000' + CAST(@seq AS NVARCHAR(10)), 3);

        INSERT INTO PlantItems (plant_ref, name, category, serial_no, calib_due, status, notes, created_by)
        VALUES (@ref,
                LEFT(ISNULL(@name, 'Welding machine'), 150),
                'welding',
                @serial,
                @expiry,
                CASE WHEN @active = 0 THEN 'disposed' ELSE 'in_service' END,
                @notes,
                'migration');
        SET @newPlantId = SCOPE_IDENTITY();
        UPDATE WeldingMachines SET plant_id = @newPlantId WHERE id = @id;

        FETCH NEXT FROM mach INTO @id, @name, @serial, @expiry, @notes, @active;
    END
    CLOSE mach; DEALLOCATE mach;
    PRINT 'Welding machines backfilled into PlantItems and linked';
END
ELSE
    PRINT 'Every welding machine already has a plant_id — backfill skipped';
GO

-- 3) Index for the reverse lookup the API uses
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_WeldingMachines_Plant')
    CREATE INDEX IX_WeldingMachines_Plant ON WeldingMachines (plant_id);
GO

-- Verification: every machine linked, every link resolving to a welding item
SELECT
    (SELECT COUNT(*) FROM WeldingMachines)                                  AS machines_total,
    (SELECT COUNT(*) FROM WeldingMachines WHERE plant_id IS NOT NULL)       AS machines_linked,
    (SELECT COUNT(*) FROM PlantItems WHERE category = 'welding' AND is_deleted = 0) AS plant_welding_rows,
    (SELECT COUNT(*) FROM WeldingMachines wm
      LEFT JOIN PlantItems p ON p.id = wm.plant_id
     WHERE wm.plant_id IS NOT NULL AND p.id IS NULL)                        AS broken_links;

SELECT wm.id AS machine_id, wm.machine_name, wm.plant_id, p.plant_ref, p.status,
       CONVERT(varchar(10), p.calib_due, 23) AS calib_due
FROM WeldingMachines wm LEFT JOIN PlantItems p ON p.id = wm.plant_id
ORDER BY wm.id;

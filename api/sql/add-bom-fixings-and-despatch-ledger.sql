-- Migration: BOM fixings + partial-despatch ledger
-- Run via Azure Portal Query Editor against the bama-erp database (office WiFi).
-- RESTART the Function App afterwards (ADD COLUMN → cached query plans).
--
-- Phase 1 of the bolts/anchors/consumables work. Adds:
--   1. JobBomItems.item_type      — 'fabricated' (default) | 'fixing' | 'consumable'
--                                    so loose items render in their own panel
--                                    and print under their own SDN heading.
--   2. JobBomItems.unit_weight_kg — weight of one piece (for SDN weight totals).
--   3. JobBomItems.despatched_qty — running total shipped to site (ledger cache).
--                                    Phase 2 uses this for partial/overship SDNs.
--   4. JobBomDespatches            — per-SDN despatch ledger. One row per
--                                    (BOM item, SDN) with the qty on that note,
--                                    so any SDN is reprintable/auditable and the
--                                    outstanding balance is derivable.
--
-- Idempotent: safe to re-run. Phase 1 does NOT change the despatch flow yet —
-- generate-sdn still ships full lines until Phase 2. These columns just sit
-- ready.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. item_type ---------------------------------------------------------------
IF COL_LENGTH('dbo.JobBomItems', 'item_type') IS NULL
BEGIN
    ALTER TABLE dbo.JobBomItems
        ADD item_type NVARCHAR(16) NOT NULL
            CONSTRAINT DF_JobBomItems_ItemType DEFAULT 'fabricated';
    PRINT 'Added JobBomItems.item_type (default fabricated).';
END
ELSE
    PRINT 'JobBomItems.item_type already present.';
GO

IF NOT EXISTS (
    SELECT 1 FROM sys.check_constraints
    WHERE parent_object_id = OBJECT_ID('dbo.JobBomItems')
      AND name = 'CK_JobBomItems_ItemType'
)
BEGIN
    ALTER TABLE dbo.JobBomItems
        ADD CONSTRAINT CK_JobBomItems_ItemType
            CHECK (item_type IN ('fabricated', 'fixing', 'consumable'));
    PRINT 'Added CK_JobBomItems_ItemType.';
END
ELSE
    PRINT 'CK_JobBomItems_ItemType already present.';
GO

-- 2. unit_weight_kg (weight of one piece) ------------------------------------
IF COL_LENGTH('dbo.JobBomItems', 'unit_weight_kg') IS NULL
BEGIN
    ALTER TABLE dbo.JobBomItems ADD unit_weight_kg DECIMAL(10,3) NULL;
    PRINT 'Added JobBomItems.unit_weight_kg.';
END
ELSE
    PRINT 'JobBomItems.unit_weight_kg already present.';
GO

-- 3. despatched_qty (running total shipped to site) --------------------------
IF COL_LENGTH('dbo.JobBomItems', 'despatched_qty') IS NULL
BEGIN
    ALTER TABLE dbo.JobBomItems
        ADD despatched_qty INT NOT NULL
            CONSTRAINT DF_JobBomItems_DespatchedQty DEFAULT 0;
    PRINT 'Added JobBomItems.despatched_qty (default 0).';
END
ELSE
    PRINT 'JobBomItems.despatched_qty already present.';
GO

-- Backfill despatched_qty for rows already shipped before this migration:
-- anything already 'on_site' or 'despatched' is treated as fully delivered so
-- Phase 2's outstanding maths starts from a correct baseline.
UPDATE dbo.JobBomItems
    SET despatched_qty = quantity
    WHERE despatched_qty = 0
      AND status IN ('on_site', 'despatched');
PRINT 'Backfilled despatched_qty for already-shipped rows.';
GO

-- 4. JobBomDespatches ledger --------------------------------------------------
IF OBJECT_ID('dbo.JobBomDespatches', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.JobBomDespatches (
        id                    INT IDENTITY PRIMARY KEY,
        bom_item_id           INT           NOT NULL,
        sdn_ref               NVARCHAR(32)  NOT NULL,   -- e.g. 'SDN-0007'
        qty                   INT           NOT NULL,   -- qty on THIS note
        sharepoint_file_id    NVARCHAR(256) NULL,
        sharepoint_drive_id   NVARCHAR(256) NULL,
        sharepoint_web_url    NVARCHAR(1024) NULL,
        file_name             NVARCHAR(256) NULL,
        despatched_at         DATETIME2     NOT NULL
                              CONSTRAINT DF_JobBomDespatches_At DEFAULT SYSUTCDATETIME(),
        created_by            NVARCHAR(256) NULL,
        CONSTRAINT FK_JobBomDespatches_Item
            FOREIGN KEY (bom_item_id) REFERENCES dbo.JobBomItems(id) ON DELETE CASCADE,
        CONSTRAINT CK_JobBomDespatches_Qty CHECK (qty <> 0)
    );
    CREATE INDEX IX_JobBomDespatches_Item ON dbo.JobBomDespatches(bom_item_id);
    CREATE INDEX IX_JobBomDespatches_Sdn  ON dbo.JobBomDespatches(sdn_ref);
    PRINT 'Created JobBomDespatches ledger table.';
END
ELSE
    PRINT 'JobBomDespatches already present.';
GO

-- Verify ---------------------------------------------------------------------
SELECT 'item_type'       AS what, IIF(COL_LENGTH('dbo.JobBomItems','item_type')      IS NULL, 0, 1) AS present
UNION ALL SELECT 'unit_weight_kg',   IIF(COL_LENGTH('dbo.JobBomItems','unit_weight_kg')  IS NULL, 0, 1)
UNION ALL SELECT 'despatched_qty',   IIF(COL_LENGTH('dbo.JobBomItems','despatched_qty')  IS NULL, 0, 1)
UNION ALL SELECT 'JobBomDespatches', IIF(OBJECT_ID('dbo.JobBomDespatches','U')          IS NULL, 0, 1);
GO

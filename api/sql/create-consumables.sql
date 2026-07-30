-- ─────────────────────────────────────────────────────────────────────────────
-- create-consumables.sql  (consumables & reordering, 2026-07-30)
--
-- Three tables:
--   Consumables          — the catalogue (wire, rods, gas, discs, PPE…)
--   ConsumableMovements  — a true ledger: everything in, everything out.
--   ConsumableReorders   — the basket. NOTHING auto-orders (Mateusz's call):
--                          a reorder is requested, then approved, then becomes
--                          a PO. No financial commitment without a human.
--
-- STOCK IS DERIVED, NEVER STORED. current stock = Σ(in) − Σ(out) from the
-- movement ledger. A stored running total drifts the first time someone edits
-- or deletes a movement, and then nobody trusts the figure — which is worse
-- than having no figure. `opening_qty` on the catalogue row is the starting
-- point for an item that existed before the ledger did.
--
-- Batch numbers matter: welding consumables are traceable under EN 1090 and
-- CON 001 already records issue against a batch.
--
-- NEW TABLES ONLY — no Function App restart needed. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Consumables')
BEGIN
    CREATE TABLE Consumables (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        item_code      NVARCHAR(40)  NOT NULL,        -- CON-001
        name           NVARCHAR(200) NOT NULL,
        category       NVARCHAR(40)  NOT NULL DEFAULT 'other',
            -- wire | electrode | gas | abrasive | ppe | fixings | paint | other
        spec           NVARCHAR(200) NULL,            -- e.g. 'G3Si1 1.0mm' / 'E7018 3.2mm'
        unit           NVARCHAR(20)  NOT NULL DEFAULT 'each',  -- each | kg | box | roll | bottle | litre | pack
        pack_size      NVARCHAR(40)  NULL,            -- '15kg reel', 'box of 100'
        supplier_name  NVARCHAR(200) NULL,
        supplier_part  NVARCHAR(80)  NULL,
        location       NVARCHAR(120) NULL,            -- where it lives in the shop
        opening_qty    DECIMAL(12,2) NOT NULL DEFAULT 0,   -- stock at the point the ledger started
        reorder_level  DECIMAL(12,2) NULL,            -- below this → suggest a reorder
        reorder_qty    DECIMAL(12,2) NULL,            -- how much to order when it trips
        batch_tracked  BIT           NOT NULL DEFAULT 0,   -- welding consumables: yes
        notes          NVARCHAR(MAX) NULL,
        is_active      BIT           NOT NULL DEFAULT 1,
        is_deleted     BIT           NOT NULL DEFAULT 0,
        created_by     NVARCHAR(120) NULL,
        created_at     DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at     DATETIME2     NULL
    );
    CREATE UNIQUE INDEX UX_Consumables_Code ON Consumables (item_code) WHERE is_deleted = 0;
    PRINT 'Consumables created';
END
ELSE
    PRINT 'Consumables already exists — no change';

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ConsumableMovements')
BEGIN
    CREATE TABLE ConsumableMovements (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        consumable_id  INT           NOT NULL,
        direction      NVARCHAR(4)   NOT NULL,        -- 'in' | 'out'
        qty            DECIMAL(12,2) NOT NULL,
        batch_no       NVARCHAR(100) NULL,
        issued_to      NVARCHAR(200) NULL,            -- who took it (out)
        job_id         INT           NULL,
        job_number     NVARCHAR(60)  NULL,
        po_number      NVARCHAR(60)  NULL,            -- what it came in on (in)
        moved_on       DATE          NOT NULL,
        source         NVARCHAR(20)  NOT NULL DEFAULT 'office',  -- paper | kiosk | office | delivery
        notes          NVARCHAR(MAX) NULL,
        is_deleted     BIT           NOT NULL DEFAULT 0,
        entered_by     NVARCHAR(120) NULL,
        created_at     DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_ConsMov_Item ON ConsumableMovements (consumable_id) WHERE is_deleted = 0;
    CREATE INDEX IX_ConsMov_Date ON ConsumableMovements (moved_on) WHERE is_deleted = 0;
    CREATE INDEX IX_ConsMov_Job  ON ConsumableMovements (job_id) WHERE is_deleted = 0;
    PRINT 'ConsumableMovements created';
END
ELSE
    PRINT 'ConsumableMovements already exists — no change';

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ConsumableReorders')
BEGIN
    CREATE TABLE ConsumableReorders (
        id             INT IDENTITY(1,1) PRIMARY KEY,
        consumable_id  INT           NOT NULL,
        qty            DECIMAL(12,2) NOT NULL,
        status         NVARCHAR(20)  NOT NULL DEFAULT 'basket',
            -- basket | approved | ordered | cancelled
        stock_at_request DECIMAL(12,2) NULL,           -- what the shelf held when it was raised
        requested_by   NVARCHAR(200) NULL,
        approved_by    NVARCHAR(200) NULL,
        approved_at    DATETIME2     NULL,
        po_number      NVARCHAR(60)  NULL,             -- filled once actually ordered
        notes          NVARCHAR(MAX) NULL,
        is_deleted     BIT           NOT NULL DEFAULT 0,
        created_at     DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at     DATETIME2     NULL
    );
    CREATE INDEX IX_ConsReorder_Status ON ConsumableReorders (status) WHERE is_deleted = 0;
    PRINT 'ConsumableReorders created';
END
ELSE
    PRINT 'ConsumableReorders already exists — no change';

SELECT (SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('Consumables')) AS cons_cols,
       (SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('ConsumableMovements')) AS mov_cols,
       (SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('ConsumableReorders')) AS reorder_cols;

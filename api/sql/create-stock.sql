-- ─────────────────────────────────────────────────────────────────────────────
-- create-stock.sql  (Phase C3 — stock register)
--
-- Steel stock on the racks: one row per section+length batch. Voice or manual
-- entry from stock.html; every create/adjust/delete is audited via ChangeLog.
-- New table => NO Function App restart needed. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

IF OBJECT_ID('StockItems', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.StockItems (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        section     NVARCHAR(64)  NOT NULL,     -- designation, e.g. 203x133x25 UB
        family      NVARCHAR(64)  NULL,         -- Universal Beams / SHS / ... (from steel db match)
        kgm         DECIMAL(10,3) NULL,         -- kg/m from steel db (NULL = unverified section)
        length_mm   INT           NOT NULL,
        qty         INT           NOT NULL DEFAULT 1,
        grade       NVARCHAR(32)  NULL,         -- S355 etc (optional)
        location    NVARCHAR(64)  NULL,         -- rack / bay (optional)
        notes       NVARCHAR(256) NULL,
        source      NVARCHAR(16)  NOT NULL DEFAULT 'manual',   -- 'voice' | 'manual'
        is_deleted  BIT           NOT NULL DEFAULT 0,
        created_by  NVARCHAR(120) NULL,
        created_at  DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
        updated_at  DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_StockItems_Section ON dbo.StockItems (section) WHERE is_deleted = 0;
    PRINT 'StockItems table created.';
END
ELSE
    PRINT 'StockItems already exists — nothing to do.';

SELECT COUNT(*) AS table_count FROM sys.tables WHERE name = 'StockItems';

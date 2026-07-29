-- ─────────────────────────────────────────────────────────────────────────────
-- add-quoteline-labour-hours.sql  (Fault Register F1 / Phase B1)
--
-- Adds QuoteLineItems.labour_hours: the ESTIMATED labour hours a line carries,
-- transferred from QB's real hour fields at mark-won. Project Tracker's
-- "Hours Scheduled" reads this column; quantity keeps its qty x price meaning
-- for contract value (the two conventions no longer share a column).
--
-- Run in Azure SQL Query Editor (office WiFi).
-- ⚠ ADD COLUMN => RESTART the Function App afterwards (portal → Restart, ~60s).
-- ─────────────────────────────────────────────────────────────────────────────

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
     WHERE object_id = OBJECT_ID('dbo.QuoteLineItems')
       AND name = 'labour_hours'
)
BEGIN
    ALTER TABLE dbo.QuoteLineItems
        ADD labour_hours DECIMAL(10,2) NULL;
    PRINT 'labour_hours column added.';
END
ELSE
    PRINT 'labour_hours already exists — nothing to do.';

-- Verify:
SELECT COUNT(*) AS column_count
  FROM sys.columns
 WHERE object_id = OBJECT_ID('dbo.QuoteLineItems')
   AND name = 'labour_hours';

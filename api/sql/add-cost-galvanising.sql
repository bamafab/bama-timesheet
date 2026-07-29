-- ─────────────────────────────────────────────────────────────────────────────
-- add-cost-galvanising.sql  (Fault Register F5 / Phase B4 — decision: SPLIT)
--
-- QB previously saved painting + galvanising combined into cost_painting,
-- which made every won project's Galvanising line show £0 (misleading).
-- This adds cost_galvanising; QB saveAll now writes the two separately and
-- mark-won maps the galvanising line to the real figure.
--
-- Existing quotes: the split populates automatically the next time each quote
-- is opened and saved in QB (cost_* are recomputed on every save). Until
-- then their cost_painting keeps the combined figure — arithmetic unchanged.
--
-- Run in Azure SQL Query Editor (office WiFi).
-- ⚠ ADD COLUMN => RESTART the Function App afterwards (portal → Restart, ~60s).
-- ─────────────────────────────────────────────────────────────────────────────

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
     WHERE object_id = OBJECT_ID('dbo.QuoteBuilderQuotes')
       AND name = 'cost_galvanising'
)
BEGIN
    ALTER TABLE dbo.QuoteBuilderQuotes
        ADD cost_galvanising DECIMAL(18,2) NULL;
    PRINT 'cost_galvanising column added.';
END
ELSE
    PRINT 'cost_galvanising already exists — nothing to do.';

SELECT COUNT(*) AS column_count
  FROM sys.columns
 WHERE object_id = OBJECT_ID('dbo.QuoteBuilderQuotes')
   AND name = 'cost_galvanising';

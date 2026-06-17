-- Add chasing_date column to QuoteBuilderQuotes
-- Run once against bama-erp (Azure portal Query Editor) on workplace WiFi.
-- After running: RESTART the Function App (cached query plan on old schema).
--
-- chasing_date = the follow-up date for a sent quote. Auto-set to +1 month
-- when a quote is sent (editable in QB). Drives the ED "To chase" filter/badge.

ALTER TABLE QuoteBuilderQuotes ADD chasing_date DATE NULL;
GO

-- Backfill: pull chasing date out of the quote_data JSON blob for existing rows
-- that already have one stored (key: chasingDate, format YYYY-MM-DD).
-- Safe to run repeatedly; only fills rows where the column is still NULL.
UPDATE QuoteBuilderQuotes
SET chasing_date = TRY_CONVERT(DATE, JSON_VALUE(quote_data, '$.chasingDate'))
WHERE chasing_date IS NULL
  AND ISJSON(quote_data) = 1
  AND JSON_VALUE(quote_data, '$.chasingDate') IS NOT NULL
  AND TRY_CONVERT(DATE, JSON_VALUE(quote_data, '$.chasingDate')) IS NOT NULL;
GO

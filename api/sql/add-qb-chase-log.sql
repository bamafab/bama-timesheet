-- Add chase-logging columns to QuoteBuilderQuotes
-- Run once against bama-erp (Azure portal Query Editor) on workplace WiFi.
-- After running: RESTART the Function App (cached query plan on old schema).
--
-- Records when a sent quote was chased, by whom, and how many times — mirrors
-- the TenderRegister notified_at / notified_by pattern. Drives the chase-count
-- badge on the Estimating Dashboard detail panel.

ALTER TABLE QuoteBuilderQuotes ADD chased_at   DATETIME       NULL;
GO
ALTER TABLE QuoteBuilderQuotes ADD chased_by   NVARCHAR(100)  NULL;
GO
ALTER TABLE QuoteBuilderQuotes ADD chase_count INT NOT NULL DEFAULT 0;
GO

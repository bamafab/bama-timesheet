-- Babcock Quotes: add revision counter
--
-- Tracks how many times the customer-facing PDF has been regenerated
-- via the tracker edit flow. Revision 0 = original generation.
-- Each regenerate via Edit Quote bumps this by 1; the new PDF is named
-- `<ref> - <customer> - <date> - rev<n>.pdf` and replaces the
-- generated_file_id / generated_file_url pointers on the row. The
-- previous PDF remains in SharePoint untouched (filename includes its
-- revision number, so old revisions can be located if needed).
--
-- Idempotent: only adds the column if it doesn't already exist.

IF NOT EXISTS (
    SELECT 1
    FROM   sys.columns
    WHERE  object_id = OBJECT_ID('dbo.BabcockQuotes')
    AND    name      = 'revision'
)
BEGIN
    ALTER TABLE dbo.BabcockQuotes
        ADD revision INT NOT NULL CONSTRAINT DF_BabcockQuotes_revision DEFAULT 0;
END

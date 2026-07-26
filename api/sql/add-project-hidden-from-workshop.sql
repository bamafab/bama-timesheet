-- add-project-hidden-from-workshop.sql
-- Adds Projects.hidden_from_workshop — flags projects that should NOT appear on
-- the shop-floor projects grid (projects.html) or kiosk view. Used for jobs the
-- other company deals with / not our scope. Draftsman-toggled via the eye button.
--
-- Run against bama-erp (Azure portal → Query Editor, office WiFi — home IP is
-- blocked). AFTER it runs, RESTART the Function App (bama-erp-api…): the running
-- app can hold a cached query plan on the old schema and throw
-- 'Invalid column name hidden_from_workshop' for a few minutes otherwise.

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.Projects') AND name = 'hidden_from_workshop'
)
BEGIN
    ALTER TABLE dbo.Projects
        ADD hidden_from_workshop BIT NOT NULL
            CONSTRAINT DF_Projects_hidden_from_workshop DEFAULT 0;
END;
GO

-- Verify (column_count should be 1)
SELECT column_count = COUNT(*)
FROM sys.columns
WHERE object_id = OBJECT_ID('dbo.Projects') AND name = 'hidden_from_workshop';
GO

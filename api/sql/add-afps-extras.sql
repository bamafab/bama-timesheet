-- ─────────────────────────────────────────────────────────────────────────────
-- add-afps-extras.sql — Commit 3 schema additions
-- ─────────────────────────────────────────────────────────────────────────────
-- Builds on add-invoicing.sql (already deployed). Adds:
--   1. Applications.is_final           — Final Application flag
--   2. Applications.period_start/_end  — date-range period picker
--   3. ApplicationLineItems.cumulative_value — running cumulative £
--   4. ApplicationLineItems.certified_this_app_value — per-line certified
--   5. UserPermissions.afps            — new permission column
--
-- All idempotent. Paste into Azure SQL Query Editor and run.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1, 2: Applications extras
IF NOT EXISTS (
    SELECT 1 FROM sys.columns WHERE Name = 'is_final' AND Object_ID = Object_ID('dbo.Applications')
)
    ALTER TABLE dbo.Applications ADD is_final BIT NOT NULL DEFAULT 0;

IF NOT EXISTS (
    SELECT 1 FROM sys.columns WHERE Name = 'period_start' AND Object_ID = Object_ID('dbo.Applications')
)
    ALTER TABLE dbo.Applications ADD period_start DATE NULL;

IF NOT EXISTS (
    SELECT 1 FROM sys.columns WHERE Name = 'period_end' AND Object_ID = Object_ID('dbo.Applications')
)
    ALTER TABLE dbo.Applications ADD period_end DATE NULL;
GO

-- 3, 4: ApplicationLineItems extras
IF NOT EXISTS (
    SELECT 1 FROM sys.columns WHERE Name = 'cumulative_value' AND Object_ID = Object_ID('dbo.ApplicationLineItems')
)
    ALTER TABLE dbo.ApplicationLineItems ADD cumulative_value DECIMAL(14,2) NULL;

IF NOT EXISTS (
    SELECT 1 FROM sys.columns WHERE Name = 'certified_this_app_value' AND Object_ID = Object_ID('dbo.ApplicationLineItems')
)
    ALTER TABLE dbo.ApplicationLineItems ADD certified_this_app_value DECIMAL(14,2) NULL;
GO

-- 5: UserPermissions.afps
IF NOT EXISTS (
    SELECT 1 FROM sys.columns WHERE Name = 'afps' AND Object_ID = Object_ID('dbo.UserPermissions')
)
    ALTER TABLE dbo.UserPermissions ADD afps BIT NOT NULL DEFAULT 0;
GO

-- ─── Verification queries ─────────────────────────────────────────────────────
-- Run these after the migration to confirm 5 results = 1:
--
-- SELECT 'Applications.is_final'                AS check_name, COUNT(*) AS exists
--   FROM sys.columns
--   WHERE Name = 'is_final' AND Object_ID = Object_ID('dbo.Applications')
-- UNION ALL
-- SELECT 'Applications.period_start',           COUNT(*)
--   FROM sys.columns
--   WHERE Name = 'period_start' AND Object_ID = Object_ID('dbo.Applications')
-- UNION ALL
-- SELECT 'Applications.period_end',             COUNT(*)
--   FROM sys.columns
--   WHERE Name = 'period_end' AND Object_ID = Object_ID('dbo.Applications')
-- UNION ALL
-- SELECT 'ApplicationLineItems.cumulative_value', COUNT(*)
--   FROM sys.columns
--   WHERE Name = 'cumulative_value' AND Object_ID = Object_ID('dbo.ApplicationLineItems')
-- UNION ALL
-- SELECT 'ApplicationLineItems.certified_this_app_value', COUNT(*)
--   FROM sys.columns
--   WHERE Name = 'certified_this_app_value' AND Object_ID = Object_ID('dbo.ApplicationLineItems')
-- UNION ALL
-- SELECT 'UserPermissions.afps',                COUNT(*)
--   FROM sys.columns
--   WHERE Name = 'afps' AND Object_ID = Object_ID('dbo.UserPermissions');

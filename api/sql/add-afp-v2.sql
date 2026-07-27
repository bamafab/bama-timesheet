-- ─────────────────────────────────────────────────────────────────────────────
-- add-afp-v2.sql — AFP v2 (grouped SOV + cumulative model + payment tracking)
-- ─────────────────────────────────────────────────────────────────────────────
-- Builds on add-invoicing.sql + add-afps-extras.sql (already deployed). Adds:
--
--   ApplicationLineItems:
--     1. section            — 'measured' | 'variation' | 'materials'
--     2. item_no            — item group number within the section (1, 2, 3…)
--     3. item_description   — the item group heading (quote scope text)
--     4. item_quote_ref     — BAMA Quote No for the item group (e.g. Q250911)
--     5. item_wo_no         — client WO / contract no (e.g. S-CM0665/0028)
--     6. gross_amount_paid  — cumulative £ certified/paid to date on this line
--     7. certified_pct      — cumulative % the client certified on this line
--
--   Applications:
--     8. previous_certificate_value — "Less Previous Contractor certificate" £
--     9. retention_pct              — retention rate used (carried per project)
--    10. contract_no                — client contract / order no on the header
--    11. cumulative_value_net       — cumulative Value of Application (A+B+C)
--
-- NOTE: this is an ADD COLUMN migration → the Function App needs a RESTART
-- after running (per CLAUDE.md). Run from office WiFi or ask Daniel.
-- All idempotent. Paste into Azure SQL Query Editor and run.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1–7: ApplicationLineItems
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name = 'section' AND Object_ID = Object_ID('dbo.ApplicationLineItems'))
    ALTER TABLE dbo.ApplicationLineItems ADD section NVARCHAR(20) NOT NULL DEFAULT 'measured';

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name = 'item_no' AND Object_ID = Object_ID('dbo.ApplicationLineItems'))
    ALTER TABLE dbo.ApplicationLineItems ADD item_no INT NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name = 'item_description' AND Object_ID = Object_ID('dbo.ApplicationLineItems'))
    ALTER TABLE dbo.ApplicationLineItems ADD item_description NVARCHAR(500) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name = 'item_quote_ref' AND Object_ID = Object_ID('dbo.ApplicationLineItems'))
    ALTER TABLE dbo.ApplicationLineItems ADD item_quote_ref NVARCHAR(50) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name = 'item_wo_no' AND Object_ID = Object_ID('dbo.ApplicationLineItems'))
    ALTER TABLE dbo.ApplicationLineItems ADD item_wo_no NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name = 'gross_amount_paid' AND Object_ID = Object_ID('dbo.ApplicationLineItems'))
    ALTER TABLE dbo.ApplicationLineItems ADD gross_amount_paid DECIMAL(14,2) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name = 'certified_pct' AND Object_ID = Object_ID('dbo.ApplicationLineItems'))
    ALTER TABLE dbo.ApplicationLineItems ADD certified_pct DECIMAL(5,2) NULL;
GO

-- 8–11: Applications
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name = 'previous_certificate_value' AND Object_ID = Object_ID('dbo.Applications'))
    ALTER TABLE dbo.Applications ADD previous_certificate_value DECIMAL(14,2) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name = 'retention_pct' AND Object_ID = Object_ID('dbo.Applications'))
    ALTER TABLE dbo.Applications ADD retention_pct DECIMAL(5,2) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name = 'contract_no' AND Object_ID = Object_ID('dbo.Applications'))
    ALTER TABLE dbo.Applications ADD contract_no NVARCHAR(100) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE Name = 'cumulative_value_net' AND Object_ID = Object_ID('dbo.Applications'))
    ALTER TABLE dbo.Applications ADD cumulative_value_net DECIMAL(14,2) NULL;
GO

-- ─── Verification ─────────────────────────────────────────────────────────────
-- SELECT name FROM sys.columns WHERE Object_ID = Object_ID('dbo.ApplicationLineItems');
-- SELECT name FROM sys.columns WHERE Object_ID = Object_ID('dbo.Applications');

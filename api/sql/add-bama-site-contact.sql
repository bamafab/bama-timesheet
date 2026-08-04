-- ─────────────────────────────────────────────────────────────────────────────
-- add-bama-site-contact.sql — BAMA's own contact on site
--
-- The Job Sheet held only the CLIENT-side contacts (commercial / PM / site
-- manager). Site deliveries need BAMA's person on site as well, so the driver
-- can call either side. Two columns on ProjectSheets, prefilled into the SDN
-- like the rest of the sheet.
--
-- ADD COLUMN => Function App RESTART REQUIRED after running.
-- ─────────────────────────────────────────────────────────────────────────────

IF COL_LENGTH('ProjectSheets', 'bama_contact_name') IS NULL
    ALTER TABLE ProjectSheets ADD bama_contact_name NVARCHAR(255) NULL;
IF COL_LENGTH('ProjectSheets', 'bama_contact_phone') IS NULL
    ALTER TABLE ProjectSheets ADD bama_contact_phone NVARCHAR(64) NULL;

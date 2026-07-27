-- ═══════════════════════════════════════════════════════════════
-- Project Sheets — per-PROJECT source of truth for site/delivery
-- details (2026-07-27, supersedes the same-day per-job JobSheets)
--
-- One row per Projects row. Holds the site address, site contact
-- and client PO that SDN / Site Pack / RAMS prefill from by default
-- (falling back to the project's site/client details when no sheet
-- has been saved yet). Supplier DNs (galv/powder) are NOT affected.
--
-- Rationale: two different site addresses within one project is
-- rare, so the sheet lives at project level and every job under
-- the project shares it.
--
-- New table => NO Function App restart required.
-- Idempotent: safe to run more than once. Drops the per-job
-- JobSheets table if the earlier same-day migration was run
-- (no production data existed in it).
-- ═══════════════════════════════════════════════════════════════

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'JobSheets')
BEGIN
    DROP TABLE JobSheets;
    PRINT 'Per-job JobSheets table dropped (superseded by ProjectSheets).';
END

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ProjectSheets')
BEGIN
    CREATE TABLE ProjectSheets (
        project_id       INT            NOT NULL PRIMARY KEY
                         REFERENCES Projects(id) ON DELETE CASCADE,
        site_name        NVARCHAR(256)  NULL,
        address_line1    NVARCHAR(256)  NULL,
        address_line2    NVARCHAR(256)  NULL,
        city             NVARCHAR(128)  NULL,
        county           NVARCHAR(128)  NULL,
        postcode         NVARCHAR(32)   NULL,
        contact_name     NVARCHAR(128)  NULL,
        contact_phone    NVARCHAR(64)   NULL,
        contact_email    NVARCHAR(256)  NULL,
        client_po_number NVARCHAR(128)  NULL,
        notes            NVARCHAR(MAX)  NULL,
        updated_at       DATETIME2      NOT NULL DEFAULT GETUTCDATE(),
        updated_by       NVARCHAR(256)  NULL
    );
    PRINT 'ProjectSheets table created.';
END
ELSE
    PRINT 'ProjectSheets table already exists - nothing to do.';

-- Verification (expect column_count = 13)
SELECT COUNT(*) AS column_count
FROM sys.columns
WHERE object_id = OBJECT_ID('ProjectSheets');

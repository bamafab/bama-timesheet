-- ═══════════════════════════════════════════════════════════════
-- Job Sheets — per-job source of truth for site/delivery details
-- (2026-07-27)
--
-- One row per DrawingJobs row. Holds the site address, site contact
-- and client PO that SDN / Site Pack / RAMS prefill from by default
-- (falling back to the project's site/client details when no job
-- sheet has been saved yet). Supplier DNs (galv/powder) are NOT
-- affected — they keep using the supplier's own address.
--
-- New table => NO Function App restart required.
-- Idempotent: safe to run more than once.
-- ═══════════════════════════════════════════════════════════════

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'JobSheets')
BEGIN
    CREATE TABLE JobSheets (
        job_id           INT            NOT NULL PRIMARY KEY
                         REFERENCES DrawingJobs(id) ON DELETE CASCADE,
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
    PRINT 'JobSheets table created.';
END
ELSE
    PRINT 'JobSheets table already exists - nothing to do.';

-- Verification
SELECT COUNT(*) AS column_count
FROM sys.columns
WHERE object_id = OBJECT_ID('JobSheets');

-- ═══════════════════════════════════════════════════════════════
-- Project Sheets — per-PROJECT source of truth for site/delivery
-- details (2026-07-27, v2: role contacts added same day)
--
-- One row per Projects row. Holds the site address, three role
-- contacts (Commercial / Project Manager / Site Manager) and client
-- PO that SDN / Site Pack / RAMS prefill from by default. The site
-- address lives HERE, never on the client record — so QB quotations
-- and anything else prefilling from Clients keeps showing the
-- client's head-office address. Supplier DNs (galv/powder) are NOT
-- affected.
--
-- New table => NO Function App restart required.
-- Idempotent. Drops+recreates the same-day v1 shape (no role
-- columns) and the earlier per-job JobSheets — neither carried
-- production data.
-- ═══════════════════════════════════════════════════════════════

IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'JobSheets')
BEGIN
    DROP TABLE JobSheets;
    PRINT 'Per-job JobSheets table dropped (superseded by ProjectSheets).';
END

-- v1 (same-day) shape lacks the role-contact columns — recreate.
IF EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ProjectSheets')
   AND NOT EXISTS (SELECT 1 FROM sys.columns
                   WHERE object_id = OBJECT_ID('ProjectSheets')
                     AND name = 'commercial_name')
BEGIN
    DROP TABLE ProjectSheets;
    PRINT 'v1 ProjectSheets dropped (pre-role-contacts shape).';
END

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'ProjectSheets')
BEGIN
    CREATE TABLE ProjectSheets (
        project_id         INT            NOT NULL PRIMARY KEY
                           REFERENCES Projects(id) ON DELETE CASCADE,
        site_name          NVARCHAR(256)  NULL,
        address_line1      NVARCHAR(256)  NULL,
        address_line2      NVARCHAR(256)  NULL,
        city               NVARCHAR(128)  NULL,
        county             NVARCHAR(128)  NULL,
        postcode           NVARCHAR(32)   NULL,
        commercial_name    NVARCHAR(255)  NULL,
        commercial_phone   NVARCHAR(64)   NULL,
        commercial_email   NVARCHAR(255)  NULL,
        pm_name            NVARCHAR(255)  NULL,
        pm_phone           NVARCHAR(64)   NULL,
        pm_email           NVARCHAR(255)  NULL,
        site_manager_name  NVARCHAR(255)  NULL,
        site_manager_phone NVARCHAR(64)   NULL,
        site_manager_email NVARCHAR(255)  NULL,
        client_po_number   NVARCHAR(128)  NULL,
        notes              NVARCHAR(MAX)  NULL,
        updated_at         DATETIME2      NOT NULL DEFAULT GETUTCDATE(),
        updated_by         NVARCHAR(256)  NULL
    );
    PRINT 'ProjectSheets table created (v2, role contacts).';
END
ELSE
    PRINT 'ProjectSheets already at v2 - nothing to do.';

-- Verification (expect column_count = 19)
SELECT COUNT(*) AS column_count
FROM sys.columns
WHERE object_id = OBJECT_ID('ProjectSheets');

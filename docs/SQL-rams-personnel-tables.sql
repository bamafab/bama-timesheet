-- ─────────────────────────────────────────────────────────────────────────────
-- Site Personnel roster  —  RAMS module phase 2b   (safe re-run version)
--
-- This is the exact script that was RUN against the database (2026-07-26).
-- Three NEW tables (no ALTER on anything existing → NO Function App restart):
--   1. CertTypes           — editable lookup of certification types
--   2. SitePersonnel       — reusable roster: staff AND subcontractors, money-free
--   3. SitePersonnelCerts  — normalised certs per person, expiry first-class
--                            (this becomes the training-matrix source later)
--
-- Run via Azure SQL Query Editor on office WiFi (home IP is blocked).
-- Every statement is guarded so the whole script is safe to run more than once.
-- Matches api/src/functions/site-personnel.js.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. CertTypes (editable lookup) ──────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'CertTypes')
BEGIN
    CREATE TABLE CertTypes (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        name        NVARCHAR(100) NOT NULL,
        active      BIT           NOT NULL DEFAULT 1,
        sort_order  INT           NOT NULL DEFAULT 99,
        created_at  DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE UNIQUE INDEX UX_CertTypes_Name ON CertTypes (name);
END
GO

-- ─── 2. SitePersonnel (roster: staff + subcontractors, NO day-rate) ──────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SitePersonnel')
BEGIN
    CREATE TABLE SitePersonnel (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        name        NVARCHAR(200) NOT NULL,
        site_role   NVARCHAR(200) NOT NULL DEFAULT '',
        type        NVARCHAR(20)  NOT NULL DEFAULT 'staff',   -- 'staff' | 'subcontractor'
        company     NVARCHAR(200) NOT NULL DEFAULT '',        -- for subcontractors
        phone       NVARCHAR(100) NOT NULL DEFAULT '',
        employee_id INT           NULL REFERENCES Employees(id), -- set when pulled from Employees
        active      BIT           NOT NULL DEFAULT 1,
        created_at  DATETIME2     NOT NULL DEFAULT GETUTCDATE(),
        updated_at  DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_SitePersonnel_Active ON SitePersonnel (active, name);
END
GO

-- ─── 3. SitePersonnelCerts (normalised — expiry is first-class) ──────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'SitePersonnelCerts')
BEGIN
    CREATE TABLE SitePersonnelCerts (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        personnel_id INT           NOT NULL REFERENCES SitePersonnel(id) ON DELETE CASCADE,
        cert_type    NVARCHAR(100) NOT NULL,   -- matches a CertTypes.name
        cert_number  NVARCHAR(100) NOT NULL DEFAULT '',
        issue_date   DATE          NULL,
        expiry_date  DATE          NULL,       -- surfaced by the future training-matrix
        created_at   DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );
    CREATE INDEX IX_SitePersonnelCerts_Personnel ON SitePersonnelCerts (personnel_id);
    CREATE INDEX IX_SitePersonnelCerts_Expiry    ON SitePersonnelCerts (expiry_date);
END
GO

-- ─── SEED: starter cert types ────────────────────────────────────────────────
INSERT INTO CertTypes (name, sort_order)
SELECT v.name, v.so
FROM (VALUES
    ('CSCS', 1), ('CPCS', 2), ('SMSTS', 3), ('SSSTS', 4),
    ('PASMA', 5), ('IPAF', 6), ('First Aid', 7), ('Coded Welder', 8),
    ('Slinger/Signaller', 9), ('Abrasive Wheels', 10), ('SPA', 11), ('EUSR', 12)
) v(name, so)
WHERE NOT EXISTS (SELECT 1 FROM CertTypes ct WHERE ct.name = v.name);
GO

-- ─── SEED: all active Employees as 'staff' rows (role/certs blank) ───────────
INSERT INTO SitePersonnel (name, type, employee_id)
SELECT e.name, 'staff', e.id
FROM Employees e
WHERE e.is_active = 1
  AND NOT EXISTS (SELECT 1 FROM SitePersonnel sp WHERE sp.employee_id = e.id);
GO

-- ─── SEED: guarantee the known site crew exist (in case not in Employees) ────
INSERT INTO SitePersonnel (name, type, site_role)
SELECT v.name, 'staff', v.role
FROM (VALUES
    ('Leszek Spychalski', 'Project Manager'),
    ('Jason Lambie',      'Site Supervisor'),
    ('Adrian Smith',      'Steel Erector / Installer')
) v(name, role)
WHERE NOT EXISTS (SELECT 1 FROM SitePersonnel sp WHERE sp.name = v.name);
GO

-- ─── SEED: set known crew roles (only if still blank) ────────────────────────
UPDATE SitePersonnel SET site_role = 'Project Manager'
    WHERE name = 'Leszek Spychalski' AND (site_role IS NULL OR site_role = '');
UPDATE SitePersonnel SET site_role = 'Site Supervisor'
    WHERE name = 'Jason Lambie'      AND (site_role IS NULL OR site_role = '');
UPDATE SitePersonnel SET site_role = 'Steel Erector / Installer'
    WHERE name = 'Adrian Smith'      AND (site_role IS NULL OR site_role = '');
GO

-- ─── SEED: known crew certs (Leszek CSCS/SMSTS, Jason CSCS/SSSTS, Adrian CSCS/CPCS)
INSERT INTO SitePersonnelCerts (personnel_id, cert_type)
SELECT sp.id, v.cert_type
FROM SitePersonnel sp
CROSS APPLY (VALUES ('CSCS'), ('SMSTS')) v(cert_type)
WHERE sp.name = 'Leszek Spychalski'
  AND NOT EXISTS (SELECT 1 FROM SitePersonnelCerts c WHERE c.personnel_id = sp.id AND c.cert_type = v.cert_type);

INSERT INTO SitePersonnelCerts (personnel_id, cert_type)
SELECT sp.id, v.cert_type
FROM SitePersonnel sp
CROSS APPLY (VALUES ('CSCS'), ('SSSTS')) v(cert_type)
WHERE sp.name = 'Jason Lambie'
  AND NOT EXISTS (SELECT 1 FROM SitePersonnelCerts c WHERE c.personnel_id = sp.id AND c.cert_type = v.cert_type);

INSERT INTO SitePersonnelCerts (personnel_id, cert_type)
SELECT sp.id, v.cert_type
FROM SitePersonnel sp
CROSS APPLY (VALUES ('CSCS'), ('CPCS')) v(cert_type)
WHERE sp.name = 'Adrian Smith'
  AND NOT EXISTS (SELECT 1 FROM SitePersonnelCerts c WHERE c.personnel_id = sp.id AND c.cert_type = v.cert_type);
GO

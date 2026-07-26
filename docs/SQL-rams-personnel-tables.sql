-- ============================================================================
-- RAMS phase 2b — Site Personnel roster tables + seeds
-- Run in Azure SQL Query Editor. All objects are NEW tables, so NO Function App
-- restart is required (restart is only needed after ALTER TABLE ADD COLUMN).
-- Idempotent: safe to re-run — CREATEs are guarded and seeds use NOT EXISTS.
-- Matches api/src/functions/site-personnel.js exactly.
-- ============================================================================

-- 1. CertTypes — editable cert-type lookup (CSCS, SMSTS, …) ------------------
IF OBJECT_ID('dbo.CertTypes', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.CertTypes (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        name        NVARCHAR(100) NOT NULL,
        active      BIT           NOT NULL CONSTRAINT DF_CertTypes_active     DEFAULT (1),
        sort_order  INT           NOT NULL CONSTRAINT DF_CertTypes_sort       DEFAULT (99),
        created_at  DATETIME2     NOT NULL CONSTRAINT DF_CertTypes_created    DEFAULT (GETUTCDATE())
    );
    CREATE UNIQUE INDEX UX_CertTypes_name ON dbo.CertTypes(name);
END
GO

-- 2. SitePersonnel — reusable roster (staff + subcontractors, money-free) -----
IF OBJECT_ID('dbo.SitePersonnel', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.SitePersonnel (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        name        NVARCHAR(200) NOT NULL,
        site_role   NVARCHAR(150) NULL,
        type        NVARCHAR(20)  NOT NULL CONSTRAINT DF_SitePersonnel_type    DEFAULT ('staff'),  -- 'staff' | 'subcontractor'
        company     NVARCHAR(200) NULL,
        phone       NVARCHAR(50)  NULL,
        employee_id INT           NULL,   -- optional link to dbo.Employees
        active      BIT           NOT NULL CONSTRAINT DF_SitePersonnel_active  DEFAULT (1),
        created_at  DATETIME2     NOT NULL CONSTRAINT DF_SitePersonnel_created DEFAULT (GETUTCDATE()),
        updated_at  DATETIME2     NOT NULL CONSTRAINT DF_SitePersonnel_updated DEFAULT (GETUTCDATE())
    );
END
GO

-- 3. SitePersonnelCerts — normalised certs (expiry first-class → training matrix later)
IF OBJECT_ID('dbo.SitePersonnelCerts', 'U') IS NULL
BEGIN
    CREATE TABLE dbo.SitePersonnelCerts (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        personnel_id INT           NOT NULL,
        cert_type    NVARCHAR(100) NOT NULL,
        cert_number  NVARCHAR(100) NULL,
        issue_date   DATE          NULL,
        expiry_date  DATE          NULL,
        created_at   DATETIME2     NOT NULL CONSTRAINT DF_SPC_created DEFAULT (GETUTCDATE()),
        CONSTRAINT FK_SPC_personnel FOREIGN KEY (personnel_id) REFERENCES dbo.SitePersonnel(id)
    );
    CREATE INDEX IX_SPC_personnel ON dbo.SitePersonnelCerts(personnel_id);
END
GO

-- ── SEED: starter cert types ────────────────────────────────────────────────
INSERT INTO dbo.CertTypes (name, sort_order)
SELECT v.name, v.so
FROM (VALUES
    ('CSCS', 1), ('CPCS', 2), ('SMSTS', 3), ('SSSTS', 4), ('PASMA', 5), ('IPAF', 6),
    ('First Aid', 7), ('Coded Welder', 8), ('Slinger/Signaller', 9),
    ('Abrasive Wheels', 10), ('SPA', 11), ('EUSR', 12)
) AS v(name, so)
WHERE NOT EXISTS (SELECT 1 FROM dbo.CertTypes c WHERE c.name = v.name);
GO

-- ── SEED: all active employees as pickable 'staff' rows (role/certs blank) ───
INSERT INTO dbo.SitePersonnel (name, type, employee_id)
SELECT e.name, 'staff', e.id
FROM dbo.Employees e
WHERE e.is_active = 1
  AND NOT EXISTS (SELECT 1 FROM dbo.SitePersonnel sp WHERE sp.employee_id = e.id);
GO

-- ── SEED: known site-crew roles (no-op if a name doesn't match Employees.name)
UPDATE dbo.SitePersonnel SET site_role = 'Project Manager', updated_at = GETUTCDATE() WHERE name = 'Leszek Spychalski';
UPDATE dbo.SitePersonnel SET site_role = 'Site Supervisor', updated_at = GETUTCDATE() WHERE name = 'Jason Lambie';
UPDATE dbo.SitePersonnel SET site_role = 'Steel Erector',   updated_at = GETUTCDATE() WHERE name = 'Adrian Smith';
GO

-- ── SEED: known site-crew certs (idempotent) ────────────────────────────────
;WITH crew AS (
    SELECT id, name FROM dbo.SitePersonnel
    WHERE name IN ('Leszek Spychalski', 'Jason Lambie', 'Adrian Smith')
)
INSERT INTO dbo.SitePersonnelCerts (personnel_id, cert_type)
SELECT c.id, v.cert
FROM crew c
CROSS APPLY (VALUES
    ('Leszek Spychalski', 'CSCS'), ('Leszek Spychalski', 'SMSTS'),
    ('Jason Lambie',      'CSCS'), ('Jason Lambie',      'SSSTS'),
    ('Adrian Smith',      'CSCS'), ('Adrian Smith',      'CPCS')
) AS v(who, cert)
WHERE v.who = c.name
  AND NOT EXISTS (
      SELECT 1 FROM dbo.SitePersonnelCerts x
      WHERE x.personnel_id = c.id AND x.cert_type = v.cert
  );
GO

-- ── VERIFY ──────────────────────────────────────────────────────────────────
SELECT 'CertTypes' AS tbl, COUNT(*) AS rows FROM dbo.CertTypes
UNION ALL SELECT 'SitePersonnel',      COUNT(*) FROM dbo.SitePersonnel
UNION ALL SELECT 'SitePersonnelCerts', COUNT(*) FROM dbo.SitePersonnelCerts;
GO

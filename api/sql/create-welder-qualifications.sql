-- ─────────────────────────────────────────────────────────────────────────────
-- create-welder-qualifications.sql  (E1 — welder approvals, 2026-07-30)
--
-- Welder qualification certificates (EN ISO 9606-1 / EN ISO 14732 / ASME IX).
-- A training-matrix tick ("Coded Welder") cannot express a qualification: an
-- auditor asks WHICH process, material group, thickness range and positions,
-- and whether the certificate was still valid on the day the weld was made.
--
-- Two validity clocks run independently and both are tracked:
--   confirm_due  — the employer's periodic confirmation of validity (signed
--                  every 6 months under EN ISO 9606-1 §9.2). Miss it and the
--                  qualification lapses even though the certificate's face
--                  date still looks fine. This is the one that catches people.
--   expiry_date  — the certificate's own expiry / re-test date as printed.
--
-- RANGE OF APPROVAL IS STORED AS PRINTED, NEVER DERIVED. The certificate
-- states the approved thickness and diameter ranges and positions; the ERP
-- records those strings/numbers verbatim and only ever COMPARES against them.
-- Deriving a range from a test thickness would be inventing qualification
-- scope, which is exactly what must not happen.
--
-- NEW TABLES ONLY — no Function App restart needed. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Qualifications
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'WelderQualifications')
BEGIN
    CREATE TABLE WelderQualifications (
        id                  INT IDENTITY(1,1) PRIMARY KEY,
        personnel_id        INT           NULL,          -- SitePersonnel.id when known
        person_name         NVARCHAR(200) NOT NULL,      -- snapshot; survives roster edits
        cert_no             NVARCHAR(100) NOT NULL,
        standard            NVARCHAR(60)  NOT NULL DEFAULT 'EN ISO 9606-1',
        -- Scope, exactly as printed on the certificate
        process             NVARCHAR(40)  NOT NULL,      -- 135 / 136 / 141 / 111 / 138…
        material_group      NVARCHAR(40)  NULL,          -- M11, M21, W01…
        product_form        NVARCHAR(20)  NULL,          -- plate | pipe | both
        joint_type          NVARCHAR(20)  NULL,          -- BW | FW | both
        thickness_min       DECIMAL(8,2)  NULL,          -- mm, as printed
        thickness_max       DECIMAL(8,2)  NULL,
        diameter_min        DECIMAL(8,2)  NULL,          -- mm, pipe only
        diameter_max        DECIMAL(8,2)  NULL,
        positions           NVARCHAR(200) NULL,          -- 'PA,PB,PC,PF' as printed
        filler_designation  NVARCHAR(80)  NULL,          -- consumable / FM group
        backing             NVARCHAR(20)  NULL,          -- mb | nb
        transfer_mode       NVARCHAR(30)  NULL,
        range_notes         NVARCHAR(500) NULL,          -- anything printed that doesn't fit above
        -- Issue / validity
        examiner            NVARCHAR(200) NULL,          -- examiner or notified body
        test_date           DATE          NULL,
        issue_date          DATE          NULL,
        confirm_due         DATE          NULL,          -- next 6-month employer confirmation
        expiry_date         DATE          NULL,          -- certificate expiry / re-test
        status              NVARCHAR(20)  NOT NULL DEFAULT 'valid',
            -- valid | lapsed | revoked | superseded
        -- Certificate file
        file_name           NVARCHAR(255)  NULL,
        sharepoint_file_id  NVARCHAR(120)  NULL,
        drive_id            NVARCHAR(140)  NULL,
        web_url             NVARCHAR(1000) NULL,
        notes               NVARCHAR(MAX) NULL,
        superseded_by       INT           NULL,
        is_deleted          BIT           NOT NULL DEFAULT 0,
        created_by          NVARCHAR(120) NULL,
        created_at          DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at          DATETIME2     NULL
    );
    CREATE INDEX IX_WelderQuals_Person  ON WelderQualifications (person_name) WHERE is_deleted = 0;
    CREATE INDEX IX_WelderQuals_Confirm ON WelderQualifications (confirm_due) WHERE is_deleted = 0;
    CREATE INDEX IX_WelderQuals_Expiry  ON WelderQualifications (expiry_date) WHERE is_deleted = 0;
    PRINT 'WelderQualifications created';
END
ELSE
    PRINT 'WelderQualifications already exists — no change';

-- 2) Six-month confirmation log — the audit trail an assessor asks for
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'WelderQualConfirmations')
BEGIN
    CREATE TABLE WelderQualConfirmations (
        id              INT IDENTITY(1,1) PRIMARY KEY,
        qualification_id INT          NOT NULL,
        confirmed_on    DATE          NOT NULL,
        confirmed_by    NVARCHAR(200) NOT NULL,   -- the responsible person signing
        evidence        NVARCHAR(500) NULL,       -- e.g. 'in continuous employment, welding 135 M11'
        next_due        DATE          NULL,       -- confirm_due set at the time
        created_at      DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_WelderQualConf_Qual ON WelderQualConfirmations (qualification_id);
    PRINT 'WelderQualConfirmations created';
END
ELSE
    PRINT 'WelderQualConfirmations already exists — no change';

-- Verification
SELECT
    (SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('WelderQualifications'))    AS qual_cols,
    (SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('WelderQualConfirmations')) AS conf_cols;

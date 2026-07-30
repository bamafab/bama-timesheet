-- create-employee-documents.sql (D3 — Employee documents, 2026-07-30)
-- Per-employee document register (contracts, right-to-work, certs, reviews)
-- mirroring D1/D2. Keyed by employee_name (timesheet employee store), with
-- the store id kept for reference. Files live in SharePoint under
-- BAMA / 03 - Employees / <Employee Name>.
-- NEW TABLE => no Function App restart. Idempotent.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'EmployeeDocuments')
BEGIN
    CREATE TABLE EmployeeDocuments (
        id                  INT IDENTITY(1,1) PRIMARY KEY,
        employee_name       NVARCHAR(120) NOT NULL,
        employee_ref        NVARCHAR(60)  NULL,       -- timesheet store id
        doc_type            NVARCHAR(30)  NOT NULL,   -- contract | rtw | cert | review | hs | other
        title               NVARCHAR(200) NOT NULL,
        doc_ref             NVARCHAR(100) NULL,
        issuer              NVARCHAR(150) NULL,
        issue_date          DATE          NULL,
        expiry_date         DATE          NULL,
        reminder_days       INT           NOT NULL DEFAULT 60,
        file_name           NVARCHAR(255) NULL,
        sharepoint_file_id  NVARCHAR(120) NULL,
        drive_id            NVARCHAR(140) NULL,
        web_url             NVARCHAR(1000) NULL,
        notes               NVARCHAR(MAX) NULL,
        is_archived         BIT NOT NULL DEFAULT 0,
        superseded_by       INT NULL,
        is_deleted          BIT NOT NULL DEFAULT 0,
        uploaded_by         NVARCHAR(120) NULL,
        created_at          DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at          DATETIME2 NULL
    );
    CREATE INDEX IX_EmployeeDocuments_Emp ON EmployeeDocuments (employee_name) WHERE is_deleted = 0;
    CREATE INDEX IX_EmployeeDocuments_Expiry ON EmployeeDocuments (expiry_date) WHERE is_deleted = 0 AND is_archived = 0;
    PRINT 'EmployeeDocuments created';
END
ELSE PRINT 'EmployeeDocuments already exists — no change';
SELECT COUNT(*) AS cols FROM sys.columns WHERE object_id = OBJECT_ID('EmployeeDocuments');

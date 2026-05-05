-- ─────────────────────────────────────────────────────────────────────────────
-- Project Tracker: site address + additional contacts + threaded comments
-- ─────────────────────────────────────────────────────────────────────────────
-- Run this on bama-erp before deploying the matching API + frontend changes.
-- Adds:
--   1. Nine site address / site contact columns on Projects (toggle defaults
--      to 1 = "site same as client", which means the site_* columns can stay
--      NULL and the UI falls back to the client address).
--   2. ProjectContacts — additional people on a project (site foremen,
--      surveyors, QSs etc.) that aren't on the client record.
--   3. ProjectComments — threaded comments, mirroring TenderComments.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Site address fields on Projects
ALTER TABLE Projects ADD site_same_as_client BIT NOT NULL DEFAULT 1;
ALTER TABLE Projects ADD site_address_line1  NVARCHAR(255) NULL;
ALTER TABLE Projects ADD site_address_line2  NVARCHAR(255) NULL;
ALTER TABLE Projects ADD site_city           NVARCHAR(100) NULL;
ALTER TABLE Projects ADD site_county         NVARCHAR(100) NULL;
ALTER TABLE Projects ADD site_postcode       NVARCHAR(20)  NULL;
ALTER TABLE Projects ADD site_contact_name   NVARCHAR(255) NULL;
ALTER TABLE Projects ADD site_contact_email  NVARCHAR(255) NULL;
ALTER TABLE Projects ADD site_contact_phone  NVARCHAR(50)  NULL;

-- 2. Additional contacts on a project
CREATE TABLE ProjectContacts (
    id INT IDENTITY(1,1) PRIMARY KEY,
    project_id INT NOT NULL,
    contact_name  NVARCHAR(255) NULL,
    contact_email NVARCHAR(255) NULL,
    contact_phone NVARCHAR(50)  NULL,
    role  NVARCHAR(100) NULL,                 -- free text: "Site foreman", "QS", etc.
    notes NVARCHAR(MAX) NULL,
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    updated_at DATETIME2 DEFAULT GETUTCDATE(),
    CONSTRAINT FK_ProjectContacts_Project
        FOREIGN KEY (project_id) REFERENCES Projects(id) ON DELETE CASCADE
);

CREATE INDEX IX_ProjectContacts_project_id ON ProjectContacts(project_id);

-- 3. Threaded comments on a project (mirrors TenderComments)
CREATE TABLE ProjectComments (
    id INT IDENTITY(1,1) PRIMARY KEY,
    project_id INT NOT NULL,
    comment NVARCHAR(MAX) NOT NULL,
    created_by NVARCHAR(255) NULL,
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    CONSTRAINT FK_ProjectComments_Project
        FOREIGN KEY (project_id) REFERENCES Projects(id) ON DELETE CASCADE
);

CREATE INDEX IX_ProjectComments_project_id ON ProjectComments(project_id);

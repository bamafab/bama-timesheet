-- Projects table — created from a Won quote, mirrors quote ref with C prefix
CREATE TABLE Projects (
    id INT IDENTITY(1,1) PRIMARY KEY,
    project_number NVARCHAR(20) NOT NULL,             -- e.g. C260502 (mirrors source quote Q260502)
    project_name NVARCHAR(255) NOT NULL,
    client_id INT NULL REFERENCES Clients(id),
    status NVARCHAR(20) DEFAULT 'In Progress',        -- In Progress, On Hold, Complete, Archived, Cancelled
    source_quote_id INT NULL REFERENCES Tenders(id),  -- the quote that won
    quote_value DECIMAL(12,2) NULL,                   -- carried over budget at conversion
    deadline_date DATE NULL,
    comments NVARCHAR(MAX) NULL,
    sharepoint_folder_id NVARCHAR(255) NULL,          -- Graph item ID for the project folder
    sharepoint_quote_folder_id NVARCHAR(255) NULL,    -- Graph item ID for the source quote folder (back-reference)
    project_manager_id INT NULL REFERENCES Employees(id),
    start_date DATE NULL,
    completion_date DATE NULL,
    created_by NVARCHAR(255) NULL,
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    updated_at DATETIME2 DEFAULT GETUTCDATE()
);

CREATE UNIQUE INDEX UX_Projects_project_number ON Projects(project_number);
CREATE INDEX IX_Projects_status ON Projects(status);
CREATE INDEX IX_Projects_client_id ON Projects(client_id);
CREATE INDEX IX_Projects_source_quote_id ON Projects(source_quote_id);

-- Add project permissions to UserPermissions
ALTER TABLE UserPermissions ADD view_projects BIT DEFAULT 0;
ALTER TABLE UserPermissions ADD edit_projects BIT DEFAULT 0;

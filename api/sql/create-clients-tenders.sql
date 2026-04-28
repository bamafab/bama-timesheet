-- Clients table
CREATE TABLE Clients (
    id INT IDENTITY(1,1) PRIMARY KEY,
    company_name NVARCHAR(255) NOT NULL,
    address_line1 NVARCHAR(255) NULL,
    address_line2 NVARCHAR(255) NULL,
    city NVARCHAR(100) NULL,
    county NVARCHAR(100) NULL,
    postcode NVARCHAR(20) NULL,
    contact_name NVARCHAR(255) NULL,
    contact_email NVARCHAR(255) NULL,
    contact_phone NVARCHAR(50) NULL,
    notes NVARCHAR(MAX) NULL,
    is_active BIT DEFAULT 1,
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    updated_at DATETIME2 DEFAULT GETUTCDATE()
);

CREATE UNIQUE INDEX UX_Clients_company_name ON Clients(company_name);

-- Tenders table
CREATE TABLE Tenders (
    id INT IDENTITY(1,1) PRIMARY KEY,
    reference NVARCHAR(20) NOT NULL,         -- e.g. Q260402
    client_id INT NOT NULL REFERENCES Clients(id),
    project_name NVARCHAR(255) NOT NULL,
    comments NVARCHAR(MAX) NULL,
    status NVARCHAR(20) DEFAULT 'tender',    -- tender, quote, won, lost, cancelled
    quote_handler_id INT NULL REFERENCES Employees(id),
    sharepoint_folder_id NVARCHAR(255) NULL, -- Graph item ID for the quote folder
    sharepoint_tender_folder_id NVARCHAR(255) NULL, -- Graph item ID for the 00-Tender subfolder
    created_by NVARCHAR(255) NULL,
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    updated_at DATETIME2 DEFAULT GETUTCDATE(),
    converted_at DATETIME2 NULL,             -- when status changed to 'quote'
    converted_by NVARCHAR(255) NULL
);

CREATE UNIQUE INDEX UX_Tenders_reference ON Tenders(reference);

-- Add tender/quote permissions to UserPermissions
ALTER TABLE UserPermissions ADD tenders BIT DEFAULT 0;
ALTER TABLE UserPermissions ADD edit_quotes BIT DEFAULT 0;
ALTER TABLE UserPermissions ADD view_quotes BIT DEFAULT 0;

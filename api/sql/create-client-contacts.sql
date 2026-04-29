-- ClientContacts table
CREATE TABLE ClientContacts (
    id INT IDENTITY(1,1) PRIMARY KEY,
    client_id INT NOT NULL REFERENCES Clients(id) ON DELETE CASCADE,
    contact_name NVARCHAR(255) NULL,
    contact_email NVARCHAR(255) NULL,
    contact_phone NVARCHAR(50) NULL,
    role NVARCHAR(255) NULL,
    notes NVARCHAR(MAX) NULL,
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    updated_at DATETIME2 DEFAULT GETUTCDATE()
);

CREATE INDEX IX_ClientContacts_client_id ON ClientContacts(client_id);

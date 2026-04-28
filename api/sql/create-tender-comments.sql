-- Tender Comments
CREATE TABLE TenderComments (
    id INT IDENTITY(1,1) PRIMARY KEY,
    tender_id INT NOT NULL REFERENCES Tenders(id) ON DELETE CASCADE,
    comment NVARCHAR(MAX) NOT NULL,
    created_by NVARCHAR(255) NULL,
    created_at DATETIME2 DEFAULT GETUTCDATE()
);

CREATE INDEX IX_TenderComments_tender_id ON TenderComments(tender_id);

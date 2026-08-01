-- create-document-acknowledgements.sql (Read-and-sign module, 2026-08-01)
-- One table serving two flavours of "someone opened a document the ERP produced
-- and signed it on their phone":
--   • RAMS  → legal sign-off. Each signer confirms "I have read & understood".
--             An acknowledgement REGISTER PDF is generated from these rows and
--             filed alongside the RAMS (context 'rams_ack').
--   • SDN/DN → goods-received acknowledgement (lighter; a receipt record).
-- The signature image lives in this row (base64 PNG) AND in any generated
-- register PDF; it is never sent back out in list responses (see the API).
-- NEW TABLE => no Function App restart. Idempotent.

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'DocumentAcknowledgements')
BEGIN
    CREATE TABLE DocumentAcknowledgements (
        id                 INT IDENTITY(1,1) PRIMARY KEY,
        doc_type           NVARCHAR(20)  NOT NULL,          -- 'rams' | 'sdn' | 'dn'
        doc_ref            NVARCHAR(200) NULL,              -- human ref/title of the document
        doc_file_id        NVARCHAR(120) NULL,              -- SharePoint driveItem id of the source PDF
        doc_web_url        NVARCHAR(1000) NULL,             -- link to the source PDF
        project_number     NVARCHAR(60)  NULL,              -- job/contract this belongs to
        job_id             INT           NULL,              -- DrawingJobs.id when known
        signer_name        NVARCHAR(160) NOT NULL,
        signer_company     NVARCHAR(160) NULL,              -- e.g. subcontractor firm
        statement          NVARCHAR(500) NULL,              -- the exact wording agreed to
        signature          NVARCHAR(MAX) NULL,              -- base64 PNG data URI of the finger signature
        acknowledged_at    DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
        acknowledged_by    NVARCHAR(160) NULL,              -- who operated the device (from token)
        register_file_id   NVARCHAR(120) NULL,              -- generated RAMS ack-register PDF (if any)
        register_web_url   NVARCHAR(1000) NULL,
        notes              NVARCHAR(1000) NULL,
        is_deleted         BIT NOT NULL DEFAULT 0,
        created_at         DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_DocAck_Project ON DocumentAcknowledgements (project_number) WHERE is_deleted = 0;
    CREATE INDEX IX_DocAck_Doc     ON DocumentAcknowledgements (doc_file_id)    WHERE is_deleted = 0;
    PRINT 'DocumentAcknowledgements created';
END
ELSE PRINT 'DocumentAcknowledgements already exists';

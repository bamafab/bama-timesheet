-- ─────────────────────────────────────────────────────────────────────────────
-- Tender Register — Schema migration (safe re-run version)
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. TenderAssignees ───────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TenderAssignees')
BEGIN
    CREATE TABLE TenderAssignees (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        full_name    NVARCHAR(200) NOT NULL,
        email        NVARCHAR(200) NOT NULL DEFAULT '',
        active       BIT           NOT NULL DEFAULT 1,
        sort_order   INT           NOT NULL DEFAULT 99,
        created_at   DATETIME2     NOT NULL DEFAULT GETUTCDATE()
    );

    INSERT INTO TenderAssignees (full_name, email, sort_order) VALUES
        ('Mateusz Braczyk',  'matt@bamafabrication.co.uk',  1),
        ('Andrew McDermid',  'macca@bamafabrication.co.uk', 2);
END

-- ─── 2. TenderRegister ───────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TenderRegister')
BEGIN
    CREATE TABLE TenderRegister (
        id                      INT IDENTITY(1,1) PRIMARY KEY,
        reference               NVARCHAR(20)      NOT NULL,
        client                  NVARCHAR(200)     NOT NULL DEFAULT '',
        project                 NVARCHAR(500)     NOT NULL DEFAULT '',
        contact_name            NVARCHAR(200)     NOT NULL DEFAULT '',
        contact_email           NVARCHAR(200)     NOT NULL DEFAULT '',
        contact_phone           NVARCHAR(100)     NOT NULL DEFAULT '',
        contact_job_title       NVARCHAR(200)     NOT NULL DEFAULT '',
        contact_skipped         BIT               NOT NULL DEFAULT 0,
        assigned_to             NVARCHAR(200)     NOT NULL DEFAULT '',
        deadline                DATE              NULL,
        date_received           DATE              NOT NULL,
        status                  NVARCHAR(20)      NOT NULL DEFAULT 'New',
        no_bid_reason           NVARCHAR(100)     NOT NULL DEFAULT '',
        sp_year_folder_id       NVARCHAR(200)     NULL,
        sp_tender_folder_id     NVARCHAR(200)     NULL,
        sp_subfolder_id         NVARCHAR(200)     NULL,
        sp_folder_url           NVARCHAR(1000)    NULL,
        qb_quote_id             INT               NULL REFERENCES QuoteBuilderQuotes(id),
        opened_in_qb_at         DATETIME2         NULL,
        opened_in_qb_by         NVARCHAR(200)     NULL,
        notes                   NVARCHAR(2000)    NOT NULL DEFAULT '',
        created_by              NVARCHAR(200)     NOT NULL DEFAULT '',
        created_at              DATETIME2         NOT NULL DEFAULT GETUTCDATE(),
        updated_at              DATETIME2         NOT NULL DEFAULT GETUTCDATE()
    );

    CREATE UNIQUE INDEX UX_TenderRegister_Reference
        ON TenderRegister (reference);

    CREATE INDEX IX_TenderRegister_Status
        ON TenderRegister (status, date_received DESC);

    CREATE INDEX IX_TenderRegister_AssignedTo
        ON TenderRegister (assigned_to, status);

    CREATE INDEX IX_TenderRegister_Deadline
        ON TenderRegister (deadline ASC)
        WHERE deadline IS NOT NULL;
END

-- ─── 3. TenderComments ───────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'TenderComments')
BEGIN
    CREATE TABLE TenderComments (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        tender_id    INT            NOT NULL REFERENCES TenderRegister(id) ON DELETE CASCADE,
        comment      NVARCHAR(2000) NOT NULL,
        author       NVARCHAR(200)  NOT NULL DEFAULT '',
        created_at   DATETIME2      NOT NULL DEFAULT GETUTCDATE()
    );

    CREATE INDEX IX_TenderComments_TenderId
        ON TenderComments (tender_id, created_at DESC);
END

-- ─────────────────────────────────────────────────────────────────────────────
-- Done. Restart the Function App after running this script.
-- ─────────────────────────────────────────────────────────────────────────────

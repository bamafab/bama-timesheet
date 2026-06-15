-- ─────────────────────────────────────────────────────────────────────────────
-- Tender Register — Schema migration
-- ─────────────────────────────────────────────────────────────────────────────
-- Run on bama-erp BEFORE deploying the API + frontend.
--
-- Creates:
--   1. TenderRegister        — one row per tender/enquiry received
--   2. TenderAssignees       — lookup table for estimator names
--   3. TenderComments        — activity log / notes per tender
--
-- Does NOT touch QuoteBuilderQuotes or any existing table.
-- ─────────────────────────────────────────────────────────────────────────────


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. TenderAssignees  (lookup — editable via admin, seeded below)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE TenderAssignees (
    id           INT IDENTITY(1,1) PRIMARY KEY,
    full_name    NVARCHAR(200) NOT NULL,
    email        NVARCHAR(200) NOT NULL DEFAULT '',
    active       BIT           NOT NULL DEFAULT 1,
    sort_order   INT           NOT NULL DEFAULT 99,
    created_at   DATETIME2     NOT NULL DEFAULT GETUTCDATE()
);

-- Seed initial assignees
INSERT INTO TenderAssignees (full_name, email, sort_order) VALUES
    ('Mateusz Braczyk',  'mateusz.braczyk@bamafab.co.uk',   1),
    ('Andrew McDermid',  'andrew.mcdermid@bamafab.co.uk',   2);


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. TenderRegister
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE TenderRegister (
    id                      INT IDENTITY(1,1) PRIMARY KEY,

    -- reference — same sequence as QB (e.g. Q26-001)
    reference               NVARCHAR(20)      NOT NULL,

    -- project info
    client                  NVARCHAR(200)     NOT NULL DEFAULT '',
    project                 NVARCHAR(500)     NOT NULL DEFAULT '',

    -- client contact (person who sent the enquiry)
    contact_name            NVARCHAR(200)     NOT NULL DEFAULT '',
    contact_email           NVARCHAR(200)     NOT NULL DEFAULT '',
    contact_phone           NVARCHAR(100)     NOT NULL DEFAULT '',
    contact_job_title       NVARCHAR(200)     NOT NULL DEFAULT '',
    contact_skipped         BIT               NOT NULL DEFAULT 0,  -- user chose "skip contact"

    -- assignment & dates
    assigned_to             NVARCHAR(200)     NOT NULL DEFAULT '',  -- full_name from TenderAssignees
    deadline                DATE              NULL,
    date_received           DATE              NOT NULL,

    -- status: New | In QB | No Bid
    status                  NVARCHAR(20)      NOT NULL DEFAULT 'New',
    no_bid_reason           NVARCHAR(100)     NOT NULL DEFAULT '',
    -- no_bid_reason values:
    --   Capacity / Too Busy | Out of Scope | Deadline Too Short
    --   Low Margin / High Risk | Poor Client History

    -- SharePoint folder links (tracked by ID so renames don't break links)
    sp_year_folder_id       NVARCHAR(200)     NULL,   -- e.g. "06 - 2026" folder ID
    sp_tender_folder_id     NVARCHAR(200)     NULL,   -- "Qxxxx - Client - Project" folder ID
    sp_subfolder_id         NVARCHAR(200)     NULL,   -- "00 - Tender" subfolder ID
    sp_folder_url           NVARCHAR(1000)    NULL,   -- direct web URL for "Open Folder" button

    -- QB link (set when "Open in QB" is clicked)
    qb_quote_id             INT               NULL REFERENCES QuoteBuilderQuotes(id),
    opened_in_qb_at         DATETIME2         NULL,
    opened_in_qb_by         NVARCHAR(200)     NULL,

    -- notes / description (free text)
    notes                   NVARCHAR(2000)    NOT NULL DEFAULT '',

    -- audit
    created_by              NVARCHAR(200)     NOT NULL DEFAULT '',
    created_at              DATETIME2         NOT NULL DEFAULT GETUTCDATE(),
    updated_at              DATETIME2         NOT NULL DEFAULT GETUTCDATE()
);

-- Unique reference
CREATE UNIQUE INDEX UX_TenderRegister_Reference
    ON TenderRegister (reference);

-- Dashboard filters
CREATE INDEX IX_TenderRegister_Status
    ON TenderRegister (status, date_received DESC);

CREATE INDEX IX_TenderRegister_AssignedTo
    ON TenderRegister (assigned_to, status);

CREATE INDEX IX_TenderRegister_Deadline
    ON TenderRegister (deadline ASC)
    WHERE deadline IS NOT NULL;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. TenderComments  (activity log per tender)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE TenderComments (
    id           INT IDENTITY(1,1) PRIMARY KEY,
    tender_id    INT           NOT NULL REFERENCES TenderRegister(id) ON DELETE CASCADE,
    comment      NVARCHAR(2000) NOT NULL,
    author       NVARCHAR(200) NOT NULL DEFAULT '',
    created_at   DATETIME2     NOT NULL DEFAULT GETUTCDATE()
);

CREATE INDEX IX_TenderComments_TenderId
    ON TenderComments (tender_id, created_at DESC);


-- ─────────────────────────────────────────────────────────────────────────────
-- Done. Restart the Function App after running this script.
-- ─────────────────────────────────────────────────────────────────────────────

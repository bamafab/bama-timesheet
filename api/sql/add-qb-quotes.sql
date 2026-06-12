-- ─────────────────────────────────────────────────────────────────────────────
-- Quote Builder integration — Schema migration
-- ─────────────────────────────────────────────────────────────────────────────
-- Run on bama-erp BEFORE deploying the API + frontend.
--
-- Creates:
--   1. QuoteBuilderQuotes   — one row per QB quote, queryable columns + full JSON blob
--   2. QuoteBuilderSnapshots — revision snapshot history per quote
--
-- Does NOT touch Tenders, Projects, QuoteLineItems or any existing table.
-- ─────────────────────────────────────────────────────────────────────────────

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. QuoteBuilderQuotes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE QuoteBuilderQuotes (
    id               INT IDENTITY(1,1) PRIMARY KEY,
    reference        NVARCHAR(20)      NOT NULL,
    revision         NVARCHAR(10)      NOT NULL DEFAULT '',
    status           NVARCHAR(20)      NOT NULL DEFAULT 'draft',
    -- status in: draft | sent | won | lost | cancelled

    -- key dates
    date_created     DATE              NOT NULL,
    date_sent        DATE              NULL,
    decision_due     DATE              NULL,
    valid_until      DATE              NULL,

    -- client / contact (denormalised — QB may not have a Clients row)
    company          NVARCHAR(200)     NOT NULL DEFAULT '',
    contact          NVARCHAR(200)     NOT NULL DEFAULT '',
    email            NVARCHAR(200)     NOT NULL DEFAULT '',
    phone            NVARCHAR(100)     NOT NULL DEFAULT '',
    site_address     NVARCHAR(500)     NOT NULL DEFAULT '',

    -- who prepared it
    prepared_by      NVARCHAR(200)     NOT NULL DEFAULT '',

    -- win/loss metadata
    loss_reason      NVARCHAR(100)     NOT NULL DEFAULT '',
    loss_competitor  NVARCHAR(200)     NOT NULL DEFAULT '',
    loss_comment     NVARCHAR(1000)    NOT NULL DEFAULT '',

    -- computed totals (written on every save — used for reports / dashboard)
    total_ex_vat     DECIMAL(12,2)     NULL,
    total_kg         DECIMAL(12,3)     NULL,
    margin_pct       DECIMAL(5,2)      NULL,
    cost_material    DECIMAL(12,2)     NULL,
    cost_installation DECIMAL(12,2)   NULL,
    cost_fabrication DECIMAL(12,2)    NULL,
    cost_design      DECIMAL(12,2)    NULL,
    cost_painting    DECIMAL(12,2)    NULL,
    cost_survey      DECIMAL(12,2)    NULL,
    cost_delivery    DECIMAL(12,2)    NULL,
    cost_prelims     DECIMAL(12,2)    NULL,

    -- SharePoint folder links
    sharepoint_folder_id        NVARCHAR(200) NULL,
    sharepoint_tender_folder_id NVARCHAR(200) NULL,

    -- linked project (set when Mark as Won creates a project)
    project_id       INT               NULL REFERENCES Projects(id),

    -- full quote-builder JSON blob (takeoff rows, labour rows, snapshots, etc.)
    quote_data       NVARCHAR(MAX)     NOT NULL DEFAULT '{}',

    -- audit
    created_by       NVARCHAR(200)     NOT NULL DEFAULT '',
    created_at       DATETIME2         NOT NULL DEFAULT GETUTCDATE(),
    updated_at       DATETIME2         NOT NULL DEFAULT GETUTCDATE()
);

-- Unique index — one row per reference+revision combo
CREATE UNIQUE INDEX UX_QBQuotes_RefRevision
    ON QuoteBuilderQuotes (reference, revision);

-- Fast lookup by status (dashboard filter)
CREATE INDEX IX_QBQuotes_Status
    ON QuoteBuilderQuotes (status, date_created DESC);

-- Fast lookup by reference (next-ref generation)
CREATE INDEX IX_QBQuotes_Reference
    ON QuoteBuilderQuotes (reference);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. QuoteBuilderSnapshots
-- ─────────────────────────────────────────────────────────────────────────────
-- Revision history snapshots — written automatically by QB on status changes
-- and manually via "Save Snapshot" button.
CREATE TABLE QuoteBuilderSnapshots (
    id               INT IDENTITY(1,1) PRIMARY KEY,
    quote_id         INT               NOT NULL REFERENCES QuoteBuilderQuotes(id) ON DELETE CASCADE,
    snapshot_ts      BIGINT            NOT NULL, -- JS Date.now() ms timestamp
    reason           NVARCHAR(100)     NOT NULL DEFAULT 'manual',
    revision_label   NVARCHAR(20)      NOT NULL DEFAULT '',
    status           NVARCHAR(20)      NOT NULL DEFAULT 'draft',
    data_snapshot    NVARCHAR(MAX)     NOT NULL DEFAULT '{}'
);

CREATE INDEX IX_QBSnapshots_QuoteId
    ON QuoteBuilderSnapshots (quote_id, snapshot_ts DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- Done. Restart the Function App after running this script.
-- ─────────────────────────────────────────────────────────────────────────────

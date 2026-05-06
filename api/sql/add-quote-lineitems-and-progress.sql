-- ─────────────────────────────────────────────────────────────────────────────
-- Quote Line Items + Multi-quote Projects + Per-line Progress
-- ─────────────────────────────────────────────────────────────────────────────
-- Run on bama-erp BEFORE deploying the matching API + frontend.
--
-- Adds:
--   1. QuoteLineItems — the 9 fixed line categories on every quote
--      (Prelims, Approval & Fab Pack, Survey, Material, Fabrication,
--       Painting, Galvanising, Installation, Delivery).
--   2. ProjectQuotes — link table allowing multiple quotes per project.
--      Backfilled from existing Projects.source_quote_id.
--   3. ProjectLineProgress — per-line % complete on each project.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. QuoteLineItems
CREATE TABLE QuoteLineItems (
    id INT IDENTITY(1,1) PRIMARY KEY,
    tender_id INT NOT NULL,
    line_no INT NOT NULL,                     -- 1..9, display order
    category NVARCHAR(50) NOT NULL,           -- 'prelims','approval_fab_pack','survey','material','fabrication','painting','galvanising','installation','delivery'
    description NVARCHAR(255) NOT NULL,
    quantity DECIMAL(10,2) NOT NULL DEFAULT 1,
    unit_price DECIMAL(12,2) NOT NULL DEFAULT 0,
    vat_applies BIT NOT NULL DEFAULT 1,        -- yes/no
    vat_rate DECIMAL(4,2) NOT NULL DEFAULT 20.00,
    is_labour BIT NOT NULL DEFAULT 0,          -- counts toward Labour Cost tile
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    updated_at DATETIME2 DEFAULT GETUTCDATE(),
    CONSTRAINT FK_QuoteLineItems_Tender
        FOREIGN KEY (tender_id) REFERENCES Tenders(id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX UX_QuoteLineItems_tender_line ON QuoteLineItems(tender_id, line_no);

-- 2. ProjectQuotes — multi-quote per project
CREATE TABLE ProjectQuotes (
    project_id INT NOT NULL,
    tender_id INT NOT NULL,
    is_primary BIT NOT NULL DEFAULT 0,         -- 1 = the original winning quote
    added_at DATETIME2 DEFAULT GETUTCDATE(),
    added_by NVARCHAR(255) NULL,
    PRIMARY KEY (project_id, tender_id),
    CONSTRAINT FK_ProjectQuotes_Project
        FOREIGN KEY (project_id) REFERENCES Projects(id) ON DELETE CASCADE,
    CONSTRAINT FK_ProjectQuotes_Tender
        FOREIGN KEY (tender_id) REFERENCES Tenders(id)
);
CREATE INDEX IX_ProjectQuotes_tender ON ProjectQuotes(tender_id);

-- Backfill: copy existing single-quote relationships into the link table.
-- The original winning quote is flagged is_primary = 1.
INSERT INTO ProjectQuotes (project_id, tender_id, is_primary, added_by)
SELECT id, source_quote_id, 1, 'system-backfill'
FROM Projects
WHERE source_quote_id IS NOT NULL;

-- 3. ProjectLineProgress — per-line % complete tracker
CREATE TABLE ProjectLineProgress (
    id INT IDENTITY(1,1) PRIMARY KEY,
    project_id INT NOT NULL,
    quote_line_item_id INT NOT NULL,
    percent_complete DECIMAL(5,2) NOT NULL DEFAULT 0,
    last_updated_by NVARCHAR(255) NULL,
    last_updated_at DATETIME2 DEFAULT GETUTCDATE(),
    CONSTRAINT FK_ProjectLineProgress_Project
        FOREIGN KEY (project_id) REFERENCES Projects(id) ON DELETE CASCADE,
    CONSTRAINT FK_ProjectLineProgress_QuoteLineItem
        FOREIGN KEY (quote_line_item_id) REFERENCES QuoteLineItems(id),
    CONSTRAINT CK_ProjectLineProgress_Range
        CHECK (percent_complete >= 0 AND percent_complete <= 100)
);
CREATE UNIQUE INDEX UX_ProjectLineProgress_proj_line
    ON ProjectLineProgress(project_id, quote_line_item_id);

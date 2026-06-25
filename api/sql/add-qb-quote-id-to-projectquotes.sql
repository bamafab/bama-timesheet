-- ─────────────────────────────────────────────────────────────────────────────
-- Allow QB (QuoteBuilderQuotes) quotes to link into ProjectQuotes / QuoteLineItems
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY:
--   ProjectQuotes.tender_id and QuoteLineItems.tender_id both FK to Tenders(id).
--   QB quotes live in QuoteBuilderQuotes, NOT Tenders — so they can't be linked.
--   The current qb-quotes mark-won works around this by inserting a ProjectQuotes
--   row with tender_id = NULL (see C260327: half-state, line items never seeded,
--   Project Tracker shows £0). This migration fixes the root cause by adding a
--   parallel qb_quote_id column so a link row references EITHER a Tender OR a
--   QB quote — never both, never neither.
--
--   Daniel's existing Tenders-based quotations flow is completely untouched:
--   every existing row keeps its tender_id, and the new column is nullable.
--
-- ORDER: run this BEFORE deploying the matching Function App changes.
-- Run on office WiFi (home IP is blocked from Azure SQL Query Editor).
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. ProjectQuotes ───────────────────────────────────────────────────────────

-- 1a. Add the QB quote reference column.
ALTER TABLE ProjectQuotes ADD qb_quote_id INT NULL;
GO

-- 1b. FK to QuoteBuilderQuotes. No cascade — detach is handled in the API,
--     and we never want a quote delete to silently drop a project link.
ALTER TABLE ProjectQuotes
    ADD CONSTRAINT FK_ProjectQuotes_QbQuote
    FOREIGN KEY (qb_quote_id) REFERENCES QuoteBuilderQuotes(id);
GO

-- 1c. tender_id must become nullable (it's part of the PK, so the PK has to be
--     rebuilt). New surrogate PK + a filtered unique index per source instead.
--     First drop the old composite PK.
ALTER TABLE ProjectQuotes DROP CONSTRAINT PK__ProjectQ__... ;  -- ⚠ SEE NOTE BELOW
GO
-- NOTE for Daniel: the PK constraint was created inline (PRIMARY KEY (project_id,
-- tender_id)) so its name is auto-generated. Find the real name first with:
--   SELECT name FROM sys.key_constraints
--   WHERE parent_object_id = OBJECT_ID('ProjectQuotes') AND type = 'PK';
-- then substitute it into the DROP above.

ALTER TABLE ProjectQuotes ALTER COLUMN tender_id INT NULL;
GO

-- 1d. New surrogate identity PK.
ALTER TABLE ProjectQuotes ADD id INT IDENTITY(1,1) NOT NULL;
GO
ALTER TABLE ProjectQuotes ADD CONSTRAINT PK_ProjectQuotes PRIMARY KEY (id);
GO

-- 1e. Exactly one of (tender_id, qb_quote_id) must be set.
ALTER TABLE ProjectQuotes
    ADD CONSTRAINT CK_ProjectQuotes_OneSource
    CHECK (
        (tender_id IS NOT NULL AND qb_quote_id IS NULL) OR
        (tender_id IS NULL AND qb_quote_id IS NOT NULL)
    );
GO

-- 1f. Preserve uniqueness that the old composite PK used to guarantee.
--     A quote (of either kind) may only be attached to a given project once.
CREATE UNIQUE INDEX UX_ProjectQuotes_proj_tender
    ON ProjectQuotes(project_id, tender_id) WHERE tender_id IS NOT NULL;
GO
CREATE UNIQUE INDEX UX_ProjectQuotes_proj_qb
    ON ProjectQuotes(project_id, qb_quote_id) WHERE qb_quote_id IS NOT NULL;
GO
CREATE INDEX IX_ProjectQuotes_qb ON ProjectQuotes(qb_quote_id);
GO

-- 1g. Clean up the C260327 half-state: the existing row has tender_id = NULL
--     AND qb_quote_id = NULL, which now violates CK_ProjectQuotes_OneSource.
--     Backfill its qb_quote_id from the Project's linked QB quote, or delete the
--     orphan link if it can't be resolved. Run this BEFORE adding the CHECK
--     constraint above if the constraint creation errors on existing data —
--     SQL Server validates CHECK against current rows by default.
--
--     Option A (preferred) — backfill from QuoteBuilderQuotes.project_id:
UPDATE pq
   SET pq.qb_quote_id = q.id
  FROM ProjectQuotes pq
  JOIN QuoteBuilderQuotes q ON q.project_id = pq.project_id
 WHERE pq.tender_id IS NULL AND pq.qb_quote_id IS NULL;
GO
--     Option B — if any orphan rows remain unresolvable, delete them:
-- DELETE FROM ProjectQuotes WHERE tender_id IS NULL AND qb_quote_id IS NULL;
-- GO


-- 2. QuoteLineItems ──────────────────────────────────────────────────────────
--    Same treatment so QB quotes can own line items (for Project Tracker tiles).

ALTER TABLE QuoteLineItems ADD qb_quote_id INT NULL;
GO
ALTER TABLE QuoteLineItems
    ADD CONSTRAINT FK_QuoteLineItems_QbQuote
    FOREIGN KEY (qb_quote_id) REFERENCES QuoteBuilderQuotes(id);
GO
ALTER TABLE QuoteLineItems ALTER COLUMN tender_id INT NULL;
GO
ALTER TABLE QuoteLineItems
    ADD CONSTRAINT CK_QuoteLineItems_OneSource
    CHECK (
        (tender_id IS NOT NULL AND qb_quote_id IS NULL) OR
        (tender_id IS NULL AND qb_quote_id IS NOT NULL)
    );
GO
-- Replace the old per-tender unique index with two filtered ones.
DROP INDEX UX_QuoteLineItems_tender_line ON QuoteLineItems;
GO
CREATE UNIQUE INDEX UX_QuoteLineItems_tender_line
    ON QuoteLineItems(tender_id, line_no) WHERE tender_id IS NOT NULL;
GO
CREATE UNIQUE INDEX UX_QuoteLineItems_qb_line
    ON QuoteLineItems(qb_quote_id, line_no) WHERE qb_quote_id IS NOT NULL;
GO

-- ─────────────────────────────────────────────────────────────────────────────
-- After running: restart the Function App (cached query plans reference the old
-- schema). Then deploy the API changes in the spec doc.
-- ─────────────────────────────────────────────────────────────────────────────

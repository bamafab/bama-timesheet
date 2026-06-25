-- ─────────────────────────────────────────────────────────────────────────────
-- Allow QB (QuoteBuilderQuotes) quotes to link into ProjectQuotes / QuoteLineItems
-- ─────────────────────────────────────────────────────────────────────────────
-- WHY:
--   ProjectQuotes.tender_id and QuoteLineItems.tender_id both FK to Tenders(id).
--   QB quotes live in QuoteBuilderQuotes, NOT Tenders — so they couldn't be linked.
--   The old qb-quotes mark-won worked around it by inserting a ProjectQuotes row
--   with tender_id = NULL. This migration fixes the root cause: a link row now
--   references EITHER a Tender OR a QB quote (qb_quote_id), never both/neither.
--
--   Daniel's Tenders-based quotations flow is untouched — existing rows keep
--   their tender_id; the new column is nullable.
--
-- STATUS: RUN ON PROD 2026-06-25. Executed clean, 0 errors.
--   Inspection beforehand confirmed: no orphan (tender_id IS NULL) rows existed,
--   so no backfill/cleanup was needed. Real composite-PK name at run time was
--   PK__ProjectQ__0D894EE6A41708E9.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── ProjectQuotes ────────────────────────────────────────────────────────────
ALTER TABLE ProjectQuotes ADD qb_quote_id INT NULL;
GO
ALTER TABLE ProjectQuotes
    ADD CONSTRAINT FK_ProjectQuotes_QbQuote
    FOREIGN KEY (qb_quote_id) REFERENCES QuoteBuilderQuotes(id);
GO

-- Drop the old composite PK so tender_id can become nullable.
-- NB the PK was created inline so its name is auto-generated; find it first with:
--   SELECT name FROM sys.key_constraints
--   WHERE parent_object_id = OBJECT_ID('ProjectQuotes') AND type = 'PK';
-- (was PK__ProjectQ__0D894EE6A41708E9 on prod 2026-06-25)
ALTER TABLE ProjectQuotes DROP CONSTRAINT PK__ProjectQ__0D894EE6A41708E9;
GO
ALTER TABLE ProjectQuotes ALTER COLUMN tender_id INT NULL;
GO

-- New surrogate identity PK
ALTER TABLE ProjectQuotes ADD id INT IDENTITY(1,1) NOT NULL;
GO
ALTER TABLE ProjectQuotes ADD CONSTRAINT PK_ProjectQuotes PRIMARY KEY (id);
GO

-- Exactly one source: a Tender OR a QB quote, never both, never neither
ALTER TABLE ProjectQuotes
    ADD CONSTRAINT CK_ProjectQuotes_OneSource
    CHECK (
        (tender_id IS NOT NULL AND qb_quote_id IS NULL) OR
        (tender_id IS NULL AND qb_quote_id IS NOT NULL)
    );
GO

-- Preserve the uniqueness the old composite PK guaranteed
CREATE UNIQUE INDEX UX_ProjectQuotes_proj_tender
    ON ProjectQuotes(project_id, tender_id) WHERE tender_id IS NOT NULL;
GO
CREATE UNIQUE INDEX UX_ProjectQuotes_proj_qb
    ON ProjectQuotes(project_id, qb_quote_id) WHERE qb_quote_id IS NOT NULL;
GO
CREATE INDEX IX_ProjectQuotes_qb ON ProjectQuotes(qb_quote_id);
GO

-- ── QuoteLineItems ───────────────────────────────────────────────────────────
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
DROP INDEX UX_QuoteLineItems_tender_line ON QuoteLineItems;
GO
CREATE UNIQUE INDEX UX_QuoteLineItems_tender_line
    ON QuoteLineItems(tender_id, line_no) WHERE tender_id IS NOT NULL;
GO
CREATE UNIQUE INDEX UX_QuoteLineItems_qb_line
    ON QuoteLineItems(qb_quote_id, line_no) WHERE qb_quote_id IS NOT NULL;
GO

-- After running: restart the Function App (cached query plans). Then deploy the
-- API changes in docs/qb-attach-existing-project-spec.md.

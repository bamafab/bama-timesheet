-- Babcock Quotes — full-lifecycle workflow expansion.
--
-- The original Babcock tracker had four statuses (Quote Sent → PO Received
-- → Invoice Generated → Paid). The new workflow tracks the full lifecycle
-- through to Bama SW invoicing. Nine statuses, with extra columns to
-- capture each stage's data.
--
-- New status flow:
--   Quote Received → Quote Sent → Live Project → Project Complete →
--   Approved to Pay → Payment Received → Sent to Bama SW →
--   Bama SW Awaiting Payment
--
-- Plus columns for each stage's payload (customer email, COUPA invoice
-- details, Bama SW invoice details, etc.).
--
-- Idempotent: every ADD is gated on sys.columns lookup. Safe to re-run.
-- Existing rows with old status values are migrated to nearest equivalents.

-- ── 1. Customer email (captured from spreadsheet at upload time) ──
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.BabcockQuotes') AND name = 'customer_email')
BEGIN
    ALTER TABLE dbo.BabcockQuotes ADD customer_email NVARCHAR(255) NULL;
END

-- ── 2. Client PO captured at "Convert to Project" ──
-- NOTE: existing po_number column was used for the old "PO Received" status.
-- It now serves the same purpose at the "Convert to Project" step (still
-- the client's PO). We keep the column name for backwards compatibility
-- with existing rows; new code uses it for the same logical thing.
-- No-op for po_number (already exists).

-- ── 3. Linked project ID (back-reference once converted) ──
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.BabcockQuotes') AND name = 'linked_project_id')
BEGIN
    ALTER TABLE dbo.BabcockQuotes ADD linked_project_id INT NULL;
    -- FK added separately below so the column add can succeed even if
    -- Projects table was created in a different deployment slot.
END

IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE name = 'FK_BabcockQuotes_LinkedProject'
)
AND EXISTS (SELECT 1 FROM sys.tables WHERE name = 'Projects')
BEGIN
    ALTER TABLE dbo.BabcockQuotes
        ADD CONSTRAINT FK_BabcockQuotes_LinkedProject
        FOREIGN KEY (linked_project_id) REFERENCES dbo.Projects(id);
END

-- ── 4. COUPA approved-invoice fields (step 5) ──
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.BabcockQuotes') AND name = 'coupa_invoice_pdf_url')
BEGIN
    ALTER TABLE dbo.BabcockQuotes ADD coupa_invoice_pdf_url NVARCHAR(MAX) NULL;
END

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.BabcockQuotes') AND name = 'coupa_invoice_pdf_id')
BEGIN
    ALTER TABLE dbo.BabcockQuotes ADD coupa_invoice_pdf_id NVARCHAR(255) NULL;
END

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.BabcockQuotes') AND name = 'coupa_invoice_number')
BEGIN
    ALTER TABLE dbo.BabcockQuotes ADD coupa_invoice_number NVARCHAR(100) NULL;
END

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.BabcockQuotes') AND name = 'coupa_invoice_due_date')
BEGIN
    ALTER TABLE dbo.BabcockQuotes ADD coupa_invoice_due_date DATE NULL;
END

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.BabcockQuotes') AND name = 'coupa_invoice_gross_total')
BEGIN
    ALTER TABLE dbo.BabcockQuotes ADD coupa_invoice_gross_total DECIMAL(18, 2) NULL;
END

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.BabcockQuotes') AND name = 'coupa_po_ref')
BEGIN
    ALTER TABLE dbo.BabcockQuotes ADD coupa_po_ref NVARCHAR(100) NULL;
END

-- ── 5. Payment received timestamp (step 6) ──
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.BabcockQuotes') AND name = 'payment_received_at')
BEGIN
    ALTER TABLE dbo.BabcockQuotes ADD payment_received_at DATETIME2 NULL;
END

-- ── 6. Bama SW invoice fields (steps 7–8) ──
IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.BabcockQuotes') AND name = 'bama_sw_invoice_pdf_url')
BEGIN
    ALTER TABLE dbo.BabcockQuotes ADD bama_sw_invoice_pdf_url NVARCHAR(MAX) NULL;
END

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.BabcockQuotes') AND name = 'bama_sw_invoice_pdf_id')
BEGIN
    ALTER TABLE dbo.BabcockQuotes ADD bama_sw_invoice_pdf_id NVARCHAR(255) NULL;
END

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.BabcockQuotes') AND name = 'bama_sw_invoice_number')
BEGIN
    ALTER TABLE dbo.BabcockQuotes ADD bama_sw_invoice_number NVARCHAR(50) NULL;
END

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.BabcockQuotes') AND name = 'bama_sw_po_number')
BEGIN
    ALTER TABLE dbo.BabcockQuotes ADD bama_sw_po_number NVARCHAR(100) NULL;
END

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.BabcockQuotes') AND name = 'bama_sw_invoice_due_date')
BEGIN
    ALTER TABLE dbo.BabcockQuotes ADD bama_sw_invoice_due_date DATE NULL;
END

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('dbo.BabcockQuotes') AND name = 'bama_sw_invoice_sent_at')
BEGIN
    ALTER TABLE dbo.BabcockQuotes ADD bama_sw_invoice_sent_at DATETIME2 NULL;
END

-- ── 7. Index on linked_project_id for back-reference lookups ──
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_BabcockQuotes_linked_project_id'
    AND object_id = OBJECT_ID('dbo.BabcockQuotes')
)
BEGIN
    CREATE INDEX IX_BabcockQuotes_linked_project_id
        ON dbo.BabcockQuotes(linked_project_id);
END

-- ── 8. Projects table — add source_babcock_quote_id for back-reference ──
-- Projects can come from a Tender (existing source_quote_id) OR a Babcock
-- quote (new source_babcock_quote_id). Both nullable; for any given row
-- exactly one should be populated.
IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.Projects') AND name = 'source_babcock_quote_id'
)
BEGIN
    ALTER TABLE dbo.Projects ADD source_babcock_quote_id INT NULL;
END

IF NOT EXISTS (
    SELECT 1 FROM sys.foreign_keys
    WHERE name = 'FK_Projects_SourceBabcockQuote'
)
BEGIN
    ALTER TABLE dbo.Projects
        ADD CONSTRAINT FK_Projects_SourceBabcockQuote
        FOREIGN KEY (source_babcock_quote_id) REFERENCES dbo.BabcockQuotes(id);
END

IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'IX_Projects_source_babcock_quote_id'
    AND object_id = OBJECT_ID('dbo.Projects')
)
BEGIN
    CREATE INDEX IX_Projects_source_babcock_quote_id
        ON dbo.Projects(source_babcock_quote_id);
END

-- ── 9. Migrate any existing rows on old statuses to the new equivalents ──
-- Old → New mapping:
--   Quote Sent         → Quote Sent          (unchanged)
--   PO Received        → Live Project        (work was kicked off)
--   Invoice Generated  → Approved to Pay     (invoice raised, awaiting payment)
--   Paid               → Payment Received    (closest terminal-equivalent)
-- Anything else is left alone — safest default.
UPDATE dbo.BabcockQuotes
   SET status = 'Live Project'
 WHERE status = 'PO Received';

UPDATE dbo.BabcockQuotes
   SET status = 'Approved to Pay'
 WHERE status = 'Invoice Generated';

UPDATE dbo.BabcockQuotes
   SET status = 'Payment Received'
 WHERE status = 'Paid';

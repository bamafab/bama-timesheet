-- Babcock Quotes: add original_quote_ref + po_number
--
-- original_quote_ref: the QP###### reference from cell E3 of the
-- Bama South West template. We don't print it on the customer-facing
-- PDF (that uses the BAMA B#### sequence) but we keep it on the
-- record so it's traceable back to the source spreadsheet.
--
-- po_number: the customer purchase order number, captured when the
-- quote moves to status 'PO Received'. Required for status advance to
-- that stage; later used to generate invoices against the PO.
--
-- Both nullable. Existing rows are unaffected (NULL for both).
-- Idempotent: each ADD is gated on sys.columns lookup.

IF NOT EXISTS (
    SELECT 1
    FROM   sys.columns
    WHERE  object_id = OBJECT_ID('dbo.BabcockQuotes')
    AND    name      = 'original_quote_ref'
)
BEGIN
    ALTER TABLE dbo.BabcockQuotes
        ADD original_quote_ref NVARCHAR(50) NULL;
END

IF NOT EXISTS (
    SELECT 1
    FROM   sys.columns
    WHERE  object_id = OBJECT_ID('dbo.BabcockQuotes')
    AND    name      = 'po_number'
)
BEGIN
    ALTER TABLE dbo.BabcockQuotes
        ADD po_number NVARCHAR(100) NULL;
END

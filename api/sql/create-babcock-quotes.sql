-- Babcock Quotes Tracker
-- Stores quotes generated from uploaded Babcock pricing schedules.
-- Single client (Babcock International), so no client_id link.

CREATE TABLE BabcockQuotes (
    id              INT IDENTITY(1,1) PRIMARY KEY,
    quote_ref       NVARCHAR(20)   NOT NULL,
    date_sent       DATE           NULL,
    total_value     DECIMAL(18, 2) NULL,
    markup_pct      DECIMAL(5, 2)  NULL,           -- e.g. 10.00 for 10%
    line_items      NVARCHAR(MAX)  NULL,            -- JSON: [{description, quantity, unit, unitPrice, total, ourPrice}, ...]
    source_filename NVARCHAR(500)  NULL,
    status          NVARCHAR(50)   NOT NULL DEFAULT 'Quote Sent',
                    -- Allowed: 'Quote Sent', 'PO Received', 'Invoice Generated', 'Paid'
    created_by      NVARCHAR(255)  NULL,
    created_at      DATETIME2      NOT NULL DEFAULT GETUTCDATE(),
    updated_at      DATETIME2      NOT NULL DEFAULT GETUTCDATE()
);

-- Reference must be unique
CREATE UNIQUE INDEX UX_BabcockQuotes_quote_ref ON BabcockQuotes(quote_ref);

-- Tracker list will sort/filter by these
CREATE INDEX IX_BabcockQuotes_status      ON BabcockQuotes(status);
CREATE INDEX IX_BabcockQuotes_created_at  ON BabcockQuotes(created_at DESC);

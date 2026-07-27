-- Per-client VAT treatment + payment terms for sales invoicing.
--   vat_treatment: 'reverse_charge' (CIS domestic reverse charge — the
--                  default, most AFP main contractors), 'standard' (20%
--                  VAT added), 'zero' (no VAT shown at all).
--   payment_terms_days: drives auto due_date = invoice_date + N days.
-- NOTE: ADD COLUMN migration → Function App restart required after running.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Clients') AND name = 'vat_treatment')
    ALTER TABLE Clients ADD vat_treatment NVARCHAR(20) NOT NULL DEFAULT 'reverse_charge';

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('Clients') AND name = 'payment_terms_days')
    ALTER TABLE Clients ADD payment_terms_days INT NOT NULL DEFAULT 30;

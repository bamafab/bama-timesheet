-- Migration: add Applications.certificate_final_payment_date — the payment
-- notice's "Final Date for payment". When present, generate-invoice uses it
-- as the invoice due_date instead of client payment terms (2026-08-17).
-- Safe to run more than once.
SET NOCOUNT ON;

IF NOT EXISTS (
    SELECT 1 FROM sys.columns
    WHERE object_id = OBJECT_ID('dbo.Applications')
      AND name = 'certificate_final_payment_date'
)
BEGIN
    ALTER TABLE dbo.Applications ADD certificate_final_payment_date DATE NULL;
    PRINT 'Added Applications.certificate_final_payment_date';
END
ELSE
    PRINT 'Applications.certificate_final_payment_date already exists — nothing to do';

-- Babcock workflow: new columns for the revised post-payment flow
-- Run against bama-erp database in Azure portal Query Editor
-- Adds columns for: PO to Bama SW, received invoice, payment date

ALTER TABLE BabcockQuotes
  ADD bama_sw_po_pdf_url                NVARCHAR(500)  NULL,
      bama_sw_po_pdf_id                 NVARCHAR(200)  NULL,
      bama_sw_received_invoice_number   NVARCHAR(100)  NULL,
      bama_sw_received_invoice_amount   DECIMAL(10,2)  NULL,
      bama_sw_received_invoice_pdf_url  NVARCHAR(500)  NULL,
      bama_sw_received_invoice_pdf_id   NVARCHAR(200)  NULL,
      bama_sw_paid_at                   DATETIME2      NULL;

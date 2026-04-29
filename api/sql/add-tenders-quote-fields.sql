-- Add quote-specific fields to Tenders table
-- Run once against bama-erp database
ALTER TABLE Tenders ADD quote_value DECIMAL(12,2) NULL;
ALTER TABLE Tenders ADD sent_date DATE NULL;
ALTER TABLE Tenders ADD chasing_date DATE NULL;

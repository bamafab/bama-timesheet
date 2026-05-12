-- Add parse_source_text to Suppliers
-- Stores the original pasted text used when a supplier was created via
-- the "Parse from quote" feature. Used as few-shot examples in future
-- parse calls — the more confirmed parsings exist, the better the extraction.
-- Run against bama-erp via Azure Portal Query Editor
-- 2026-05-12

ALTER TABLE Suppliers
    ADD parse_source_text NVARCHAR(MAX);

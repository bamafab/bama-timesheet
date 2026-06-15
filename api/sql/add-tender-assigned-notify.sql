-- Add assigned_to_id and notification tracking to Tenders
-- Run via Azure portal Query Editor against bama-erp database
-- After running: restart the Function App (portal → bama-erp-api → Restart)

ALTER TABLE Tenders
ADD assigned_to_id INT NULL,
    notified_at    DATETIME NULL,
    notified_by    NVARCHAR(100) NULL;

-- Optional FK (soft — don't add REFERENCES so deleting an employee doesn't break tenders)
-- Verify
SELECT column_name, data_type
FROM INFORMATION_SCHEMA.COLUMNS
WHERE table_name = 'Tenders'
  AND column_name IN ('assigned_to_id', 'notified_at', 'notified_by');

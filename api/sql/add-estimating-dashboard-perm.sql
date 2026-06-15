-- Add estimating_dashboard permission column to UserPermissions
-- Run via Azure portal Query Editor against bama-erp database
-- After running: restart the Function App (portal → bama-erp-api → Restart)

ALTER TABLE UserPermissions
ADD estimating_dashboard BIT NOT NULL DEFAULT 0;

-- Verify
SELECT column_name, data_type, column_default
FROM INFORMATION_SCHEMA.COLUMNS
WHERE table_name = 'UserPermissions' AND column_name = 'estimating_dashboard';

-- Add pay_type and carryover_days to Employees table
-- Run once against bama-erp database
ALTER TABLE Employees ADD pay_type NVARCHAR(10) NOT NULL DEFAULT 'payee';
ALTER TABLE Employees ADD carryover_days DECIMAL(4,1) NOT NULL DEFAULT 0;

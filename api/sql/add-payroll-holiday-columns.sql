-- Add holiday pay columns to PayrollArchive
-- Run once against bama-erp database
--
-- See docs/SPEC-holiday-payroll.md for context.
-- Booked holiday (paid type='paid' or 'half') and bank holiday are stored
-- separately so future reporting can distinguish them. The live payroll table
-- and archive view sum them into a single HOL column for display.
ALTER TABLE PayrollArchive ADD holiday_hours      DECIMAL(6,2)  NOT NULL DEFAULT 0;
ALTER TABLE PayrollArchive ADD holiday_pay        DECIMAL(10,2) NOT NULL DEFAULT 0;
ALTER TABLE PayrollArchive ADD bank_holiday_hours DECIMAL(6,2)  NOT NULL DEFAULT 0;
ALTER TABLE PayrollArchive ADD bank_holiday_pay   DECIMAL(10,2) NOT NULL DEFAULT 0;

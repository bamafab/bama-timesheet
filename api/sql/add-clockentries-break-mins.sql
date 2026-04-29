-- Add break_mins to ClockEntries table
-- Run once against bama-erp database
ALTER TABLE ClockEntries ADD break_mins INT NOT NULL DEFAULT 0;

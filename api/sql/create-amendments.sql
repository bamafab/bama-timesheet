-- ClockingAmendments table
-- Stores amendment requests submitted by employees from the kiosk
CREATE TABLE ClockingAmendments (
    id            INT IDENTITY(1,1) PRIMARY KEY,
    clocking_id   INT NOT NULL REFERENCES ClockEntries(id) ON DELETE CASCADE,
    employee_id   INT NOT NULL REFERENCES Employees(id),
    clocking_date DATE NOT NULL,
    original_in   NVARCHAR(5) NULL,   -- HH:MM display string stored as submitted
    original_out  NVARCHAR(5) NULL,
    requested_in  NVARCHAR(5) NULL,   -- null = no change requested
    requested_out NVARCHAR(5) NULL,
    reason        NVARCHAR(1000) NOT NULL,
    status        NVARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending, approved, rejected
    resolved_by   NVARCHAR(255) NULL,
    resolved_at   DATETIME2 NULL,
    submitted_at  DATETIME2 NOT NULL DEFAULT GETUTCDATE()
);

CREATE INDEX IX_ClockingAmendments_clocking_id ON ClockingAmendments(clocking_id);
CREATE INDEX IX_ClockingAmendments_employee_id ON ClockingAmendments(employee_id);
CREATE INDEX IX_ClockingAmendments_status      ON ClockingAmendments(status);

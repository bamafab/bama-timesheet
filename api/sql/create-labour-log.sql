-- LabourLog — the locked audit record of approved hours, fed from ProjectHours
-- when the office syncs a week. Replaces the legacy SharePoint
-- "PROJECT TRACKER.xlsx → Labour Log / Unproductive Time" sheets.
--
-- Hierarchy:
--   ClockEntries  (raw kiosk events, never deleted)
--     ↓
--   ProjectHours  (per-day-per-project breakdown, editable by office)
--     ↓
--   LabourLog     (locked snapshot at sync time — this table)
--
-- Idempotency: each ProjectHours row maps to at most one LabourLog row, via
-- UNIQUE(project_hours_id). On re-sync, the API performs an UPSERT — existing
-- rows are refreshed in-place (handles the case where the office edits a
-- ProjectHours row after the initial sync). Snapshot fields (employee_name,
-- project_name) are preserved even if the source records are later renamed.
--
-- Both productive (S1xxx, C-prefix) and unproductive (S000, WGD) hours live
-- in this single table, distinguished by entry_type. The legacy spreadsheet
-- split them across two sheets — we don't need to.

CREATE TABLE LabourLog (
    id                  INT IDENTITY(1,1) PRIMARY KEY,
    project_hours_id    INT NOT NULL,                      -- FK + idempotency key
    entry_date          DATE NOT NULL,                     -- the day worked
    week_commencing     DATE NOT NULL,                     -- Monday of that week
    employee_id         INT NULL,
    employee_name       NVARCHAR(255) NOT NULL,            -- snapshot
    project_number      NVARCHAR(20) NOT NULL,             -- 'S1988', 'S000', 'WGD', etc.
    project_name        NVARCHAR(500) NULL,                -- snapshot at sync time
    hours               DECIMAL(6,2) NOT NULL,
    entry_type          NVARCHAR(20) NOT NULL DEFAULT 'productive', -- 'productive' | 'unproductive'
    source              NVARCHAR(50) NOT NULL DEFAULT 'Timesheet App',
    synced_at           DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    synced_by           NVARCHAR(255) NULL,
    created_at          DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    updated_at          DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME(),
    CONSTRAINT FK_LabourLog_ProjectHours FOREIGN KEY (project_hours_id)
        REFERENCES ProjectHours(id) ON DELETE CASCADE
);

-- One LabourLog row per ProjectHours row — enforces idempotency at the DB level.
CREATE UNIQUE INDEX UX_LabourLog_project_hours_id
    ON LabourLog(project_hours_id);

-- Common query patterns:
--   "Total labour cost for project X" → filter by project_number, sum hours
--   "Hours logged by employee Y in week Z" → filter by employee_id + week_commencing
--   "All labour activity in date range" → filter by entry_date
CREATE INDEX IX_LabourLog_project_number ON LabourLog(project_number, entry_date);
CREATE INDEX IX_LabourLog_employee_week  ON LabourLog(employee_id, week_commencing);
CREATE INDEX IX_LabourLog_entry_date     ON LabourLog(entry_date);
CREATE INDEX IX_LabourLog_entry_type     ON LabourLog(entry_type);

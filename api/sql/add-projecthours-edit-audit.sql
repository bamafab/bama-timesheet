-- Audit trail for employee-edited project hours.
--
-- Background: when an employee edits an existing logged hours entry from the
-- kiosk (e.g. "I forgot I also did 1h on this project"), they can now type a
-- reason. Without these columns, the reason was set in local JS state only and
-- vanished on refresh. The manager can't tell why an entry was amended.
--
-- After this migration:
--   edit_reason   — free-text reason the employee gave for the change
--   edited_at     — UTC timestamp of when the edit was submitted
--   edited_by     — name of the person who submitted the edit (employee or manager)
-- Approval state already exists via is_approved (added separately).
--
-- Idempotent: safe to run multiple times. Each ALTER is guarded by a check.

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('ProjectHours') AND name = 'edit_reason')
    ALTER TABLE ProjectHours ADD edit_reason NVARCHAR(1000) NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('ProjectHours') AND name = 'edited_at')
    ALTER TABLE ProjectHours ADD edited_at DATETIME2 NULL;

IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('ProjectHours') AND name = 'edited_by')
    ALTER TABLE ProjectHours ADD edited_by NVARCHAR(255) NULL;

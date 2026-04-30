-- Prevent duplicate ProjectHours entries from double-clicks, retries, or race conditions.
--
-- Background: submitDay() in shared.js POSTs each entry individually with no dedup.
-- A double-click on Submit, a network retry, or two tabs submitting simultaneously
-- could each create the same row. The S000 cleanup in finishClockOut/saveEditEntry
-- only deletes from local state — old DB rows pile up forever.
--
-- This unique index makes accidental duplicates impossible at the DB level. The
-- API will get a constraint-violation error, and the frontend already has try/catch
-- around the POST to show a user-facing toast.
--
-- Note: this allows a single (employee, project, date) row only. If we ever need
-- multiple rows per day for the same project (e.g. split shifts), drop this index
-- and switch to (employee, project, date, sequence) or use a SUM at read time.

-- First, deduplicate existing data (keep oldest row per group, sum the hours into it)
;WITH dupes AS (
    SELECT id, employee_id, project_number, date, hours,
           ROW_NUMBER() OVER (PARTITION BY employee_id, project_number, date ORDER BY id) AS rn,
           SUM(hours) OVER (PARTITION BY employee_id, project_number, date) AS total_hours
    FROM ProjectHours
)
UPDATE ph SET ph.hours = dupes.total_hours
FROM ProjectHours ph
JOIN dupes ON dupes.id = ph.id
WHERE dupes.rn = 1;

DELETE FROM ProjectHours
WHERE id IN (
    SELECT id FROM (
        SELECT id, ROW_NUMBER() OVER (PARTITION BY employee_id, project_number, date ORDER BY id) AS rn
        FROM ProjectHours
    ) x WHERE rn > 1
);

CREATE UNIQUE INDEX UX_ProjectHours_emp_proj_date
    ON ProjectHours(employee_id, project_number, date);

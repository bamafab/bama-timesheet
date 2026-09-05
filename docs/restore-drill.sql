-- ─────────────────────────────────────────────────────────────────────────────
-- docs/restore-drill.sql — run against BOTH bama-erp-restore-test and bama-erp
-- (Azure portal Query Editor, office WiFi). The restored copy must equal live
-- minus whatever landed after the chosen restore point. See CLAUDE.md
-- "Backups & recovery". Read-only.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT DB_NAME()                                              AS database_name,
       SYSUTCDATETIME()                                       AS queried_at_utc,
       (SELECT COUNT(*)            FROM Projects)             AS projects_rows,
       (SELECT MAX(id)             FROM Projects)             AS projects_max_id,
       (SELECT MAX(updated_at)     FROM Projects)             AS projects_last_update,
       (SELECT COUNT(*)            FROM Invoices)             AS invoices_rows,
       (SELECT MAX(id)             FROM Invoices)             AS invoices_max_id,
       (SELECT MAX(ref)            FROM Invoices)             AS invoices_last_ref,
       (SELECT COUNT(*)            FROM ClockEntries)         AS clockentries_rows,
       (SELECT MAX(id)             FROM ClockEntries)         AS clockentries_max_id,
       (SELECT MAX(clock_in)       FROM ClockEntries)         AS clockentries_last_clock_in,
       (SELECT COUNT(*)            FROM ChangeLog)            AS changelog_rows,
       (SELECT MAX(changed_at)     FROM ChangeLog)            AS changelog_last_change;

-- One-shot cleanup: remove test payroll revisions for week commencing
-- 27 April 2026 created during the Email-to-Payroll fix sessions
-- (rev0 → rev6+, depending on what's there).
--
-- Run STEP 1 first to see what will be deleted.
-- Then run STEP 2 to actually delete.
-- The associated SharePoint PDFs need to be deleted manually from
--   01 - Accounts / 02 - Payroll / 00 - 2026 /
-- (the file_url column shows the exact paths).
--
-- Comments table is left alone — instructions saved during testing
-- are real instructions for that real payroll week, not test noise.

-- ── STEP 1: REVIEW (run this first) ──────────────────────────────────────
SELECT id, week_commencing, revision_number, file_name, created_by, created_at, file_url
FROM PayrollRevisions
WHERE week_commencing = '2026-04-27'
ORDER BY revision_number ASC;

-- ── STEP 2: DELETE (run only after reviewing the above) ──────────────────
-- DELETE FROM PayrollRevisions WHERE week_commencing = '2026-04-27';

-- ── STEP 3: VERIFY (optional, run after STEP 2) ──────────────────────────
-- SELECT COUNT(*) AS remaining_for_week
-- FROM PayrollRevisions
-- WHERE week_commencing = '2026-04-27';

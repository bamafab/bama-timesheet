-- Project hours no longer require manager approval — they're saved as-is and
-- removed by the office team if logged in error.
--
-- This script flips all existing pending entries to approved so they stop
-- appearing as "needs approval" on the office view. Run it once after deploying
-- the no-approval frontend changes.
--
-- Idempotent: re-running just affects rows that are still 0 (none, after the
-- first run unless something new went pending — which shouldn't happen with
-- the API change defaulting is_approved=1 on insert).

UPDATE ProjectHours
SET is_approved = 1
WHERE is_approved = 0;

-- Add approval tracking to ClockEntries so amendments stay approved across reloads.
--
-- Background: when a manager amends a clocking the row gets is_amended = 1.
-- Approving the amendment used to only update local state, so a hard refresh
-- reverted it to "pending" because normaliseClocking() in shared.js derived
-- approvalStatus purely from is_amended.
--
-- After this migration, approvalStatus is derived from (is_amended, is_approved):
--   is_amended = 0                  -> not applicable (null)
--   is_amended = 1, is_approved = 0 -> pending
--   is_amended = 1, is_approved = 1 -> approved
--
-- Existing amended rows default to is_approved = 0 (i.e. pending). That matches
-- how they currently render after a refresh, so no behaviour regresses — the
-- manager just needs to approve them once more, this time durably.

ALTER TABLE ClockEntries ADD is_approved BIT NOT NULL DEFAULT 0;
ALTER TABLE ClockEntries ADD approved_by NVARCHAR(255) NULL;

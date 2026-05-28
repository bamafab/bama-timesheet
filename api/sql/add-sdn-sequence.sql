-- Migration: add SDN (Site Delivery Note) ref sequence
-- Run via Azure Portal Query Editor against the bama-erp database.
--
-- Site DNs use a separate sequence from supplier DNs to keep their
-- numbering visually distinct on the printed delivery notes:
--   Supplier DN: DN-0001, DN-0002, …
--   Site DN:     SDN-0001, SDN-0002, …
--
-- The allocator on the backend (job-bom-items.js) increments this
-- Settings row in the same transaction that flips selected items
-- from 'ready_for_despatch' to 'on_site'.

IF NOT EXISTS (SELECT 1 FROM Settings WHERE [key] = 'sdn_next_seq')
BEGIN
    INSERT INTO Settings ([key], value, updated_at)
    VALUES ('sdn_next_seq', '1', SYSUTCDATETIME());
END

-- ─────────────────────────────────────────────────────────────────────────────
-- Ensure "Zinc Phosphate Primer" exists as a FINISHING service type so it shows
-- up as a selectable finish on assembly drawings (driven by ServiceTypes.is_finish).
--
-- Root cause it fixes: the app's "Add service type" form/API never set is_finish,
-- so finishes added through the UI were created with is_finish = 0 and never
-- appeared in the assembly finish dropdown — the OCR could read "Zinc Phosphate
-- Primer" but it could not be matched, so assemblies showed "No finish".
--
-- Idempotent: safe to run repeatedly. Inserts if missing, otherwise just flags
-- the existing row (and reactivates it if it had been soft-deleted).
-- ─────────────────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM ServiceTypes WHERE name = N'Zinc Phosphate Primer')
    INSERT INTO ServiceTypes (name, is_active, is_finish)
    VALUES (N'Zinc Phosphate Primer', 1, 1);
ELSE
    UPDATE ServiceTypes
       SET is_finish = 1, is_active = 1
     WHERE name = N'Zinc Phosphate Primer';
GO

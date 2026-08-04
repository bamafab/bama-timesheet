-- ─────────────────────────────────────────────────────────────────────────────
-- widen-drawing-element-files-context.sql
--
-- The CK_DEF_Context CHECK on DrawingElementFiles only allowed
-- parts-sections / parts-plates / site — the 'rams' context (generated RAMS
-- PDFs registered per job, decision B) was never added, so every RAMS file
-- registration 500'd with a constraint violation. Widen it to include 'rams'.
--
-- Constraint change only (no new columns) => no Function App restart needed.
-- ─────────────────────────────────────────────────────────────────────────────

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CK_DEF_Context')
    ALTER TABLE DrawingElementFiles DROP CONSTRAINT CK_DEF_Context;

ALTER TABLE DrawingElementFiles ADD CONSTRAINT CK_DEF_Context
    CHECK (context IN ('parts-sections','parts-plates','site','rams'));

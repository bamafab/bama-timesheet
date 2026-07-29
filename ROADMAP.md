# BAMA ERP — Roadmap

Companion to FAULT-REGISTER.md. Phase A (audit) and Phase B (B0–B5 fixes)
completed 2026-07-29. This file tracks the build phases and newly-scoped work.

## Done
- **A** Fault audit → FAULT-REGISTER.md
- **B0–B5** Health check + report exports · F1 hours transfer · F2/F9 field
  ownership · F4 hard delete + numbering · F6 ChangeLog · F3 win rate ·
  F5 galvanising split · F10 golden tests
- **C1** Job Costing (estimate vs actual, Project Tracker) — 2026-07-29
- **C1b** Productivity grid (person × job × day, reports.html) — 2026-07-29

## Next
- **C2** Capacity board ✅ SHIPPED 2026-07-29 (ED Overview: next-8-weeks
  stacked load vs capacity line from remaining estimated hours × deadlines;
  /api/capacity-summary).
- **C2b** ✅ SHIPPED 2026-07-29 — no schema change needed: JobAssemblyActions
  ledger existed since the staged-fab build. Operator picker on stage moves is
  now REQUIRED + remembered (localStorage); new Fab output report in
  reports.html (kg per person per day, job-colour chips, stage filter, CSV,
  help) on new GET /api/fab-output.
- **C3** Stock register ✅ SHIPPED 2026-07-29 (stock.html: push-to-talk voice
  entry via Web Speech + Claude transcription, deterministic validation +
  kg/m against steel-sections.json generated from the steel database; manual
  rows, review-before-save, qty steppers, soft delete + restore, CSV, tonnage
  totals, ChangeLog audit on every mutation; StockItems table). Built ready —
  Mateusz will populate on a quiet day. **C3b** cut lists / bar optimisation
  against recorded stock — after stock is populated.
- **C4** CVR / WIP ✅ SHIPPED 2026-07-29 (reports.html: per-project value
  [certified-first, applied flagged] vs cost [labour + PO nett], margin,
  billing position/WIP, cash columns, KPI strip; GET /api/cvr-summary;
  CSV + native landscape PDF management pack; help with definitions).
  Phase C COMPLETE.
- **F8 rolling** Help + "Something looks wrong?" per module as phases touch it

## Phase D — Document & QMS layer  (scoped 2026-07-29, NOT started)

Scoped per Mateusz: the ERP becomes the home for company documents and QMS
paperwork, filing everything into a PROPER SharePoint folder taxonomy instead
of the current ad-hoc naming.

**D0 — IN PROGRESS 2026-07-29:** migration tool built (`sp-migrate.html`, not
linked from hub — direct URL): inventory scan, editable canonical tree with
idempotent creation, per-folder mapping (default leave-in-place), dry-run,
logged execution with downloadable move-log, and revert-from-log. Runs with
Mateusz's own delegated Graph permissions (he outranks Daniel). Moves keep
item IDs stable so ERP sharepoint_*_id references survive. Awaiting Mateusz's
answers on D1–D5 (naming, legacy scope, 04 Sales, BAMA-specific folders,
numbering) + OneDrive backup before execution. ERP REPOINTED 2026-07-29
(same day tree was created): SP_TAX taxonomy constants + spYearName
(year−2022, auto-creates each January) in shared.js; new project folders →
06 - Projects/<NN - year> (tender→project, babcock→project, projects-page,
QB mark-won inline); new quote folders → 05 - Sales & Estimating/<NN - year>
(tender-register server); ED tender quick-link reads new path with legacy
Quotation/ (year−2023) fallback. Old folders keep working via stored IDs +
drive-wide search. Remaining: content migration after backup (steps 1/3/4 of
the tool). Babcock basePath left in its own world deliberately.

**D0 — SharePoint taxonomy design (prerequisite, decisions needed from
Mateusz before any code):** agree the canonical folder tree (company-level:
policies / insurances / RAMS library / QMS; supplier-level; employee-level;
project-level already exists). Decide naming convention, who may write where,
and the migration approach for existing misnamed folders (map + move script
vs. leave-and-start-clean). ERP then owns folder creation — humans stop
inventing names. Likely needs Daniel for SharePoint permissions.

**D1 — Company document library:** policies, insurances, certificates with
expiry dates + renewal reminders (surface on ED overview), version history via
SharePoint, ChangeLog on upload/replace.

**D2 — Supplier records:** supplier register (contacts, terms, approvals,
insurance/quality certs with expiry) — feeds PO tracker and supplier-invoice
matching instead of free-text supplier names.

**D3 — Employee documents + contract generation:** employment contract
generated from a template (docx/PDF, two-engine rule: template deterministic,
AI drafts nothing legally binding without review), stored per employee;
training matrix ties in via existing SitePersonnelCerts schema.

**D4 — QMS forms & check sheets:** digital versions of the QMS check sheets,
fillable on shop floor / site (kiosk or phone), auto-filed to the right
project folder, PDF rendered natively. Form definitions data-driven so new
sheets don't need code.

Order rationale: D0 unblocks everything; D1/D2 are independent after that;
D3 needs a contract template from Mateusz; D4 is the largest and benefits
from the taxonomy + form-engine groundwork.

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
- **C3** Stock register with voice entry (Web Speech + Claude parse, validated
  against the steel database) → cut lists / bar optimisation wired to stock
- **C4** CVR / WIP management pack (value applied vs cost to date per live
  project, cash position) — lands in reports.html
- **F8 rolling** Help + "Something looks wrong?" per module as phases touch it

## Phase D — Document & QMS layer  (scoped 2026-07-29, NOT started)

Scoped per Mateusz: the ERP becomes the home for company documents and QMS
paperwork, filing everything into a PROPER SharePoint folder taxonomy instead
of the current ad-hoc naming.

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

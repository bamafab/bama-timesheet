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

### Phase D status — 2026-07-30

- **D0** tree created + ERP repointed (root `BAMA`, IDs in `SP_TAX`).
  **Outstanding: Mateusz runs the legacy content migration** in
  `sp-migrate.html` (Auto-map → dry-run → execute; move-log CSV is the undo).
- **D1** ✅ Company docs register — office.html › Company Docs, drag&drop AI
  import, expiry strip on ED.
- **D2** ✅ Supplier records — FPC s9 approval status + SupplierDocuments.
- **D3** ✅ Employee docs + contract generator; **D3b** ✅ offer letter +
  electronic new-starter sheet.
- **D4** ✅ Data-driven QMS engine + all 9 FPC sheets as definitions + rich
  field types (job/machine/drawing/personnel pickers, photo, signature,
  repeating tables). New sheets are a SQL INSERT, no code.
- **Training Matrix** ✅ person × cert grid on the RAMS 2b schema.
- **Plant Register** ✅ statutory inspection tracking (LOLER/PUWER/PAT/
  calibration/service/MOT), newest-certificate-wins, bulk cert drop with
  deterministic matcher.

## Phase E — open queue (2026-07-30)

Priority order as it stands:

1. ~~2dp rounding on financial calculations~~ ✅ **DONE 2026-07-30** — MONEY
   section in shared.js (`_r2` / `sumMoney` / `pctOf` / `gbp2` / `gbpWhole` /
   `gbpShort`), invoice preview-vs-saved mismatch fixed on both client paths
   and server-side, BACS + reconciliation totals, Babcock PDF fallbacks.
   `tests/money-rounding.js` (37 assertions) is the gate.
2. **Welder qualification register (E1)** — the real FPC/EN 1090 gap. Scope
   per certificate (process, material group, thickness/diameter range,
   positions), 6-month employer endorsement AND 3-year re-test tracked
   separately, certificate PDFs to `02 - Quality (QMS)`, plus a scope check
   that flags assigning a welder outside his approval range. Training-matrix
   cells cannot express this.
3. **F7** — assign-path double counting, verify against live data.
4. **QB Won→Project rebuild** — half-state C260327; schema decision is
   Mateusz's now (Daniel is out).
5. **Running Cost tile source** — aggregate POs + supplier invoices; and point
   the Labour Cost tile at LabourLog actuals instead of the quote budget.
6. **Balustrade F7** — step 3 spigots for glass families, step 2 handrail
   image-button picker. Blocked on real numbers from Mateusz.
7. **Staircase / balustrade live calibration** — Q250410 through the spiral
   wizard vs the £15k fab line; welded balustrade £333/m vs 305–325 envelope.
8. **Policy / RA template studio** — parked by Mateusz; produce, tweak and
   sign policies and risk assessments from templates (new modal family like
   the RAMS generator).
9. **Retention ledger + release invoicing**, **sales-side remittance OCR** —
   both parked.
10. **Mobile clock-in page** (PIN, no Microsoft account) — needs server-side
    PIN checking.
11. **Housekeeping** — two known preflight errors in QB (`plantTypeSelect`,
    `scopeTemplateDD`); F8 rolling help per module.

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
2. ~~Welder qualification register (E1)~~ ✅ **DONE 2026-07-30** — Office ›
   Welder Approvals. Printed range of approval per certificate, both validity
   clocks (6-month confirmation + expiry) with the confirmation endpoint that
   logs and advances together, certificate reader that fills the form for a
   human to check rather than saving, and the 🔍 Check-a-welder scope test.
   `tests/welder-scope.js` (43 cases) is the gate.
   Scope check is wired into the point of use as a **warning** (Mateusz's call:
   blocking would stop the shop when the register lags reality) — the override
   is recorded on the inspection record.
2b. ~~Inspection & NDT sampling (E2)~~ ✅ **DONE 2026-07-30** — Office ›
   Inspection & NDT. Visual pinned at 100% (never sampled); supplementary NDT
   sampled from the editable, verify-before-trust `NdtExtentRules` table;
   per-job weld population, shortfall badges, failed-inspection audit.
   `tests/inspection-sampling.js` (36 cases).
   **Still to do here:** BAMA FAB 001 submissions should auto-create an
   inspection record (link exists — `qms_submission_id` — but nothing writes it
   yet), and a printable inspection summary for the job file / release pack.
3. **F7** — assign-path double counting, verify against live data.
4. **QB Won→Project rebuild** — half-state C260327; schema decision is
   Mateusz's now (Daniel is out).
5. ~~Running Cost / Labour Cost tile sources~~ ✅ **ALREADY DONE** (verified in
   code 2026-07-30 — this entry was stale and had been recommended repeatedly
   off it, wrongly). `_projectLabourCostLogged` = Σ(ProjectHours × basic rate),
   S000 excluded, CIS included, no OT uplift; the tile reads that, and falls
   back to showing variance vs the quote budget only as *meta text*. Running
   Cost = nett total of active POs, which is **commitments not invoices** by
   deliberate design (documented on the Job Costing PDF: commitments lead cash).
   If supplier-invoice-based actuals are ever wanted they'd be a second figure,
   not a replacement. **Lesson: verify against the code before recommending a
   fix from a roadmap line.**
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

---

## Phase F — merged forward plan (2026-07-30)

**Numbering warning.** An earlier session's plan used "E1 + E2" to mean *plant
register + consumables/reorder*; this session reused E1/E2 for *welder
qualifications + inspection sampling*. Both labels are now in the history. This
Phase F list supersedes both — one source of truth, use these numbers.

**Dropped on the floor and worth noting:** that earlier plan asked three
decisions (welding machines into Plant or separate; consumable issue-out kiosk
or office; reorder POs auto-draft or basket) and paired the plant register with
a consumables/reorder half. The plant register was built; the decisions were
never put to Mateusz and the consumables half was never built. Carried into F3
below.

Ranked by value, with what this session's work already changed:

- **F1 — O&M / handover pack generator + DoP, CoC and ITP.** Highest value, and
  materially cheaper than when first proposed: the pack's contents are mostly
  captured already — material certs with heat numbers (BAMA MAT 001, live since
  the phase 2 seed), weld records (FAB 001), release records (REL 001), welder
  qualifications + 6-month confirmations, inspection & NDT records, plant
  inspection certificates, company docs (UKCA 1090 EXC3, ISO 9001/14001/45001,
  insurances), COSHH sheets. To build: as-built drawing selection, warranties,
  and the indexed bookmarked PDF assembly.

  **Scope confirmed by Mateusz 2026-07-30 — three generated documents, all
  native jsPDF on the SDN/DN pattern (two-engine: AI drafts narrative only,
  deterministic renderer builds the document):**

  · **DoP — ✅ DONE 2026-07-30** (see CLAUDE.md). Built as below, with the
    numbers read off the UKCA certificate in Company Docs rather than typed
    (Mateusz's call) and a single one-time human confirmation before issue.
    **Declaration of Performance.** TERMINOLOGY MATTERS HERE. For
    structural steelwork under EN 1090-1 the regulated document is a
    *Declaration of Performance* under the Construction Products Regulation,
    not a "Declaration of Conformity" (that belongs to other directives). Its
    content is PRESCRIBED (CPR Annex III / EN 1090-1 ZA.3): unique
    identification code of the product-type, intended use, manufacturer,
    AVCP system (2+ for structural steel), the notified body number, the FPC
    certificate number, and declared performance against the harmonised
    specification. **AI must NOT draft any of those fields.** They are
    constants that come off BAMA's UKCA 1090 EXC3 certificate and must be
    stored as verified configuration — same pattern as NdtExtentRules: seeded
    blank/unverified, entered once by Mateusz, then reused. AI drafts only the
    free-text product description / scope.
    NEEDED FROM MATEUSZ: notified body number, FPC certificate number,
    declared performance values, execution class per product-type.
  · **CoC — ✅ DONE 2026-07-30** (see CLAUDE.md). Built as specified below.
    **Certificate of Conformity.** A contractual/commercial document,
    not a regulated one, which is why main contractors ask for it in wording
    that varies. Template with the job's actual data (contract, drawings and
    revisions, materials with heat numbers, welding standards, NDT extent
    achieved, coatings) and a signature block. Free-text draftable by AI
    because nothing in it is a regulated declaration — but every figure quoted
    must come from the ERP's own records, never invented.
  · **ITP — ✅ DONE 2026-07-30** (see CLAUDE.md). Built as specified below.
    **Inspection & Test Plan.** Per contract, and it should PRE-FILL from
    the E2 inspection plan rather than being typed: activities, reference
    documents, acceptance criteria, intervention type (H hold / W witness /
    S surveillance / R review), responsibility and record reference. The NDT
    rows derive from the job's exec class and its verified NdtExtentRules
    percentages, so the ITP and the actual sampling can never disagree. Visual
    always shows as 100%. Issue as a document AND keep it live so achieved-vs-
    planned is visible during the job.
- ~~**F2 — Material traceability report**~~ ✅ **DONE 2026-07-30** —
  `AssemblyHeatAllocations` bridges heat → assembly (the link that didn't
  exist), report grades each assembly piece/contract/none and never overstates.
  Note `api/src/functions/traceability.js` remains welding machines / service
  types / suppliers despite its name — material traceability is in
  `heat-allocations.js`.
- **F3 — Consumables & requisitions** (the dropped half). CON 001 exists as a
  QMS form so issue-out is *recorded* but not *stocked* — no ledger, no reorder.
  **All three decisions settled by Mateusz 2026-07-30:**
  · *Consumable issue-out:* **BOTH.** Primary is a printable tally sheet PDF to
    hang in the workshop — his reasoning, which is right: the lads are already
    marking fab / weld / complete and adding another screen tap per rod is how
    you get a register nobody fills in. The kiosk tap is built too, as the
    optional route. Paper is the default, digital is the bonus.
  · *Reorder POs:* **basket to approve before sending.** Confirmed — nothing
    that creates a financial commitment goes out without a human pressing
    something.
  · *Welding machines:* ✅ **DONE 2026-07-30** (see CLAUDE.md). Below was the
    plan; it was built as described, kiosk untouched.
    **MIGRATE INTO PLANT** — Mateusz's decision, overriding
    the earlier recommendation to keep them separate (I argued against it on FK
    grounds; he wants one place and one fewer sidebar line, which is a fair
    call on usability). Do it WITHOUT breaking the two foreign keys:
      1. `PlantItems` becomes the single editing surface (category `welding`).
      2. `WeldingMachines` survives ONLY as the identity row those FKs point at
         (`JobAssemblies.welding_machine_id`, in both add-job-fabrication and
         add-staged-fabrication) — add `plant_id` to it (ALTER ⇒ **Function App
         restart required**) and auto-maintain the row from the plant record.
      3. Remove the Welding Equipment tab from the office sidebar.
      4. Kiosk machine picker reads plant items of category `welding` and writes
         the linked `WeldingMachines.id`, so lads pick the machine they welded
         with and nothing downstream changes shape.
      5. Plant categories already carry the type, so machine "types" come free.
    Migration must backfill a PlantItems row per existing WeldingMachine and
    link it; existing assembly history stays intact.
- ~~**F4 — Toolbox talk register**~~ ✅ **DONE 2026-07-30** — library +
  AI drafting + delivery register with signatures, own tab rather than a QMS
  definition row (a talk needs reusable content and an attendance history,
  which the generic form engine doesn't model).
- **F5 — Accident / near-miss register + RIDDOR helper.** POL001 promises an
  accident book and an F2508 process and there is no digital form. This one
  carries legal weight (RIDDOR reporting deadlines) and near-miss trending is
  what 45001 auditors ask for. Full build, not a form row.
- **F6 — Management review + audit pack.** 9001/14001/45001 all require annual
  management review with objectives and KPIs; the Health tab and CVR already
  hold the numbers.
- **F7 — Cash flow forecast** (13-week). AFP dates, invoice due dates and
  supplier payment runs are all already in the system; mostly assembly.
- **F8 — Waste transfer / environmental register** for 14001.
- ~~Weld map / NDT tracking per contract~~ — **largely delivered** by the E2
  inspection module (per-contract plan, per-assembly records, per-category
  sampling). What's left is the visual weld map itself, which is low value
  against the rest of this list.

**Immediate, ahead of all of the above:** the Labour Cost tile shows the quote
budget rather than LabourLog actuals, which quietly undermines CVR and Job
Costing — those reports look precise and are not. Plus the two FAB 001 ↔
inspection-record loose ends from E2.

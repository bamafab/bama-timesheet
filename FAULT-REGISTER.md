# BAMA ERP — Fault Register (Phase A audit)

Audited 2026-07-29. Read-only code audit of the seams between modules: TD → QB →
Project → hours/cost, plus numbering, chase flow, stats provenance, and the
help/undo/audit posture. Each entry: symptom → root cause → proposed fix.
Nothing here has been changed yet — fixes land in Phase B after approval.

Severity: CRITICAL = shows wrong numbers or loses data today.
HIGH = will produce wrong numbers under normal use. MEDIUM = causes grief /
confusion. LOW = quality/robustness debt.

---

## F1 · CRITICAL — QB → Project hours transfer is wrong by design collision ✅ FIXED B1 2026-07-29 (migration + backfill SQL in api/sql/, pasted in chat)

**Symptom:** Project Tracker "Hours Scheduled" shows a meaningless small number
(typically 5) for every QB-won project, regardless of the hours quoted.

**Root cause:** two consumers assign different meanings to the same column.
`seedQbLineItems` (qb-quotes.js, mark-won) inserts the 9 project lines with
`quantity = 1` and the money in `unit_price`. Project Tracker's
`_sumLabourHoursScheduled()` (shared.js) reads `Σ quantity` on labour-flagged
lines as *hours*. So hours = number of labour lines. Worse: if a PM "fixes" it
by typing real hours into quantity, `_sumLineItems()` (contract value =
Σ qty × unit_price) multiplies the line value by the hours — contract value
explodes. The two conventions cannot coexist on the same columns.

**QB knows the real numbers** (fabHours, fabpackHours, designHours,
instDays × instOperatives × 8, survey visits…) — they are simply never sent.

**Proposed fix:** add a dedicated `labour_hours` column to `QuoteLineItems`
(nullable). mark-won maps QB's real hour estimates per category into it;
`_sumLabourHoursScheduled` reads the new column (falling back to the old
quantity convention only for hand-built tender lines). Contract maths
untouched. Schema change → migration SQL pasted in chat + Function App restart.

---

## F2 · HIGH — Stale-blob clobber: column edits silently reverted by QB saves ✅ FIXED B2 2026-07-29 (contested-column dirty filter + column-wins load merge; ownership table in CLAUDE.md)

**Symptom:** a chase date rolled forward by the "log chase" flow (or any field
edited by a column-only endpoint) reverts to its old value after the quote is
next touched in QB. Same disease as the quote-date bug fixed 2026-07-29.

**Root cause:** `qb-quotes/{id}/log-chase` updates `chasing_date`,
`chased_at`, `chase_count` columns only. QB's in-memory blob still holds the
old `chasingDate`; the next `saveAll()` sends `chasing_date: q.chasingDate`,
clobbering the roll-forward. Compounding it, `selectQuote()`'s SQL-wins merge
list covers date/dateSent/decisionDue but **not** `chasing_date` — so even
reopening the quote resurrects the stale blob value.

**Proposed fix (family-wide, not per-field):** (a) add `chasing_date` (and
`chase_count`/`chased_at` as read-only) to the selectQuote SQL-wins merge;
(b) establish the rule in CLAUDE.md: any field writable by a column-only
endpoint must be column-wins on load; (c) health-check report flags rows where
blob and column disagree on any mirrored field.

---

## F3 · HIGH — "Win rate" means three different things on different screens ✅ FIXED B4 2026-07-29 (qbWinRate() helper — won ÷ decided — used by client card, pipeline stats and analytics; ED already used the same definition)

**Symptom:** the win rate on the QB client card, the QB pipeline stats, the QB
analytics view and the ED overview do not agree — "fake numbers" by
inconsistency, not by error.

**Root cause:** client stats (QB ~18034) and pipeline (~18108) compute
`won / ALL quotes` (drafts and unsent included in the denominator); QB
analytics (~19699) and ED (dashboard ~1368) compute `won / (won + lost)`
(decided only). Both are defensible; showing both under one label is not.

**Proposed fix:** one shared helper `winRate(quotes)` with a single agreed
definition (recommend won/decided, with "n of m sent" as secondary text),
used by all four call sites.

---

## F4 · MEDIUM — QB numbering skips (+2) after accidental duplicate; no hard delete ✅ FIXED B3 2026-07-29 (mechanism confirmed by health data: number consumed while duplicate was live; hard delete for never-sent drafts + NULL-status counted as live in next-ref; numbering self-healed in live test)

**Symptom (reported):** accidental Duplicate → archive → next quote ref jumps
two instead of one.

**Audit finding:** the code *should* reuse the number — UI delete is a soft
delete (`status='deleted'`) and `qb-next-ref` excludes `status != 'deleted'`.
Two candidate mechanisms need a live-data check: (a) rows with **NULL** status
are also excluded by `status != 'deleted'` (SQL three-valued logic) — a NULL-
status row would *hold* its number invisibly; (b) the ref may also exist in
`Tenders`/`TenderRegister`, which next-ref scans and which soft-delete never
touches. Health-check report will list which refs are held and by which table.

**Proposed fix:** true hard delete allowed for `draft` quotes never sent
(mirrors the invoicing Draft/Void rule); next-ref treats NULL status as live
explicitly; health check surfaces number-holding ghost rows.

---

## F5 · MEDIUM — "Galvanising £0" on every seeded project line ✅ FIXED B4 2026-07-29 (cost_galvanising column; QB saves the two separately; mark-won maps the real figure; older quotes split automatically on next open+save)

**Symptom:** project line items always show Galvanising at £0 and Painting
inflated, which reads as missing data.

**Root cause:** intentional — QB's `cost_painting` already includes
galvanising, so mark-won maps galvanising to null to avoid double-counting.
Correct arithmetic, misleading presentation.

**Decision (Mateusz, 2026-07-29): SPLIT.** QB will save `cost_galvanising`
separately (new column), saveAll sends painting and galvanising individually,
and mark-won maps galvanising -> cost_galvanising. Lands in Phase B4 with a
migration.

---

## F6 · MEDIUM — No audit trail on state changes ✅ FIXED B3 2026-07-29 (ChangeLog table + logChange helper; wired into quote status/hard-delete/mark-won, AFP certify/un-certify, invoice void/delete; Recent Changes viewer in ED Health tab)

**Symptom:** "who marked this AFP certified?" / "who archived this quote?"
cannot be answered; reverts are guesswork.

**Root cause:** no ChangeLog. Some endpoints stamp `*_by` fields ad-hoc
(chased_by, added_by) but status transitions, cert changes, despatches and
deletes mostly don't.

**Proposed fix:** one `ChangeLog` table (entity_type, entity_id, action,
old_value, new_value, changed_by, changed_at) + a tiny `logChange()` helper in
the API; wire it into quote status, AFP cert, despatch, invoice state, and
deletes first. New table → no Function App restart needed.

---

## F7 · MEDIUM — Assign-path double counting risk (verify with live data)

When a won quote is **assigned** to an existing project, its 9 line items are
seeded and its lines join `_sumLineItems()` (contract) and hours sums. If the
project's original quote lines already cover the same scope (e.g. a revision
quoted separately then assigned), contract value and hours double. The unique
index prevents duplicate *attachments* but not overlapping *scopes*. Needs a
live-data check + a UI warning when assigning ("this adds £X to the project's
contract value — is it additional works?").

---

## F8 · LOW — Help system exists only in QB

`openHelp`/`HELP_CONTENT` count: QB ✓, projects.html 0, invoice-tracker 0,
dashboard 0, project-tracker 0, office 0. **Proposed fix:** extract the QB
help pattern into shared.js, roll out per module with a "Something looks
wrong?" troubleshooting section (human error vs system error), written during
whichever phase touches the module. Generalise the QB definition-of-done rule
system-wide.

---

## F9 · LOW — Blob/column mirror audit (remainder of the F2 family) ✅ FIXED B2 2026-07-29 (ownership table documented in CLAUDE.md; enforced by dirty filter + health check C1)

`saveAll()` mirrors ~20 fields from the blob into columns on every save.
The date bug and F2 are two instances of the same class. Remaining fields to
audit for "who else writes this column": status (mark-won writes it),
decision_due (TD side?), valid_until, revision. Deliverable: a documented
ownership table (blob-owned vs column-owned vs both+reconciled) in CLAUDE.md,
enforced by the health check.

---

## F10 · LOW — No regression harness on the pricing engine ✅ FIXED B5 2026-07-29 (tests/golden-quotes.js — 10 fixtures, 478 pinned values, self-healing extraction from the live page; negative-tested; CLAUDE.md gate rule)

`computeQuoteTotals` (and `computeAreaBreakdown`) have no golden tests; every
refactor risks silent drift in quoted prices. **Proposed fix:** commit ~10
anonymised quote blobs + expected totals as a Node test script
(`tests/golden-quotes.js`), run manually before any engine-touching push and
referenced in CLAUDE.md.

---

## Deliverable of Phase B0 — the Health Check report ✅ SHIPPED 2026-07-29

`GET /api/health-check?year=YYYY` (api/src/functions/health-check.js) +
🩺 Health tab in dashboard.html. Checks C1–C10 below map to the fault entries.

A read-only API endpoint + Reports Hub page that scans live data for: blob vs
column disagreements per quote (F2/F9); refs held by deleted/NULL-status/ghost
rows (F4); projects whose line-item sum ≠ quote total; labour lines with
quantity > 1 AND unit_price > 0 (F1 hand-fix casualties); AFP/cert/invoice
chains that don't reconcile; orphaned rows (line items without quotes,
ProjectQuotes without projects). Run on demand; each finding links to the
fault number here.

---

## Proposed Phase B order

1. **B0** — Health Check report (tells us the real blast radius of F1/F2/F4/F9
   in live data before we fix).
2. **B1** — F1 hours transfer (schema + seed + tracker read) — the fault that
   started this.
3. **B2** — F2 + F9 chase/blob ownership fixes.
4. **B3** — F4 hard delete + numbering; F6 ChangeLog (they share the
   who/when/undo groundwork).
5. **B4** — F3 win-rate unification + F5 galvanising label (small, batched).
6. **B5** — F10 golden tests (before Phase C building starts).
7. F7 verified via B0 data; F8 rolls out with each later phase.


---

## Phase C1 — Job Costing ✅ SHIPPED 2026-07-29

Project Tracker gains a "Job Costing — Estimate vs Actual" card per project:
QB net cost buckets (labour vs bought-in) against actual kiosk labour cost and
nett PO commitments, with variance, hours est-vs-logged, contract value and
running margin. Native jsPDF export + in-card help ("Something looks wrong?")
per the robustness DoD. API: /api/project-quotes now carries est_* columns.
Caveats stated in-product: actuals = commitments to date, not final cost.

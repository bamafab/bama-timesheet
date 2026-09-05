# BAMA ERP — System Review & Forward Plan
**Date:** 5 Sep 2026 · **Mode:** read-only audit (nothing changed, nothing pushed)
**Sources:** repo `bamafab/bama-timesheet` @ `156433f1` (1,104 commits, 341 since 1 Jul), CLAUDE.md / FAULT-REGISTER.md / ROADMAP.md, live SharePoint `BAMA` root, market reference (Tekla PowerFab / STRUMIS module sets).

---

## 0. Verdict in one paragraph

The system is real and in daily production — new projects C260903 / C260905 were created on 4 Sep straight into `06 - Projects/04 - 2026` with the full subfolder set, and the AFP engine has been through three rounds of hardening against real certificates (RG Carter, Brookhurst, Stevenage). Module coverage is now wider than Tekla PowerFab's core list (Estimating, Purchasing, Project Management, Production Control, Inventory) *plus* QMS/EN 1090 paperwork, payroll, invoicing and AFP — which PowerFab and STRUMIS leave to a separate accounts package. What it lacks is not features. It lacks a **hardened core**: the API trusts unsigned tokens, permission checks live only in the browser, multi-step writes are not transactional, nothing alerts anyone when something fails, and 57k lines of shared JS load on every page including the kiosk. Two months of work went into breadth; the next block should go into depth.

---

## 1. Where we are — the last ten weeks

| Period | Delivered |
|---|---|
| 24–29 Jul | Phase A audit → Fault Register F1–F10; Phase B0–B5 (health check, hours transfer, field ownership, hard-delete, ChangeLog, win-rate, galvanising split, golden tests); Phase C1–C4 (Job Costing, productivity grid, capacity board, stock register, CVR/WIP) |
| 30 Jul – 1 Aug | Phase D (SharePoint taxonomy, Company/Supplier/Employee docs, QMS engine + 9 FPC sheets, Training Matrix, Plant Register); E1 Welder approvals, E2 Inspection & NDT; F1 ITP/CoC/DoP/O&M; F2 traceability; F3 consumables; F4 toolbox talks |
| 3–10 Aug | House-style PDF chrome, policy e-sign, Babcock cascade + net PO figure, legacy tender world retired (~2,600 lines), steel 4-copy drift fixed + generator, SharePoint self-healing IDs + relinker, SQL Serverless cost guards |
| 13–28 Aug | AFP cert OCR (summary-only notices, QS breakdown, over-certification), retention semantics aligned, invoice VAT rate select, bill-from-quote, SDN add-lines, IFC/STEP takeoff Path B, PlanSwift import, full-width layout |
| 1–2 Sep | AFP engine audit (one prev-% model, scoped matching, certified-in-full shortcut, reconciliation guard, frozen Paid column, Less-Previous from chain); Payments Due defaults; double-billing guard |

**Outstanding on your side** (unchanged): RAMS R19–R21 severity sign-off · mill cert examples · balustrade spigot numbers · D0 legacy content migration (see §4.3 — half done) · three pending SQL scripts (`create-employee-documents`, `seed-qms-forms-phase2`, `create-steel-test-certs` → restart).

---

## 2. What's good — keep, don't touch

- **Two-engine rule** (AI reads/classifies, JS computes) is applied consistently and has already paid for itself in AFP and DoP. Best architectural decision in the codebase.
- **Test gates**: 16 test scripts, golden quotes 498 pinned values, money-rounding, steel-match, welder-scope, inspection-sampling. Coverage of *business rules* is unusually good for a system this size.
- **Health check + ChangeLog + schema-check**: the "ask the database, don't guess" posture. Most bespoke ERPs never get this.
- **MONEY section**: one rounding model, penny-reconciled, tested.
- **SharePoint stored-ID-first resolution + relinker**: the right answer to Explorer copy+delete.
- **CLAUDE.md as the operating manual**: hard rules with fault numbers and dates. It works — 2,443 lines and mostly still accurate.
- **Robustness DoD** (export + help + undo in the same commit) and **graphics-are-part-of-done**.

---

## 3. Tier 0 — Hardening (invisible to users, non-negotiable)

Ordered by blast radius. None of these are features; all of them are the difference between "works" and "robust".

### 3.1 CRITICAL — API accepts unsigned tokens
`api/src/auth.js` decodes the JWT, checks `exp`/`aud`/`iss`, and checks that the `kid` *exists* in Microsoft's JWKS — but **never verifies the signature**. The code comment admits it. Tenant ID and client ID are public (they're in the frontend). Anyone can mint a token with `{aud: CLIENT_ID, iss: <tenant>, exp: <future>, kid: <any current MS kid>}` and every endpoint — payroll, invoices, employee PINs, supplier bank details — accepts it.
**Fix:** verify RS256 signature against the JWKS key (Node `crypto.verify` or `jose`, ~40 lines). Zero UI change. **One session, do first.**

### 3.2 HIGH — Authorisation is client-side only
`UserPermissions` is read by the browser to hide tabs. Only `user-access.js` checks permissions server-side. Every other endpoint accepts any authenticated tenant user. A workshop employee with a Microsoft account can `DELETE /api/invoices/…` from the console.
**Fix:** `requirePerm(auth, 'payroll')` helper that loads the caller's `UserPermissions` row (cached per request), applied per route family. Map: payroll/employees/pin → `payroll`|`staff`; invoicing/AFP/supplier-invoices → `invoicing`; qb-quotes/quote-financials → `editQuotes`; POs → `editPurchaseOrders`; projects/drawings write → `editProjects`|`draftsmanMode`; user-access → `userAccess`. Read endpoints for kiosk stay open to any authed user. **Two sessions** (helper + sweep, then smoke-test each page).

### 3.3 HIGH — Implicit flow + token expiry loses work
Implicit-flow access tokens expire after ~60–90 min; `apiCall` on 401 redirects to login mid-action — a half-filled AFP modal or RAMS edit is gone. Microsoft has deprecated implicit flow.
**Fix:** MSAL.js auth-code + PKCE with silent refresh (`acquireTokenSilent`). Keep the `hub.html` bounce contract intact — same sessionStorage keys, so no page changes. Also gives refresh tokens for the m-qms PWA. **One to two sessions**, test on hub first (the load-bearing rule).

### 3.4 HIGH — Multi-step writes are not transactional
Only 5 of 57 function files use `mssql` transactions. `mark-won` does Projects INSERT → QuoteBuilderQuotes UPDATE → ProjectQuotes INSERT → seed 9 lines as four separate statements; the "C260327 half-state" is exactly a failure between steps 1 and 2. Same pattern in AFP certify, supplier-invoice match, payment runs, merge-suppliers.
**Fix:** `withTransaction(async tx => …)` helper in `db.js`; wrap mark-won, AFP certify/amend, invoice create+lines, payment-run create, supplier merge, SDN amend. Idempotency key on mark-won (reference-based) so a retry can't double-create. **Folds into the QB Won→Project rebuild (§4.1).**

### 3.5 HIGH — Nobody is told when it breaks
No Application Insights hookup, no failed-request alert, no frontend error reporting (`window.onerror` / `unhandledrejection` absent). Failures are discovered when Natasza says "it didn't save". Azure SQL Serverless PITR backups exist by default but **no restore has ever been rehearsed**.
**Fix:** (a) enable App Insights on the Function App — it's a portal toggle + `APPLICATIONINSIGHTS_CONNECTION_STRING`; (b) one alert rule: 5xx rate > N in 5 min → email you; (c) `POST /api/client-error` + global handler in shared.js that ships `{page, message, stack, user}` — surfaced in ED Health tab; (d) one-off: restore the DB to a point-in-time copy, confirm `/api/health-check` runs against it, delete it. Document RPO/RTO in CLAUDE.md. **One session.**

### 3.6 MEDIUM — Last-write-wins with three concurrent users
No `rowversion` / `updated_at` check anywhere. You, Natasza and Leszek edit the same Project/Quote/Invoice; the slower save silently overwrites the faster one. The F2 "stale blob clobber" family is one instance.
**Fix:** `updated_at` echo on PUT for the six contested entities (Projects, QuoteBuilderQuotes, Invoices, Applications, PurchaseOrders, DrawingJobs): server rejects with 409 if the row moved; client shows "changed by X — reload / overwrite". **One session.**

### 3.7 MEDIUM — CI runs no tests
Both GitHub Actions deploy on push to `main`; neither runs `node tests/*.js`, `preflight.py` or `node --check shared.js`. The gate sequence exists only in CLAUDE.md and in Claude's discipline.
**Fix:** a `verify` job before both deploy jobs (10 lines of YAML); deploy blocked on red. Also stops a bad `shared.js` reaching prod on a Friday. **Half a session.**

### 3.8 MEDIUM — `shared.js` is 56,761 lines on every page
CLAUDE.md still says "~9,700 lines"; it is 6× that. Kiosk (`index.html`) downloads AFP OCR, RAMS generator, Babcock cascade, jsPDF drawers — all of it. 1,624 inline `onclick=` handlers; 1,728 top-level functions in one global scope; 8 helpers duplicated with QB (`toast`, `bamaConfirm`, `fmtDate`, `switchTab`…).
**Not a rewrite.** No-build split: `shared-core.js` (auth, api, MONEY, toast/confirm, sidebar, ~3k lines) + per-domain files (`shared-afp.js`, `shared-rams.js`, `shared-sp.js`, `shared-pdf.js`…) loaded only by pages that need them. Same globals, same cache-bust pattern, `preflight.py` already checks cross-file ids. Kiosk load drops ~90%; a syntax error in AFP no longer takes out clocking. **Three to four sessions, mechanical, one domain per commit, gated by all tests.** Do after 3.1–3.5.

### 3.9 LOW — Housekeeping (one cleanup commit)
- **Four PDFs with company financials at repo root** (`CVR-WIP-2026-08-04.pdf`, `Job-Costing-S1982…`, `labour-payments-2026-07…`, `payments-due-2026-07-31.pdf`) — git history is forever; remove, add `*.pdf` (root) to `.gitignore`. `staticwebapp-change.txt`, `_f7_wip/` (F7 scratch, engine already in QB) — remove or move to `docs/`.
- `api/src/functions/auth.js` and `responses.js` — dead duplicates (no routes, differ from the real ones) → delete.
- `.gitignore` ignores `package.json` globally — a footgun for `api/package.json`; scope it to `/tests/`.
- `templates.html`, `po-tracker.html`, `manager.html`, `sp-migrate.html` — not on the hub; confirm which are still wanted (templates.html looks orphaned).
- **46 hardcoded `claude-sonnet-4-6` strings** → one `AI_MODEL` constant client-side, and the proxy applies a server default when `model` is absent. One env var to change on the next model deprecation instead of 46 edits.
- Stale doc: CLAUDE.md "PINs loaded to the client" warning — `employees.js` already strips `pin`; update. `README.md` is empty — one paragraph + pointer to CLAUDE.md.
- Steel DB: make `steel-data.js`, QB inline, `steel-sections.json`, `steel-database.html` **outputs** of `tools/build-steel-sections.js` with a `tests/steel-copies-in-sync.js` gate, so "patch all four" can't be forgotten.

---

## 4. Tier 1 — Workflow seams (where the ERP earns its keep)

### 4.1 QB Won → Project rebuild (the biggest seam, now unblocked)
One transactional, idempotent endpoint: `POST /api/qb-quotes/{id}/win` does Project row → `ProjectQuotes` primary → line-item seed (hours in `labour_hours`, galvanising split) → `ProjectSheets` prefill (site address, contacts from quote) → returns a **plan** of SharePoint work for the client to execute (folder create, `03 - Quote` copy) with `sharepoint_folder_id` written back on success. Failure mid-way rolls back the SQL and reports the step. `source_quote_id` decision: **Option A** — keep as Tenders-only legacy FK, add `source_qb_quote_id` (nullable) so the health check stops false-flagging. Include the F7 assign-path warning ("this adds £X to contract value — additional works?").
**Two sessions.** Migration: ADD COLUMN → restart.

### 4.2 Drawing revision control (Leszek's world — current scope rule)
Today a re-uploaded drawing is a new file; nothing says "Rev B supersedes Rev A" and fabrication can carry on against the old sheet. This is the single most expensive class of workshop error in fabrication and every MIS (PowerFab, STRUMIS) models it explicitly.
**Build:** `DrawingRevisions` (job, drawing_no, rev, sharepoint_file_id, issued_at, superseded_by, status draft/current/superseded); upload flow detects same drawing number → prompts "new revision of X?"; assemblies carry `drawing_rev_id`; **red banner** on any assembly whose rev is superseded and not yet re-checked; kiosk fab/weld stage moves warn. Site Pack / SDN / ITP print the rev. **Two to three sessions.** New table, no restart.

### 4.3 SharePoint D0 — finish the migration
Live data today: `05 - Sales & Estimating` = **54 GB** (quotes moved ✔), `06 - Projects` = **49 MB** (only ERP-created 2026 projects — legacy S-jobs and pre-taxonomy C-jobs **not** migrated), `04 - Suppliers & Subcontractors` = **0 bytes**. Half-migrated is the worst state: two places to look. Your run, tool is ready (`sp-migrate.html`). After it, retire `sp-migrate.html` from the repo (keep the move-log CSV).

### 4.4 Requisition → PO handoff + connected inventory
F3 left "approve requisition → raise PO by hand → mark ordered". Close it: approved basket → pre-filled New PO modal (supplier, lines, project XOR cost centre) → on PO receipt (new `PurchaseOrderReceipts`) → `StockItems` increments with heat number → BOM consumption decrements and writes `AssemblyHeatAllocations`. That single chain turns stock (C3), traceability (F2) and purchasing into one ledger instead of three registers — it's what PowerFab's Inventory module is. **Three to four sessions**, after stock is populated on your quiet day.

### 4.5 Action inbox — one "needs you" surface
Every module has its own alert strip (expiring certs, overdue AFPs, unmatched invoices, pending requisitions, RAMS awaiting signature, welder confirmations due, plant inspections, holidays to approve). Nobody opens eight tabs. One `GET /api/inbox` aggregating them with owner + due + deep link, on hub and ED overview, dismiss-with-reason logged. **Two sessions.** Mostly assembly — the queries exist.

### 4.6 Workshop schedule
Capacity board (C2) shows load vs capacity at week granularity; Leszek still sequences jobs in his head. A drag-to-week board per job with fab/weld/paint/despatch bars, fed by `JobAssemblies` remaining kg and deadline, writing back a `planned_week`. **Two sessions.**

### 4.7 E2 loose ends (small, ahead of the above)
FAB 001 submission → auto-create inspection record (`qms_submission_id` link exists, nothing writes it); printable inspection summary for the release pack. **Half a session.**

---

## 5. Tier 2 — Compliance & finance features (real value, no rush)

1. **F5 Accident / near-miss register + RIDDOR helper** — legal weight, POL001 promises it. Full build with F2508 field mapping and 10-day / 15-day deadline countdown. **Two sessions.**
2. **F7 13-week cash-flow forecast** — AFP dates, invoice due dates, payment runs, payroll weeks all exist; assembly + one report. **One session.**
3. **Hiring pipeline (`JobOffers`)** — your spec from 30 Jul, unbuilt: offer as a record with lifecycle, accepted → creates Employee → drafts contract → prefills New Starter. **Two sessions.**
4. **Retention ledger + release invoicing** — parked; becomes urgent the first time a retention falls due and nobody chases it. **One session.**
5. **F6 Management review pack**, **F8 waste-transfer register** — 9001/14001 audit season items. **One session each.**
6. **Mobile clock-in (PIN, no Microsoft account)** — now possible once 3.1/3.2 land (server-side PIN, scoped API). **One session.**
7. **PDF house-style step 6** (ITP, CoC, DoP, Traceability, Consignment, O&M front matter — header/footer only). **Half a session.**
8. **F8-rolling Help** — every module still without a "Something looks wrong?" section: projects.html, invoice-tracker, dashboard, project-tracker, office. Roll out one per touched module, as the rule says.

---

## 6. What shouldn't be there / should be reconsidered

| Item | Recommendation |
|---|---|
| Financial PDFs committed at repo root | Remove + gitignore (§3.9). Company data in a git history with a PAT that rotates monthly is a leak surface. |
| `api/src/functions/auth.js`, `responses.js` legacy copies | Delete. They differ from the real ones — a future edit to the wrong file would be silent. |
| `sp-migrate.html` | Retire after D0 completes. Direct-URL admin tools with delegated Graph move powers shouldn't stay deployed. |
| `_f7_wip/`, `staticwebapp-change.txt`, `HOW-TO-PUSH-FROM-CHAT.md` | Move to `docs/` or delete. |
| `templates.html` | Orphaned (no hub link, no references). Confirm and remove, or link it. |
| Four steel copies | Keep as build outputs only (§3.9). |
| `tenders.js` rump + `Tenders` table | **Keep** — 5 live FK joins + Attach Quote modal. Already documented. |
| Keep-warm timer | Keep — but confirm against the SQL Serverless auto-pause rule from 10 Aug (health ping must not touch SQL). |
| Model string ×46 | Centralise (§3.9). |

---

## 7. Proposed sequence (≈14–18 sessions)

| # | Block | Sessions | Needs from you |
|---|---|---|---|
| 1 | **3.1 JWT signature** + **3.7 CI gate** + **3.9 housekeeping commit** | 1 | Approve deleting root PDFs / legacy copies |
| 2 | **3.5 Monitoring** (App Insights, alert, client-error, restore drill) | 1 | Portal access to enable App Insights; 20 min for the restore rehearsal |
| 3 | **3.2 Server-side permissions** | 2 | Confirm route→permission map (I'll draft it) |
| 4 | **4.1 QB Won→Project rebuild** incl. **3.4 transactions** | 2 | `source_qb_quote_id` (Option A) sign-off; one ADD COLUMN → restart |
| 5 | **4.2 Drawing revision control** | 2–3 | Leszek's current drawing-number convention (5 min chat) |
| 6 | **3.3 MSAL PKCE auth** | 1–2 | App registration: add SPA redirect + enable auth-code flow (I'll write the exact clicks) |
| 7 | **3.6 Optimistic concurrency** + **4.7 E2 loose ends** | 1 | — |
| 8 | **4.5 Action inbox** | 2 | Which items matter to whom (you / Natasza / Leszek) |
| 9 | **3.8 shared.js split** | 3–4 | — (mechanical, all gates) |
| 10 | **4.4 Requisition→PO→stock chain** | 3–4 | Stock populated first (your quiet day) |
| 11 | Tier 2 as pressure dictates (F5 first) | — | — |

**Parallel, your side, any time:** run the three pending SQL scripts (I'll paste them inline when you're ready); D0 legacy content migration; RAMS R19–R21 severities; mill cert examples; spigot numbers.

---

## 8. Decisions I need before coding

1. **Order**: agree Tier 0 blocks 1–3 go before any new feature (they touch nothing Leszek sees, so the 24 Jul scope rule is respected in spirit — but it's your call).
2. **Housekeeping deletions** (§3.9): yes/no on removing the four PDFs from history (`git filter-repo` — rewrites history; everyone re-clones — or just delete going forward and accept they stay in history).
3. **Permission map** for §3.2 — I'll table it as a grid for you to tick.
4. **Drawing revision convention** — what does Leszek write on a revised sheet today (`-B`, `Rev B`, `_R2`)? Determines the detector.
5. **Option A** for `source_quote_id` — confirm.
6. **App Insights spend** — Serverless-friendly sampling; expect < £5/month at current volume.

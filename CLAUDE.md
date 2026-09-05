# BAMA Fabrication ERP

Workshop management system for BAMA Fabrication — a steel fabrication workshop.
Handles timesheet/kiosk clocking, payroll, holidays, office workflows, project/drawing
management, and a standalone UK steel section reference.

> **Current plan:** `docs/BAMA-ERP-Review-2026-09-05.md` — the 5 Sep read-only
> audit and the sequenced session plan that followed it. Session 1 (JWT
> signature verification, CI verify gate, housekeeping) landed 2026-09-05.

## Rules for Claude Code

- **Golden tests gate the pricing engine (Fault Register F10).** Run
  `node tests/golden-quotes.js` before ANY push touching computeQuoteTotals,
  computeAreaBreakdown, or their helper closure in quote-builder.html. Red =
  quoted prices moved: fix the regression, or consciously re-baseline with
  `--update` and justify it in the commit message. The harness extracts the
  engine from the live page at runtime (self-healing helper resolution), so
  it always tests what ships.
- **Graphics are part of done (raised twice by Mateusz, 2026-07-29).** Any
  grid/board/report UI ships looking DESIGNED, not raw: consistent per-entity
  colours (hash→hue chips), pinned/sticky totals that can't scroll off-screen,
  zebra/weekend shading, legends, hover titles, proper spacing. If it looks
  like a data dump, it isn't finished.
- **Robustness definition of done (system-wide).** Anything shipped that
  produces findings, numbers or documents must include its export/copy path,
  its Help/troubleshooting note, and a way back (undo/revert or soft-delete)
  in the SAME commit — not as a follow-up. Established Phase B, 2026-07-29.
- **ChangeLog convention (Fault Register F6).** State transitions on
  commercial entities (quote status, AFP certify/un-certify, invoice
  void/delete, hard deletes) are audited via `logChange()` from
  `api/src/changelog.js` — non-fatal by design. When adding a NEW
  state-changing endpoint, wire logChange in the same commit. Viewer:
  ED Health tab → Recent changes; API: GET /api/change-log.
- **QB hard delete rule (Fault Register F4).** DELETE /api/qb-quotes/:id is
  guarded server-side: only never-sent drafts (or archived rows) with no
  project link, cascading QuoteLineItems + snapshots. Sent quotes are archive-
  only. next-ref counts NULL-status rows as LIVE (collision guard).
- **QB quote field ownership (Fault Register F2/F9).** QuoteBuilderQuotes
  fields fall into three classes. (1) *QB-owned*: quote_data blob, cost_*,
  total_ex_vat/total_kg/margin_pct, sharepoint ids — always sent by saveAll.
  (2) *Contested* (also written by ED Overview inline edits, the loss modal,
  and /log-chase): revision, status, date_created, date_sent, decision_due,
  chasing_date, valid_until, company, contact, email, phone, site_address,
  prepared_by, loss_*. QB only sends a contested field when the session
  actually changed it (QB_CONTESTED + _qbColSnapshots dirty filter in
  quote-builder.html), and selectQuote takes column values over the blob on
  load. (3) *Column-only*: chased_at, chase_count — never in the blob,
  passthrough read-only. Any NEW endpoint that writes a QB column must add the
  field to QB_CONTESTED and the selectQuote merge, or QB will clobber it.
- **QuoteLineItems.labour_hours owns estimated hours** (Fault Register F1).
  `quantity` means qty×price for contract value ONLY — never store hours in
  it. mark-won transfers QB's hour estimates (fabrication = fabHours;
  approval_fab_pack = fabpack+strEng+architect+draughtsman+connDesign;
  installation = crew×days×8) via `computeQuoteHoursByCategory()` in QB, with
  a blob-parse fallback server-side. Project Tracker's Hours Scheduled reads
  labour_hours (legacy hours-in-quantity honoured only when quantity>1).

- **Regulated declarations are configuration, not AI output.** A Declaration of
  Performance (EN 1090-1 / CPR Annex III) contains prescribed fields — notified
  body number, FPC certificate number, AVCP system, declared performance,
  execution class. These are constants off BAMA's UKCA certificate and must be
  stored as verified config (seeded blank, entered once, reused), exactly like
  `NdtExtentRules`. **AI never drafts them**; it drafts only free-text product
  description. Note the terminology: structural steel gets a *Declaration of
  Performance* (regulated), not a "Declaration of Conformity"; a *Certificate of
  Conformity* is a separate contractual document whose figures must still come
  from ERP records rather than being invented.
- **Money: round at every step, and totals are sums of printed lines.**
  One place for all of it — the **MONEY** section at the top of `shared.js`:
  `_r2(v)` (round one value), `sumMoney(list, pick)` (round each line, then the
  running sum — so a total always equals the figures printed beside it),
  `pctOf(value, pct)` (VAT / retention / markup), and the formatters `gbp2`
  (£1,290.30, anything reconciled to the penny), `gbpWhole` (£1,290, client
  quote PDFs) and `gbpShort` (£1.3k, dashboard tiles only, never on a
  document). **Never** write `.reduce((s, x) => s + x.amount, 0)` on money.
  Gated by `tests/money-rounding.js` — run it before any push touching
  monetary maths or formatting. NOTE: `dashboard.html` and
  `quote-builder.html` do NOT load shared.js, so each carries a standalone
  copy of its formatter; the test compares them against the canonical helpers
  and fails if they drift, and also fails if either page starts loading
  shared.js (at which point delete the duplicate).
- **One AI model constant.** `AI_MODEL` at the top of `shared.js` is the only
  client-side model string; `api/src/functions/claude-proxy.js` applies a
  server-side default (env `AI_MODEL_DEFAULT`, fallback pinned in the file) when
  `body.model` is absent — which is what the standalone pages (`quote-builder.html`,
  `dashboard.html`) do. Never write a literal model id anywhere else.
- **Always run `node --check shared.js` after editing it.** It's ~56,800 lines of
  global-scope JS (source-regex gates in `tests/` cover parts of it; nothing
  unit-tests it) — a syntax error breaks every page at once.
- **Run `python3 preflight.py <file.html>` before every push that touches an
  HTML file.** Acorn only catches *syntax* — it sails past the bugs that have
  actually cost us hours: a `getElementById` for an id that doesn't exist (modal
  never opens — the babcockEmailModal bug), an `async` function called without
  `await` (result is a Promise, renders as `[object Promise]` — the nextQuoteRef
  bug), an `onclick="foo()"` with no `foo` defined (nothing happens on click).
  `preflight.py` runs Acorn on every inline `<script>` block PLUS these intent
  checks. **ERRORS block the push; fix them. WARNINGS need an eyeball** — most are
  fire-and-forget async (fine) or ids defined in shared.js (fine), but a missing
  `await` on `qbFetch`/`trFetch`, or a `getElementById('x')?.value` where `x`
  doesn't exist (silent — value never reads, defaults silently) are real and
  must be checked. Run `python3 preflight.py` with no args to check all pages.
  Tune `FIRE_AND_FORGET` / `GLOBALS` sets in the script when a warning is a
  confirmed false positive, rather than ignoring the output.
- **Do not touch hub.html OAuth logic without asking first.** The token-handoff
  dance (`#access_token` capture → sessionStorage → `bama_return_page` bounce) is
  load-bearing for every authenticated page. Changes here have broken prod before.
- **Sidebar groups default to expanded.** `renderUnifiedSidebar()` — no
  `collapsed` class on any `sidebar-nav-label-toggle` / `sidebar-nav-subitems`
  at render time (Mateusz, 2026-07-30: Traceability kept hiding its tabs).
  Users can still collapse a group by hand; don't ship one collapsed.
- **Chart.js is loaded in office.html only.** Reports (with charts) have moved from
  manager to office. Don't add the CDN tag to other pages.
- **Tender ↔ Quote financial separation.** Tender-facing views must NEVER show
  financial details (pricing, costs, margins, quote values). Money belongs in
  quote/financial views gated by `viewQuotes` / `editQuotes` permissions; staff
  with only `tenders` permission must not see any monetary information. The
  legacy `tenders.html`/`quotes.html` pages were retired 2026-08-08/09 — the
  live surface is the Tender Register in `dashboard.html` (standalone, no
  shared.js). Always confirm with Mateusz before adding any new info display
  to a tender-facing list.
- **Legacy tender world fully stripped from shared.js (2026-08-09).** The
  tenders.html/quotes.html support code (~2,600 lines: page init/PIN flows,
  tender & quote lists/detail, tender comments/files/notify/reassign, new-quote
  PDF wizard, quote line-item editor, client-detail page view, dead nav
  helpers, Send Later button in the Babcock email modal) is DELETED. Kept and
  still live: client list + quick add/edit contact flow (Office Clients tab,
  `_ensureClientModals()`), `formatFileSize`, `openAttachQuoteModal` (project
  tracker — the reason tenders.js API keeps read-only GET). Don't reintroduce
  references to `tendersData`, `currentTender`, `openTenderDetail`,
  `renderQuoteList`, `loadQuoteLineItems` etc. — they no longer exist.
- **Bama SW PO figure is NET of project PO expenses (2026-08-09).**
  `handleAdvanceFromPaymentReceived` (shared.js) computes the Raise-PO-to-
  Bama-SW amount as pre-markup value MINUS the linked project's PO spend:
  every non-Cancelled PO on `linked_project_id`, netted of VAT via `_poNet`
  and summed with `sumMoney` — the same definition as Project Tracker's
  Running Cost tile, so the figures agree across modules. The Bama SW PO
  itself is never a PurchaseOrders row (PDF + babcock-quotes fields only),
  so it can't self-deduct. Non-fatal: if the PO fetch fails, the undeducted
  figure is shown with a warning toast + note in the modal
  (`#bptbsBreakdown` in babcock.html shows the deduction breakdown).
- **Babcock payment cascade (2026-08-08).** Marking money movements in
  the invoicing ledgers now mirrors onto the Babcock tracker via
  `api/src/babcock-cascade.js` (`advanceBabcockOnPayment`):
  sales invoice on a BC project fully Paid ⇒ 'Approved to Pay' →
  'Payment Received' (+payment_received_at); Babcock-linked supplier
  invoice marked paid (payment run or PUT paid_at) ⇒ 'Payment Received'
  → 'Paid to Bama SW' (+bama_sw_paid_at). STRICT: only fires from the
  exact prior step — earlier statuses return action:'skipped' and the
  frontend (`babcockCascadeToast` in shared.js) shows a warning toast;
  at/past target = silent noop. Credit notes (gross < 0) never advance.
  ONE-WAY: un-paying never rolls the tracker back. Non-fatal: cascade
  failure never fails the payment write. The old note that financial
  cascades are "Babcock-tracker-only" is superseded.
- **Babcock ↔ Project Tracker status cascade.** When a Babcock-linked
  Project (i.e. `Projects.source_babcock_quote_id` is set) is updated to
  `status = 'Complete'` via `PUT /api/projects/:id`, the API also advances
  the linked `BabcockQuotes` row to `'Project Complete'` — but only if
  Babcock is currently at `'Quote Received'`, `'Quote Sent'`, or
  `'Live Project'`. If Babcock has already passed Project Complete
  (Approved to Pay / Payment Received / Sent to Bama SW / etc.), the
  cascade is a no-op so finance state is never regressed. The reverse
  direction also exists: `handleAdvanceFromLiveProject()` in `shared.js`
  updates the linked Project to Complete when finance advances Babcock.
  Only the `Complete` status mirrors — On Hold / Archived / Cancelled
  changes in Project Tracker do not touch BabcockQuotes. All
  post-Project-Complete steps (COUPA upload + OCR, Approved to Pay,
  Payment Received, Bama SW invoice) remain Babcock-tracker-only.
- **Bump the cache-bust version when shipping UI changes** to `shared.js` or
  `bama.css`. Format: `?v=YYYYMMDD` + letter (`a`/`b`/`c`/… for same-day pushes).
  Example: first push on 2026-03-26 → `?v=20260326a`; hotfix same day → `?v=20260326b`.
  Update every HTML file that references the changed asset.
- **Never delete from `ClockEntries`.** This table is the raw audit trail of
  every kiosk clock-in / clock-out event — it's the source of truth that
  payroll, ProjectHours, and any future dispute resolution relies on. Other
  derived tables (ProjectHours, payroll runs, etc.) can be wiped safely if
  the user requests it; ClockEntries cannot, even on a "full reset". If the
  user asks for a labour-data wipe, default to deleting ProjectHours only
  and explicitly confirm before touching anything else. Don't suggest
  deleting ClockEntries even as a "full reset" option.
- **Never guess whether a migration has run — ask the database.**
  ED › Health › **Database migrations** calls `GET /api/schema-check`, which
  probes `sys.tables` / `sys.columns` (and the QmsForms seed rows) against
  `api/src/schema-manifest.json` and reports every script in `api/sql/` as
  applied / part-applied / needs-running / data-only. Regenerate the manifest
  with `python3 api/sql/build-manifest.py` and commit the JSON **in the same
  commit as any new migration**, or the new script won't be checked. Data-only
  scripts (backfills, imports, constraint widenings) can't be probed
  structurally and are deliberately listed as unverifiable rather than assumed.
  **Retired tables** (`RETIRED_TABLES` in `build-manifest.py`, currently
  `TenderComments`) are dropped from every probe: a script that only created
  retired tables reports *retired — not required*; one that also creates live
  tables keeps its live probes. Never run a retired script to turn Health green.
- **Paste SQL migrations inline in chat — never just reference the path.**
  When a change requires a `.sql` script under `api/sql/`, the user runs it
  manually against `bama-erp` (Azure portal Query Editor). They expect the
  full script in the chat reply ready to copy-paste, not "see
  api/sql/foo.sql". Commit the file to the repo as well, but the chat must
  contain the runnable SQL. Same applies to any ad-hoc one-off queries.
- **Restart the Function App after `ALTER TABLE ADD COLUMN`.** Even after
  the migration runs cleanly and `sys.columns` confirms the column exists,
  the running Function App can hold a cached query plan on the OLD schema
  in its `mssql` connection pool. Symptom: backend throws `Invalid column
  name '<newcol>'` for several minutes despite the column existing. Fix:
  portal.azure.com → Function App `bama-erp-api…` → top toolbar → Restart,
  wait ~60s. Always include this in the smoke-test plan when shipping a
  schema change. Don't reserve `exists` as a column alias in verification
  queries either — it's a SQL Server reserved word; use `column_count` or
  similar instead.
- **POs link to Projects via `project_id`, not `job_number`.** A PO that
  belongs to a project must have `PurchaseOrders.project_id` set to the
  matching `Projects.id`. `job_number` is just a human-readable mirror
  (the project_number string) and is **not** what Project Tracker filters
  on — `loadProjectPos()` calls `/api/purchase-orders?project_id=...`.
  The DB enforces XOR via `CK_PurchaseOrders_ProjectXorCostCentre`:
  exactly one of `project_id` / `cost_centre` is set. Bulk PO imports
  must do the project lookup at insert time (or include a backfill
  block at the end — see `import-po-tracker-2026.sql` section 4).
  When fixing this for legacy data, the swap is: set `project_id`,
  null `cost_centre`. Failing to null `cost_centre` will violate the
  check constraint and the UPDATE will fail mid-transaction.

- **Job Sheet (project-level) is the default prefill source for site-facing
  documents.** Each Projects row can have one `ProjectSheets` row (site
  address, site contact, client PO, notes) — one sheet shared by every job
  in the project, keyed by `Projects.id` (`proj.dbId`, NOT the
  project_number string). Edited via the "Job Sheet" modal in
  `projects.html` (buttons in both the project and job detail headers;
  draftsman-editable, read-only otherwise). SDN, Site Pack, and RAMS
  prefill through `_jobSheetResolved(proj)` in `shared.js`: saved sheet →
  project site address → client address. Everything remains editable in
  each document modal. **Supplier DNs (galv / powder coat) are deliberately
  NOT wired to the Job Sheet** — they keep the supplier's own address.
  The sheet carries three role contacts (Commercial / Project Manager /
  Site Manager, each name+phone+email) picked from ClientContacts
  dropdowns (same source as QB) or typed free — newly typed names are
  auto-saved to ClientContacts with their role (non-fatal on failure).
  The site address lives ONLY in ProjectSheets, never on the client
  record, so QB quotations and anything else prefilling from Clients
  keeps showing the head-office address. "Generate PDF" renders a native
  jsPDF Job Sheet (`drawJobSheetPDF` in `shared.js`, drawDnPDF
  conventions: accent section bars, zebra tables, stat cells, footer
  rule; letterhead has company details to the RIGHT of the logo,
  Site Pack style) from the CURRENT modal fields, uploads it to the PROJECT FOLDER
  ROOT on SharePoint as `Job Sheet - <projno>.pdf` (overwrites on
  regenerate) and opens the SharePoint copy; falls back to a blob tab
  if SharePoint is unreachable. The modal is wiped via `_jsResetModal()`
  on every open (the DOM persists between projects — without the wipe,
  contacts leak between projects), `loadJobSheet` promise-caches the
  in-flight fetch (fast-click race), and the auto address prefill order
  is: saved sheet → project site → QB quotation site address → client
  head office.
  The sheet also shows (read-only): quoted figures pulled from the linked
  won QB quote (`GET /api/project-sheet/{id}/extras` — fab/design hours,
  site crew, tonnage via JSON_VALUE on quote_data; link resolved through
  QuoteBuilderQuotes.project_id OR ProjectQuotes; when no QB quote is
  linked, falls back to the Project Tracker — source Tender reference +
  quote_value, marked source:'tracker', shown as a Quote value stat; the
  PDF's Quoted stat cells render only the figures the quote actually
  carries), and a per-job
  fabrication summary (members + tonnage = SUM(quantity*total_weight_kg)
  from JobAssemblies). A "Hours & variations" ledger
  (`ProjectSheetRevisions`: base quote + VOs, each optionally pinned to a
  job, job_id ON DELETE SET NULL) records what hours were allocated to
  which job; CRUD via GET/POST
  `/api/project-sheet/{id}/revisions` + DELETE
  `/api/project-sheet-revisions/{id}`. "Fill base from quote" seeds the
  add-row from the quotation. The Job Sheet buttons live in the
  draftsman bars (next to Add Job on the project screen, and on the job
  screen bar) — NOT in the page headers.
  API: `GET/PUT /api/project-sheet/{projectId}` (flat route, upsert).
  Migration: `api/sql/add-project-sheets.sql` (new table — no Function App
  restart; also drops the short-lived per-job JobSheets / v1
  ProjectSheets shapes if present).

## Architecture at a glance

Two independently deployed pieces:

1. **Static frontend** — plain HTML + one shared `shared.js` + `bama.css`, served by
   **Azure Static Web Apps** (hostname `proud-dune-0dee63110.2.azurestaticapps.net`).
   No build step, no framework, no bundler.
2. **API** — **Azure Functions** (Node 22, `@azure/functions` v4, programmatic model)
   at `bama-erp-api` (`bama-erp-api-deauckd2cja7ebd5.uksouth-01.azurewebsites.net`).
   Backed by Azure SQL (`bama-erp-sql` / db `bama-erp`) via `mssql`.

The frontend calls the Functions API directly (cross-origin). It also calls **Microsoft
Graph** directly — but *only* for SharePoint/Excel file operations (PROJECT TRACKER,
Labour Log, drawings PDFs/BOM JSON) and sending mail. All relational data lives in SQL.

## Repository layout

```
/
├── hub.html              — Landing page, also the OAuth redirect target
├── index.html            — Workshop kiosk (clock in/out, log hours, holidays, orders)
├── manager.html          — Manager dashboard (settings, user access)
├── office.html           — Office dashboard (staff, holidays, payroll, reports, archive, etc.)
├── projects.html         — Drawings & jobs (per-project draftsman/build workflow)
├── project-tracker.html  — Project register: live SQL projects from won quotes
├── steel-database.html   — Standalone UK steel section reference (no shared.js, no auth)
├── shared.js             — ~56,800 LOC. Page-aware; every page except hub/steel/dashboard/quote-builder loads it.
├── bama.css              — Single shared stylesheet. Dark theme, CSS variables.
├── staticwebapp.config.json — Azure SWA route: `/` → `/hub.html`
├── .github/workflows/
│   ├── azure-static-web-apps-proud-dune-0dee63110.yml  — deploys frontend on push to main
│   └── main_bama-erp-api.yml                           — deploys API on push to main
└── api/
    ├── host.json                 — Functions host config (route prefix `api`)
    ├── local.settings.json       — Local env (SQL conn string placeholder, tenant/client IDs)
    ├── package.json              — Deps: @azure/functions ^4, mssql ^10
    └── src/
        ├── auth.js               — JWT validation (Microsoft identity)
        ├── db.js                 — mssql pool + parameterised query helper
        ├── responses.js          — CORS + JSON response helpers
        └── functions/            — One file per domain, each registers routes with app.http(…)
            ├── clockings.js      — clock-in, clock-out, CRUD
            ├── clients.js        — Client database CRUD + search/autocomplete
            ├── drawings.js       — DrawingJobs + elements + notes
            ├── employees.js      — CRUD
            ├── holidays.js       — request / approve / reject, balance maintenance
            ├── keep-warm.js      — timer trigger: every 4 min, Mon–Sat 05:00–20:00
            ├── payroll.js        — week approval + PayrollArchive
            ├── project-hours.js  — CRUD + grouped summary
            ├── projects.js       — Projects CRUD + Won-quote conversion lookup
            ├── settings.js       — Settings KV + PIN verify + /api/health
            ├── tenders.js        — Tenders CRUD + reference generation + status changes
            ├── traceability.js   — welding machines, service types, suppliers
            └── user-access.js    — UserPermissions + AccessRequests
```

## Data flow

1. Browser lands on `hub.html`. If `#access_token=…` is in the URL (post-login
   redirect), `hub.html` stores the token in `sessionStorage` and bounces to the
   return page stored under `bama_return_page`.
2. On any non-hub page, `shared.js` runs `init()` which:
   - Handles the OAuth hash (if present)
   - Fires `/api/health` as a warm-up (the Function App goes cold quickly)
   - Calls `loadTimesheetData()` — parallel GETs of `/api/employees?all=true`,
     `/api/clockings`, `/api/project-hours`, `/api/holidays`, `/api/settings` —
     with 3 attempts and generous timeouts (cold starts can take 15–25 s)
   - On the kiosk/projects pages, also pulls `state.projects` from
     **PROJECT TRACKER.xlsx** on SharePoint via Graph
   - On manager/office/projects, also pulls `loadUserAccessData()` (from API now)
   - Populates `state.timesheetData.{employees,clockings,entries,holidays,settings}`
     and builds name↔id maps (`_empNameToId` / `_empIdToName`)
3. User actions call targeted endpoints via `api.get/post/put/delete`. Local state
   is patched optimistically so the UI feels instant; no global save.

## Authentication & authorisation

Two layers:

> ⚠️ **Implicit flow is deprecated by Microsoft** and migration to auth code + PKCE
> is queued. Do not build new features that assume the current hash-fragment
> handoff will stay forever — but also don't casually refactor it; see the rule
> about hub.html above.
>
> ℹ️ **PINs never leave the API.** `api/src/functions/employees.js` strips `pin`
> from every row it returns and substitutes `has_pin`; all PIN gates go through
> `POST /api/auth/verify-pin` (`settings.js`, called from `shared.js`). Don't
> reintroduce a client-side compare. (Corrected 2026-09-05 — the old note said
> PINs were loaded to the client; that stopped being true when employees.js
> started stripping them.)

**1. Microsoft login (who are you?)** — OAuth2 implicit flow against Azure AD.
- Tenant: `c92626f5-e391-499a-9059-0113bd07da2d`
- Client: `04b702fd-c53c-4f38-94bc-0334ce91d954`
- Scopes: `Files.ReadWrite Sites.ReadWrite.All Mail.Send` (Graph-scoped — the token
  works for both Graph *and* our API)
- Redirect URI is the SWA root (`https://proud-dune-0dee63110.2.azurestaticapps.net`).
  `hub.html` catches the fragment, stores `bama_token` + `bama_token_expiry` in
  sessionStorage, and bounces back using `bama_return_page`.
- `AUTH.login()` uses `prompt=none` (silent); `AUTH.loginInteractive()` is the
  visible fallback. `apiCall()` handles 401s by clearing the token and attempting
  a silent relogin once.

**Backend verification** (`api/src/auth.js`) — `requireAuth(request)` is called at
the top of every handler:
- Checks `exp`, `nbf`, audience, issuer, then **verifies the RS256 signature**
  (since 2026-09-05; before that only `kid` presence was checked — forged tokens
  passed). Two-stage, "B+C":
  - **B — local RS256** against Microsoft's JWKS (`node:crypto`, no dependency).
    Graph access tokens carry a header `nonce` and Microsoft signs the header
    with `nonce` replaced by `base64url(SHA-256(nonce))` — `verifyRs256()` tries
    the raw header, then the nonce-normalised one. Unknown `kid` → JWKS is
    re-fetched once (key rotation) before rejecting. `alg` must be `RS256`.
  - **C — Graph introspection fallback**, ONLY for a nonce-carrying token that
    fails B (i.e. Microsoft changed the nonce scheme): `GET /v1.0/me` with the
    token, require `/me.id === payload.oid`; cached by SHA-256(token) until `exp`
    (negatives 5 min). Never accepts without B or C succeeding.
  - Gate: `node tests/auth-token.js` (25 cases, injected JWKS + stubbed
    introspector, no network). Run before any push touching `api/src/auth.js`.
  - **Permanent fix (queued, MSAL session):** expose an API-audience scope
    (`api://<client-id>/access_as_user`) on the app registration, have the
    frontend request a Graph token *and* an API token, and send the API token to
    our API. Its `aud` is our client id and it has no nonce, so plain RS256
    applies — at that point delete the nonce normalisation, the introspection
    path and the Graph audiences from `validAudiences`.
- Accepts audiences: our client ID, Graph (`https://graph.microsoft.com`), and Graph's
  app ID (`00000003-0000-0000-c000-000000000000`). That's why Graph-scoped tokens are OK.
- Accepts v1 and v2 issuers for our tenant.
- Returns either a user object `{userId,name,email,roles,raw}` or a 401 response.
  Callers check `if (auth.status) return auth;` to short-circuit.

**2. App permissions (what can you do?)** — per-employee permission flags stored in
the `UserPermissions` table, surfaced via `/api/user-access`. Frontend holds them
on `userAccessData.users[name].permissions`.

Permission keys (`PERMISSION_DEFS` / `PERM_TO_TAB`):
`byProject, byEmployee, clockingInOut, payroll, archive, staff, holidays, reports,
settings, userAccess, draftsmanMode, tenders, editQuotes, viewQuotes,
editProjects, viewProjects, viewPurchaseOrders, editPurchaseOrders, invoicing`.

⚠️ When adding new permission keys, update **all four places**:
1. `PERMISSION_DEFS` array in shared.js
2. `loadUserAccessData()` in shared.js — must map snake_case row → camelCase
3. `toggleUserPermission()` default permissions object in shared.js
4. `permCols` and `keyMap` in `api/src/functions/user-access.js`
5. SQL `UserPermissions` table — add column with default 0
Skipping any of these causes silent permission resets, "no valid fields" errors,
or bootstrap logic falsely re-granting all perms.

PIN gate: manager/office/draftsman/tenders entry requires the employee's numeric
`pin` (stored on the Employees row). Verified via `/api/verify-pin`. After successful
PIN, `currentManagerUser` is stored in `sessionStorage.bama_mgr_authed` so navigating
between manager/office/tenders pages skips re-authentication.

**Bootstrap** — if *no* user has any permission yet, the first user to PIN into
manager/office is auto-granted full admin. See `checkManagerPin`/`checkOfficePin`.

## Database schema (inferred from queries — no migrations in repo)

Core tables:
- `Employees(id, name, pin, rate, staff_type, erp_role, holiday_balance,
  holiday_entitlement, is_active, created_at, …)`
- `ClockEntries(id, employee_id, clock_in, clock_out, break_mins, source,
  is_amended, amended_by)` — `source` in {`kiosk`,`manual`}
- `ProjectHours(id, employee_id, project_number, date, hours, week_commencing,
  is_approved, created_at)`
- `Holidays(id, employee_id, date_from, date_to, type, reason, working_days,
  status, submitted_at, decided_at)` — `type` in {`paid`,`unpaid`}; balance is
  deducted on approve / restored on delete when paid.
- `PayrollArchive(id, employee_id, week_commencing, total_hours, basic_hours,
  overtime_hours, double_hours, rate, basic_pay, overtime_pay, double_pay,
  total_pay, archived_at)`
- `Settings(key, value, updated_at)` — value stored as string, JSON-parsed on read.
- `UserPermissions(employee_id, by_project, by_employee, clocking_in_out, payroll,
  archive, staff, holidays, reports, settings, user_access, draftsman_mode,
  updated_at)`
- `AccessRequests(id, employee_name, reason, status, created_at, updated_at)` —
  status in {`pending`,`dismissed`,`approved`,`rejected`}
- `DrawingJobs(id, project_number, job_name, finishing, transport,
  sharepoint_file_id, is_complete, completed_at, completed_by, created_at)`
- `DrawingElements(id, job_id, element_name, quantity, is_complete, completed_at,
  completed_by)`
- `DrawingNotes(id, job_id, note_text, added_by, created_at)`
- `WeldingMachines(id, machine_name, serial_number, expiry_date, notes, is_active,
  updated_at)` + `WeldingMachineWelders(machine_id, employee_id)` join
- `ServiceTypes(id, name, is_active)` (UNIQUE on name)
- `Suppliers(id, supplier_name, address_line1/2, city, county, postcode, telephone,
  email, contact_name, notes, is_active, updated_at, payment_term_type,
  payment_term_days, payment_dd, is_subcontractor, utr_number, cis_rate,
  bank_sort_code, bank_account_no)` +
  `SupplierServices(supplier_id, service_type_id)` join
- `SupplierInvoices` — AP ledger (2026-07-28): many invoices per PO, standalone
  (no PO), optional `babcock_quote_id`. `invoice_type` supplier|subcontractor;
  CIS fields `labour_gross/cis_rate/cis_deduction` with `gross` = amount payable.
  `due_date` computed server-side from supplier terms (NULL for DD) unless the
  client sends an explicit override. Server keeps legacy PO aggregate columns
  in sync via `recomputePoReconciliation` (sum within £1 = matched, over =
  discrepancy, under = unmatched/partial). API: `supplier-invoices.js`
  (CRUD + `supplier-invoices-match` with over-match `needs_confirm` handshake +
  `supplier-payment-runs`). UI: invoice-tracker Supplier Invoices tab (chips,
  aged creditors, Match-to-PO, Add/Amend modal with drop-to-parse + CIS toggle +
  quick-create subcontractor, BACS run w/ CSV + per-supplier remittances).
- `SupplierPaymentRuns(id, run_ref, run_date, method, period_from/to,
  invoice_count, total_gross, notes, created_by)` — BACS runs; creating one
  marks its invoices paid
- `Clients(id, company_name, address_line1/2, city, county, postcode,
  contact_name, contact_email, contact_phone, notes, is_active, created_at,
  updated_at)` — UNIQUE on company_name
- `Tenders(id, reference, client_id, project_name, comments, status,
  quote_handler_id, sharepoint_folder_id, sharepoint_tender_folder_id,
  created_by, created_at, updated_at, converted_at, converted_by)` —
  status in {`tender`,`quote`,`won`,`lost`,`cancelled`}; reference format
  `Q260402` (Q + YY + sequential count for the year, NOT per-month). SharePoint
  folders auto-created under `Quotation/{NN - YYYY}/{reference}/` with
  `00 - Tender` subfolder. Year folder format: `(year - 2023) - YYYY` so
  2026 = `03 - 2026`, 2027 = `04 - 2027`. Reference numbering scans existing
  SharePoint folder names + DB records to find the next free number.
  Contact fields (name/email/phone) stored on the tender, not the client,
  since they vary per project even with the same client.
- `ClientContacts(id, client_id, contact_name, contact_email, contact_phone,
  role, notes, created_at, updated_at)` — multiple contacts per client
  (e.g. project manager, foreman, accounts). ON DELETE CASCADE. Auto-populated
  when a tender is created with contact details, deduplicated by case-insensitive
  match on (contact_name + contact_email).
- `TenderComments(id, tender_id, comment, created_by, created_at)` — threaded
  comments on a tender. ON DELETE CASCADE so removing a tender drops its
  comments. The original `comments` field on Tenders is rendered as the
  first "(initial)" entry in the thread for backwards compatibility.
- `Projects(id, project_number, project_name, client_id, status,
  source_quote_id, quote_value, deadline_date, comments,
  sharepoint_folder_id, sharepoint_quote_folder_id, project_manager_id,
  start_date, completion_date, created_by, created_at, updated_at)` —
  status in {`In Progress`, `On Hold`, `Complete`, `Archived`, `Cancelled`}.
  `project_number` has three prefix conventions:
  - **`C######`** — BAMA projects converted from a won Quote
    (`Q260502` → `C260502`). Created automatically via
    `convertQuoteToProject()` in shared.js when a quote transitions to
    `won`. `source_quote_id` FKs to the originating `Tenders` row.
  - **`BC######`** — Babcock projects converted from a won Babcock
    Quote (`BQ###` → `BC###`). Created via the Babcock cascade flow.
    SharePoint: BC folders live in `06 - Projects/<year>/01 - Babcock/`
    (spBabcockProjectParent), not directly in the year folder — applies
    to both the BQ→BC conversion and BC-numbered manual projects
    (Mateusz 2026-08-08).
  - **`S####`** — legacy / pre-ERP project references (e.g. `S1965 -
    Brookhurst Farm`, `S1982`, `S1998`). Imported manually or carried
    over from the spreadsheet era; no `source_quote_id`. Still appear
    in Project Tracker, kiosk pickers, LabourLog (`S/C-prefix` are
    "productive"), and PO `job_number`. New S-refs aren't allocated
    by the ERP — they're only inserted by data imports.
  SharePoint folders auto-created flat under `Projects/{C-ref - Client - Project}/`
  (no year folder layer — different from Quotation/ which is grouped per year)
  with 9 standard subfolders (`00 - RAMS` through `08 - Application for payment`)
  and the source quote folder contents copied into `03 - Quote`. S-prefix
  projects predate the auto-folder convention and may have no SharePoint folder.

## Payroll rules (BAMA-specific)

Implemented in [payroll.js](api/src/functions/payroll.js) `payroll-approve`,
mirrored on the frontend in `calculatePayroll` (shared.js). Both must stay
in sync — same bucket math both sides.

- First 40 hours per week = basic (rate × 1).
- Hours over 40 = overtime (rate × 1.5).
- **Double time only applies to Sunday hours, and only if the employee worked
  Saturday AND Sunday in the same week.** Otherwise Sunday hours count toward
  the normal 40/overtime split.
- **Booked paid holidays** (`Holidays.status='approved'`, `type` in
  `'paid'`/`'half'`) credit 8h (or 4h for half-day) at basic rate. They fill
  the 40h bucket BEFORE worked hours, pushing worked hours into overtime if
  the combined total exceeds 40. Holiday hours themselves are always paid at
  basic rate (never OT, never double).
- **Bank holidays** auto-credit 8h × basic rate to every active payee (CIS
  excluded), no booking required. Same 40h-bucket interaction as booked
  holiday. Stored in `PayrollArchive.bank_holiday_hours` / `bank_holiday_pay`
  separately from booked holiday so the two can be reported on independently.
- **Clock-ins on bank holidays are blocked** at every entry point (kiosk,
  manager add-clocking, kiosk add-missing, API POST/PUT). The workshop is
  closed.
- All totals rounded to 2 dp. Write + `UPDATE ProjectHours SET is_approved=1`
  runs in a single `mssql` transaction; rollback on error.

## Holiday rules

- Holiday year starts `2026-03-30` (`HOLIDAY_YEAR_START` in shared.js).
- Default annual entitlement is 28 working days (20 + 8 bank) — see
  `DEFAULT_ANNUAL_DAYS = 20`. Per-employee override via `holiday_entitlement`.
- UK bank holidays are hardcoded in `UK_BANK_HOLIDAYS` (shared.js) and
  mirrored in `api/src/bank-holidays.js`. **Update both** when the calendar
  changes. Roadmap: move to a Settings/DB row.
- `working_days` is computed client-side (`countWorkingDays`) excluding
  weekends and bank holidays, then sent to the API. Bank holidays therefore
  don't deduct from `holiday_balance` (consistent with the 28 = 20 + 8
  entitlement model).
- Paid holidays decrement `holiday_balance` only on approval; deleting an
  approved paid holiday restores the balance.
- See [docs/SPEC-holiday-payroll.md](docs/SPEC-holiday-payroll.md) for the
  full design and worked examples.

## Projects & drawings

- The **project list** for the kiosk dropdown and dashboards still lives in
  `PROJECT TRACKER.xlsx` on SharePoint (drive `CONFIG.driveId`, item
  `CONFIG.projectTrackerItemId`). `loadProjects()` reads whichever sheet has
  `Project ID` + `Project Name` + `Status` headers, filtering to `In Progress`.
  `FALLBACK_PROJECTS` (shared.js ~450–508) is used if SharePoint is unreachable.
- `writeApprovedToLabourLog()` appends approved project-hour rows to the **Labour Log**
  sheet in the same workbook (cols A–E + H). Columns F/G have spreadsheet formulas
  and are left alone.
- `writeUnproductiveTimeLog()` posts unproductive/`S000` rows to the
  **Unproductive Time** sheet.
- **Drawings metadata + BOM** are stored as JSON files (`drawings.json`,
  `bom-<projectId>.json`) in the SharePoint timesheet folder
  (`CONFIG.timesheetFolderItemId`), read/written via Graph. Jobs themselves also live
  in SQL (`DrawingJobs` table) — the Graph-side JSON tracks richer structure
  (approval revisions, tasks, files, notes) that hasn't been migrated yet.

### Assembly OCR — dual drawing formats (2026-07-28)

`ocrAssemblyPdf` (shared.js) auto-detects the drawing layout:
- **Layout 1 (Tekla)** — top-right summary table with part rows + totals;
  bottom-centre "N No. Mkd X (finish)" text. Original behaviour.
- **Layout 2 (sketch/SolidWorks, e.g. The Stonemasonry Company)** — no parts
  table; title block bottom-right ("Sketch Contents" = assembly name,
  "Quantity required" + "QUANTITY N" box = qty, QUANTITY box wins), parts
  derived from section/plate callouts (SHS/RHS/RSA + Overall Height as
  length; "20mm Plate" → PLT20), material from "All plates S355" notes,
  finish from "-Paint Red Oxide" notes. Area/weight null — NEVER estimated
  (two-engine rule; AI copies printed values only).
Envelope return: `{assemblies:[...]}` (legacy single object normalised into
it) or `{skip:true, reason}` for GA/overview sheets. `onAssemblyFilesPicked`
skips GA sheets (file stays in SharePoint, toast) and queues one review card
PER assembly — multi-variant sheets ("Column 1-C & 2-C, QUANTITY 1 OF EACH",
thermal-break plate arrays) yield several cards sharing one SharePoint file.
max_tokens 3000.

### New PO modal: add-supplier flow (2026-07-28)

The main New PO supplier picker (`filterPoSuppliers`) previously dead-
ended at "No suppliers match" — a PO couldn't be raised for an unknown
supplier (the Instant PO flow already had add-supplier; the main modal
didn't). Now, QB-style:
- Ltd/Limited/PLC/punctuation-insensitive matching ("did you mean" list)
- Dropdown ALWAYS ends with `＋ Add "<typed>" as a new supplier` →
  inline form in po-tracker.html (`poNewSupplierForm`: name required,
  contact/phone/email optional) → `savePoNewSupplier()` POSTs
  /api/suppliers, pushes `_poSuppliersCache`, auto-selects.
- Last-chance duplicate guard: exact normalised name match pops
  bamaConfirm "Use existing / Create new anyway".
- Form includes full address (line1/2, city, county, postcode) — sent to
  POST /api/suppliers; warning toast if saved address-less (POs print the
  supplier address).

### --bg-darker CSS variable fix (2026-07-28)

`var(--bg-darker)` was used ~50× (shared.js, projects, invoice tracker…)
but NEVER DEFINED in bama.css :root → resolved transparent. Visible
symptom: RAMS personnel roster dropdown rendered see-through over the
sections text. Now defined `--bg-darker: #0a0a0a` in :root. bama.css
cache-bust bumped (bama.css?v=20260728a — CSS has its own version param).

### DN/AFP PDF long-text overflow + AFP folder fix (2026-07-28)

- **DN (`drawDnPDF`)**: Mark cell now wrapped via splitTextToSize measured
  in BOLD (it prints bold — measuring in the active normal font under-
  measures). Mark col widened 20→42mm (sketch-style names), Profile 40→34,
  minor trims elsewhere; markLines included in row-height calc.
- **AFP (`drawAfpPDF` section pages)**: item description was split while
  the PREVIOUS row's normal 7.5pt font was active but printed bold 8.5 —
  overflowed into Quote No. Font now set to bold 8.5 BEFORE
  splitTextToSize. RULE: always set the print font before measuring.
- **AFP SharePoint path**: 3 call sites used 'Application for Payment'
  (created a duplicate folder) — corrected to the standard
  '08 - Application for payment' from the project folder list.

### Assembly save 500/409 fix (2026-07-28)

Root cause of mass 500s on sketch-style batches: `job-assemblies-create`
threw when a part had no `part_mark` — sketch drawings have none. Fixes:
- **Server** — only `profile` required; missing `part_mark` defaults to
  `P{n}` (Function App redeploy, no migration).
- **Client** (`onAssemblyFilesPicked`) — parts get descriptive default
  marks from the profile prefix (SHS/RHS/RSA…, else P{n}) before queueing.
- **409 cause**: two sheets can share a title ("Top Column RSA Bracket"
  ×2) hitting UQ(job_id, mark). `_armDedupeMark(mark, pendingQueue)`
  suffixes " (2)", " (3)"… checking the open batch, the in-flight upload
  queue AND the job's existing assemblies (case-insensitive).
- OCR prompt now asks for short descriptive part marks on layout 2
  (SHS / TOP PLT / BASE PLT / GUSSET).
Note: N cards from one merged PDF is BY DESIGN — every sheet (and every
variant on a multi-variant sheet) is its own assembly.

### Assembly review steel-DB auto-weight (2026-07-28)

`steel-data.js` (repo root, NEW) — shared copy of QB's steel engine
(`STEEL_KGM` full UK sections, `findSteelProfile` fuzzy matcher,
`lookupKgM`), extracted programmatically from quote-builder.html. QB keeps
its own inline copy (no-external-JS rule) — when adding sections, update
BOTH or regenerate this file from QB. Loaded by projects.html BEFORE
shared.js; all shared.js callers guard `typeof lookupKgM === 'function'`.

Assembly review cards now auto-resolve weights like a QB take-off:
- `_armFillWeightsFromSteelDb(ocr)` after OCR — fills only NULL part
  weights (kg/m × length_m, PER PIECE — save-time total already × qty);
  flagged `_auto_weight`, rendered green with `data-auto="1"`.
- `armPartCellInput` live on profile/length inputs — recomputes auto
  weights, kg/m tooltip on the profile cell ("SHS 180x180x10 — 52.8 kg/m"
  / "Not in steel database"). Typing in the weight cell clears the auto
  flag — hand-typed weights are never overwritten.
- Plates (PLT20 etc.) have no kg/m — stay null/manual by design.

### Staged / partial fabrication (fab → weld → complete)

Supersedes the old binary "Mark fabricated" flow (SPEC-job-fabrication-rework
§5 describes that original design; the staged model below replaces §5's
mark-fabricated step). Migration: `api/sql/add-staged-fabrication.sql`.

- **An assembly of Q pieces tracks three running counts** on `JobAssemblies`:
  `qty_fabbed`, `qty_welded`, `qty_completed`. Derived (never stored):
  `to_fab = quantity - qty_fabbed - qty_completed`,
  `ready_to_weld = qty_fabbed - qty_welded`,
  `bom_qty = qty_welded + qty_completed`. The fab→weld pool and the
  direct-complete pool are **disjoint** — a raw piece goes down exactly one
  route, and the endpoint caps enforce it. Don't add a path that lets a fabbed
  piece also be "completed" directly (double-counts onto BOM).
- **Two routes to BOM.** Fab→Weld (welding a piece pushes it to BOM), or
  Complete (direct, skips welding — for items that need no weld). Both feed
  BOM via `applyBomDelta`.
- **`status` is derived, not set by hand.** `deriveStatus()` (in
  `job-assemblies.js`, mirrored client-side as `asmIsTerminal` etc.):
  `pending` (nothing done) → `in_progress` (some done) → `fabricated`
  (every piece on BOM). `'fabricated'` is kept as the terminal name so
  existing reads — kiosk 24h window, project progress rollups,
  `confirmCloseJob` — keep working. On reaching terminal the legacy
  `fabricated_at/by/welder_id/welding_machine_id` fields are stamped too.
- **Smart BOM merge (`applyBomDelta`) — SAME-STATUS merge only (2026-08-24).**
  Completing/welding more pieces of an assembly TOPS UP an existing BOM row
  instead of spawning duplicate lines — but ONLY a row whose status equals
  the status a fresh row would get (`pending` if the finish is outsourced,
  else `ready_for_despatch`). For an outsourced finish (galv / powder coat),
  a `ready_for_despatch` row means RETURNED from the supplier — merging new
  raw pieces into it silently marks them as already coated (the "6 of 7 back
  from PPC, 7th completed later" bug). New pieces on an outsourced-finish
  assembly therefore always land on a `pending` line so they can be sent for
  PPC while the returned batch carries on to despatch. Rows frozen onto a DN
  (`at_supplier`/`despatched`/`on_site`) still never merge. The "don't show
  1no B2, 3no B2, 1no B2" requirement is preserved within each status.
  Rollback (`removeBomDelta`) drains `pending` rows before
  `ready_for_despatch` (newest first within each) so un-completing pulls back
  not-yet-sent pieces before ever touching a returned batch.
- **Full action history.** `JobAssemblyActions` logs every fab/weld/complete
  press (stage, qty, operator, machine, bom_item_id, when, who). The counts on
  `JobAssemblies` are the fast-read cache; this table is the audit source of
  truth ("3 fabbed by Ann, 2 by Bob").
- **Endpoints** (`api/src/functions/job-assemblies.js`):
  `PUT /:id/fab | /:id/weld | /:id/complete`, each in one txn. Body carries
  `qty` + operator/machine. Operator+machine are **required** in workshop/kiosk
  for weld & complete, **optional** in draftsman mode and in all bulk actions.
  Legacy `PUT /:id/fabricate` kept as a shim (marks all pieces welded).
- **UI.** Cards (projects.html `renderAssembly`, kiosk
  `renderKioskFabCard`) show progress chips (N to fab / N to weld / N on BOM)
  and offer only the applicable buttons. One stage modal (`openStageActionModal`)
  with a qty stepper defaulting to all-remaining. **Bulk select**
  (`openBulkStageModal`) ticks many assemblies → per-assembly qty boxes + one
  optional operator/machine → sequential calls with a confirm-total popup.
  Both surfaces share the `_bulk*` state in shared.js.
- **Rollback (draftsman only).** `PUT /:id/rollback {stage, qty}` undoes N
  pieces of a stage: un-fab (`qty_fabbed -= N`, cap = fabbed-not-welded),
  un-weld / un-complete (decrement + `removeBomDelta` from the open BOM row,
  cap = min(stage count, open-BOM qty)). Only pieces on an OPEN (no-DN) BOM
  row can be pulled back — anything on a raised DN is frozen and the server
  returns a clear error. Logged to `JobAssemblyActions` with performed_by
  suffixed '(rollback)'. UI: `openRollbackModal` (reuses the stage modal, no
  operator/machine, red confirm) + an "Undo" row on the assembly card.

## Key conventions

- **SharePoint item-id stability rule (2026-08-10 — do not regress).** Graph item
  ids survive renames and SharePoint **web UI "Move to"** — but Explorer /
  OneDrive-sync moves execute as copy+delete and mint NEW ids, orphaning every
  stored `sharepoint_folder_id` / `sharepoint_file_id`. Consequences:
  project-folder resolution (`findProjectFolder`) is stored-id-first → taxonomy
  listing → exact-prefix legacy search, NEVER substring `.includes()` matching
  (C260740 matched inside "BC0089 - Babcock - C2607406", 2026-08-10); every
  drawing-job upload path calls `ensureJobFolderAlive(job)` which re-resolves a
  404ing folder id by name under `<project>/02 - Drawings` and persists it
  (self-heal); full repair after a bad move is `bamaRelinkDrawingJob('<project>')`
  in the browser console (Projects page) — relinks job folders and rewrites
  DrawingRevisionFiles / DrawingElementFiles / JobBomItems file ids by filename
  match via `POST /api/drawings-relink-files`. Tell users to move folders in the
  SharePoint web UI, never Explorer.

- **SQL Serverless cost rule (2026-08-10 — do not regress).** The Azure SQL DB is
  Serverless and must be allowed to auto-pause (~60 min of zero activity). NOTHING
  may hit SQL on a timer outside working hours: `keep-warm.js` deliberately does
  NOT touch the pool, and `startKioskPolling()` (shared.js) is guarded to
  05:00–20:59 Mon–Sat + `!document.hidden`. Any new polling/timer feature —
  frontend or backend — must carry the same working-hours guard, or the DB runs
  24/7 and burns the vCore allowance. Also: the kiosk's `loadTimesheetData()`
  bounds clockings + project-hours to the last 14 days (`?from=`) — kiosk-only,
  every other page loads full history. New list endpoints polled by any page
  should always be date-bounded.
- **One shared.js, page-aware.** The module detects the page it's on via
  `CURRENT_PAGE = 'index' | 'hub' | 'manager' | 'office' | 'projects'` derived from
  `window.location.pathname`. Use this guard for page-specific logic. Steel database
  and hub do not load `shared.js`.
- **Name ↔ ID bridge.** The UI was originally built around employee *names*; the
  SQL schema uses integer IDs. Use `empIdByName(name)` and `empNameById(id)`.
  Always rebuild maps via `buildEmployeeMaps()` after mutating
  `state.timesheetData.employees`.
- **Normalise API rows before pushing to state.** `normaliseEmployee`,
  `normaliseClocking`, `normaliseEntry`, `normaliseHoliday` in shared.js. They
  also convert snake_case to camelCase and split clock timestamps into
  `date` + `HH:MM` strings.
- **No shared save.** `saveTimesheetData()` is a stub that logs a warning — every
  action calls its own targeted endpoint. Don't reintroduce bulk saves.
- **Dynamic UPDATEs.** Handlers build `SET a=@a, b=@b` from whichever fields
  appear in the body. `is_*` booleans go in as `1`/`0`. Always use parameterised
  queries via the `query(sql, {params})` helper — never string-concatenate values.
  (Exception: `payroll.js` interpolates numeric payroll fields inside the
  transaction block — values are all parsed numbers, not user input.)
- **CORS + responses.** Every handler returns via the helpers in
  `api/src/responses.js` (`ok`, `created`, `badRequest`, `notFound`, `unauthorized`,
  `serverError`, `preflight`). They attach CORS headers keyed to an allowlist:
  the SWA origin, portal.azure.com, and localhost:4280. Anything else gets the
  SWA origin as fallback.
- **Auth pattern in handlers.**
  ```js
  const auth = await requireAuth(request);
  if (auth.status) return auth;  // 401 shape has a `.status`; user object doesn't
  ```
- **One `auth.js`, one `responses.js`** — at `api/src/`. The pre-refactor copies
  inside `api/src/functions/` were deleted 2026-09-05; don't recreate them
  (anything in `functions/` is loaded by the v4 host at startup — which is
  exactly why the postInvocation hook lives in `functions/observability.js`).
- **Never `git add -A` report output.** Root `*.pdf` is gitignored (test PDFs
  with real figures were committed 31 Jul/4 Aug and removed 2026-09-05). Check
  `git status` before staging; deliverable PDFs belong under `docs/`.
- **Keep-warm.** `keep-warm.js` runs a timer trigger every 4 min Mon–Sat 05:00–20:00
  to prevent cold starts during workshop hours. Do not rely on it for correctness —
  the frontend also pings `/api/health` on load.
- **No tests, no build.** `npm run test` is a stub. The SWA deploy sets
  `skip_app_build: true` and uploads the repo root as-is. HTML files reference
  `shared.js` / `bama.css` with cache-busting query strings (`?v=20260326b`) —
  bump these when shipping UI changes that must invalidate caches.
- **Secrets.** `api/local.settings.json` contains a placeholder password. In
  production, `SQL_CONNECTION_STRING`, `AZURE_TENANT_ID`, `AZURE_CLIENT_ID` come
  from App Settings on the Function App. Never commit real secrets.

### Office / Company Docs session notes (2026-08-08, afternoon)

- **Policy Studio (ERP-owned policies).** New `Policies` +
  `DirectorSignatures` tables (`api/sql/create-policies.sql`, new tables — no
  restart), `api/src/functions/policies.js` (CRUD + issue transitions
  logChange'd, GET/POST `/api/director-signature`). Frontend panel at the top
  of Office ▸ Company Docs: import existing docx (mammoth, added to
  office.html) or PDF — AI structures sections **VERBATIM** (two-engine: it
  never rewrites compliance wording), section editor, native-jsPDF house-style
  renderer `drawPolicyPDF` with the AUTHORISATION block (statement, signature
  image, signed by/date, next review, revision history) ON the last page.
  One-click sign via stored director signature (canvas capture first time,
  offer to save).
- **Option B revision model — the whole trick.** Staff acknowledgements are
  keyed to the SharePoint FILE id everywhere (mobile Sign Policies tile,
  register modal, ✍ markers). So: re-issuing the SAME revision overwrites the
  same file via PUT `/items/{id}/content` → stable file id → staff signatures
  persist. A content edit on an issued policy bumps the revision (two-button
  save: "Save (same rev)" for typo fixes vs "Save as Rev N+1"), clears the
  file id → next issue creates a NEW file → acks reset naturally. Zero
  changes to the acknowledgements schema or mobile app.
- **Register integration.** Every issue updates the SAME CompanyDocuments row
  (company_document_id link) — issue_date, expiry_date = +review_months, file
  ids — so ED reminders and the duplicate-row trap are handled by
  construction. A `policy_director` acknowledgement is also posted per issue,
  feeding the existing ✍ staleness markers.

- **Policy annual review = director e-signature.** `POLICY_REVIEW_MONTHS = 12`
  in shared.js. `docDirAuthState(fileId)` classifies the latest director
  signature per file as ok / stale (>12 months) / none. Table ✍ marker is
  three-state (green / red / amber); register modal shows a red "Annual review
  overdue" banner with a prominent Re-sign button. After `docDirSignSave`
  records the signature, a bamaConfirm offers to bump the doc's
  review/expiry_date to today +12 months (one tap, replaces editing dates in
  Word). Bump failure is non-fatal — the signature is always safe.
- **Dropzone renewal detection (docSaveCard).** Before saving a dragged-in
  doc, active `_docRows` are scanned for an older version: normalized doc_ref
  match, or same category + normalized-title equality/containment (title >6
  chars). Match → bamaConfirm offers Renew (POST new + PUT old
  `{is_archived:1, superseded_by}` — same mechanics as the 🔁 button,
  reversible from Show archived). Cancel saves as a separate document. Fixes
  the "Natasza uploads the newly signed H&S policy, old one lingers as
  EXPIRED" trap. Supersede failure after a successful save downgrades to a
  toast telling the user to archive manually.
- **Authorised issue PDF (`polFileAuthorisedIssue`).** Director signing files
  a second output next to the register: the ORIGINAL policy PDF with an A4
  "Document Authorisation" page appended via pdf-lib (statement, embedded
  signature PNG, signed-by/date/next-review, logo best-effort) — named
  `<title> — Authorised YYYY-MM-DD.pdf`, filed in the policy's own folder.
  This is the self-contained file for Constructionline/CHAS/clients; the
  register PDF alone doesn't show the authorisation ON the document. PDFs
  only, requires pdf-lib on the page (office.html has it); every failure is
  non-fatal — the DB signature is always recorded first. Word-wrap helper
  `_plWrapText` (pdf-lib has no splitTextToSize).
- **`_docDirAuth` now keeps the NEWEST signature per file** — the
  acknowledgements list is ORDER BY acknowledged_at DESC, so first hit wins
  (previous code let the oldest overwrite, which would have broken staleness).

### QB session notes (2026-08-08)

- **Handover Pack is THE internal document.** The old standalone Cost Breakdown
  was merged into `buildHandoverPackHtml()` (quote-builder.html): cost element
  table, full steel schedule (area-grouped, EA-aware, fittings row), wizard-item
  labour table, engine-effective finishing quantities, delivery section,
  What-If. PDF menu: Quote / Quote + Handover / Handover Pack ('breakdown' mode
  is a legacy alias). Tonnage on the pack ALWAYS includes fittings
  (`totalKgInclFittings`); float displays trimmed to 3dp.
- **The ⚡ wizard NEVER auto-fills Approval & Fab Pack hours.** The detailing
  complexity midpoint (dwizMid) already covers producing approval drawings +
  fab pack; a separate fabpack allowance double-counts. `q.fabpackHours = 0` in
  every design branch of applyWizard; manual entry on Calcs remains. Also:
  `closeWizard()` (Cancel) must NEVER write to the quote — it used to
  force-apply auto hours on close. Only ✓ Apply writes.
- **Wizard tile £ figures come from Global Rates.** `wizSyncRateLabels()`
  rewrites survey/finish/crane/MEWP/prelim/delivery tile labels from `rates.*`
  on every open; `wizDeliveryRate()` maps tile key `hiab_drop` → rates key
  `hiab`. Survey rows priced from `rates.survey`, delivery (tiles, manual rows,
  autoEstimateDelivery) from `rates.delivery` — never hardcode a rate in the
  wizard again.
- **Wizard "heaviest" = heaviest SINGLE piece** (row kg ÷ qty), not row total —
  it's the critical lift weight for crane sizing.
- **Takeoff selection:** master checkbox + per-area + per-sub-area checkboxes
  (`toggleAreaSelect`/`toggleSubareaSelect`); selecting a collapsed group
  expands it first (collapsed rows render no checkboxes), preserving other
  selections across the rerender. Row cbs carry `data-area`/`data-subarea`.
  Any checkbox INPUT inside the takeoff table must pin explicit
  width/height/`flex:0 0 auto` inline — `.data-table input { width:100% }`
  balloons it otherwise.
- **Steel data: two hand-edited copies + one generated file (2026-08-09).**
  Hand-edit STEEL_KGM in BOTH quote-builder.html inline AND steel-data.js
  (loaded by projects.html; bump its `?v=` on change) — QB carries its own
  copy by design (no external JS). Then run
  `node tools/build-steel-sections.js` to regenerate **steel-sections.json**
  (stock/m-qms voice matcher — NEVER hand-edit it; `--check` flag verifies
  freshness) and bump the json fetch `?v=` in stock.html + m-qms.html. Gate:
  `node tests/steel-match.js`. History: the json had drifted (missing the
  2026-08-08 gap-fills) AND carried garbage kg/m on all 377 CHS/SHS/RHS/
  Flat/Round/Square rows (kgm = first designation number) plus nulls on all
  260 purlins — silently corrupting stock tonnage. The generator fixed all
  637 and makes recurrence impossible. **steel-database.html** (reference
  page, inline DATA) is the fourth copy: when adding sections, append rows
  there too. Its RHS + Flat Bar families were regenerated 2026-08-09 with
  mass from STEEL_KGM + exact EN 10210 geometry (ro=1.5t, ri=1.0t spandrel
  method — reproduces blue book RHS 200x100x8 to every printed digit).
  ⚠ KNOWN FAULT: the page's CHS/SHS (and likely bars/alu/stainless)
  Ix/Iy/r/W columns are still WRONG (e.g. CHS 114.3x5 page I=238 vs exact
  257; SHS 100x100x5 page 214 vs 279) — mass/area/surface are fine. Same
  regeneration method applies; awaiting Mateusz's go-ahead.
  2026-08-08 fills: FLT 6–30mm band complete for widths 40–500; EN 10210
  RHS rectangles added (300x150, 180x100, 260x180, 300x100, 350x250,
  400x300, 450x250, 500x200/300 + gauge gaps). RHS masses per EN 10210-2:
  `M = 0.00785*(2t(B+H) − 5.0731t²)`; FLT: `w×t×7850/1e6`, 3 sig figs.
  Before assuming a "missing" section was removed, check `git log -S` — both
  300x150 reports turned out to be original seed-data gaps.

### Quote Builder engines (staircase / spiral / balustrade)

These apply to the wizard engines in `quote-builder.html`. They are hard
conventions — the calibration *numbers* live in `DEFAULT_RATES` in code and are
tuned live, so they are deliberately NOT duplicated here.

- **Steel sections are thickness-first on display.** Flats show as `FLT 12x250`
  (thickness × width), never width-first. `findSteelProfile` canonicalises a
  designation by stripping spaces, upper-casing, and replacing `×`/`/` with `X`;
  FLT lookup is order-insensitive, but every *displayed* form is thickness-first.
  All section inputs (takeoff grid + every wizard Custom field) use
  `attachSteelAutocomplete()` — never a raw native `<datalist>`.
- **EA positional convention.** For per-piece rows: `_unit='EA'`,
  `length=1000` (sentinel — not a real length), `kgm` = weight of ONE piece,
  `qty` = number of pieces. Do not change how EA weight is calculated.
- **Wizard rows are excluded from the global rollups.** Every row a wizard
  injects carries `_excludeFromFabHours:true` (wizard computes its own labour,
  so global fab-hours must not re-count it) and `_excludeFromFittingsBase:true`
  (wizard adds its own fittings line, so the global fittings % must not stack).
  Keep both flags on any new wizard row.
- **`_fixedPrice` rows.** Proprietary items priced flat per piece (spiral
  treads; future glass spigots) set `_fixedPrice` and `kgm=0`. `rowCost()` and
  `rowWeight()` in the totals engine already honour this: a fixed-price row is a
  valid zero-weight row, NOT a "missing kg/m" error. Don't reintroduce a
  missing-weight warning for them.
- **Pop-up / dialog rule (2026-07-27).** NEVER use browser-native dialogs
  (`window.confirm`, `window.alert`, `window.prompt`) in any new or modified
  code. Always the styled dialogs: `bamaConfirm({title, body, icon,
  confirmText, tone:'danger'})` for confirmations — now self-injecting via
  `_ensureBamaConfirmModal()`, so it works on every page with no markup
  needed — and `toast(msg, 'success'|'error')` for notifications. ~27
  legacy native calls remain in shared.js + 3 in quote-builder.html;
  replace them opportunistically whenever touching nearby code.
- **Two-engine principle.** Geometry/weight/labour is pure deterministic JS
  (BS-aware, density 7850). The AI (drawing recognition) only READS — it never
  does arithmetic, and returns null rather than guessing.
- **Never guess domain values.** Section weights, labour rates, purlin weights,
  spigot weights etc. come from published data or Mateusz's real workshop
  figures — never invented.
- **Help is part of done.** Any new Quote Builder feature updates the in-app
  Help (`HELP_CONTENT` in `quote-builder.html`) in the same change, not later.
- **`knownPrefixes` must list UA explicitly.** `findSteelProfile`'s prefix
  scan (`knownPrefixes`) includes `UA` (before `EA`). Without it, an explicit
  `UA 200*100*10` falls through to the no-prefix dimension inference, which
  mis-tags a 3-dim section as RHS. The separate `EA`→`UA` reclassification
  (unequal legs) still handles bare `EA`/`ANGLE` input — both paths are needed.
- **Don't full-render the wizard-labour list on every keystroke.** The
  Staircase & Balustrade Labour block's inputs use `oninput` → `recalcAll`.
  `recalcAll` calls `updateWizLabourTotals()` (patches the `£` result cells +
  per-item/block totals in place by id: `wlres-{kind}-{idx}-{bucket}`,
  `wltot-{kind}-{idx}`), NOT `renderWizLabour()`. A full `renderWizLabour`
  rebuilds `innerHTML` and steals focus mid-type (the old "one digit then
  re-click" bug). Structural changes only (advanced toggle, inject/delete,
  reset, and `onblur` to surface the ●edited marker) call `renderWizLabour`.
- **Per-area lock vs per-cat lock.** `areaPricingLocks` holds individual
  `id|cat` pins (auto-created when a single category is hand-edited).
  `areaFullLocks` holds whole-area locks: `toggleAreaLock(id)` snapshots the
  area's current 5 computed cat figures into `areaPricing[id]` and pins all 5,
  so the area's price is held when other areas are added/removed (only unlocked
  areas share the fixed-mode rebalance). A locked area stays editable —
  `setAreaCost` just updates the pinned value and leaves `areaFullLocks` intact.
  Unlock clears that area's pins. Both are backfilled as `[]` for old quotes.
- **Area breakdown reconciles to the global headline (penny-exact).**
  `computeAreaBreakdown` ends with a reconciliation step: the sum of per-area
  totals is forced to equal `G.total` (the single-pass `computeQuoteTotals`
  figure the client PDF and Calcs summary quote). When areas are locked, the
  pinned 2dp values can stop summing to `G.total` (no unlocked area absorbs the
  remainder). The gap is folded into the **largest** area's pre-margin material
  (a real cost line, so the detailed per-area PDF's category sums also
  reconcile), then that row's subtotal/margin/total/shared are rebuilt and a
  final 1p residual is settled on its total. The global stays authoritative;
  the breakdown is adjusted to match it. Don't reintroduce a path where the
  area table and the headline can show different grand totals.
- **Client prices are quoted to the whole pound.** `computeQuoteTotals`
  returns `total` rounded to whole £ (the authoritative client price used by
  the Calcs summary, all PDFs, the area breakdown and the deposit); `totalExact`
  keeps the 2dp figure for internal ratios (cost/kg). `buildClientLines` rounds
  each post-margin sell line to whole £ and then settles the rounding remainder
  on the largest line so `Σ lines === Math.round(total)` exactly — the client
  never sees line items that don't add up to the headline. `fmt` (Calcs) and
  `fmtGBP` (PDFs) both display whole £. Don't reintroduce 2dp client prices or
  a path where rounded lines don't reconcile to the rounded total.

For editing/testing protocol (anchor-based single-occurrence `str.replace` with
an `assert count==1`, Node unit tests for pure engine functions before UI work,
one logical change per commit) and the mandatory `preflight.py` run, see the
**Rules for Claude Code** section at the top of this file.

### In-page PDF rendering (html2pdf / html2canvas)

Applies to every flow that builds an HTML document string and rasterises it to
a PDF in the browser: delivery notes (`buildDnHtmlV2` +
`renderDocHtmlToPdfBlob`), the QB client quote (`renderQuotePdfToBase64`), and
any future document renderer. This has produced a silent **blank white PDF**
twice — once in QB, once in the DN flow. The failure modes:

- **Scope the stylesheet to a root class — never rely on `body` selectors.**
  The capture path injects the markup into a `<div>` on the live app page, so a
  `body { color:#222 }` rule *structurally cannot match*. The content then
  inherits `bama.css`'s `body { color: var(--text) }` (`#f0f0f0`) and paints
  near-white text onto the white canvas: a page that looks blank but isn't
  empty. Scope everything under a wrapper class (the DN uses `.dn-root`) and
  wrap the body content in that element. Bare element selectors (`table`,
  `th`, `td`) and a global `* { }` reset must be scoped too, otherwise they
  leak out and restyle the surrounding app during capture.
- **Never position the capture container off-screen.** `position:fixed;
  left:-10000px` captures blank. html2canvas needs the element actually laid
  out and *painted*: use `position:absolute; left:0; top:0; z-index:-9999`
  with an explicit px width (A4 at 96dpi ≈ 794px), fully opaque — no
  `opacity:0`, no `display:none`, no `mm` widths.
- **Await image load before rasterising.** The BAMA logo is a data URI that
  still needs a decode tick; capturing early drops it silently. Resolve on
  `load`/`error` per `<img>` with a safety timeout.
- **Log the blob size.** A healthy A4 document is tens of KB; under ~8KB means
  a blank capture. Both renderers log size + the element's bounding rect so the
  next regression is visible in the console instead of silent.
- **The template preview does not exercise this path.**
  `refreshTemplatePreview` uses `iframe.srcdoc`, where the markup is a real
  document with a real `<body>` — so a document can preview perfectly and still
  export blank. Test the actual generate flow, not the preview.

### Site Pack generator (projects.html — Site Installation)

Generates a site-installation pack PDF for the crew, replacing the by-hand
version. Lives on the Site Installation element (`renderSite()`), button
"📋 Generate Site Pack" next to Upload File (draftsman, open job). All code is
in `shared.js`; the modal (`sitePackModal`) is in `projects.html`.

Two-engine split, same principle as QB Quote Helper:
- **Deterministic (no AI):** header (from `currentProject` — project_number,
  project_name, client, site_* address/contact), Prepared by (draftsman),
  Grade default, and the **Fasteners table** — pulled straight from the job
  BOM loose items (`_bomItemsByJob[jobId]` where `item_type` is `fixing` or
  `consumable`). AI never counts fixings; the BOM is authoritative.
- **AI (`/api/claude-proxy`, `AI_MODEL`):** ONLY the Scope of Work.
  `sitePackGenerateScope()` fetches the ticked drawing(s) from the job's Site
  Installation files (Graph `/drives/{driveId}/items/{fileId}/content` →
  base64), attaches them as image/document blocks (same shape as QB staircase
  recognition), and asks for numbered installation instructions. Reader-only
  prompt: it describes what/how to install, never invents quantities or
  dimensions. 429-retry + deterministic template fallback so the user is never
  blocked. Everything is editable in the modal before generating. A
  **Brief / Extended** selector (`spScopeDetail`, default Brief) tunes the scope
  length: Brief is lean install steps for erectors (the detailed method
  statement lives in the RAMS); Extended is a fuller scope for jobs with no
  RAMS or a non-standard install.

The header is a **full-width 4-column info table** (label|value|label|value,
like the original hand-made site pack) with the site address folded in above
the black divider; the drawing references sit in a **full-width DRAWINGS band
below the divider** so any number of drawings wrap horizontally instead of
stacking in a narrow column. The Drawing Ref default and drawing picker exclude
previously-generated Site Packs and dedupe by fileId.

PDF is **native jsPDF** (`drawSitePackPDF` / `renderSitePackPdfBlob`), a direct
copy of the DN renderer (`drawDnPDF`) — no html2canvas. Same logo aspect-ratio
handling, `splitTextToSize` wrapping, page-break with table-header redraw, and
"Page X of Y" footer. On generate, `confirmSitePack()` saves the PDF into the
`05 - Site Installation` SharePoint subfolder and records it via
`POST /api/drawing-elements/{jobId}/file` (`fileContext:'site'`), so it appears
in the Site Installation file list like any uploaded file.

## RAMS generator (Site Installation)

Sibling of the Site Pack — Risk Assessment & Method Statement generator, built
in phases. Button "📋 Generate RAMS" (purple) in `renderSite()`, modal
`ramsModal` in `projects.html`, all logic in `shared.js` (`openRamsModal` /
`ramsGenerateScope` / `drawRamsPDF` / `renderRamsPdfBlob` / `confirmRams`).

Two-engine split, same principle as QB and the Site Pack:
- **Deterministic:** header prefill from `currentProject`/`currentJob`, the
  jsPDF renderer, and **all risk scoring** — `RAMS_RISK_LIBRARY` is a CURATED
  hazard library (hazard, pre/post-control L×S×R, standard control wording)
  seeded from BAMA's three example RAMS. The AI never invents scores or
  control text.
- **AI (`/api/claude-proxy`, `AI_MODEL`):** ONLY drafts the Scope of
  Works + Sequence of Works from the ticked drawing(s) (reader, not
  calculator; 429-retry + deterministic template fallback).

Personnel come from the `SitePersonnel` roster (+ `SitePersonnelCerts` /
`CertTypes`) via a searchable tile picker, with a freeform-textarea fallback if
the roster API is unavailable. RAMS is money-free — no rates anywhere (tender ↔
quote separation applies).

PDF is **native jsPDF** (`drawRamsPDF` / `renderRamsPdfBlob`), copied from the
DN/Site-Pack renderer — no html2canvas. Appendix A is the L×S×R risk table,
Appendix B the briefing register.

**Save (phase 6):** `confirmRams()` uploads the PDF to the **project-level**
folder `<ProjectFolder>/00 - RAMS/<JobFolder>/` (decision B — NOT inside the
job's own SharePoint folder; same `findProjectFolder()` lookup as the DN flow)
and registers it via `POST /api/drawing-elements/{jobId}/file` with
`fileContext:'rams'` — a dedicated context in `DrawingElementFiles`
(allowed-list in `api/src/functions/drawing-elements.js`). The loader hydrates
`job.rams.files` from `data.files['rams']`; they render as a "RAMS documents"
list on Site Installation (`renderFileRow(f,'rams')`) and delete through the
normal `confirmDeleteFile` path (SharePoint file + SQL row). If the SharePoint
save fails, the PDF opens in a new tab so the document is never lost. The RAMS
drawing picker excludes previously generated Site Pack / RAMS outputs.

**Tier wiring (phase 4):** the Brief / Complex / Tier-1 selector drives
document depth deterministically via `RAMS_TIER_PRESETS`: which standard
sections are ticked by default (Brief drops Environmental & Monitoring;
changing tier RE-APPLIES the group ticks), condensed vs full Programme and
Emergency text (Tier 1 adds RIDDOR + muster-point lines), a Tier-1-only
"Document Control & Approval" sign-off table (Prepared / Reviewed / Approved
with signature space) rendered as section 1, and the Appendix B briefing rows
(8 / 12 / 16, or the roster size if larger).

**Work Brief (2026-08-10):** optional `ramsWorkBrief` textarea above the
drawings picker — a free-text note that steers the AI when drawings/photos
don't tell the story (e.g. "removal of existing structure ONLY — recip saw, no
new steel supplied"). When set it is injected into the scope prompt as
AUTHORITATIVE (overrides what photos suggest — a photo of existing structure is
context, not an install instruction); generation is allowed with a brief and NO
ticked drawings; the deterministic fallback template (installation-shaped) is
SKIPPED when a brief is set. Persisted as `rams.workBrief`, restored on
revision. System prompt is now works-type aware (install / removal / alteration
sequencing hints).

**Import RAMS (2026-08-10):** "📥 Import RAMS" button next to Generate RAMS in
`renderSite()` — brings an externally-produced RAMS PDF (e.g. drafted in chat)
into the system so revisions happen in-register. `importRamsDoc()` (hidden file
input, PDF only) → opens the normal modal (next register number) →
`_ramsParseImport(file)` sends the PDF through claude-proxy with a reader-only
prompt + a digest of `RAMS_RISK_LIBRARY`; the AI returns header fields, scope,
tasks, personnel NAMES, matched library `refs` and unmatched `extraHazards`.
Two-engine: risks are ticked by REF against the library (scores/controls stay
100% library — the imported document's own scoring is never copied); unmatched
hazards are listed in the status line for a manual ＋ custom-risk add;
personnel restore by-name via `ramsInitPersonnel` (roster match, same as a
revision). Nothing is saved until Mateusz eyeballs the form and hits Generate —
which re-renders the house-style PDF and registers it as a normal first issue
(Rev 00, next RAMS no) through the untouched `confirmRams` pipeline.

**Site-plan pin (phase 5):** the uploaded plan preview is clickable — the pin
is stored as `{x,y}` in **% of the image** (`_ramsSitePlanPin`) so it lands in
the same spot at any render size, shown as a 📍 marker in the modal (Clear-pin
button below). `drawRamsPDF` draws it as a **vector** marker (jsPDF helvetica
has no emoji): red teardrop with the stem apex on the exact point + a WORK
AREA label, flipped below the point when the pin is within 10% of the top edge.

**DOCX export (phase 7 — done):** the modal's **Output** select adds an
editable Word twin (`PDF + Word (.docx)`) saved alongside the PDF in the same
`00 - RAMS/<job>/` folder and registered as a second `fileContext:'rams'` row
(name suffixed " (Word)"). Second deterministic renderer, same `rams` object:
`drawRamsDOCX(docx, rams, assets)` is PURE/sync (Node-testable) and
`renderRamsDocxBlob(rams)` is the async shell (library load, image dims,
`Packer.toBlob`). Library is **docx.js v9 (dolanmiu/docx)** loaded on demand by
`resolveDocxLib()` from **jsDelivr** (`docx@9.7.1/dist/index.umd.cjs`, global
`window.docx`) — the lib is NOT on cdnjs (only docxtemplater is; don't confuse
them). Gotchas baked in: (1) docx.js **swaps width/height itself** when
`orientation: LANDSCAPE` — always pass PORTRAIT A4 dims for the Appendix A
landscape section or it double-swaps back to portrait; (2) the CONTENTS page is
a live Word `TOC` field + `features: { updateFields: true }`, so Word prompts
"update fields" on open — that's expected, not a bug; (3) the site-plan WORK
AREA pin is **composited into the image via canvas** (`_ramsCompositePin`)
before embedding, since docx has no vector overlay; (4) image sizing uses
`_dataUriDims()` (an `Image()` decode — data URIs have no naturalWidth, same
lesson as jsPDF's `getImageProperties`), mm→px at 96dpi. Page numbers are real
`PAGE`/`NUMPAGES` fields per section footer. A DOCX failure never sinks the
flow — the PDF is already saved; the user just gets a warning toast.

## Company Document Library (D1 v2 — Office › Company Docs)

**v2 (2026-07-29, after Mateusz feedback):** the register moved from ED to
**office.html** (sidebar entry "📁 Company Docs", tab `tab-docs`, module lives
in shared.js — `renderDocsTab()` injects the whole UI, modal self-injects).
ED keeps only the expiry **alert strip** (click → `office.html?tab=docs`).
New: **drag & drop multi-file import with AI parsing** — each PDF/image goes
through claude-proxy (reader-only prompt, nulls when not printed, never
guesses dates) and comes back as an editable review card (title, category,
ref, issuer, issue/expiry) → eyeball-check → 💾 saves file to SharePoint +
register row. Save-all button when several parsed. Non-parseable types
(.doc etc.) get a blank card for manual fill; upload still works. Categories
extended: insurance, policy, accreditation, **coshh** (SDS → H&S/03 - COSHH),
**ra_ssow** (→ H&S/05 - Risk Assessments & SSoW, created on first use), hs
(general → H&S root), other. PARKED (Mateusz, for later): policy/RA template
studio — produce, tweak and sign policies & risk assessments from templates
(likely a new modal family like the RAMS generator).

## (v1 spec below — folder mapping & API details still accurate)

Register of company-level documents (insurances, policies, accreditations,
H&S) with first-class expiry reminders. Lives entirely on `dashboard.html`
(new 📁 Docs tab) + `api/src/functions/company-documents.js` +
`CompanyDocuments` table (`api/sql/create-company-documents.sql`).

- **Storage split:** SQL holds metadata + reminder logic only. Files upload
  from the browser straight to SharePoint via the user's delegated Graph
  token — the API never touches Graph. Destination folders (BAMA /
  01 - Company Management): insurance → `01 - Insurances/<NN - year>` (year
  of issue date, `spYearName` convention year−2022); policy →
  `02 - Policies & Procedures`; accreditation →
  `03 - Accreditations & Certifications`; hs → `04 - H&S`; other → Company
  Management root. Dashboard is standalone (no shared.js) so it carries a
  local `DOC_SP` ID subset + local Graph helpers — **SP_TAX in shared.js
  remains the source of truth**; if taxonomy IDs ever change, update both.
  **History:** the first D0 tree ("00 - BAMA") was deleted 2026-07-29 after
  a failed migration — Auto-map's wrapper input said "BAMA" while the folder
  was "00 - BAMA", and create-on-miss silently forked a duplicate root. The
  tree was re-created the same day as plain **"BAMA"** (no numeric prefix on
  the root) and every ID repointed: SP_TAX (shared.js), DOC_SP
  (dashboard.html), SP_SALES_ID (tender-register.js), SP_PROJECTS_ID
  (quote-builder.html). sp-migrate.html now guards against a repeat:
  Auto-map resolves the tree in **resolve-only mode** (exact-name GET by
  path, aborts on any miss, never creates), and the explicit Create-tree
  button logs a ⚠ whenever it actually creates a folder rather than finding
  one.
- **Expiry logic:** per-doc `reminder_days` (default 60). `GET
  /api/company-documents/expiring` returns expired + inside-window docs and
  powers the always-visible red strip under the ED tab bar plus a count
  badge on the Docs tab (`loadDocAlerts()`, hooked onto `showDashMain`).
  `expiry_date NULL` = never expires, never alerts.
- **Renew flow:** creates a NEW row (fresh dates + file), then archives the
  old row with `superseded_by` pointing at the replacement. Archive is
  reversible ("Show archived" → ↩ restore). Delete is soft
  (`is_deleted = 1`); the SharePoint file is always left in place.
- **ChangeLog:** archive / unarchive / soft-delete are audited via
  `logChange('company_document', …)` (F6 convention).
- **Routes:** GET `company-documents` (`?all=true` incl. archived), GET
  `company-documents/expiring`, POST, PUT `/{id}` (partial update), DELETE
  `/{id}`. `expiring` is GET-only so it can't collide with the `{id}` PUT/
  DELETE routes.
- Export path: ⬇ CSV button on the tab (robustness rule). The `toast()` →
  `showToast` alias for the Health tab lives at the top of the D1 script
  block.

## Supplier records (D2 — Suppliers tab, 2026-07-30)

FPC s9 layer on the existing Suppliers module. Inside the supplier detail
modal (office.html › Suppliers) a "Docs & Approval" section
(`supplierDocsArea`, rendered by `renderSupplierDocsArea()` in shared.js):
approval status Unapproved/Approved/Conditional/Suspended + review-due date
(PUT `/api/supplier-approval/{id}`, columns on Suppliers via
`api/sql/create-supplier-documents.sql` — **ALTER TABLE ⇒ the deploy restart
covers it**), audited via logChange('supplier', …, 'approval_change').
Per-supplier document register (`SupplierDocuments` table,
`/api/supplier-documents` — same route shapes as company-documents incl.
`/expiring`): types insurance_el/pl/pi, quality, cis, hs, other; drag & drop
AI parsing identical to the D1 importer (reader-only, editable card, save
uploads to **BAMA / 04 - Suppliers & Subcontractors / <Supplier Name>**
(find-or-create, sanitised) + register row). Renew flow: archive old →
drop new (single way in via the drop zone). Approval badge shows next to the
supplier name in the list (skipped when unapproved to avoid noise).
`docExpiryInfo()` from D1 is reused for badges.

## Employee documents + contract generation (D3 — 2026-07-30)

"📁 Docs" button on each employee card (office.html › Employees) opens
`empDocsModal` (self-injecting, shared.js): per-employee register
(`EmployeeDocuments` table keyed by employee_name, `/api/employee-documents`
— same shapes as the D1/D2 APIs incl. `/expiring`), types
contract/rtw/cert/review/hs/other, drag & drop AI parsing (D1/D2 pattern),
files → **BAMA / 03 - Employees / <Employee Name>** (find-or-create).
**Contract generator** (`contractGenModal`): role presets
(Fabricator/Welder, Erector, Draftsman, Office Admin) fill hours/pattern/pay
basis; deterministic sections in `_contractSections()` — wording source of
truth is `templates/TEMPLATE-employment-contract.md` (address = 11 Enterprise
Way, Yaxley PE7 3WY — NOT Culley Court); native jsPDF render (splitTextToSize,
page breaks, Page X of Y, blob-size diagnostic), opens for print/sign, files
to the employee folder + registers as doc_type 'contract' (unsigned noted).
Signed copy comes back through the same drop zone. DOCX twin renderer =
future nicety. SQL: `api/sql/create-employee-documents.sql` (new table, no
restart). Note: the FPC document itself still says 46 Culley Court and
contains two leftover "Kilnbridge" references (s8.1, s11.5) — Mateusz to fix
in the source doc.

## D3b Offer letter + New Starter form / D4 QMS engine (2026-07-30)

**D3b (in empDocsModal):** ✉️ Offer letter generator (`openOfferGen`,
role→duties presets in OFFER_DUTIES_PRESETS, wording mirrors Marek's real
offer letter incl. Christmas-shutdown holiday clause; doc_type 'offer') and
📋 New Starter Information Sheet (`openStarterForm` — electronic version of
the paper sheet: personal/bank/NI/RTW/emergency/P45/driving-licence fields,
STARTER_FIELDS const; hand device to the starter, save renders PDF + files;
RTW expiry saved as the register expiry so it alerts; doc_type 'starter').
Both use `_empPdfHeader()` text letterhead (Enterprise Way address).
**Standalone mode (2026-08-08):** `openStarterForm(true)` — 📋 button at the
top of office.html ▸ Staff Management, for candidates not yet on the books.
Opens blank (clears previous candidate's data on open AND after save — never
prefills from `_empDocsEmp`), files under the typed name in 03 - Employees,
skips the `loadEmployeeDocs()` refresh unless empDocsModal is actually open.
Per-employee flow from the Docs modal unchanged (`openStarterForm()`).
Also a **New Starter home tile on m-qms.html** (calls `openStarterForm(true)`
directly — modal, not a view, so no mGo change); m-qms carries CSS overrides
forcing the modal to single-column with 16px inputs (iOS no-zoom).
**Employee auto-create (2026-08-09):** standalone save files as
`NSF - <Name> - <date>.pdf` and, via an "Office use" block (standalone only:
create-record checkbox default ON, staff type, pay type, start date), POSTs
/api/employees (pin '0000', rate 0, erp_role workshop/office_admin from staff
type) after a client-side dedupe check against /api/employees?all=true —
no server-side dedupe exists on that POST. Refreshes office Staff list if
state is loaded; non-fatal if the record create fails (PDF already filed).

**D4 foundation:** data-driven QMS engine — `QmsForms` (versioned JSON
definitions; **new sheets = SQL INSERT, no code**) + `QmsSubmissions`
(answers JSON, audited 'submitted' via logChange). SQL
`api/sql/create-qms-forms.sql` seeds BAM VER 001 (Welding Equipment
Checksheet) + BAMA CAL 001 (Calibration Log Entry). Office sidebar "📋 QMS
Forms" (tab-qms, `renderQmsTab`): form cards → generic modal renderer
(field types text/number/date/select/textarea/yesno with tap buttons) →
native jsPDF → files to BAMA / 02 - Quality (QMS) / (02 - Forms & Check
Sheets (masters) | 05 - Calibration Records) → registers submission; recent
submissions list on the tab. Remaining 7 sheets defined in
templates/TEMPLATE-qms-check-sheets.md — add as definition rows; richer
field types (pickers/photo/finger-signature/table) are the next D4 phase.

## Training Matrix (2026-07-30 — Office › Training Matrix)

Person × cert-type grid over the RAMS 2b schema (SitePersonnel /
SitePersonnelCerts / CertTypes — no backend changes, the cert endpoints
already existed). `renderTrainingTab()` in shared.js, tab-training in
office.html, sidebar entry in the HR group. Sticky name column + header,
staff/subcontractor chips, search, expiry colouring identical to the
document registers (red expired / amber ≤60d / green / grey no-expiry,
blank = not held), summary cards, CSV export. Tap a cell → tmCellModal:
existing certs for that person+type (delete) + add/renew form (number,
issue, expiry — a renewal is just a newer cert; `_tmBestCert` shows the
latest expiry). ＋ Person posts to the shared roster (same one the RAMS
personnel picker uses); ＋ Cert type posts to CertTypes (user-editable list
per the 2b decision). Daniel is no longer involved in the ERP (2026-07-30)
— Mateusz owns schema/infra decisions; QB Won→Project is unblocked.

## D4 phase 2 — rich QMS field types (2026-07-30)

Engine still definition-driven (**new sheet = SQL INSERT, no code**), now with
the field types the bigger FPC sheets need. `_qmsFieldHtml()` renders,
`_qmsHydratePickers()` fills live ERP data, `_qmsInitSignatures()` wires
canvases:
- **job** → live projects (non-Closed) from /api/projects; **machine** →
  /api/welding-machines; **personnel** → shared SitePersonnel roster
  (multi-select chips, same roster as RAMS + Training Matrix); **drawing** →
  select with free-text fallback. Every picker degrades to a plain text input
  if its API is unavailable, so a sheet is never un-fillable.
- **photo** → `capture="environment"` (phone camera), preview thumb, embedded
  in the PDF via `getImageProperties` proportions.
- **signature** → finger/mouse canvas (touch handlers `passive:false`),
  PNG embedded; `_qmsSigTouched` means an untouched pad saves nothing.
- **table** → repeating rows with `columns` from the definition; rendered as a
  mini grid in the PDF with header + zebra-free rows; blank rows dropped.
- **yesno** supports `allowNa: true` for a third N/A button.
Images live in the PDF only — never in the submission JSON (size).
`api/sql/seed-qms-forms-phase2.sql` adds the remaining 7 sheets:
BAMA tec 001 (contract review), CON 001 (consumables), BAMA MAT 001 (material
receiving, with cert photo), BAMA FAB 001 (fabrication inspection, dual
signature), BAMA REL 001 (final release), BAMA SITE 001 (site daily),
BAMA CAR 001 (NCR/CAR). Validated: 7 definitions, 96 fields, all types known.

**Training Matrix:** tapping a person's name opens `tmEditModal` — name, site
role, phone, company and a **Direct employee ↔ Subcontractor** toggle (people
move both ways as work demands), via the existing PUT /api/site-personnel/{id}.

## QMS check sheets — EVIDENCE, not paperwork (2026-07-30, Mateusz's rule)

**A shop-floor check sheet is proof the check happened, not a form to fill.**
The written procedure lives in Company Docs; the sheet references it and
captures the outcome. Target shape: pick job → photo → tap the outcome →
name → sign → save. Keep required fields to the genuine minimum. If a sheet
grows past ~5 real inputs, it's drifting back into paperwork — push back.
`slim-qms-checksheets.sql` re-authored FAB/REL/MAT/SITE to this (each 9 fields
but most are a read-only note, optional photo/sig/notes; 4–5 real inputs).
tec 001 (office contract review) and CAR 001 (NCR) stay form-shaped by nature.

Two engine additions supporting this (both definition-only, no per-sheet code):
- **note** field type → read-only instruction/procedure-reference text (accent
  left-border card). Skipped in answer collection; rendered small-italic on the
  PDF so the filed record shows which procedure applied.
- **yesno** now takes `yesLabel`/`noLabel`/`naLabel` → the tap buttons show
  your own words (e.g. "Good quality" / "Poor — needs rework", "Pass"/"Fail").
  `qmsYn()` colours by `data-tone` (good=green/bad=red/na=grey), not by the
  literal value, so custom labels still colour correctly. Stored value = label.

**Empty-dropdown fix (Mateusz found it):** the `job` picker used to render a
`<select>` with only a blank option when there were no live jobs, and the
`drawing` picker was a select with no list behind it — both looked like an
empty box with nothing in it. `_qmsHydratePickers()` now swaps either to a
plain text input when there's nothing to pick. Rule: never render a picker
that can resolve to a single blank option — fall back to text.

## Help & FAQ tab (2026-07-30)

Office ▸ Help & FAQ (`tab-help`, `renderHelpTab`, sidebar ❓). Central,
searchable, plain-English guide to every ERP area — written for whoever opens
it, not for a developer. Content is data-driven in `HELP_TOPICS` (array of
`{area, icon, items:[{q,a}]}`): **add an entry = edit that array, nothing
else.** Live search highlights matches; area chips use the hash→hue colour
convention. When a new module ships, add its Help entries in the same commit
(same spirit as the robustness definition of done).

## Plant Register (2026-07-30 — Office › Traceability › Plant Register)

Company plant & equipment register: `tab-plant` in office.html, module at the
end of shared.js (`renderPlantTab`). One `PlantItems` row per item with six
regime due-date DATE columns — `loler_due` / `puwer_due` / `pat_due` /
`calib_due` / `service_due` / `mot_due` (NULL = regime not applicable) —
rendered training-matrix-style: sticky item column, traffic lights (green /
amber ≤60d / red overdue), category chips (fixed palette in `PLANT_CATS`),
summary cards, zebra rows, CSV export. Statuses: in_service / under_repair /
quarantined / off_hired / disposed (transitions audited via logChange; retire
items by status, soft-delete only for mistakes). `plant_ref` unique among
live rows, auto-suggested `P-NNN`. Tap a row → `plantModal` (self-injecting):
details + regime dates + per-item docs area (D1/D2/D3 drag&drop AI-parse
pattern; reader-only two-engine rule). Docs table `PlantDocuments`
(loler/puwer/pat/calibration/service/mot/manual/other); files upload to
SharePoint `BAMA / 02 - Quality (QMS) / 07 - Plant & Equipment / <Ref - Name>`
(find-or-create). **Saving a cert whose doc_type maps to a regime
auto-advances that item's due date** — the date always comes off the printed
cert or the user's review-card edit, never invented. API:
`api/src/functions/plant-register.js` — /api/plant-items (+/expiring: regimes
unpivoted, in_service+under_repair only, ≤60 days), /api/plant-documents.
**Newest certificate wins (2026-07-30).** Calibration, LOLER and PAT are all
done by outside bodies, so the certificate is the source of truth, not a typed
date. `_plantBuildDocIdx()` indexes live (non-archived) docs to
plantId → regime → newest expiry; `_plantReconcileFromDocs()` runs on tab load
and pushes any regime column FORWARD to match a newer cert on file (never
backwards, never a date that wasn't printed or typed by the user). Grid cells
carry a 📄 marker when the date is cert-backed; the item modal shows the
cert date under each regime input and warns in amber when the typed date is
older than a cert. QMS Forms tab has an **External certificates** panel
(`_qmsRenderExternalCerts()`) reading the same index — the QMS check sheets
stay for in-house work (routine validation, pre-use inspection) and never
duplicate an external cert.

**Register-level bulk import (2026-07-30).** Drop the whole envelope from the
examiner on the register: each cert is read (asset identifiers as well as
dates), then a DETERMINISTIC matcher in JS picks the item — serial exact 100 /
partial 88, asset_ref 92, make 34 + model 40 + description tokens, generic
words ('lift','machine','tool'…) excluded, disposed items excluded, and an
ambiguity guard drops confidence to `low` when the runner-up is within 15
points (identical twin machines with no serial). Confidence badge + reason on
every card, item override dropdown, and `➕ Create new item from this
certificate` which prefills make/model/serial/category from the cert. Save-all
for the batch. Pinned by `tests/plant-match.js` (21 cases) — **run it before
any push touching the matcher or the docs index.** Per-item drop zone in the
modal is unchanged; manual entry is always available.

ED shows a `plantAlertStrip` (dashboard.html, amber) fed by /expiring,
deep-linking office.html?tab=plant. SQL:
`api/sql/create-plant-register.sql` — new tables only, no restart. The
Welding Equipment tab (WeldingMachines) stays separate — it feeds the QMS
machine picker; welders can also be listed in the plant register but nothing
migrates automatically.

## Welder Approvals (E1, 2026-07-30 — Office › Traceability › Welder Approvals)

`tab-welders` in office.html, module at the end of shared.js
(`renderWeldersTab`). Exists because a training-matrix "Coded Welder" tick
cannot answer what an EN 1090 assessor asks: which process, which material
group, what thickness, which positions, and was it valid on the day of the
weld. Tables `WelderQualifications` + `WelderQualConfirmations`
(`api/sql/create-welder-qualifications.sql`, new tables, no restart); API
`api/src/functions/welder-qualifications.js` — /api/welder-quals
(+/expiring, both clocks unpivoted), /api/welder-qual-confirm/{id},
/api/welder-qual-confirmations.

**Two independent validity clocks, and BOTH gate usability.** `expiry_date` is
the certificate's own expiry; `confirm_due` is the employer's 6-monthly
confirmation of validity (EN ISO 9606-1 §9.2) — the one that lapses while the
certificate's face date still looks fine. `weldQualValidity()` returns
unusable if either has passed, or if status is lapsed/revoked/superseded.
`POST /api/welder-qual-confirm/{id}` writes the signed confirmation to the log
AND moves `confirm_due` (+6 months, capped at the certificate expiry) in one
endpoint so the two can never disagree; every confirmation is `logChange`d.

**RANGE OF APPROVAL IS STORED AS PRINTED AND ONLY EVER COMPARED AGAINST.**
This is the two-engine rule at its sharpest: a wrong "yes" here licenses an
unqualified weld. Claude reads the printed range off the certificate (prompt is
explicit: read the RANGE OF APPROVAL section, not the test piece, and never
derive a range from a test thickness); `_weldScopeCheck()` does plain-JS
comparison. Specifically: position checking is **membership only** — a
certificate printing PF is NOT treated as licensing PC; a missing printed range
yields a "check it by hand" note, never a silent pass; every failure reason is
reported, not just the first. `weldCheckPerson()` picks the best certificate a
person holds. Pinned by `tests/welder-scope.js` (43 cases) — **run it before
any push touching validity or scope logic.**

Certificate import fills the form for a human to check and **does not save** —
`weldCertApply()` populates fields, the user confirms against the paper, then
Save. Files go to `BAMA / 02 - Quality (QMS) / 04 - Welder Qualifications`.
Welder picker reads the same SitePersonnel roster as RAMS and the training
matrix (welders are often subcontractors). 🔍 **Check a welder** is the point of
the module: job parameters in, approved/not-approved out with reasons, before
the weld is assigned. ED gets a purple `weldAlertStrip` from /expiring.

## Inspection & NDT sampling (E2, 2026-07-30 — Office › Traceability › Inspection & NDT)

`tab-inspection` in office.html, module at the end of shared.js
(`renderInspectionTab`). Tables `NdtExtentRules` + `JobInspectionPlans` +
`JobInspectionRecords` (`api/sql/create-inspection-plans.sql`, new tables, no
restart); API `api/src/functions/inspection-plans.js`.

**TWO RULES THE MODULE WILL NOT LET ANYONE BEND:**
1. **Visual inspection is 100% at every execution class** — never sampled.
   `_inspRequired()` hard-codes 100% for `inspectionType === 'visual'` no
   matter what the rules table says. Mateusz's initial framing ("EXC2 is
   roughly 10% so sign off 10%") conflated visual with supplementary NDT; the
   10% figures apply only to NDT.
2. **The percentages live in DATA, never in code, and start UNVERIFIED.**
   `NdtExtentRules` is seeded with the EN 1090-2 Table 24 categories and
   indicative values, every row `verified = 0`, `source_note` saying so. The
   tab shows a loud amber banner listing how many are unverified and the
   per-category rows carry "⚠ unverified" until a human edits the percentage
   and presses Verify (name + date recorded, `logChange`d). **Never hard-code
   a compliance percentage from recall** — a figure that looks authoritative
   but nobody checked is worse than no figure. Same principle as never letting
   AI invent a hazard score.

Sample counts round **UP** (`Math.ceil`) — rounding down under-samples, which
would report compliance while one inspection short. Where a category has
utilisation variants, the HIGHER percentage is assumed until the user says
which applies. A category with no rule for that class gets 0% NDT required
(never a guess) but still 100% visual. Weld population per category is entered
per job (`weld_counts` JSON); progress bars show visual and NDT separately with
a shortfall badge that says "not ready for release". Failed inspections are
counted separately from sample progress and `logChange`d on creation.
Pinned by `tests/inspection-sampling.js` (36 cases).

**Welder scope check at the point of use — WARNS, does not block.** Mateusz's
call (2026-07-30): blocking would stop the shop whenever the register is behind
reality. `inspCheckWelder()` runs on welder selection in the log-inspection
modal; if there's no usable qualification it shows a red panel and sets
`_inspWeldWarning`, which is appended to the record's notes so the override is
auditable afterwards. Full thickness/position scope testing stays on the
Welder Approvals tab (🔍 Check a welder).

## Welding machines live in the Plant Register (F3, 2026-07-30)

Mateusz's decision — one place, one fewer sidebar line. **WeldingMachines was
NOT dropped and its rows are never deleted**, because
`JobAssemblies.welding_machine_id` FKs it in both add-job-fabrication.sql and
add-staged-fabrication.sql, and the workshop kiosk reads
`/api/welding-machines`. So: `PlantItems` (category `welding`) is the editing
surface, and `syncWeldingMachine()` in plant-register.js keeps the shadow
WeldingMachines row in step behind it — **the kiosk therefore needed no change
at all**, which is the point. Mapping: name→machine_name, serial_no→serial_number,
calib_due→expiry_date (a welding machine's verification expiry IS its
calibration date — BAM VER 001), status disposed/off_hired→is_active 0.
Deleting a plant item DEACTIVATES the machine, never deletes it.
`WeldingMachineWelders` (authorised welders) is untouched and now surfaces in
the plant modal via `plantLoadWelders()`. The Welding Equipment sidebar entry is
removed; `tab-welding` markup and its renderer are deliberately LEFT IN PLACE
(unreachable, harmless) rather than ripped out.
Migration: `api/sql/migrate-welding-machines-into-plant.sql` — **contains ALTER
TABLE ⇒ Function App restart required.** The welding link is fetched in its own
guarded query, never folded into `ITEM_COLS`, so the register still loads before
the migration runs. Pinned by `tests/plant-welding-sync.js` (26 cases, mostly
safety properties).

## Inspection & Test Plan (F1a, 2026-07-30 — Office › Inspection & NDT › 📋 ITP)

`ItpRows` hangs off `JobInspectionPlans` so the ITP and the real NDT sampling
read the SAME exec class and the SAME verified `NdtExtentRules` percentages —
they cannot drift apart. `api/sql/create-itp-rows.sql` (new table, no restart);
API `api/src/functions/itp.js`.

**NO AI in this generator, deliberately.** `itpGenerateRows(plan, rules)` is a
pure function over `ITP_TEMPLATE` (the standard BAMA activity list, held as data
so it can be edited in one place) plus the job's weld categories. An ITP is a
factual schedule; an invented acceptance criterion or hold point would be a
liability. Visual rows are always 100% and always intervention `H`; NDT rows
appear only where a verified percentage is non-zero, spell out the count
("10% of category (8 of 80 welds)"), and carry a "[extent to be confirmed
against EN 1090-2 Table 24]" caveat plus a note whenever the rule is still
unverified — so an unverified figure cannot be issued to a client silently.

**Regeneration never destroys the user's work.** Rows are `is_auto = 1` when
generated; editing any cell sets `is_auto = 0` ("it's yours now"), and
`POST /api/itp-rows-bulk` soft-deletes only the auto rows. A client's
hand-added witness point survives regeneration — losing one silently would be
worse than not regenerating at all. The response reports `hand_added_kept`.

`itpRowProgress()` gives live achieved-vs-planned per row off the real
inspection records, shown in the modal (`3/8 (5 short)`), returning `null` for
non-inspection rows rather than a misleading zero.
PDF: `drawItpPDF` / `renderItpPdfBlob` — native jsPDF, **landscape** (ITP tables
are wide), columns summing exactly to the 277mm usable width, row height
measured from the tallest wrapped cell before drawing, repeating table header on
page break, red left edge on hold points, intervention key printed on every page
(an ITP is useless if H/W/S/R can't be decoded), signature block, "Page X of Y",
blob-size diagnostic. Saves to the job's SharePoint folder via
`findProjectFolder`. Pinned by `tests/itp-generate.js` (33 cases, including that
the ITP's count equals `_inspProgress`'s required count at both EXC2 and EXC3).

## Certificate of Conformity (F1b, 2026-07-30 — Office › Inspection & NDT › 📜 CoC)

`JobCertificates` (`api/sql/create-job-certificates.sql`, new table, no restart)
registers every issued CoC **and** DoP — one table, `doc_type` discriminator.
API `api/src/functions/job-certificates.js`.

**TWO scopes, one document family (Mateusz, 2026-07-30).** `doc_type = 'coc'`
is supply AND install; `doc_type = 'doc'` is **supply only** and its declaration
expressly excludes erection, alignment, final connections and works by others.
Same evidence, same gathering, different declared responsibility; each keeps its
own revision sequence. `drawCocPDF` branches on `d.mode`, and the scope is
printed on the face of the document as well as in the wording. **Do not confuse
`'doc'` with `'dop'`** — 'doc' is this commercial Declaration of Conformity;
'dop' is the regulated Declaration of Performance. The O&M pack picks up
whichever of the two was issued.

**A CoC is contractual, not regulated**, which is why contractors all word the
request differently — so the narrative CAN be AI-drafted. What cannot:
`cocGatherFacts(jobId)` reads every FIGURE out of the ERP — assemblies
(tonnage, marks, finishes), BAMA MAT 001 heat numbers (out of the submission
answers JSON, filtered to the job), inspection plan + records for NDT extent
**achieved**, welder qualifications with validity. `cocDraftScope()` passes those
facts as JSON and forbids the model from stating any number, heat number,
certificate number, percentage or date not present in them, or inventing
standards/notified bodies/approvals. Contrast the DoP, which is regulated and
whose fields are not AI-drafted at all (see the rule near the top of this file).

**Gaps are surfaced, never swallowed.** Missing heat numbers, an unmet
inspection sample, failed inspections, invalid welder qualifications, a
non-'Accepted' material receipt — each becomes a `gaps` entry shown in an amber
panel before issue, and the panel says plainly it's a warning not a lock (his
call throughout: don't stop the shop, do record it). `gapsAtIssue` is stored in
the payload so what was outstanding at signing is provable later.

**Issued certificates are frozen.** `payload` snapshots every certified figure,
because live NDT counts and drawing revisions move on and a re-render a year
later would no longer match the paper the client holds. Re-issuing increments
`revision`, supersedes the previous row, and the PUT endpoint accepts only file
refs / notes / status — it explicitly refuses to edit certified figures.

PDF: `drawCocPDF` / `renderCocPdfBlob` — native jsPDF portrait; sections are
omitted entirely when there's no data rather than printed empty; the "visual
inspection is carried out on 100% of welds" line is fixed text, not derived;
blank key-values dropped; declaration + signature block; filed to the job's
SharePoint folder. Pinned by `tests/coc-certificate.js` (43 cases, mostly
honesty properties rather than layout).

## Declaration of Performance (F1c, 2026-07-30 — Office › Inspection & NDT › 🏷 DoP)

The regulated document: a DoP under the Construction Products Regulations against
BS EN 1090-1, with the prescribed numbered clauses (CPR Annex III). Records into
`JobCertificates` with `doc_type = 'dop'` — no new table. Config lives in
`Settings` under key `dop_config`.

**Where the AI is used, and where it is refused.** Mateusz's point was fair —
the ERP already holds the UKCA/FPC certificate, so it should read the numbers
itself rather than asking him to type them. `dopReadCertificate()` finds the
accreditation document in the Company Docs register, downloads it from SharePoint
via Graph (`/items/{id}/content` + `getToken()`), and extracts approved body
name/number, FPC certificate number, standard, AVCP system, exec class and
marking — prompt demands exact transcription, forbids inferring, and specifically
forbids guessing a body number from the body's name. **Anything freshly read is
re-marked unverified**, and issue is BLOCKED until a human confirms
character-for-character (name + date stored). That's the one-click compromise:
he types nothing, but the declaration isn't issued on an unchecked OCR.

**Declared performance values are never generated.** `DOP_CHARACTERISTICS` holds
the standard's characteristic NAMES (flagged in the UI to be checked against
BAMA's own copy of Annex ZA — rows are editable/addable/removable). The
performance VALUES start blank and are never filled in for us; blank rows are
filtered out of the PDF rather than printed as empty claims, and **'NPD' is never
defaulted** — it's a real declaration and has to be typed deliberately.
`dopAssemble()` returns hard `blockers` (unverified, no body number, no FPC
number, no standard, no AVCP system, every characteristic blank) separately from
`warnings` (some blank, exec-class mismatch between job and FPC certificate).
The Issue button is disabled while any blocker stands — unlike the CoC, which
only warns, because this one is regulatory.

`_abToBase64()` converts the downloaded certificate in 32KB chunks;
`String.fromCharCode(...bytes)` throws on anything over ~100KB and a certificate
PDF is bigger than that. PDF: `drawDopPDF` / `renderDopPdfBlob` — native jsPDF
portrait, numbered clauses 1–7, declared-performance table, statutory
sole-responsibility statement, signature block. Pinned by
`tests/dop-declaration.js` (40 cases, framed as what the ERP refuses to do).

## O&M / Handover Pack (F1d, 2026-07-30 — Office › Inspection & NDT › 📚 O&M Pack)

Binds everything already on file into one indexed PDF. Recorded in
`JobCertificates` with `doc_type = 'om'` (added to the API's DOC_TYPES — **no
migration**); `payload` holds the section manifest, page count and any failures.

**office.html now loads BOTH jsPDF and pdf-lib** — it previously loaded neither,
which meant the ITP/CoC/DoP renderers shipped earlier the same day would have
failed from this page. Any page rendering a PDF carries the tag (CLAUDE.md rule).

**BUG FIXED, worth remembering:** `resolveJsPDFCtor()` is **async**. Called
without `await` it returns a Promise, which is truthy, so a `if (!Ctor) throw`
guard passes and `new Ctor()` then throws "not a constructor". All three
renderers (ITP, CoC, DoP) had this. `tests/om-pack.js` now asserts no
un-awaited `resolveJsPDFCtor()` call exists anywhere in shared.js.

**Two-pass pagination, because the contents page changes its own page numbers.**
`omAssemblePack()`: collect every source and measure its real page count →
`omLayout()` settles how many contents pages are needed (each section costs one
divider + its pages) → draw front matter with true page numbers → bind. Both
`omPaginate()` and `omLayout()` are pure and unit-tested, including the
30/31-section boundary where the contents spills to a second page and every
section shifts down.

**On bookmarks, deliberately:** pdf-lib has no outline API, so navigation is a
contents page with real page numbers plus a divider before each section, NOT a
PDF sidebar tree. Hand-writing outline objects risks a subtly corrupt file, and
a pack that won't open at the client's end is far worse than one without a
sidebar. The UI says so rather than leaving the user to wonder.

Sources (`omGatherSources`): latest non-superseded DoP and CoC, ITP generated
live at build time, as-built drawings off the job assemblies, QMS submissions
filtered to the job, company accreditations (ticked) and insurances (unticked by
default). Plus a drop zone for warranties, coating certs and third-party NDT
reports. **Nothing is silently dropped** — anything unreadable is listed with its
reason in the UI and stored in the payload; an entirely empty pack throws rather
than producing a cover with nothing behind it. Encrypted client PDFs load with
`ignoreEncryption`.

## Material traceability (2026-07-30 — Office › Inspection & NDT › 🔗 Traceability)

**The gap this filled:** the ERP knew which heats arrived (BAMA MAT 001), which
assemblies were made and by whom (JobAssemblies + JobAssemblyActions) and what
was despatched — but **nothing joined a heat number to an assembly**, so
traceability could only ever be stated at contract level.
`AssemblyHeatAllocations` (`api/sql/create-heat-allocations.sql`, new table, no
restart) is that bridge, many-to-many; API `api/src/functions/heat-allocations.js`
(+ `/api/heat-allocations-bulk`, which skips duplicate assembly+heat pairs
rather than doubling the paperwork).

**Never claim a level the records don't support.** `traceBuildChain()` grades
every assembly: `piece` (heats allocated to that specific assembly), `contract`
(heats known for the job but not allocated to this one) or `none` (no heats
recorded at all). The job's overall level is its weakest assembly — one
unallocated assembly means the contract is contract-level, not piece-level.
Contract level is generally accepted at EXC2; EXC3 and client traceability
clauses usually want piece. The report states the limitation in prose at the top
of the PDF, and lists heats received but never allocated as an explicit gap.
Allocation is optional and done by ticking heats × assemblies — matching falls
back to `assembly_mark` when there's no id, and despatch matching is
case/whitespace insensitive. `traceWhereUsed()` is the reverse lookup.
`drawTracePDF` is landscape native jsPDF. Pinned by `tests/traceability.js`
(31 cases, mostly about not overstating the level).

## Toolbox talks (2026-07-30 — Office › Traceability › 🗣 Toolbox Talks)

`ToolboxTalks` (library) + `ToolboxTalkDeliveries` (each time one was given) —
`api/sql/create-toolbox-talks.sql`, new tables, no restart; API
`api/src/functions/toolbox-talks.js`.

**SIGNATURE IMAGES NEVER REACH THE DATABASE.** The signed PDF filed to
SharePoint is the evidence; the register stores name / role / signed flag only.
The API strips anything else deliberately and the client never sends the image.
Same rule as the QMS engine.

**An attendance record can't be empty or half-made.** The API rejects a delivery
with no attendees or no named presenter; the UI blocks it first; and signing a
name auto-ticks their attendance so it's impossible to have a signature without
a record. Deliveries snapshot `talk_ref` and `talk_title`, so deleting a library
talk never orphans the evidence that it was given.

**AI drafts talk CONTENT — the right use here** (safety guidance in plain words,
not a calculation or a regulated declaration). Prompt forbids invented
statistics, demands UK practice and trade specificity, and forbids asserting
that BAMA has any particular permit system or kit. Drafts are `source:'drafted'`,
badged in the UI, and the review banner says what the draft cannot know.
`TBT_STARTER_LIBRARY` (10 talks, in shared.js so the wording lives in one place)
seeds on demand: hot works, height, lifting, manual handling, PPE, plant checks,
COSHH/fume, site traffic, electrical, housekeeping.

Paper first, device optional: `drawTbtPDF` prints ruled signature lines plus
spare rows for walk-ups (14 on a blank print), and renders captured e-signatures
where they exist. Job-specific talks file to the job folder; general ones to
`01 - Company Management / 04 - H&S / Toolbox Talks`.

**TESTING TRAP, hit three times today:** do NOT use `/functionName[\s\S]*?\n}/`
to extract a function whose body contains a JSON template — the template's
closing brace matches first and the capture truncates silently, so assertions
about the tail of the prompt fail against correct code. Slice between known
boundaries instead.

## Consumables (2026-07-30 — Office › Traceability › 🧰 Consumables)

`Consumables` + `ConsumableMovements` + `ConsumableReorders`
(`api/sql/create-consumables.sql`, new tables, no restart); API
`api/src/functions/consumables.js`.

**PAPER IS THE PRIMARY ROUTE, deliberately** (Mateusz's call and he was right):
print the tally sheet, hang it up, type it in weekly. `drawConsSheetPDF` prints
tick-boxes rather than a number field — quicker to mark with gloves on — grouped
by category, with blank lines for anything off-catalogue. The kiosk-style
⚡ Quick issue exists as the *optional* route; adding a screen tap per welding rod
is how you get a register nobody fills in. `consTypeSheet()` types a finished
sheet in one go and reports bad lines by number rather than discarding the good
ones.

**STOCK IS DERIVED, NEVER STORED**: `opening_qty + Σin − Σout`, computed in the
list query. A stored running total drifts the first time a movement is edited and
then nobody trusts the figure. There is deliberately no `current_stock` column.

**BUG WORTH REMEMBERING:** `consStockState()` originally did `Number(item.stock)`,
and `Number(null) === 0` — so a MISSING stock figure read as "out of stock" and
would have suggested a reorder for an item nothing is known about. Absent and
zero must stay different; it now checks for null/undefined/'' first.

**Nothing auto-orders**: basket → approved (recorded against a name) → ordered
against a PO. Duplicate basket entries for the same item are refused. Suggestions
never fire for something already on order. Issuing more than the ledger shows
warns and proceeds (the shelf is the truth, the ledger is catching up) and going
negative is a flag to reconcile, not an error. Batch-tracked items warn if issued
without a batch number — welding consumables are traceable under EN 1090 and
CON 001 records issue against a batch.

## House-style PDF chrome — every generated document (2026-08-04)

All BAMA documents now share the letterhead family in shared.js:
`bamaDocHeader` (logo + company block left, italic accent title + meta grid
right, full rule) / `bamaSectionHeading` / `bamaDocFooter` /
**`bamaDocContinuation`** (new: slim page-2+ strip — accent italic title left,
muted ref right, ink rule; multi-page docs don't repeat the full letterhead).
Helpers take `pageW`/`pageH` options for **landscape** documents (pass 297/210).
Converted 2026-08-04 (the last dark-bar holdouts): ITP (landscape), CoC/DoC,
DoP, O&M cover + contents + section dividers, Material Traceability
(landscape), Consumables tally sheet. Pattern inside each renderer:
`let _firstPage = true;` in `header()` — first call draws `bamaDocHeader`,
later calls draw `bamaDocContinuation`. **Regulated CoC/DoP body content
(clauses, declared performance) untouched — header/footer only.**
Smoke-test any renderer change with jsPDF in node (see commit 2026-08-04),
not just `node --check`.

## Policy e-sign (read-and-sign for Company Docs, 2026-08-04)

The DocumentAcknowledgements engine now covers company policies:
- API: `doc_type` accepts `'policy'`; GET `/api/acknowledgements` filters by
  `doc_type` and `doc_file_id`.
- **Mobile** (m-qms.html): "Sign Policies" tile lists live Company Docs in
  categories `policy` / `hs` / `ra_ssow` (`DOC_SIGNABLE` in shared.js) that
  have a SharePoint file; shows "✓ You signed <date>" per user; sign modal is
  the generalised RAMS one (`mSignOpenDoc` + `_signMode` = 'rams'|'policy',
  statement per mode). On save the register PDF (`mPolBuildRegister`) is
  rebuilt from ALL signatures for that file and filed in the SAME SharePoint
  folder as the policy (`<title> - Signature Register.pdf`, overwrites).
- **Office** (Company Docs tab): ✍ button per signable row →
  `openDocSignatures` modal: signed list + **outstanding** (active Employees
  not among signer names, name-matched case-insensitively) + 🖨 local
  register-PDF print (`printDocSignatureRegister`).
- **Version reset is structural, not a flag:** signatures key on
  `doc_file_id`. The renew flow (`renewDoc` → archive + `superseded_by`)
  uploads a NEW file, so the new version starts with zero signatures and
  everyone shows outstanding again. No extra clock needed.

**Director authorisation (2026-08-04b):** `doc_type: 'policy_director'` —
the director e-signs a policy to authorise it for issue / confirm annual
review. Signed inside the office ✍ Signatures modal (inline pad, name
prefilled from Graph /me, `POLICY_DIRECTOR_STATEMENT`). The ✍ button on the
Company Docs table is green when the current file version carries a director
signature, amber when not (bulk-loaded once per table render via
`?doc_type=policy_director`). Re-sign button for annual reviews.
**One register builder for everything:** `polBuildRegisterDoc` /
`polFileRegister` in shared.js — office print, office filing after director
sign, and the mobile app all render the SAME PDF (director authorisation
block above the signature register). Renewing a policy = new file id = both
the staff register AND the director authorisation reset together.

**Phase-C report packs restyled (2026-08-04b):** exportJobCostingPDF,
exportCvrPDF (landscape) and exportLabourPayPDF dropped the navy
[26,26,46]/blue/foreign palette for the house family (bamaDocHeader with
logo, HOUSE_HEAD table heads with ink text, bamaDocContinuation on page
breaks, bamaDocFooter). Semantic colours kept: RED/GREEN variance, AMBER
WIP, PURPLE CIS. Remaining deliberate non-house PDFs: Babcock quote
(client-facing navy #1F3552 by design), invoices/remittance/AFP/RAMS/Site
Pack/Job Sheet (untouched per standing scope), drawHealthPDF in
dashboard.html (page doesn't load shared.js — internal diagnostic).

## Modal → Page mapping

Every `id=…Modal` element in the HTML, by page. Handy when tracing an
`openX()` / `document.getElementById('…Modal')` call in `shared.js` back to
the markup it mutates.

**index.html (kiosk)**
- `holidayKioskModal` — holiday request kiosk flow (name → PIN → dates)
- `orderFormModal` — materials/order submission
- `empPinModal` — PIN prompt when opening an employee panel
- `addClockingModal` — employee "add missing clocking" for a past day
- `editEntryModal` — edit an already-submitted project-hours entry
- `noProjectModal` — clock-out guard when no project hours logged (WGD/S000 choice)
- `amendmentModal` — employee requests an amendment on an existing clocking
- `confirmModal` — generic confirm dialog

**manager.html**
- `requestAccessModal` — "I don't have permission — ask admin" form
- `confirmModal` — generic confirm dialog

**dashboard.html (ED)**
- `docModal` — Company Document Library add / edit / renew (D1)
- `lossModal` — mark quote as Lost with reason/competitor
- `chaseModal` — AI-drafted chase-up email for a sent quote
- `bamaConfirmModal` — generic confirm dialog (local copy)

**office.html**
- `requestAccessModal` — same as manager
- `mgrAddClockingModal` — manager adds a clocking for any employee
- `deleteClockingDayModal` — office deletes a full day (clocking + project hours) for one employee
- `approveWeekModal` — approve week + archive to PayrollArchive
- `dashCreateTaskModal` — office dashboard: create a task for a colleague
- `dashSendMessageModal` — office dashboard: internal message
- `officeHolidayModal` — manager approve/reject holiday request
- `bookAbsenceModal` — office books an absence directly (no request flow)
- `editHolidayModal` — edit/delete any holiday, sickness, or absence (directors, finance, office_admin)
- `confirmModal` — generic confirm dialog

**projects.html**
- `draftsmanLoginModal` — pick draftsman user
- `draftsmanPinModal` — PIN prompt for draftsman mode
- `createJobModal` — new DrawingJob under a project
- `uploadFileModal` — upload drawing/file to a job element
- `createTaskModal` — assembly task under a job
- `completeTaskModal` — mark task complete with notes/files
- `closeJobModal` — final sign-off on a job
- `uploadBomModal` — upload a bill-of-materials
- `addBomItemModal` — manual BOM line entry
- `generateDnModal` — generate delivery note
- `siteDnModal` — site delivery note (ship BOM items to site)
- `sitePackModal` — generate site installation pack (header + AI scope + BOM fixings → native-jsPDF PDF)
- `confirmModal` — generic confirm dialog

hub.html and steel-database.html have no modals.

**Client modals (lazy-injected by shared.js, used on office.html Clients tab)**
- `newClientModal` — add a new client to the database
- `editClientModal` — edit client details
- `contactModal` — add/edit/delete a contact for a client (quick add/edit flow)
- These were originally built for the retired tenders.html; `_ensureClientModals()`
  injects them into <body> on first use of the Office Clients tab.

**project-tracker.html**
- `projectTrackerPinModal` — PIN entry on the project tracker page
- `projectContactModal` — add/edit/delete an additional project contact
  (site foreman, QS, surveyor etc.); separate from client contacts
- `attachQuoteModal` — searchable list of won quotes not already attached
  to this project; click a row to attach via `confirmAttachQuote()`
- `confirmModal` — generic confirm dialog (used by `showConfirmAsync` for
  Won-quote conversion confirm and the unsaved-changes prompt on
  `closeProjectDetail`)

## Roadmap / queued

Tracked here so Claude Code has context when a related question comes up —
none of this is built yet.

- **2dp rounding on financial calculations ✅ FIXED 2026-07-30.** The MONEY
  section in `shared.js` is now the single source (`_r2` / `sumMoney` / `pctOf`
  / `gbp2` / `gbpWhole` / `gbpShort`); `_r2` was moved out of the middle of the
  Babcock block to the top utilities. Fixed: the two Babcock PDF grand-total
  fallbacks (raw sum → `sumMoney`); the invoice modal preview, which summed
  `qty × price` UNROUNDED while `_invPayload()` summed per-line 2dp values —
  the preview and the saved/printed invoice could disagree by pennies; invoice
  retention / VAT base / gross on both client paths and in
  `api/src/functions/invoicing.js` (client and server now agree to the penny);
  BACS run totals, remittance/statement reconciliation figures and aged-debt
  AR. The four competing `fmtGBP` definitions were resolved into three
  clearly-named canonical helpers (they were doing three genuinely different
  jobs — 2dp, whole-pound, abbreviated — under one name).
  Pinned by `tests/money-rounding.js` (37 assertions).
- **Mobile clock-in page** — PIN-based, no Microsoft login. Standalone page
  aimed at site staff with no work account. Will need a server-side PIN check
  (see the PIN warning under Auth) and its own scoped API surface.
- **Full project tracker in-app (Phase 2 done)** — the SharePoint
  PROJECT TRACKER.xlsx dependency has been retired in code. SQL `Projects`
  is now the sole source for the kiosk project picker (via `loadProjects()`,
  filtered to `status='In Progress'`); the legacy spreadsheet read and the
  hardcoded `FALLBACK_PROJECTS` array are gone. The Labour Log + Unproductive
  Time sheets have been replaced by the SQL `LabourLog` table — see
  `api/sql/create-labour-log.sql` and `api/src/functions/labour-log.js`.
  `writeApprovedToLabourLog()` (shared.js) now POSTs both productive and
  unproductive entries to `/api/labour-log`, which idempotently upserts
  keyed on `project_hours_id`. The "Sync to SharePoint" button in
  office.html is now "Sync to Labour Log". `project-tracker.html` is the
  canonical UI for project records.
  Still queued: pointing the project-tracker financial dashboard's
  Labour Cost tile at LabourLog data (currently shows the labour budget
  from quote line items, not actual hours logged).
- **Quote financial workflow** — **Phase 1 done**. The 9 fixed line item
  categories per quote (Prelims through Delivery) live in the
  `QuoteLineItems` table (the legacy quotes.html editor and its
  `loadQuoteLineItems()`/`saveQuoteLineItems()` shared.js code were removed
  2026-08-09 with the rest of the legacy tender world; the table itself is
  live — mark-won writes it, Project Tracker reads it). The
  Project Tracker (`project-tracker.html`) shows a financial dashboard:
  3 tiles (Contract Value, Labour Cost, Running Cost stub) + per-quote
  line-item tables with per-line % complete sliders. Multi-quote per
  project supported via the `ProjectQuotes` link table — primary quote
  is the originating won quote and cannot be detached. Per-line % drives
  a value-weighted project progress figure shown on the Labour tile.
  **Phase 2 (Invoice Tracker) — Commits 1, 2 + 3 done**.
  See "Invoice Tracker" section below for the full feature.
  **Still to do (Phase 2+)**: Running Cost source (POs / supplier
  invoices — schema landed, needs aggregation tile), and optional
  `viewProjectFinancials` permission split.
- **Invoicing Phase 1 (client VAT treatment + AFP invoice fix, 2026-07-27)** —
  `Clients.vat_treatment` ('reverse_charge' default | 'standard' | 'zero') +
  `Clients.payment_terms_days` (default 30) via `api/sql/add-client-vat-terms.sql`
  (ADD COLUMN → Function App restart). Fields editable in Add/Edit Client
  modals. `applications-generate-invoice` rewritten: VAT position now comes
  from the client's vat_treatment (never from cert figures — certs show £0
  VAT under reverse charge); single editable summary line "Works executed as
  per Application for Payment AFPxx / Payment Certificate <ref> dated <date>"
  instead of the raw AFP line dump; `due_date` = invoice_date + client terms.
  Invoice modal: VAT/CIS checkboxes replaced by a 3-way VAT Treatment select;
  selecting a client auto-applies its treatment + terms (hint line shown,
  still overridable). Draft invoices now editable via ✏️ Edit in the detail
  modal (reuses New Invoice modal, `_invEditing`, wholesale line replace).
  `invoices-detail` joins Applications for `afp_ref` / `afp_certificate_ref`
  / `afp_certificate_date` (drives the PDF "Re:" line). PDF corrections in
  `drawBamaInvoicePDF`: VAT Reg 435 0591 07 in From block, registration
  footer (Company No. 14680571), accounts@bamafabrication.co.uk, NEW bank
  details (Sort 30-99-50, Acct 26816462), statutory DRC wording (VAT Act
  1994 s55A), "Re: AFP / Payment Certificate" reference line.
- **Invoicing: PO→client sync + Bill To address (2026-07-28)** — PO prompt
  also extracts the ISSUER's address (line1/2, city, county, postcode) +
  contact email/phone (never the Bama deliver-to block). `_invApplyParsedPO`
  is now async: unknown customer → auto-created via `POST /api/clients`
  (VAT treatment from PO VAT signal, 30-day terms, toast to review) and
  pushed into `_invClientsCache`; known client with no address → backfilled
  via `PUT /api/clients/{id}` (contact fields only if empty). Warning toast
  if neither PO nor client has an address. `invoices-detail` now joins
  `client_address_line1/2/city/county/postcode`; `_buildInvoicePdfData`
  builds a multi-line Bill To (detail-join → _invSelectedClient →
  clients-cache fallback) and toasts a warning when the PDF is generated
  with no address (clients reject address-less invoices). Email subject
  uses first Bill To line only.
- **Invoicing: Fill from PO (2026-07-28)** — "📄 Fill from PO" button in the
  New/Edit Invoice modal (`invPoParseBtn` + hidden `invPoFileInput`, accepts
  PDF or image). `parseInvoicePO()` → `_invParsePOFile()` (Claude vision via
  claude-proxy, 429 retry 30s, extracts customer/po_number/po_date/lines/
  net_total/vat_amount/carriage; skips zero-value "Message Line" rows,
  merges their text into vague priced lines; handles per-hundred pricing)
  → `_invApplyParsedPO()` (deterministic): customer fuzzy-matched via
  `_invImportMatchClient` → `selectInvCustomer` (client VAT/terms win) else
  free-text + PO VAT signal sets treatment; lines wholesale-replace
  `_invLineRows`; "As per your Purchase Order No. X dated Y" appended to
  Notes (prints on PDF). Two-engine: totals always recomputed by
  `recalcInvoiceTotals()`; hint cross-checks lines total vs PO stated net
  (red warning if >1p off) and flags client-default vs PO VAT conflicts.
- **Invoicing Phase 3 (historical import, 2026-07-27)** — "📥 Import Old
  Invoices" button on the tracker header → `invImportModal`: multi-PDF
  picker, sequential Claude vision OCR per file (429 retry once after 30s)
  extracting ref/date/customer/net/VAT/retention/gross/reverse-charge flag,
  editable review grid with fuzzy client auto-match (Ltd/Limited-insensitive),
  duplicate-ref flagging (against `_invInvoiceList` + within batch), per-row
  VAT mode + Paid/Issued status (default Paid → total_outstanding 0).
  Commit: original PDFs uploaded to `01 - Accounts/03 - Sales Invoices/
  YYYY/MM/` (non-fatal per file), then `POST /api/invoices-import` (flat
  route, max 100/batch, server-side ref dedupe, CN/PRO prefix → kind,
  single summary line per invoice). Refs preserved so `nextInvoiceRef`'s
  MAX-scan lands correctly after backfill. NOTE: seed INV0257 + broken
  INV0258 hard-deleted via one-off SQL (children first, AFP reset to
  Certified) — real ones re-enter via import.
- **Invoicing Phase 4a (aged debt, 2026-07-27)** — collapsible "Aged Debt"
  card at the top of the Sales Invoices tab: bucket tiles (Not yet due /
  1–30 / 31–60 / 61–90 / 90+ days past due + Total outstanding) and a
  per-customer aged table with expandable invoice rows (click customer →
  its open invoices; click invoice → detail modal). Computed client-side
  from `_invInvoiceList` (kind=invoice, status Issued/Partially Paid,
  total_outstanding>0; bucket by days past due_date, falls back to
  invoice_date). `renderInvAgedDebt()` hooked into `renderInvSalesTable()`.
- **Invoicing Phase 4b (issue→email last mile, 2026-07-27)** — reuses the
  generic Babcock email composer (modal markup copied into
  `invoice-tracker.html`; opener/sender in shared.js are page-agnostic).
  New default template `emailInvoiceIssue` (tokens: invoice_ref,
  contact_name, project_suffix/project_line, gross_total, due_date,
  vat_note — vat_note auto-includes CIS reverse-charge paragraph when
  applicable). `_openInvoiceEmailComposer(inv)`: regenerates the invoice
  PDF via `renderBamaInvoicePDF`, attaches as base64, prefills To: from
  the client's contact_email (clients cache). Auto-opens right after
  Issue + PDF succeeds (the last mile); also available anytime via
  "📧 Email Invoice" button on the detail modal for Issued/Partially
  Paid/Paid. Sent via Graph /me/sendMail from the signed-in user.
- **Invoicing Phase 4c (credit notes, 2026-07-27)** — "Credit Against
  Invoice" picker in the invoice modal (shown only for kind=credit_note;
  searches Issued/Partially Paid/Paid invoices; prefills customer +
  project from the parent). `parent_invoice_id` persisted on create AND
  update (added to invoices-update). On issue, `_invAllocateCreditNote()`
  posts a "Credit Note" payment of the CN gross against the parent via
  the existing payments endpoint — parent's outstanding + status
  auto-update (aged debt reflects it immediately; CNs themselves are
  excluded from aged debt by the kind filter). Detail modal shows
  "Credits INVxxxx"; parent's payments table shows the CN row. PDF gets
  a "Credit against Invoice INVxxxx" line (parent ref joined in
  invoices-detail as parent_invoice_ref). saveAndIssueInvoice also gained
  the email-composer last mile + CN allocation. Standalone CNs (no
  parent) still allowed.
- **Invoicing Phase 4d (AI email drafting + CN import, 2026-07-27)** —
  generic composer gained QB-style AI drafting: `openBabcockEmailModal`
  accepts optional `aiDraft:{context}`; when supplied, a tone bar
  (Warm/Brief/Firm + ↻ Redraft, `_ensureBemailToneBar` injected above
  bemailBody at runtime so no per-page markup edits) appears and
  `draftBabcockEmailBody()` drafts via claude-proxy (429 retry 30s,
  falls back to the resolved template body). Invoice/CN composer passes
  full context (ref, contact, project, amount, due date, RC note,
  parent invoice for CNs). Any other caller (tenders/babcock) can adopt
  by passing aiDraft. Historical import OCR prompt now credit-note and
  pro-forma aware (CN/PRO refs, positive amounts even if bracketed).
- **Invoicing Phase 4e (one-click payment chaser, 2026-07-27)** — chase
  mode on the invoice composer: `_openInvoiceEmailComposer(inv, {chase:
  true})` uses new template `emailInvoiceChase` (tokens outstanding_total,
  overdue_phrase) with AI context including outstanding vs original,
  days overdue, and an escalation instruction when >45 days; default
  tone auto-selects firm when >30 days overdue, warm otherwise.
  Entry points: "📨 Chase Payment" on the detail modal (Issued/Partially
  Paid invoices with outstanding>0) and a one-click 📨 Chase button on
  every expanded aged-debt invoice row (`chaseInvoiceById` fetches
  detail + opens composer; event.stopPropagation so the row click still
  opens detail). PDF copy attached in both paths.
- **Invoicing polish (2026-07-27)** — (1) Sales Invoices search bar
  (`invSalesSearch`, filters ref/customer/project/status client-side,
  match count shown). (2) Sender-aware signature: emailSignature default
  now uses {{sender_name}} + new token {{sender_sig_role}} ("Role — BAMA
  Fabrication" or just company); buildBabcockEmailTokens falls back to
  "Accounts Team" when no user resolved. NOTE: a customised signature
  saved via the Templates page OVERRIDES this default — edit there too
  if one exists. (3) QB email signature now resolves the sender name
  from Graph /me (`qbFetchSenderName`, cached, falls back to preparedBy)
  — QB deliberately has NO shared.js dependency so it was aligned in
  place rather than ported to the Babcock engine; full port parked.
  QB Help updated per definition-of-done.
- **Invoicing: reopen wrongly-Paid invoices (2026-07-27)** — "↩ Reopen"
  button on the detail modal, visible only for Paid invoices with ZERO
  payment rows (i.e. imported historicals). `POST /api/invoices/{id}/
  reopen` (guarded server-side: must be Paid, must have no payments —
  invoices WITH payments are corrected by deleting the payment row,
  which recomputes automatically). Sets status=Issued, total_outstanding
  =gross. bamaConfirm gate before action.
- **Invoicing polish (2026-07-27)** — (1) Sales Invoices search bar
  (`invSalesSearch`, filters ref/customer/project/status client-side,
  match count shown). (2) Sender-aware signature: emailSignature default
  now uses {{sender_name}} + new token {{sender_sig_role}} ("Role — BAMA
  Fabrication" or just company); buildBabcockEmailTokens falls back to
  "Accounts Team" when no user resolved. NOTE: a customised signature
  saved via the Templates page OVERRIDES this default — edit there too
  if one exists. (3) QB email signature now resolves the sender name
  from Graph /me (`qbFetchSenderName`, cached, falls back to preparedBy)
  — QB deliberately has NO shared.js dependency so it was aligned in
  place rather than ported to the Babcock engine; full port parked.
  QB Help updated per definition-of-done.
  Invoicing module COMPLETE except parked item (remittance OCR — incoming).
- **Invoicing: Pay & Remit + retention release (2026-07-27)** — Supplier
  Invoices tab: checkbox per unpaid row → "💸 Pay & Remit" (single supplier
  per run) → modal (date/method/reference) → marks each PO paid
  (`paid_at/paid_by/paid_ref` — new `PurchaseOrders.paid_ref` column),
  renders native-jsPDF remittance advice (`drawBamaRemittancePDF` /
  `renderBamaRemittancePDF`, drawDnPDF conventions, header repeat on
  page-break), uploads to `01 - Accounts/06 - Remittances/YYYY/MM/`
  (non-fatal — blob tab fallback), then opens the email composer
  (template `emailRemittance`, AI-draft context, PDF attached) to the
  supplier's email. Sales tab: collapsible "🔒 Retention Held" card
  (invoices with `retention_amount>0`, Issued/Partially Paid/Paid, no
  active release child) with overdue-red due dates and a one-click
  "Raise Release Invoice" → creates a Draft invoice flagged
  `Invoices.is_retention_release=1` + `parent_invoice_id`, net =
  retention, VAT per client vat_treatment, due = today + client terms,
  single "Release of retention held under invoice X" line, then opens
  the detail modal for review/issue. RET badge in the sales list;
  detail modal + PDF show "Retention release for INVxxxx". Edit-draft
  path preserves the flag via `_invEditing`. Migration:
  `api/sql/add-remittance-retention.sql` (ADD COLUMN → Function App
  restart). Follow-up (same day): remittance PDF logo fix
  (`renderBamaRemittancePDF` now awaits `loadLogoDataUri()` — reading the
  bare cache rendered the text-fallback header), supplier-invoices search
  bar (`invSupplierSearch`, filters supplier/PO/inv#/project/paid) with a
  header select-all checkbox that ticks every UNPAID row in the filtered
  view, and an amber From-mismatch warning in the shared email composer
  when the browser's Microsoft login ≠ the PIN'd ERP user (emails go via
  Graph /me/sendMail = the signed-in mailbox; sending as a shared
  accounts@ mailbox would need Mail.Send.Shared + mailbox permissions —
  parked, needs Daniel).
- **Invoice Tracker** — standalone `invoice-tracker.html` page with four
  tabs (AFPs · Sales Invoices · Supplier Invoices · Receipts). Gated by
  the `invoicing` permission. Backed by `Applications`,
  `ApplicationLineItems`, `Invoices`, `InvoiceLineItems`,
  `InvoicePayments`, `Receipts`, `InvoiceAttachments` tables (see
  `api/sql/add-invoicing.sql`) plus `PurchaseOrders.supplier_invoice_*`
  extension columns. **Commit 1 done** — schema, page shell with PIN
  gate, four-tab layout, KPI tiles, sidebar cross-nav on all tracker
  pages, Hub tile, INV0257 seed row so the first allocated invoice ref
  is INV0258. **Commit 2 done** — full Sales Invoice CRUD (incl. pro
  formas + credit notes), shared `drawBamaInvoicePDF` renderer mirroring
  the Babcock quote template (RED + NAVY palette, selectable text via
  jsPDF, retention/VAT/CIS reverse-charge totals, BAMA bank details
  footer); issue flow: Draft → render PDF → upload to
  `01 - Accounts/03 - Sales Invoices/YYYY/MM/` → mark Issued with
  SharePoint link. Payment recording with auto status update
  (Issued/Partially Paid/Paid) and retention-release flag. Void flow.
  Receipts tab with client-side Claude vision OCR pre-filling supplier /
  date / category / net / VAT / gross; file uploaded to
  `01 - Accounts/05 - Receipts/YYYY/MM/{category}/`. Supplier invoices
  tab attaches uploaded supplier invoices to existing POs via Claude
  vision OCR; PUT `/api/purchase-orders/{id}/supplier-invoice`
  auto-reconciles (within £1 of PO total = `matched`, else
  `discrepancy`); files go to `01 - Accounts/04 - Supplier Invoices/`.
  `auth.email || auth.name` pattern used for `created_by` / `uploaded_by`.
  **Commit 3 done** — full AFP lifecycle (Draft → Submitted → Certified →
  Invoiced → Cancelled), separate `afps` permission (wired through all 5
  places, separate from `invoicing`). Two-pane AFP tab layout: left sidebar
  lists projects with AFPs alphabetically with action-pending badges
  (`N cert?`, `N inv?`), right pane shows the project's AFP01, AFP02… stack
  as clickable cards. Show-cancelled toggle hides Cancelled by default
  (numbers are burned via unique index `(project_id, application_no)`).
  New AFP modal: SOV pre-populated from quote line items (AFP01) or prior
  AFP's lines (AFP02+); `previous_pct_complete` carried forward from the
  most-recent CERTIFIED AFP per line (matched by `source_quote_line_item_id`
  then by description); Final Application checkbox snaps all lines to 100%.
  Save Draft + Save & Submit (renders AFP PDF → uploads to
  `<ProjectFolder>/Application for Payment/AFPxx.pdf` → marks Submitted).
  `drawBamaAfpPDF` renderer mirrors the Invoice PDF letterhead with
  "Application for Payment" title, FINAL APPLICATION red banner if Final,
  7-column SOV table (# | Description | Contract £ | Prev Cum £ | This App £
  | Cum £ | % Date), navy TOTAL APPLIED pill. Certificate upload modal:
  client-side Claude vision OCR extracts BOTH header (cert ref/date,
  certified net/VAT/retention/gross) AND per-line certified £ values
  (matched to AFP lines by description). Upload & Confirm: cert PDF saved
  to `<ProjectFolder>/Application for Payment/AFPxx-Certificate.<ext>`,
  cert metadata + per-line certified values persisted, status → Certified.
  Generate Invoice flow: creates Draft Invoice with `source_afp_id`,
  retention copied from AFP, lines copied (uses `certified_this_app_value`
  if set, else `this_app_value`), AFP → Invoiced. Schema additions in
  `add-afps-extras.sql`: `Applications.is_final`, `period_start`/`_end`;
  `ApplicationLineItems.cumulative_value`, `certified_this_app_value`;
  `UserPermissions.afps`. New API endpoints in `invoicing.js`:
  `applications-create`, `-update`, `-submit`, `-certificate` (POST+PUT),
  `-generate-invoice`, `-cancel`, `applications-next-ref` (flat route to
  avoid `{id}` collision per the lesson from the invoices-next-ref hotfix).
  Numbering allocators implemented:
  `nextInvoiceRef(kind)` (INV / PRO share sequence, CN separate),
  `nextAfpRef(projectId)` (per-project AFP01, AFP02…). SharePoint paths
  locked: Sales Invoices → `01 - Accounts/03 - Sales Invoices/YYYY/MM/`,
  Supplier Invoices → `01 - Accounts/04 - Supplier Invoices/YYYY/MM/`,
  Receipts → `01 - Accounts/05 - Receipts/YYYY/MM/{category}/`,
  AFPs → `<ProjectFolder>/Application for Payment/`.
- **RBAC** — real role-based permissions enforced server-side. Current
  `UserPermissions` flags become the source of truth the API checks, not just
  what the UI hides. Blocker: move PIN verification server-side first.
- **Sickness / SSP integration** — Sickness and absence entries on the
  `Holidays` table (type other than `paid`/`half`/`unpaid`) are currently
  ignored by payroll. Build SSP triggering: track qualifying days, apply the
  SSP rate after the 3-day waiting period, surface on the payroll page
  alongside holiday pay. Depends on a Settings entry for the current SSP
  weekly rate and a per-employee earnings threshold check.
- **Bank holiday list to Settings** — UK bank holiday dates are duplicated
  in `UK_BANK_HOLIDAYS` (shared.js) and `api/src/bank-holidays.js`. Move to
  a `BankHolidays` table or Settings row, editable from manager.html.
  Avoids a code deploy each year. Current list runs out at the end of 2027.
- **PO from supplier quote (parsed)** — Phase 2 of the Purchase Orders
  feature. User uploads a supplier's quote (PDF, image, Excel) into the
  New PO modal; the system extracts line items (description, qty, unit,
  unit_price, line_total) via Claude API + (for scans) OCR, pre-populates
  the modal for review, and stores the source file as a `POAttachments`
  row with `kind = 'supplier_quote'` so the prices are traceable.
  Reuses the LLM pipeline already wired up for Babcock COUPA OCR.
  Should also fuzzy-match the supplier name in the parsed quote against
  `Suppliers` and pre-select. Aim: human reviews and confirms — never
  auto-creates the PO without confirmation.
- **Supplier tiles (queued)** — two more quick-access tiles above the supplier
  table, alongside the existing "POs Awaiting Invoice" tile:
  - **Discrepancies** — count of POs where `reconciliation_status = 'discrepancy'`
    (invoice received but value doesn't match PO total within £1 tolerance).
    Red tile. Drill-down grouped by supplier showing PO ref, PO value, invoice
    value, and difference. Should always be zero.
  - **Overdue POs** — Open/Approved/Sent POs where `created_at` is older than
    30 days with no `delivery_received_at` or `supplier_invoice_received_at`.
    Amber tile. Drill-down grouped by supplier sorted by age desc.
- **Supplier detail view + invoice upload** — clicking a supplier in the
  Office → Suppliers tab will open a detail panel showing all POs for
  that supplier, grouped by status (Open / Received / Matched /
  Discrepancy / Closed). Each PO row expandable to show line items.
  A file-upload area on the panel lets office staff attach a supplier
  invoice directly to the supplier record: the PDF is saved to SharePoint
  under `01 - Accounts/04 - Supplier Invoices/YYYY/MM/` and linked to the
  matching PO via the existing `PUT /api/purchase-orders/{id}/supplier-invoice`
  flow (with Claude vision OCR pre-filling supplier / date / net / VAT /
  gross for review before saving). Essentially a supplier-first entry
  point for the supplier invoice workflow that already exists in the
  Invoice Tracker.
- **Supplier detail: contacts + address enrichment** — the supplier detail
  header should show all contacts for that supplier with a `notes` field
  indicating department/role (e.g. "Accounts", "Sales", "Account Manager").
  `Suppliers` has a single `contact_name` field today; this needs expanding
  to a `SupplierContacts` table (supplier_id, contact_name, contact_email,
  contact_phone, notes/department, is_primary) similar to `ClientContacts`.
  The address (address_line1/2, city, county, postcode) should also be
  surfaced in the detail header. If those fields are blank, the first
  successful invoice OCR parse for that supplier should auto-fill them
  (Claude already extracts supplier address from invoices during the dropzone
  flow — save it back via `PUT /api/suppliers/:id` if the supplier currently
  has no address). Both the contacts and the address enrichment from invoice
  parsing should be added together as a single feature.
- **Instant PO** — "I'm on the phone to a supplier and need a PO number
  RIGHT NOW" flow. Button on the PO Tracker (and ideally a kiosk
  shortcut). Asks only for supplier name (autocomplete from `Suppliers`,
  or free-text if not on file yet), allocates the next sequential PO
  reference immediately, persists a `PurchaseOrders` row with status =
  `Open` and a flag (`is_draft_stub` or similar) marking it as
  incomplete, and creates a follow-up task on the office dashboard
  ("Complete PO P260507 with Bapp — raised by Mike at 14:32") assigned
  to office admin (or to whoever's the configured "PO completer").
  The reference goes back to the caller instantly; admin fills in
  project link, line items, totals etc. when they get to the task.
  Should integrate with the existing dashCreateTaskModal / office task
  system so it shows up in the normal task queue.

### Planning session — 2026-06-02 (voice notes, design tomorrow)

- **Daily login alert modal** — On a user's **first login of the day** to the
  ERP, show a once-per-day modal (shown on the first login attempt only, never
  again that day). Contents:
  - All overdue tasks **delegated to this user** — how long each is now overdue
    and who it is overdue with.
  - **Role-based alerts** driven by a setup/config system (see below) — e.g.
    a director (Ahmed) sees invoices due to be paid today + whose tasks are
    most overdue; office admin (Natasha) sees unmatched PO numbers + her own
    dashboard tasks. Different users see different alert types.
  - Option to **print the job list per day**.
  - Data sources: the existing dashboard tasks, invoices due to pay today, and
    overdue items from the **Compliance Calendar** (below).
  - **Alert setup/config system** — admin panel to decide which alert types
    each user/role receives. Map alert types → users/roles.
- **Babcock Quotes tracker — project number fix** — Project number is not
  displaying correctly in the bids/quotes tracker. May have been fixed before;
  double-check and re-fix if needed.
- **HOUSEKEEPING — delete 3 tenders from today** — Three tenders created on
  2026-06-02 have broken SharePoint folders (folders didn't create correctly).
  Delete them from Tenders, then either redo them or fix the folder names.
- **Tender → quote auto-conversion** — When a tender has been typed up/saved,
  it should automatically become a quote at that point (no separate manual
  step).
- **Welding machine calibration certificates** — In the Control Traceability
  tab, add a calibration-certificate **upload field per welding machine**.
  Each upload needs a certificate **expiry date** and **reminders** for those
  dates (feed into the Compliance Calendar / daily login alert).
- **Compliance tab (new, standalone)** — A brand-new Compliance tab,
  **separate and unrelated to the welding machines**. Scope TBD — discuss
  tomorrow. Will house the Compliance Calendar below.
- **Compliance Calendar** — A document-expiry tracker for everything with an
  expiry date that needs action when due/nearly due: insurances, vehicle MOTs,
  van service dates, certifications, etc. Lives inside the Compliance tab.
  Overdue/upcoming items **feed into the daily login alert** report. (Name
  agreed: "Compliance Calendar".)
- **Invoice Tracker — show net not gross** — The invoice tracker page is
  currently displaying gross values for some reason; change it to show **net**
  values.
- **Invoice creation system** — Build a complete, fully functional invoice
  creation flow: generate an invoice and **match it to a received purchase
  order**. End-to-end.
- **Invoice Tracker — payment approval workflow** — Re-purpose the invoice
  tracker as the hub for tracking invoices **due for payment**. From that page,
  generate reports for the directors showing which invoices are due; directors
  flag "please pay this invoice"; office admin staff then proceed with payment
  for flagged invoices. (Approval → execution workflow.)

## Local dev

- Frontend: serve the repo root over HTTP (e.g. `npx http-server` on :4280 to
  match the CORS allowlist). OAuth redirect URI is the prod SWA, so local logins
  aren't straightforward — work against the deployed API with a token captured
  from a real session in sessionStorage.
- API: `cd api && npm install && npm start` (requires Azure Functions Core Tools
  v4). Fill in `SQL_CONNECTION_STRING` in `local.settings.json`.

## Deployment

Both workflows trigger on push to `main`:
- **Frontend** → `Azure/static-web-apps-deploy@v1`, uploads `/` as-is.
- **API** → zips `api/`, deploys to Function App `bama-erp-api` via OIDC.

## Monitoring, alerting & client errors (Session 2, 2026-09-05)

The system tells us when it breaks. Three layers, none of which touch SQL on a
timer (the 2026-08-10 Serverless cost rule holds):

- **Application Insights** on the Function App — resource **`bama-erp-api`**
  (same name as the Function App; enabled at creation, app setting
  `APPLICATIONINSIGHTS_CONNECTION_STRING` already present — confirmed 2026-09-05).
  Adaptive sampling is on in `host.json` with requests excluded from sampling.
  Traces = `context.log/warn/error`; every invocation's `operation_Id` equals
  the `X-Request-Id` we return (below). Expected cost: free tier / < £5 a month.
- **One alert rule** (created 2026-09-05) — a *log search* alert on the App
  Insights resource: `requests | where toint(resultCode) >= 500`, table rows
  > 5 per 5-min window, evaluated every 5 min, severity 1, auto-resolve, mute
  30 min → action group `bama-erp-alerts` (display `bama-erp`) → email
  matt@bamafabrication.co.uk. ~$1.50/month. Why not a platform metric: the
  Function App is on **Flex Consumption**, which exposes no `Http 5xx` /
  `Http Server Errors` metric ("not supported for selected scope"). Why
  `resultCode` and not the "Failed requests" metric: Functions telemetry marks
  a *returned* 500 as `success=true`, and most of ours are returned via
  `serverError()`. Requests are excluded from sampling in `host.json`, so the
  count is exact. Expect the email ~5–12 min after the failures (ingestion +
  evaluation lag). **Tested 2026-09-05:** 6 × `diag-throw` at ~18:10 → alert
  email ~18:22 (12 min). Portal gotchas: the rule must be created from the
  *Application Insights* resource's Alerts blade, not the Function App's (same
  name — the Function App scope has no `requests` table and fails Details
  validation); the rule name cannot contain `>`; "Query must be specified"
  means the KQL wasn't committed on the Condition tab — paste, wait for the
  preview chart to render, then Next.
- **`api/src/functions/observability.js`** — ONE `app.hook.postInvocation`
  hook, zero handler edits: stamps `X-Request-Id: <invocationId>` on every
  response (exposed via `Access-Control-Expose-Headers`); on any status ≥ 500
  logs `[5xx] METHOD /api/route status=NNN user=<email> reqId=<id>` (email
  comes from a WeakMap `requireAuth` fills — `auth.getAuthUser(request)`; no
  PII beyond email); converts an UNCAUGHT throw into a CORS'd JSON 500
  `{error, request_id}` — the host's bare 500 has no CORS headers and the
  browser reports it as "Failed to fetch". Handler convention stays: catch →
  `context.error('route-name:', err)` → `return serverError(...)`. Never
  `console.*` in `api/` — it bypasses the invocation context.
  `GET /api/diag-throw?confirm=yes` (requireAuth, no SQL) throws on purpose:
  six calls trip the alert. Gate: `tests/observability-hook.js`.
- **Client errors** — the global `window 'error'` + `'unhandledrejection'`
  reporter (canonical block in `shared.js` between the
  `// === BAMA client-error reporter` markers; byte-identical standalone copies
  in `quote-builder.html` and `dashboard.html`, which don't load shared.js —
  `m-qms.html` DOES load shared.js, so no copy there). Fire-and-forget POST to
  `/api/client-error` with `{page, message, stack, url (hash stripped),
  userAgent, extra}`; de-duplicated per session, 10/session cap, skips
  no-token / 401 / AbortError / opaque "Script error." / resource-load events;
  the reporter itself can never throw. `apiCall` / `trFetch` / `qbFetch` set
  `err.requestId` + `window.__bamaLastApiRequestId` from `X-Request-Id` (in
  reports only — never in toasts). `bamaReportClientError(err, extra)` is the
  manual hook for caught-but-noteworthy failures. Server: rate limit 20/min per
  user IN CODE before any SQL; every field clipped; `ClientErrors` table
  (`api/sql/create-client-errors.sql`, new table, no restart); reads are
  date-bounded 1–90 days (default 7) — **no purge job, ever**; missing table =
  soft 200 `{stored:false}` so the reporter can't trip the 5xx alert before the
  migration runs. Viewer: **ED › Health › Client errors** (grouped, CSV, help
  note; Diagnostics box behind `userAccess`). Gates: `tests/client-errors.js`,
  `tests/client-error-copies.js` (edit the block in shared.js, then paste it
  into both standalone pages — the gate fails on drift).

## Backups & recovery

Azure SQL `bama-erp` (Serverless) has point-in-time restore (PITR) on by
default: full backup weekly, differential every 12–24 h, transaction-log backup
every 5–10 min (differential every 12 h). Retention, set 2026-09-05 at SQL
*server* `bama-erp-sql` → Data management → Backups → Retention policies (it
lives on the server blade, not the database):
- **PITR 35 days** (was the 7-day default) — any bad write inside five weeks
  can be undone to the minute.
- **LTR (long-term retention) is NOT available** — Azure refuses it on a
  Serverless database with auto-pause enabled
  (`LtrConfigPolicyUnsupportedIfAutoPauseEnabled`, tried 2026-09-05). Auto-pause
  stays (cost rule) → no LTR. Anything older than 35 days is unrecoverable from
  Azure backups. Optional belt-and-braces: a **manual** export (database →
  Export → .bacpac to a storage account) once a quarter, by hand — never a
  timer.
- Restore-test copies must be deleted afterwards (drill log).
Backups need nothing from us and nothing here touches SQL on a timer.

- **RPO ≤ 10 minutes** (the transaction-log backup interval — the most data a
  restore can lose). **RTO ≈ 30 minutes** (measured 27 min, 2026-09-05 — see
  drill log). Add ~5 min to repoint `SQL_CONNECTION_STRING` + restart the
  Function App in a real recovery. Alert auto-resolve also verified 2026-09-05
  (resolved email ~18:38 after the 18:22 fired email).
- **Drill procedure** (rehearse at least twice a year, from the office — the
  server firewall blocks home IPs so Query Editor won't connect from home):
  1. portal → SQL server `bama-erp-sql` → database `bama-erp` → top toolbar
     **Restore** → Point-in-time → pick a time 15–30 min ago → database name
     `bama-erp-restore-test` → **same compute tier (Serverless, same vCore
     max, auto-pause ON)** → Review + create. Note the wall-clock time.
  2. When the restore shows *Online*, open Query Editor on
     `bama-erp-restore-test` and run the row-count query in
     `docs/restore-drill.sql` (Projects / Invoices / ClockEntries counts +
     MAX ids/dates) — then the same query on live `bama-erp`. The copy must
     equal live minus whatever landed after the chosen restore point.
  3. Note the time the copy went Online → that is the measured RTO.
  4. **Delete `bama-erp-restore-test`** (Overview → Delete). It bills vCore
     seconds while resumed — never leave a restore copy behind.
  5. Record below.
- **Drill log**
  | Date | Restore point (UTC) | Create → Online | RTO (measured) | Row counts (copy vs live) | Run by |
  |---|---|---|---|---|---|
  | 2026-09-05 | 16:19 | 17:52 → ~18:19 BST | **~27 min** | Projects 88/88 (max id 91) · Invoices 330/330 (max id 553) · ClockEntries 382/382 (max id 405) · ChangeLog 168/168 — identical; copy deleted after | Mateusz |
  Lessons: the portal's *Deployment start time* drifted backwards while restoring — ignore it, time from the Create click. No progress indicator exists; refresh the SQL databases list. 27 min for a 32 GB-tier Serverless DB with ~1k rows in the big tables is the log-chain replay + resume cost, not data volume — plan on ~30 min RTO.
- **Real recovery** = the same steps with the LIVE name: restore to
  `bama-erp-restored`, verify, then either repoint `SQL_CONNECTION_STRING` on
  the Function App to the restored database (fastest — Function App restart
  applies it) or rename databases. Never restore *over* the live database
  before the copy has been verified. `ClockEntries` is the one table that must
  never be lost — check its count first.

## AFP v2 (Applications for Payment) — invoice-tracker.html
- **Cumulative model** (mirrors client Excel): per line the user sets **cumulative %** (`this_app_pct_complete` stores CUMULATIVE %, not per-period). `this_app_value` = contract × (cum − prev)%. Summary: Value of Application (cumulative) − Less Previous Contractor Certificate (editable, auto = Σ certified net of prior AFPs) = GROSS Valuation this period − retention = Amount Due. This automatically re-claims payless shortfalls.
- **Grouped SOV**: `ApplicationLineItems.section` ('measured'|'variation'|'materials') + `item_no`/`item_description`/`item_quote_ref`/`item_wo_no`. Item = a BAMA quote; sub-lines = cost breakdown from QuoteLineItems.
- **VO auto-pull**: AFP02+ copies prior AFP's SOV wholesale, then appends any ProjectQuotes quote whose reference isn't in the SOV yet as a new Variation item (toast shown). Primary quote(s) → Measured Works on AFP01.
- **Per-line paid ledger**: `gross_amount_paid` = cumulative certified £ on the line. Carried forward at AFP creation from last certified AFP; cert-confirm PUT adds `certified_this_app_value` on top (re-confirm strips old value first — no double-add).
- **Retention + Contract No** live on Applications (`retention_pct`, `contract_no`), carried forward from the most recent AFP = per-project sticky.
- **VAT default OFF** — AFPs are not VAT documents; VAT applies at invoice stage.
- **PDF**: `drawRamsPDF`-style native jsPDF renderer `drawBamaAfpPDF` — **landscape A4**, page 1 summary block, then grouped section pages (item header rows with light fill + quote/WO refs, red outstanding values, section totals, header repeat on page-break, Page X of Y footer).
- **Cert / payment-notice OCR v2**: max_tokens 8000 (1500 truncated multi-page notices → JSON crash), `_extractJsonLoose` salvages truncated AI JSON (fence-strip + bracket-balance, sets `_truncated`). Per line the OCR extracts **certified CUMULATIVE value** (RG Carter "Certification Current Value") — handles both period and full-value certs; server derives this-period = cum − carried paid base and sets `gross_amount_paid = cum` (re-confirm safe). Manual fallback always available: "✓ Certify in full" copies applied figures into the cert fields per line. Payless lines highlighted red in the modal; Certified/Invoiced AFP cards show a red "▼ PAYLESS £X" badge when certified net < applied net.
- **Natasza one-click**: Certified AFP cards show "✓ READY TO INVOICE" + Generate Invoice button directly on the card (`generateInvoiceFromAfpCard`).
- **AFP import (mid-project onboarding)**: the import RECREATES the imported document itself — reads valuation no + "works up to" date, forces that AFP ref/number via `application_no` on POST /api/applications (dup-guarded; nextAfpRef MAX+1 continues the sequence, so the next raise is automatically N+1), keeps the document's own Less Previous Certificate. "📥 Import latest AFP" in the New AFP modal reads a submitted AFP (.xlsx strict SheetJS parser `parseAfpWorkbook` — validated to-the-penny vs S1969 AFP6; AI fallback `parseAfpWithAI` for PDFs/drifted layouts, `AI_MODEL` max_tokens 8000) and fills SOV + contract no + retention; prev certificate prefilled = imported cumulative (user checks vs latest payment notice). Requires xlsx.full.min.js script tag on the page.
- Quotes with no line items fall back to a single "Contract works (as quoted)" line at quote_value. Zero-value lines stay in the modal but are excluded from the PDF.
- Migration: `api/sql/add-afp-v2.sql` (ADD COLUMN → Function App restart required).
- **Submit PDF date (2026-09-05)**: both submit paths (`saveAndSubmitAfp`, `submitAfpFromDetail`) render + upload the PDF BEFORE `POST /submit` stamps `submitted_at` (deliberate — a PDF/SharePoint failure must not leave a Submitted AFP with no document), so they pass `{ ...afp, submitted_at: afp.submitted_at || now }` into `_buildAfpPdfData`. Without it the SharePoint PDF printed "Date: Draft" while the detail-modal re-download (post-submit) had the date. Keep the render-before-submit order.
- **Cancel semantics (2026-09-05, Mateusz — S1969 AFP07)**: `POST /api/applications/:id/cancel` (and `DELETE /api/applications/:id`) share `cancelOrDeleteAfp()`. **Draft → HARD DELETE** (InvoiceAttachments parent_kind application/application_certificate → ApplicationLineItems → Applications; ChangeLog `hard_delete`) so the number is freed and `nextAfpRef` (MAX+1, unchanged) hands it out again. **Submitted / Certified → soft cancel** (status Cancelled, row kept, number burned — the PDF was issued to the client; ChangeLog `cancelled`). Invoiced → refused. UI `cancelAfp()` shows "Delete draft" vs "Cancel AFP" copy accordingly. Never reintroduce a blanket soft-cancel for drafts.
- **Retention is NEVER deducted on AFP-generated invoices (2026-08-17, Mateusz's rule)**: retention is held at PROJECT level (`Applications.certified_retention` → CVR "Retention held"), and the payment-notice "Total amount due" is already net of retention. `applications-generate-invoice` sets invoice net = certified payment due excl. VAT (`certified_gross − certified_vat`, fallback `certified_value_net − certified_retention`, then applied equivalents), `retention_amount = 0`, VAT/reverse-charge on the full due amount. Bug history: INV0316 (S1965/C132 Val 6) subtracted cumulative retention £8,616.66 from the £8,803.34 due → £186.68. `certified_retention` is stored CUMULATIVE (2026-08-17, Mateusz: client payment certs always show retention cumulatively) — OCR extracts the notice's cumulative retention row as-is; CVR "Retention held" takes the LATEST certified AFP's figure per project (TOP 1 by application_no), never SUM; generate-invoice's net−retention fallback demoted below the gross-based paths (only correct on a first valuation).
- **Summary-only payment notices (RG Carter S3 style, 2026-08-18)**: cert OCR is raw-extraction only — the AI NEVER calculates; it lifts printed figures (`notice_gross_valuation_cum`, `notice_previously_paid`, retention row, payment due, dates) and returns `line_items: []` for summary notices. Deterministic JS then: (a) derives this-period net = payment due + retention movement (cum retention now − previous certified AFP's `certified_retention` from `_invAfpList`, 0 if no history); (b) auto-fills all cert line inputs at applied cumulative when the notice's gross valuation reconciles with the applied total (±£0.05), else warns with the exact £ mismatch and fills nothing. Verified against CM0665 Val 4: derived net 24,727.00 = Carter's own This-Payment subtotal.
- **QS breakdown as second cert document (2026-08-18)**: cert modal has an optional second dropzone for the QS's breakdown/account summary (xlsx/pdf/image; main input also accepts xlsx now). `_certFileToBlocks` converts Excel to CSV text via SheetJS (all sheets, 60k char cap) — Anthropic API can't take xlsx raw. Prompt rules: breakdown drives per-line certification (lumps matched by description; "Contract sum" in full = all measured-works lines at applied cum); header totals always from the notice. Breakdown saved to SharePoint as `<ref>-Certificate-Breakdown.<ext>` beside the cert. `_runCertParse()` shared by both pickers.
- **AFP paid semantics — HARD RULES (2026-09-02, replaces the 2026-08-18 asymmetric lift after Stevenage + Linford AFP06 audit)**:
  1. `gross_amount_paid` on a line = cumulative CERTIFIED/paid to date. Set ONLY by the certificate PUT (per-line "Cert cum £"). Never estimated.
  2. Next-AFP seeding (`_afpPopulateSov`, AFP02+): `previous_pct_complete` = paid ÷ contract_value (cap 100) from the matched line of the LAST CERTIFIED AFP — **one model, both directions**. Payless lines start at the paid level (e.g. 0%), NOT at our applied %; the claim is `this_app_pct_complete` (= max(prev AFP cum, prev%)), so shortfalls are still claimed and now SHOW as "this application £". Application totals are unaffected either way. Toasts: lines certified above applied; lines with no cert match (carried from previous AFP instead).
  3. Cert-line matching (`findCertLine`): source_quote_line_item_id → same item (item_quote_ref, or section+item_no when no ref) + description → cv tie-break. **Never description-only across items** — sub-line names repeat under every item; the original v2 matcher did this and planted other items' paid figures (3220% on Linford).
  4. Cert parse: if notice `Gross Valuation` == our applied cumulative (±5p) → certified IN FULL → every line = applied cum, deterministic, AI per-line output IGNORED. Otherwise AI reads per-line values with the Final-vs-Current rule (QS breakdowns pair Final Qty/Current Qty/Rate/Final Value/Current Value; Final Value and Rate are forecast final account, never certified; blank Current = 0). `_afpCertReconcile()`: Σ line cert cum can never exceed the notice Gross Valuation (prev cert + this-period net when no parse) → RED error + danger confirm on save.
  5. Amend Certificate: Certified AND Invoiced AFPs can re-open the cert modal (pre-filled with recorded header + per-line values; prev-paid column shows the pre-cert base). API preserves Invoiced status and original certified_at; per-line re-confirm strips the old delta (existing wasCert path).
  6. PDF `Paid £` on a saved AFP = `gross_amount_paid − certified_this_app_value` (paid BEFORE its own certificate) so a re-download always equals the sent document.
  7. SOV sources for a quote (AFP01 / VO auto-pull), in order: QuoteLineItems (tender_id, then qb_quote_id) → QB explicit lines (`qb_lines` from project-quotes: customLines for type custom, standardLines otherwise) → QB cost categories (est_*, pro-rata scaled to sell) → single "Contract works (as quoted)". All normalised so Σ === quote_value to the penny (drift on the largest line).
- **NO lump distribution — deleted 2026-08-18 (Mateusz)**: per-line certified values DO NOT EXIST at lump granularity; any split (AI or JS pro-rata) fabricates data and floods the review with fake red/amber deviations. Cert line rule is strictly: fill ONLY lines whose value is explicitly printed per line/item (verbatim, never capped at or adjusted toward applied; a printed blank/dash against a listed item = 0); coarse lumps → those lines stay BLANK for manual fill ("Certify in full" button covers the all-agreed case). Do not reintroduce lump splitting in any form.
- **Cert parse UX + carry rule (2026-08-18)**: pickers only STAGE files; one `🤖 Analyse` button (quote-helper pattern) runs `_runCertParse()` once over everything attached — one API call for notice+breakdown, not two. Prompt matching restored to e503436 confidence rules (match by description/order, printed values verbatim, never capped; blank/dash on a listed item = 0; single figure spanning many lines = leave out). After parse, deterministic carry: blank lines with no new claim (applied cum == prev paid, ±1p) fill at the paid value — no payless sign means the paid position carries; parsed values always win. Status reports carried count.
- **Stale-label bug (2026-08-19 root cause of "big mess" parse)**: `openCertUploadModal` nulled `_afpCertFile` but never reset the MAIN dropzone label, so a reopened modal showed the old PDF filename while nothing was staged → xlsx-only parse (gross taken from "This valuation", no retention/dates/ref, 0 matches). Fixed: both labels + Analyse button reset on open; result status now starts with "Analysed: <filenames>" and shows a loud amber warning when no payment notice was attached; raw parsed JSON logged to console as `[certParse]` for ground-truth debugging.
- **Cert modal: grouped lines + applied-vs-certified variance (2026-08-24, Stevenage RG Carter)**:
  `renderAfpCertLineFields` renders the per-line cert inputs GROUPED section → item
  (same headers as `_afpDetailLinesHtml`) — SOV sub-lines repeat identical names
  under every area (Approvals / Materials / Delivery…), so a flat list made it
  impossible to tell which area a certified value belonged to. `data-line-idx`
  stays the ORIGINAL flat line_items index (the parse fill and AI line numbering
  key off it); `data-line-id` drives the confirm PUT — do not renumber either.
  The cert-parse prompt's "Our application lines" now carries `[item N · desc ·
  quote ref]` context per line + a rule to disambiguate repeated names by area
  (skip, never guess, when the document doesn't make the area clear). The modal
  header inputs show "applied £X" hints and a live `_certVarianceUpdate()` strip
  (Net / Gross / Σ lines: amber ▲ ABOVE applied, red ▼ BELOW = payless, green ✓
  matches) — wired oninput on all header + line inputs, after parse, and on
  "Certify in full". AFP cards get an amber `▲ OVER-CERT £X` badge (mirror of
  `▼ PAYLESS`); the AFP detail modal shows an `afpDetailCertDiff` banner stating
  the certified-vs-applied direction and the next-AFP consequence.
- **Invoice due date from cert (2026-08-17)**: `Applications.certificate_final_payment_date` (migration `api/sql/add-afp-final-payment-date.sql`, ADD COLUMN → Function App restart). Cert modal has a "Final Payment Date" field; OCR extracts the notice's "Final Date for payment"; cert-confirm PUT stores it; `generate-invoice` uses it as `due_date` when present, else invoice date + client payment terms.
- **Invoice VAT rate (2026-08-17)**: `Invoices.vat_rate` DECIMAL(5,2) NULL (migration `api/sql/add-invoice-vat-rate.sql`; NULL = legacy 20). Rate select (20/5/0) beside VAT Treatment in the invoice modal; `_invVatRate()` feeds both standard VAT and the CIS reverse-charge info figure in recalc + payload; PDF prints the actual rate on the VAT line and the Section 55A notice. AFP-generated invoices default to 20 (NULL) — flip the rate in the Draft edit. First use: INV0316 at 5%.

## SDN edit: add lines to an existing note (2026-08-27)
- **Problem it solves (Mateusz/Leszek)**: fixings were missing from the BOM when an
  SDN was generated; adding them later forced a SECOND SDN. Now the ✎ Edit modal
  on any SDN (project register / deliveries modal) carries an **ADD ITEMS TO THIS
  NOTE** section listing every shippable BOM item across the project's jobs that
  isn't already a line on that note — including anything added to the BOM after
  the note was issued. Qty 0 = leave off; qty > 0 = goes on the same ref.
- **Eligibility = generation rules, exactly**: fabricated marks from
  `ready_for_despatch` capped at outstanding; fixings/consumables from
  `ready_for_despatch` OR `on_site` with no cap (overship / top-up). Items
  already on the note are excluded (edit their existing line instead — the server
  rejects duplicates with that message).
- **API**: `/api/sdn-amend` now also accepts `add_lines: [{ item_id, qty }]`
  alongside `lines`. Either may be empty (not both). Additions run in the SAME
  transaction: item rows locked (UPDLOCK), same-project guard via DrawingJobs,
  duplicate-on-note guard, ledger INSERT into `JobBomDespatches` inheriting the
  note's SharePoint file refs (TOP 1 existing ledger row) so the reissue
  fast-path keeps working, then the identical `despatched_qty`/status bump as
  generate-sdn. The at-least-one-line check counts additions. Register
  line_count/total_qty recompute already sums by ref, so new rows are covered.
- **Frontend** (`openSdnEditModal` / `confirmSdnEdit` in shared.js): candidates
  fetched fresh per job (`_bomItemsByJob` cache bypassed — statuses may have
  flipped since page load), grouped per job with the purple job header when
  multi-job, fabricated/fixings sub-groups, `sdnEA_qty_<id>` inputs default 0.
  Counts line reads "N lines · M pcs after edit (+K new)". After amend the
  existing flow re-fetches `sdn-detail` and redraws/overwrites the PDF in place,
  so added lines print on the same file automatically. `touchedJobs` refresh
  includes added items' jobs.

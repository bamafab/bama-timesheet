# BAMA Fabrication ERP

Workshop management system for BAMA Fabrication — a steel fabrication workshop.
Handles timesheet/kiosk clocking, payroll, holidays, office workflows, project/drawing
management, and a standalone UK steel section reference.

## Rules for Claude Code

- **Always run `node --check shared.js` after editing it.** It's ~9700 lines of
  untested global-scope JS — a syntax error breaks every page at once.
- **Do not touch hub.html OAuth logic without asking first.** The token-handoff
  dance (`#access_token` capture → sessionStorage → `bama_return_page` bounce) is
  load-bearing for every authenticated page. Changes here have broken prod before.
- **Chart.js is loaded in office.html only.** Reports (with charts) have moved from
  manager to office. Don't add the CDN tag to other pages.
- **Tender ↔ Quote financial separation.** The Tender page and Tender list must
  NEVER show financial details (pricing, costs, margins, quote values). Those
  belong exclusively on the Quote page (`quotes.html`), gated by `viewQuotes` /
  `editQuotes` permissions. Staff with only `tenders` permission must not see
  any monetary information. Always confirm with the user before adding any new
  info display to the Tender page or Tender list.
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
├── tenders.html          — Tender management + client database
├── quotes.html           — Quotations: financial-sensitive view (separate from tenders)
├── steel-database.html   — Standalone UK steel section reference (no shared.js, no auth)
├── shared.js             — ~9700 LOC. Page-aware; every page except hub/steel loads it.
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
            ├── auth.js           — (legacy copy of ../auth.js — not referenced; see Conventions)
            ├── clockings.js      — clock-in, clock-out, CRUD
            ├── clients.js        — Client database CRUD + search/autocomplete
            ├── drawings.js       — DrawingJobs + elements + notes
            ├── employees.js      — CRUD
            ├── holidays.js       — request / approve / reject, balance maintenance
            ├── keep-warm.js      — timer trigger: every 4 min, Mon–Sat 05:00–20:00
            ├── payroll.js        — week approval + PayrollArchive
            ├── project-hours.js  — CRUD + grouped summary
            ├── projects.js       — Projects CRUD + Won-quote conversion lookup
            ├── responses.js      — (legacy copy of ../responses.js — not referenced)
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
> ⚠️ **PINs are currently loaded to the client and compared in JS.** The full
> `Employees` row (including `pin`) arrives via `/api/employees?all=true` and the
> manager/office/draftsman PIN gates compare locally. `/api/auth/verify-pin`
> exists but is not used. This must be tightened before real RBAC lands:
> stop sending PINs to the client and route all PIN checks through the server.

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
- Decodes JWT header + payload (no signature check cryptographically, but verifies
  `kid` exists in Microsoft's JWKS, plus `exp`, `nbf`, audience, issuer)
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
  email, contact_name, notes, is_active, updated_at)` +
  `SupplierServices(supplier_id, service_type_id)` join
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

## Key conventions

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
- **Duplicate legacy files in `api/src/functions/`.** `auth.js` and `responses.js`
  also exist at `api/src/` and are the canonical versions — the copies inside
  `functions/` predate the refactor and aren't `require`d anywhere. Don't edit them;
  prefer deleting if touching this area.
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
- `confirmModal` — generic confirm dialog

hub.html and steel-database.html have no modals.

**tenders.html**
- `newTenderModal` — create new tender with client autocomplete
- `editTenderModal` — edit tender details and status (tender ↔ cancelled only)
- `newClientModal` — add a new client to the database
- `editClientModal` — edit client details
- `contactModal` — add/edit/delete a contact for a client (used in client detail)
- `tenderPinModal` — PIN entry on tenders page
- `uploadProgressModal` — file upload progress indicator

**quotes.html**
- `quotesPinModal` — PIN entry on quotes page
- `confirmModal` — generic confirm dialog (used by `showConfirmAsync` for the
  Won-quote conversion prompt before kicking off the project conversion)
- (Reuses `editClientModal`, `contactModal` from shared)
- Other quote-specific modals will be added as the financial workflow is built

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

- **⚠ URGENT — 2dp rounding on all financial calculations** — Floating point
  accumulation across line items produces values like £1,290.2999... which are
  stored as `+grandTotal.toFixed(2)` = £1,290.30 but can display incorrectly
  elsewhere (e.g. £1,291 in some render paths). Fix: every intermediate
  calculation that feeds a monetary total must round to 2dp at each step
  (`Math.round(x * 100) / 100`), not just at the final `.toFixed(2)` before
  storage. Affects: Babcock quote line item accumulation (`grandTotal +=
  ourPrice` in the generate flow), the marked-up total preview
  (`updateBabcockMarkedUpTotal`), the edit line items flow, and any other place
  line items are summed. Also audit `fmtGBP` usage — multiple local definitions
  exist; consolidate to one shared function. The "PO value sent" in the Bama SW
  Invoice Received modal derives from `total_value` so fixing at source fixes
  downstream too.

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
  categories per quote (Prelims through Delivery) are now editable on the
  Quote detail page (`quotes.html`) — see `loadQuoteLineItems()` /
  `renderQuoteLineItems()` / `saveQuoteLineItems()` in shared.js. The
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

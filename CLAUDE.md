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
- **Bump the cache-bust version when shipping UI changes** to `shared.js` or
  `bama.css`. Format: `?v=YYYYMMDD` + letter (`a`/`b`/`c`/… for same-day pushes).
  Example: first push on 2026-03-26 → `?v=20260326a`; hotfix same day → `?v=20260326b`.
  Update every HTML file that references the changed asset.

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
├── manager.html          — Manager dashboard (reports, settings, user access)
├── office.html           — Office dashboard (staff, holidays, payroll, archive, etc.)
├── projects.html         — Projects + drawings + draftsman mode
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
            ├── drawings.js       — DrawingJobs + elements + notes
            ├── employees.js      — CRUD
            ├── holidays.js       — request / approve / reject, balance maintenance
            ├── keep-warm.js      — timer trigger: every 4 min, Mon–Sat 05:00–20:00
            ├── payroll.js        — week approval + PayrollArchive
            ├── project-hours.js  — CRUD + grouped summary
            ├── responses.js      — (legacy copy of ../responses.js — not referenced)
            ├── settings.js       — Settings KV + PIN verify + /api/health
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
settings, userAccess, draftsmanMode`.

PIN gate: manager/office/draftsman entry requires the employee's numeric `pin`
(stored on the Employees row). Verified client-side against loaded employee data;
`/api/auth/verify-pin` exists but the UI currently compares locally.

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

## Payroll rules (BAMA-specific)

Implemented in [payroll.js](api/src/functions/payroll.js) `payroll-approve`:
- First 40 hours per week = basic (rate × 1)
- Hours over 40 = overtime (rate × 1.5)
- **Double time only applies to Sunday hours, and only if the employee worked
  Saturday AND Sunday in the same week.** Otherwise Sunday hours count toward the
  normal 40/overtime split.
- All totals rounded to 2 dp. Write + `UPDATE ProjectHours SET is_approved=1` runs
  in a single `mssql` transaction; rollback on error.

## Holiday rules

- Holiday year starts `2026-03-30` (`HOLIDAY_YEAR_START` in shared.js).
- Default annual entitlement is 28 working days (20 + 8 bank) — see
  `DEFAULT_ANNUAL_DAYS = 20`. Per-employee override via `holiday_entitlement`.
- UK bank holidays are hardcoded in `UK_BANK_HOLIDAYS`.
- `working_days` is computed client-side (`countWorkingDays`) excluding weekends
  and bank holidays, then sent to the API.
- Paid holidays decrement `holiday_balance` only on approval; deleting an approved
  paid holiday restores the balance.

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

## Roadmap / queued

Tracked here so Claude Code has context when a related question comes up —
none of this is built yet.

- **Mobile clock-in page** — PIN-based, no Microsoft login. Standalone page
  aimed at site staff with no work account. Will need a server-side PIN check
  (see the PIN warning under Auth) and its own scoped API surface.
- **Full project tracker in-app** — replace the SharePoint PROJECT TRACKER.xlsx
  dependency. Projects, statuses, and the Labour Log move into SQL. `loadProjects()`
  and `writeApprovedToLabourLog()` / `writeUnproductiveTimeLog()` will retire.
- **Quote → project workflow** — the currently-disabled QUOTATIONS tile on the
  hub becomes real: create a quote, accept it, auto-create a project + initial
  jobs. Depends on the project tracker migration above.
- **RBAC** — real role-based permissions enforced server-side. Current
  `UserPermissions` flags become the source of truth the API checks, not just
  what the UI hides. Blocker: move PIN verification server-side first.

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

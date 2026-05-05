# SESSION HANDOVER — Project Tracker build

> **Purpose:** Hand this session to a fresh Claude session so it can continue
> exactly where the previous one left off. Read this **first**, before
> CLAUDE.md, before any code, before answering anything.
>
> **Last updated:** end of session ending 2026-05-05.
> **Prior session commit was:** `eadf772` — "Quote → Project conversion: SQL
> Projects table, project-tracker.html". Everything since then is **uncommitted
> work in the working tree**.

---

## 0. CRITICAL: read this before doing anything

1. Read **this file** completely.
2. Then read **CLAUDE.md** for repo context.
3. Then read **`docs/SPEC-quote-lineitems-and-project-tracker.md`** — it's
   the design spec for the multi-session build still ahead.
4. Run `git status` and `git diff --stat` to see exactly what's uncommitted.
5. **Do not commit or push anything until the user explicitly asks.**
   The user has a standing rule: always ask before committing or pushing.

---

## 1. Where we are right now

The user has been building out the **Project Tracker** feature — converting
won quotes into projects with their own SharePoint folder structure, plus
a new dedicated `project-tracker.html` page.

**Phase 1 was committed and pushed last session** (`eadf772`):
- SQL Projects table created
- API at `api/src/functions/projects.js`
- New page `project-tracker.html`
- Auto-conversion when a quote is marked Won
- Hub tile for "PROJECT TRACKER"

**Then the user listed 6 issues to fix.** Items 1–5 are done in the working
tree but **NOT pushed**. Item 6 is the big one and is now scoped across
several sessions — only the spec doc is ready, no implementation.

The user is ending the session at 90% usage and wants this picked up cleanly
next time.

---

## 2. The 6 issues — current status

### ✅ Issue 1: Top-left "BAMA FABRICATION" logo → link to hub
- **Done in working tree.** Wrapped `<div class="logo">…</div>` in
  `<a href="hub.html">` on all 8 pages with the logo (excluding hub.html).
- Files modified: `babcock.html`, `index.html`, `manager.html`, `office.html`,
  `project-tracker.html`, `projects.html`, `quotes.html`, `tenders.html`.

### ✅ Issue 2: Project Tracker login screen tiles broken
- **Done in working tree.** The tiles were using a made-up class name
  (`mgr-emp-tile`). Fixed `renderProjectTrackerEmployeeGrid` and
  `selectProjectTrackerUser` in `shared.js` to use the real `.emp-btn`
  pattern from `renderTenderEmployeeGrid`.
- File modified: `shared.js`.

### ✅ Issue 3: Won-conversion modal styled like Babcock confirms
- **Done in working tree.** Replaced native `confirm()` calls with
  `showConfirmAsync()` (already exists in shared.js). This needed
  `<div id="confirmModal">` markup added to both `quotes.html` and
  `project-tracker.html` (it wasn't on those pages, hence the original
  fallback to native confirm).
- Files modified: `shared.js`, `quotes.html`, `project-tracker.html`.

### ✅ Issue 4: Project folder flat under `Projects/` — no year folder
- **Done in working tree.** Removed the year-folder layer in
  `convertQuoteToProject()`. Projects now go straight to
  `BAMA - Documents/Projects/C260502 - Client - Project Name/`.
- Files modified: `shared.js`, `CLAUDE.md`.

### ✅ Issue 5: Site address toggle, additional contacts, threaded comments
This was a big change. Done in working tree:

- **SQL migration** (NEW file): `api/sql/add-project-site-and-contacts.sql`
  - Adds 9 columns to Projects: `site_same_as_client` (BIT default 1),
    `site_address_line1/2`, `site_city`, `site_county`, `site_postcode`,
    `site_contact_name/email/phone`
  - New table `ProjectContacts` (additional contacts on a project, with
    free-text role + notes)
  - New table `ProjectComments` (threaded comments)
  - **MUST be run on `bama-erp` before deploying** or API will 500.

- **API changes** in `api/src/functions/projects.js`:
  - Added 9 site fields to PUT allowed list
  - New endpoints: `/api/project-contacts` (GET/POST/PUT/DELETE),
    `/api/project-comments` (GET/POST/DELETE)

- **UI changes** in `project-tracker.html`:
  - Site Address card with toggle (default ON = same as client)
  - Toggle uses existing `.perm-switch` CSS class for consistency
  - When OFF, reveals 9 fields: address×5, contact name/email/phone
  - Additional Contacts card with list + "+ Add Contact" button
  - New `projectContactModal` (mirrors tender contactModal pattern)
  - Comments card with threaded UI matching quote comments
  - Original single Notes textarea retained at bottom (user said
    "keep it for now")

- **JS changes** in `shared.js`:
  - `_populateProjectDetailFields()` extended for site fields
  - `_siteAddressSummary()`, `_refreshSiteSection()`,
    `onSiteSameToggle()` helpers
  - `saveProjectChanges()` includes site fields in body
  - Full set of contact CRUD functions:
    `loadProjectContacts`, `renderProjectContacts`,
    `openAddProjectContact`, `openEditProjectContact`,
    `closeProjectContactModal`, `submitProjectContactModal`,
    `deleteProjectContactFromModal`
  - Threaded comments: `loadProjectComments`, `addProjectComment`,
    `deleteProjectComment`
  - `closeProjectDetail()` now uses `showConfirmAsync` for unsaved-changes

- **CLAUDE.md** modal mapping updated for project-tracker.html.

### ⏳ Issue 6: Project view as financial/tracking dashboard (NOT BUILT)

This is the big one. **Only the spec is written**, in
`docs/SPEC-quote-lineitems-and-project-tracker.md`. See section 4 below
for the full breakdown of decisions and outstanding questions.

---

## 3. Cache-bust state

All HTML files reference `?v=20260505i` for `shared.js` and `bama.css`.
**If you make further UI changes, bump to `?v=20260505j`** across every
HTML file (per the rule in CLAUDE.md). Simple sed:

```bash
for f in *.html; do sed -i 's/v=20260505i/v=20260505j/g' "$f"; done
```

---

## 4. The big one — Issue 6 in detail

### What the user wants

The Project Tracker (project-tracker.html) currently shows a **basic
project record view** (status, dates, client, comments). The user wants
it transformed into a **senior-management financial/tracking dashboard**.

### Three financial tiles at the top of the project detail

1. **Contract Value** — total of ALL quotes attached to this project.
   Currently only 1 quote per project (`Projects.source_quote_id`); user
   wants the ability to attach more later via "Add Quote" button inside
   the project.
2. **Labour Cost** — sum of labour-bearing line items from attached quotes.
3. **Running Cost** — sum of invoices/POs charged to the project. Phase 4
   stub for now.

### Per-quote line-items table below

For each attached quote, render a table:
- Section header = the quote's "Comments or Special Instructions" text
  (the order description / scope of works)
- Rows = the 9 fixed line items: Prelims, Approval and Fabrication Pack,
  Survey, Material cost, Fabrication, Painting, Galvanising, Installation,
  Delivery
- Columns: description, unit price, VAT yes/no, VAT% (default 20%, editable),
  amount, **% complete** (editable)
- Total row at bottom

### % complete drives invoicing

When the user changes any % complete value, a "Generate Invoice" / "Generate
AFP" button appears at the top. Clicking it generates an invoice or
Application for Payment based on the cumulative-vs-delta model (still to
be decided in detail).

### What the example quote (Q260422) tells us

The user uploaded the actual quote XLSX file. Key findings (full analysis
in the SPEC doc):

- Every BAMA quote has the **same 9 fixed line item categories**
- Items can have value of 0 (e.g. galvanising, delivery often 0)
- VAT is per-line, default Yes at 20%, but per-line override is needed
  because some work is at 5% VAT
- The Calcs sheet has the BOM-level intelligence (steel sections, weights)
  — this is for Phase 3+, not the immediate build
- The "Comments or Special Instructions" field is the **scope of works**
  description — this is what becomes the section header on the project tracker

### Decisions already locked in by the user
- Labour set: TBD (strict 3 lines vs inclusive 5 lines — open question)
- Multi-quote per project: yes, via "Add Quote" button (UI only triggers,
  schema handles via `ProjectQuotes` linking table)
- Project number format: inherited from quote, Q→C swap (already implemented)
- Project SharePoint folder: flat under `Projects/{C-ref - Client - Name}/`
  with 9 default subfolders (already implemented)

### Recommended phasing across future sessions

The user agreed in principle to phase this. From the previous session:

| Session | Scope |
|---------|-------|
| 1 (last) | Push queued fixes; add SQL migration scripts only |
| 2 (next) | Quote detail page — line items editor |
| 3 | Project Tracker rebuild — 3 tiles + per-quote line items + % complete |
| 4 | Invoices & AFPs — generation, PDF, numbering, storage |

But the user said "wait for now" on the phasing answer at the end of the
session — they hadn't formally locked it in. **Re-confirm with the user
which phase to start with at the beginning of the next session.**

### Open questions to ask user before building

1. **Labour set definition** — which line items count as labour for the
   "Labour Cost" tile? Strict (Fabrication + Painting + Installation) or
   inclusive (+ Approval and Fabrication Pack + Survey)? Affects the
   `is_labour` BIT column in `QuoteLineItems`.
2. **Backfill** — do we backfill QuoteLineItems for existing won quotes
   by reading their xlsx files? Or only new quotes get line items going
   forward?
3. **AFP visibility/permissions** — reuse `viewQuotes`/`editQuotes` or
   add new `viewProjectFinancials`/`generateInvoices`?
4. **Running cost source** — purchase orders, supplier invoices, both?
   Needs its own schema design.
5. **Invoicing model** — cumulative ("invoiced 60% to date") or delta
   ("invoice +15% since last AFP")? User said "let's talk about this
   in detail later" — definitely needs a real conversation.

---

## 5. Files in working tree summary

Run `git status` to confirm. Expected state:

### Modified (10 files)
```
M  CLAUDE.md                           ← modal mapping updated
M  api/src/functions/projects.js       ← site fields + new endpoints
M  babcock.html                        ← logo wrapped in hub link
M  index.html                          ← logo wrapped in hub link
M  manager.html                        ← logo wrapped in hub link
M  office.html                         ← logo wrapped in hub link
M  project-tracker.html                ← lots: site/contacts/comments cards,
                                          new modals, logo link
M  projects.html                       ← logo wrapped in hub link
M  quotes.html                         ← logo wrapped in hub link, confirmModal added
M  shared.js                           ← lots: tile-fix, dark modal, flat folder,
                                          site/contacts/comments JS
M  tenders.html                        ← logo wrapped in hub link
```

### New (untracked)
```
?? api/sql/add-project-site-and-contacts.sql
?? docs/SPEC-quote-lineitems-and-project-tracker.md
?? docs/SESSION-HANDOVER.md            ← this file
```

---

## 6. Recommended action when next session starts

1. Read this file, CLAUDE.md, and the SPEC.
2. Run `node --check shared.js` and `node --check api/src/functions/projects.js`
   to confirm the working tree compiles. **Both should pass cleanly.**
3. Greet the user briefly, summarise what's in the working tree (don't
   re-list every detail — point to this file), and ask which of these
   they want to do first:
   - **Push the 5 queued fixes** as one commit (they were ready to push
     when the session ran out)
   - **Run the SQL migration first** (`add-project-site-and-contacts.sql`)
     — required before deploying since the API depends on the new columns
   - **Start on Issue 6** (the big build)
4. **Always ask before committing or pushing.** This is a standing rule.

---

## 7. Suggested commit message for the queued fixes

If/when the user says push, here's a ready-to-go commit message for the
5 queued fixes:

```
Project Tracker polish: site address, contacts, comments + UI fixes

Issue 1: Top-left BAMA FABRICATION logo now links to hub.html on every
non-hub page (8 pages updated).

Issue 2: Project Tracker login screen tiles fixed — were using a
non-existent CSS class. Now uses the same .emp-btn pattern as
manager/office/tenders/quotes login.

Issue 3: Won-quote conversion confirmation now uses the in-app dark
modal (showConfirmAsync) instead of native browser confirm(). Required
adding <div id="confirmModal"> to quotes.html and project-tracker.html.
Project detail unsaved-changes prompt also uses the in-app modal.

Issue 4: Project SharePoint folder structure flattened — projects now
go straight to BAMA-Documents/Projects/{C-ref - Client - Name}/, no
year folder layer.

Issue 5: Project detail page expanded with:
  - Site Address toggle (default ON = same as client). When OFF, reveals
    9 fields: address × 5 + site contact name/email/phone.
  - Additional Contacts card with add/edit/delete (separate from client
    contacts — for site foremen, surveyors, QSs etc.).
  - Threaded Comments section (mirrors quote comments UI). Multiple
    users can comment with timestamps + delete.
  - Original Notes textarea retained per user's request.

DB:
  - api/sql/add-project-site-and-contacts.sql adds 9 site columns to
    Projects + creates ProjectContacts and ProjectComments tables.
  - MUST BE RUN ON bama-erp BEFORE DEPLOYING.

API:
  - projects.js extended with site fields in allowed update list.
  - New endpoints: /api/project-contacts (GET/POST/PUT/DELETE),
    /api/project-comments (GET/POST/DELETE).

Cache-bust: ?v=20260505i across all HTML.

Issue 6 (financial tiles + per-quote line items + invoicing) is scoped
in docs/SPEC-quote-lineitems-and-project-tracker.md and queued for
future sessions — not in this commit.
```

(Customise the cache-bust suffix if it gets bumped further.)

---

## 8. Anything else worth knowing

- The user runs the project from a PAT-authenticated repo at
  `bamafab/bama-timesheet`. The init command at session start clones,
  configures git as "Claude AI", and reads CLAUDE.md.
- The user **always wants to be asked** before committing/pushing. This
  is in their memory edits.
- The user **does not want financial info on the Tender page or list**.
  Quote financials are gated behind viewQuotes/editQuotes. This is also
  in memory edits and in CLAUDE.md.
- Standing rule: bump cache-bust version on UI changes to shared.js or
  bama.css.
- Standing rule: run `node --check shared.js` after editing it.

End of handover. Good luck.

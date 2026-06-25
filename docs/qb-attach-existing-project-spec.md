# QB "Attach Won Quote to Existing Project" — backend spec for Daniel

## The problem in one paragraph
When a QB quote is marked Won, we want the same choice the old quotations module
gives: **Create New Project** OR **Assign to an Existing Project** (for when two
quotes are really one job). The blocker is that `ProjectQuotes.tender_id` and
`QuoteLineItems.tender_id` both have a hard FK to `Tenders(id)`. QB quotes live in
`QuoteBuilderQuotes`, not `Tenders`, so they can't be linked. The current
`qb-quotes mark-won` works around it by inserting a `ProjectQuotes` row with
`tender_id = NULL`, which is why **C260327** is stuck in a half-state (link row
with no source, line items never seeded, Project Tracker shows £0).

## Step 1 — Database (migration written)
Run `api/sql/add-qb-quote-id-to-projectquotes.sql` on office WiFi.
It adds a nullable `qb_quote_id` column (FK → `QuoteBuilderQuotes`) to both
`ProjectQuotes` and `QuoteLineItems`, makes `tender_id` nullable, and adds a
CHECK so exactly one of the two is set. **Your existing Tenders-based flow is
untouched** — every current row keeps its `tender_id`.

⚠ Two things to watch, both flagged inline in the SQL:
1. `ProjectQuotes` PK is the inline composite `(project_id, tender_id)` with an
   auto-generated name — look it up before the DROP (query is in the file).
2. The C260327 orphan row violates the new CHECK; backfill query (Option A) or
   delete (Option B) is in the file. Do the backfill **before** adding the CHECK,
   or SQL Server rejects the constraint against existing data.

Restart the Function App after (cached query plans).

## Step 2 — API changes (3 endpoints)

### 2a. `quote-financials.js` → `project-quotes-create` (POST /api/project-quotes)
Accept `qb_quote_id` as an alternative to `tender_id`.
- Body now: `{ project_id, tender_id?, qb_quote_id?, is_primary, added_by }`
- Require `project_id` AND exactly one of `tender_id` / `qb_quote_id`.
- Dupe check + INSERT keyed on whichever id is present.

### 2b. `quote-line-items-seed` (POST /api/quote-line-items/seed/...)
Currently routed `quote-line-items/seed/{tender_id}`. Add a parallel route or a
query flag so it can seed against a QB quote:
- Suggest new route: `quote-line-items/seed-qb/{qb_quote_id}` (flat route, avoids
  colliding with the parameterised `{tender_id}` one — same rule as `qb-next-ref`).
- Inserts the same 9 default rows but with `qb_quote_id` set, `tender_id` NULL.

### 2c. `qb-quotes.js` → `qb-quotes-mark-won`
Two changes:
- **New-project path:** replace the `tender_id = NULL` insert with
  `INSERT INTO ProjectQuotes (project_id, qb_quote_id, is_primary, added_by) ...`
  and then seed line items via the new seed-qb path. This fixes the root cause of
  the C260327 bug for all future Won quotes.
- **Assign path (new):** accept an optional `existing_project_id` in the body.
  When present, SKIP project creation — instead insert a `ProjectQuotes` row with
  `is_primary = 0`, `qb_quote_id = <this quote>`, set the quote's `project_id` to
  the existing project, seed its line items, and return that project. The SharePoint
  folder creation in the frontend is also skipped for the assign path (no new
  project folder needed — the quote folder can optionally be referenced later).

## Step 3 — Frontend (done, waiting on backend)
The QB Won modal now has the New / Assign-to-existing choice + live-project picker,
mirroring `quotes.html`. It sends `existing_project_id` to `mark-won` when assigning.
It's guarded so the assign button does nothing harmful until the backend supports it.
See commit referenced alongside this doc.

## `GET /api/project-quotes?project_id=X` (read side, for Project Tracker)
Currently INNER JOINs `Tenders`. To show QB-sourced quotes too, it needs a UNION/
LEFT JOIN that also pulls from `QuoteBuilderQuotes` when `qb_quote_id` is set.
Lower priority — only matters for displaying the attached list; the attach itself
works without it.

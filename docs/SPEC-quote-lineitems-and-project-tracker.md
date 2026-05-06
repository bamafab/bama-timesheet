# SPEC: Quote Line Items + Project Tracker (multi-session build)

> Captured from the Q260422 example quote to keep context across sessions.
> **Status: Sessions 2 + 3 BUILT (commit pending). Session 4 (AFPs) still
> design-only.** See bottom of this doc for which open questions were
> decided and which still need user input.

## The Quote template

Every BAMA quote follows the same structure. The quote sheet has:

- **Header**: Quotation #, Date, Valid until, Customer ID, Prepared by
- **Quotation For**: client contact name
- **Comments or Special Instructions**: multi-line free text (the order
  description / scope of works). Example:
  > "Supply and installation of dog cages to suit Transporter Van, includes
  > compression latches. Supply of window frame including 2no. UB178*102 with
  > welded bottom plate 300*10 and 2no. SHS100*100*7. Finish RAL 6019."
- **Line items table** with 5 columns: Quantity | Description | Unit Price | VAT | Amount
- **TOTAL** row

### The 9 fixed line item categories
These are the **same on every quote**, with values that can be 0:

| #  | Description                  | Typical content                                  |
|----|------------------------------|--------------------------------------------------|
| 1  | Prelims                      | Project manager, H&S officer, RAMS, PPE         |
| 2  | Approval and Fabrication Pack| Drawings/design hours                            |
| 3  | Survey                       | Site visits, parking, fuel                       |
| 4  | Material cost                | Steel, fittings, hardware                        |
| 5  | Fabrication                  | Workshop labour                                  |
| 6  | Painting                     | Wet paint, primer                                |
| 7  | Galvanising                  | Galvanising sub-total                            |
| 8  | Installation                 | Site install, lifting equipment, lodging         |
| 9  | Delivery                     | Transport                                        |

VAT is per-line (Yes/No). In practice every line is "Yes" at 20% but the
per-line override is required because some items (e.g. residential 5% VAT
work) need different rates. **Default VAT rate = 20%**, editable per line.

## Labour cost for the project tracker tile

The "Labour Cost" tile on the project view should sum the **labour-bearing**
line items:

- **Strict labour**: Fabrication + Painting + Installation
- **Inclusive (suggested default)**: Approval and Fabrication Pack + Survey
  + Fabrication + Painting + Installation
- **Excluded** (always): Prelims (admin), Material cost, Galvanising
  (subcontracted), Delivery (logistics)

⚠️ **Confirm with user before implementing** — the inclusive vs strict
distinction matters for management reporting.

## Schema implications

### `Quotes` table (extending existing `Tenders` row)
The existing `Tenders` row stays as-is for tender/quote/won tracking. Line
items become a child table:

```sql
CREATE TABLE QuoteLineItems (
    id INT IDENTITY PRIMARY KEY,
    tender_id INT NOT NULL REFERENCES Tenders(id) ON DELETE CASCADE,
    line_no INT NOT NULL,                 -- 1..9 (display order)
    category NVARCHAR(50) NOT NULL,       -- 'prelims', 'approval_fab_pack', ...
    description NVARCHAR(255) NOT NULL,
    quantity DECIMAL(10,2) DEFAULT 1,
    unit_price DECIMAL(12,2) DEFAULT 0,
    vat_applies BIT DEFAULT 1,            -- Yes/No
    vat_rate DECIMAL(4,2) DEFAULT 20.00,  -- editable per line
    is_labour BIT DEFAULT 0,              -- flag for the labour cost tile
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    updated_at DATETIME2 DEFAULT GETUTCDATE()
);
CREATE UNIQUE INDEX UX_QuoteLineItems_tender_line ON QuoteLineItems(tender_id, line_no);
```

When a tender is created, **9 default rows are auto-inserted** (one per
category, all zeros, is_labour pre-flagged according to the inclusive set).

### Multi-quote per project — relationship change

Currently `Projects.source_quote_id` is single. To allow "Add Quote" inside
a project, we add a linking table:

```sql
CREATE TABLE ProjectQuotes (
    project_id INT NOT NULL REFERENCES Projects(id) ON DELETE CASCADE,
    tender_id INT NOT NULL REFERENCES Tenders(id),
    is_primary BIT DEFAULT 0,            -- 1 = the quote that originally won
    added_at DATETIME2 DEFAULT GETUTCDATE(),
    added_by NVARCHAR(255) NULL,
    PRIMARY KEY (project_id, tender_id)
);
```

**Migration**: on create-projects-quotes-table.sql, populate from the
existing `Projects.source_quote_id` then leave that column for back-compat.

### Per-line progress tracking

```sql
CREATE TABLE ProjectLineProgress (
    id INT IDENTITY PRIMARY KEY,
    project_id INT NOT NULL REFERENCES Projects(id) ON DELETE CASCADE,
    quote_line_item_id INT NOT NULL REFERENCES QuoteLineItems(id),
    percent_complete DECIMAL(5,2) DEFAULT 0,   -- 0–100
    last_updated_by NVARCHAR(255) NULL,
    last_updated_at DATETIME2 DEFAULT GETUTCDATE()
);
CREATE UNIQUE INDEX UX_ProjectLineProgress_proj_line
    ON ProjectLineProgress(project_id, quote_line_item_id);
```

### Invoices & Applications for Payment (Phase 4)

To be designed in detail — model open questions:
- Cumulative vs delta — likely cumulative with a generated AFP storing a
  snapshot of percent_complete at issue time
- Sequential numbering scheme (per-project? global?)
- Storage: PDF in SharePoint under the project's `08 - Application for payment`
  subfolder

## UI build order (across sessions)

| Session | Scope | Status |
|---------|-------|--------|
| 1 | Push queued fixes; add SQL migration scripts only | ✅ done (commit 5574cc1) |
| 2 | Quote detail page — line items editor (read existing quote, allow inline edit) | ✅ done |
| 3 | Project Tracker rebuild — 3 tiles + per-quote line items + % complete | ✅ done |
| 4 | Invoices & AFPs — generation, PDF, numbering, storage | ⏳ design only |

## Decisions made (from Session 2/3 build)

1. **Strict vs inclusive labour set** — went with **inclusive** as the default
   (`is_labour=1` on Approval & Fab Pack, Survey, Fabrication, Painting,
   Installation; `is_labour=0` on Prelims, Material, Galvanising, Delivery).
   Per-line override is editable on the quote — flip the Labour checkbox to
   change it for a specific quote without touching code.
2. **Importing existing quotes** — **don't backfill**. Old won quotes get
   the 9 default rows (zeroed) on first open of the quote detail page;
   filling them in is a manual job per quote. The seed endpoint is idempotent.
3. **AFP visibility** — riding on existing `viewQuotes` / `editQuotes`
   permissions for now. Splitting out a `viewProjectFinancials` is queued
   for Session 4 if/when it becomes needed.
4. **Running cost source** — deferred to Session 4. Tile renders "—" until
   the underlying POs / supplier-invoices schema is designed.

## Open questions for Session 4 (AFPs)
1. Cumulative vs delta AFPs — likely cumulative with a generated AFP
   storing a snapshot of `percent_complete` at issue time
2. Sequential numbering scheme — per-project? global?
3. Storage — PDF in SharePoint under the project's `08 - Application for
   payment` subfolder
4. Running cost source — purchase orders, supplier invoices, both?

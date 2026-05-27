# Job & Fabrication Rework — Spec

Replaces the current draftsman-jobs flow with an assembly-driven fabrication
and despatch pipeline. Affects `projects.html` (draftsman + workshop view),
adds a new "Fabrication" tile on `index.html` (kiosk), and migrates the
underlying data from the SharePoint `drawings.json` blob into SQL.

This is a **clean cutover** — no migration of existing job data. The wipe
of `DrawingJobs` (and the old SharePoint blobs) happens after the code
ships and before workshop staff start using the new flow.

---

## 1. Scope of changes

### What stays the same
- `00 - SE Drawings` (NEW) — draftsman's personal working folder, accessed
  directly on SharePoint. Created automatically alongside the other element
  folders when a job is created. Not exposed in the UI.
- `02 - Approval` — element behaviour unchanged.
- `03 - Parts` — element behaviour unchanged (for now).
- `05 - Site Installation` — element behaviour unchanged (for now).
- Job-creation modal — still a single "job name" field; only the folder
  list expands to include `00 - SE Drawings` at the top.

### What changes
- **Projects list (projects.html)** — filters to `In Progress` only; sorted by
  open-job count descending.
- **Job detail screen** — all 5 element sections collapsed by default.
- **01 - BOM** — purpose changes from "stuff to fabricate" to "stuff to
  despatch". Two routes in: manual upload (loose items) and auto-generated
  from fabricated assemblies. Status state machine added. Files retained;
  notes removed.
- **04 - Assembly** — workflow shifts from manual task entry to per-assembly
  PDF upload with Claude vision OCR. Mark-fabricated lives on the assembly
  header. On fabrication → a BOM row is generated automatically.
- **NEW kiosk tile** — "Fabrication" full-width below the existing 3 kiosk
  tiles, listing pending assemblies workshop-wide, big "Mark fabricated"
  button.
- **Data layer** — `drawings.json` and `bom-*.json` on SharePoint are
  retired. SQL becomes the source of truth.

### What we're not building yet (roadmap)
- Materials arrival tracking — link incoming steel deliveries to specific
  assemblies so the workshop knows what each pallet was for. Until this
  lands, the workshop assumes materials magically appear when needed.
- In-browser PDF viewer for assembly drawings. For now the UI links out to
  SharePoint (opens in new tab).

---

## 2. Projects list (projects.html)

`renderProjectTiles()` reworked.

**Filter:** show only `state.projects` where `status === 'In Progress'`.
On Hold projects are excluded from this page. The project manager reinstates
On Hold projects via the Project Tracker when they come back into play.

(Note: `loadProjects()` is left unchanged because `state.projects` is read
by many other paths. The In-Progress filter is applied locally inside
`renderProjectTiles()` only.)

**Sort:** three groups, in order:

1. Projects with **≥ 1 open job** — sorted by open-job count descending
   (busiest at the top).
2. Projects with **only closed jobs** — secondary sort by project ID asc.
3. Projects with **no jobs at all** — secondary sort by project ID asc.

Within group 1, tie-breaker is project ID asc.

Sort runs *after* `loadDrawingsData()` has resolved (open-job counts come
from the per-project job lists). The grid re-paints once drawing data
arrives — a brief reflow is acceptable.

---

## 3. Job creation

Modal unchanged: single field, "Job name". On submit:

1. Find/create `02 - Drawings/` under the project folder.
2. Create `02 - Drawings/{NN - <Job name>}/`.
3. Create the 6 element subfolders inside (sequence preserved):
   ```
   00 - SE Drawings          (NEW)
   01 - BOM
   02 - Approval
   03 - Parts
   04 - Assembly
   05 - Site Installation
   ```
   `03 - Parts` retains its `01 - Sections` and `02 - Plates` sub-subfolders.
4. INSERT into `DrawingJobs` (replacing the old SharePoint JSON append).
5. Return the new `DrawingJobs.id` for the UI to navigate to.

`ELEMENT_FOLDERS` in shared.js gains `seDrawings: '00 - SE Drawings'` as
its first key. The existing `createJob()` loop over `Object.values(...)`
picks it up with no further change.

---

## 4. Job detail screen

All 5 element sections (`01 - BOM`, `02 - Approval`, `03 - Parts`,
`04 - Assembly`, `05 - Site Installation`) are **collapsed by default** on
job open. Clicking a section header expands it (existing
`toggleElement(name)` behaviour). State is per-session — no persistence
across page loads.

---

## 5. 04 - Assembly

### Upload flow

1. Draftsman clicks "Upload Assembly PDF". File picker accepts `.pdf` only.
2. PDF uploaded to SharePoint under `04 - Assembly/<filename>.pdf`.
3. PDF passed to **Claude vision OCR** (same client-side pipeline as the
   Babcock COUPA invoice flow).
4. OCR extracts:
   - **Assembly mark** — first row, first column of the top-right
     summary table (e.g. `RL1`).
   - **Quantity** — first row, second column ("Values for ONE assembly"
     row's "Quantity" column, e.g. `26`).
   - **Total area** and **total weight** — the "Totals for ONE assembly"
     row.
   - **Parts** — every row between the assembly-header row and the
     totals row. Each part: `mark` (e.g. `F1`, `F20`), `quantity`,
     `profile`, `length`, `material`, `area`, `weight`.
   - **Finish** — bottom-centre text matching the pattern
     `\d+\s+No\.?\s+Mkd\s+\S+\s+\((.+?)\)` — capture group 1 is the
     finish (e.g. `Galvanised`). If no parenthesised text is present,
     finish is null.
5. **OCR review modal** opens, pre-populated with the extracted values.
   The user can edit any field (mark, qty, every part row, every part
   field, finish). The modal includes a "finish" dropdown sourced from
   `ServiceTypes WHERE is_finish = 1`, plus an option for
   "No finish required". The OCR's literal finish string is matched
   case-insensitively to set the default selection; if no match, the
   dropdown defaults to "No finish required" and the raw string is
   shown as a hint ("OCR read: '…' — no matching finishing service").
6. On Confirm:
   - INSERT one row into `JobAssemblies` (with the file pointer,
     `finish_service_id`, `finish_label_raw`, totals, `status='pending'`).
   - INSERT N rows into `JobAssemblyParts`.
   - On Cancel: the uploaded PDF stays in SharePoint (the file already
     exists, no rollback). The draftsman can delete it from SharePoint
     manually or re-trigger the OCR review later.

### Re-uploading the same assembly mark

`UNIQUE (job_id, assembly_mark)` enforces one row per mark per job. On
attempted re-upload of an existing mark, the modal shows a confirm dialog
**before** doing the OCR:

- If existing assembly is `status='pending'`:
  > **RL1 already exists.** Replacing will delete the old assembly and its
  > parts. Continue?

- If existing assembly is `status='fabricated'`:
  > ⚠️ **RL1 already exists and has been marked as fabricated.**
  > Replacing will delete the old assembly, its parts, and the BOM row
  > derived from it. The BOM row may already be at the supplier or
  > despatched — check before continuing.
  > Continue?

If confirmed, the existing `JobAssemblies` row (and via FK cascade, its
parts) is deleted, and if there's an attached `JobBomItems` row with
`source_assembly_id = <old>`, that's deleted too. Then the upload
proceeds normally.

> **Note on FK cascades:** `FK_JobBomItems_Assembly` is `NO ACTION`
> (not `SET NULL`) because SQL Server rejects multiple cascade paths
> to a single target — both `DrawingJobs → JobBomItems` (direct
> CASCADE) and `DrawingJobs → JobAssemblies → JobBomItems` (cascade
> via the parent) would otherwise touch the same target. The direct
> cascade handles job deletion. **For assembly deletion alone** (the
> replace flow above, or a future explicit delete endpoint), the API
> must null out `source_assembly_id` on dependent BOM rows
> *in the same transaction* before deleting the `JobAssemblies` row —
> otherwise the FK will block the delete.

### Display in the Assembly section (projects.html)

Each assembly renders as a card:

```
RL1                                          Qty 26   Galvanised   [Open PDF]
─────────────────────────────────────────────────────────────────────
F1   1   CHS42.4x3   1747.6   S355      0.23 m²   5.78 kg
F20  1   PLT10x60     150.0   S275JR    0.02 m²   0.69 kg
─────────────────────────────────────────────────────────────────────
                                                       [Mark fabricated]
```

The heaviest part (`MAX(weight_kg)` across the parts) is visually
highlighted (bold or coloured background) — purely informational; it's
the row that will become the BOM line name on fabrication.

### Mark fabricated

Clicking "Mark fabricated" opens a small modal:

- **Welder** dropdown — `Employees WHERE staff_type='workshop' AND active`.
- **Welding machine** dropdown — `WeldingMachines WHERE is_active`.
- Confirm button.

On confirm:

1. UPDATE `JobAssemblies` SET `status='fabricated', fabricated_at=NOW,
   fabricated_by=<auth.name>, welder_id=<id>, welding_machine_id=<id>`.
2. INSERT a `JobBomItems` row:
   - `source = 'assembly'`
   - `source_assembly_id = <assembly.id>`
   - `description = <heaviest part's profile>` (e.g. `CHS42.4x3`)
   - `quantity = <assembly quantity>` (e.g. 26)
   - `finish_service_id = <assembly.finish_service_id>` (may be null)
   - `status = 'pending'` if a finish is set, otherwise
     `'ready_for_despatch'` (skip the supplier step entirely).

Both writes happen in a single SQL transaction; rollback on error.

---

## 6. 01 - BOM

### Two routes in

**Route A — manual upload (loose items, e.g. bolts, fixings).**
Existing upload UI retained. File saved to `01 - BOM/` on SharePoint.
The user fills in a description and quantity manually at upload time
(no OCR). Creates a `JobBomItems` row with `source='manual'`,
`finish_service_id=null`, `status='ready_for_despatch'`.

> No-finish manual items go straight to `ready_for_despatch`. If you
> need a manual loose item to go through a finishing supplier, change
> its status manually after creation (Edit → set finish + status).

**Route B — auto-generated from fabricated assemblies.** See §5.

### Notes (the subsection) — REMOVED

The current BOM section has a "Notes" tab — this is removed in the
rework. Notes are not part of a despatch queue.

### Status state machine

```
pending  ──►  at_supplier  ──►  ready_for_despatch  ──►  despatched
   │                                  ▲
   └─── (no-finish items skip to here)┘
```

- `pending` — waiting to go to a finisher. Only set on
  finish-required assembly-sourced rows at creation time.
- `at_supplier` — delivery note generated, items sent out. Set
  automatically when the row is included on a generated DN (§7).
- `ready_for_despatch` — back from the finisher (or no finish needed
  in the first place).
- `despatched` — gone to the client.

Any user with project access can advance status. Transitions are
implemented as explicit buttons on each row's expanded view:

| Current state | Action button | Resulting state |
|---|---|---|
| `pending` | (only via Generate DN — see §7) | `at_supplier` |
| `at_supplier` | "Mark returned from supplier" | `ready_for_despatch` |
| `ready_for_despatch` | "Mark despatched" | `despatched` |

Backward transitions ("undo") are not in scope for v1. Mistakes are
corrected by deleting and recreating the row.

### Display

The BOM section becomes a list, grouped by status:

```
01 - BOM  ────────────────────────────────────────────  [Generate DN]

PENDING  ─────────────────────────────────────────────────────────
☐ CHS42.4x3              Qty 26   Galvanised   from RL1
☐ CHS76.1x4              Qty 12   Galvanised   from RL2

AT SUPPLIER  ─────────────────────────────────────────────────────
   M16 anchors           Qty 100  Galvanised   DN-0042  Smith Galv
   PLT12x200x200         Qty 8    Painted      DN-0043  AcmePaint

READY FOR DESPATCH  ──────────────────────────────────────────────
   CHS60.3x3             Qty 18                from RL5
   M16 bolts             Qty 50                (manual upload)

DESPATCHED  ──────────────────────────────────────────────────────
   …
```

`pending` rows have checkboxes (for selecting onto a DN — see §7).
Other groups display read-only with the appropriate action button per
row.

---

## 7. Delivery notes

When the user selects one or more `pending` BOM rows and clicks
"Generate DN":

1. Validate all selected rows share the **same `finish_service_id`**.
   Mixed finishes → error toast ("All items on a DN must require the
   same finishing service. Generate separate DNs.").
2. Open the supplier picker — populated from
   `Suppliers s JOIN SupplierServices ss ON ss.supplier_id=s.id
   WHERE ss.service_type_id = <finish_service_id> AND s.is_active=1`.
3. User picks one supplier.
4. Generate the DN PDF (template TBD — reuses the BAMA letterhead
   pattern from `drawBamaInvoicePDF`).
5. Upload DN PDF to SharePoint:
   `<ProjectFolder>/07 - Deliveries/<JobFolderName>/<DN-ref>.pdf`.
   (Matches the legacy path so existing folder structure stays
   coherent.)
6. UPDATE selected `JobBomItems` SET `status='at_supplier',
   supplier_id=<id>, delivery_note_id=<dn_id>, sent_at=NOW`.

For v1, the `DeliveryNotes` table is **deferred** — we store the
supplier and a `sent_at` timestamp directly on the `JobBomItems` row.
`delivery_note_id` is added as a nullable column but not FK'd to
anything yet. A proper `DeliveryNotes` table can land later without
breaking schema.

DN reference numbering: `DN-0001` ascending, single global sequence.
A `Settings` row `dn_next_seq` tracks it (matches the existing
pattern for invoice / quote refs).

---

## 8. Kiosk fabrication tile (index.html)

### Placement

A new tile inserted on `index.html` below the existing top 3 tiles
(clockings / hours / holidays). It spans the **full width** of the
existing 3 combined.

### Visible content

Title row: `Fabrication`, with a count badge `N pending`.

Project filter chips: `All projects` (default selected), then one chip
per project that has any pending assemblies. Tapping a chip filters
the list below.

List of assembly cards, grouped by `project + job`. Each card is
similar to the projects.html assembly card but slimmer:

```
RL1                                          Qty 26   Galvanised
F1   1   CHS42.4x3   1747.6   S355      0.23   5.78
F20  1   PLT10x60     150.0   S275JR    0.02   0.69
                                              [Mark fabricated]
```

Tapping "Mark fabricated" opens the same welder + machine modal as on
projects.html. Welder dropdown filtered to
`staff_type='workshop' AND active=1`. No PIN gate — kiosk trusts who's
at the screen.

### Visibility of completed work

After marking fabricated, the card stays visible for **24 hours**,
dimmed, with a green check + `Fabricated 14:32 · <welder name>`.
Older fabricated cards drop off the kiosk view (still visible in
projects.html history).

Query for the kiosk list:

```sql
SELECT a.*, j.job_name, j.project_number, p.project_name, e.name AS welder
FROM JobAssemblies a
JOIN DrawingJobs j ON j.id = a.job_id
JOIN Projects p ON p.project_number = j.project_number
LEFT JOIN Employees e ON e.id = a.welder_id
WHERE p.status = 'In Progress'
  AND (a.status = 'pending'
       OR (a.status = 'fabricated' AND a.fabricated_at > DATEADD(hour, -24, SYSUTCDATETIME())))
ORDER BY a.status DESC, p.project_number, j.job_name, a.assembly_mark;
```

(`status DESC` puts `'pending'` before `'fabricated'` alphabetically.)

### Refresh

The kiosk is a long-lived screen. The fabrication tile polls
`/api/job-assemblies/kiosk` every 60 seconds. After a local
"Mark fabricated" action, the list patches optimistically + a
background refresh confirms.

---

## 9. Data layer

### Schema changes

```sql
-- ─────────────────────────────────────────────────────────────────
-- DrawingJobs: extend (already exists)
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE DrawingJobs ADD created_by NVARCHAR(256) NULL;
ALTER TABLE DrawingJobs ADD sharepoint_folder_id NVARCHAR(256) NULL;

-- ─────────────────────────────────────────────────────────────────
-- ServiceTypes: extend (already exists)
-- ─────────────────────────────────────────────────────────────────
ALTER TABLE ServiceTypes ADD is_finish BIT NOT NULL CONSTRAINT DF_ServiceTypes_IsFinish DEFAULT 0;

-- Seed common finishing services (idempotent)
IF NOT EXISTS (SELECT 1 FROM ServiceTypes WHERE name = 'Galvanising')
  INSERT INTO ServiceTypes (name, is_active, is_finish) VALUES ('Galvanising', 1, 1);
IF NOT EXISTS (SELECT 1 FROM ServiceTypes WHERE name = 'Painting')
  INSERT INTO ServiceTypes (name, is_active, is_finish) VALUES ('Painting', 1, 1);
IF NOT EXISTS (SELECT 1 FROM ServiceTypes WHERE name = 'Powder Coating')
  INSERT INTO ServiceTypes (name, is_active, is_finish) VALUES ('Powder Coating', 1, 1);
IF NOT EXISTS (SELECT 1 FROM ServiceTypes WHERE name = 'Shot Blasting')
  INSERT INTO ServiceTypes (name, is_active, is_finish) VALUES ('Shot Blasting', 1, 1);
IF NOT EXISTS (SELECT 1 FROM ServiceTypes WHERE name = 'Priming')
  INSERT INTO ServiceTypes (name, is_active, is_finish) VALUES ('Priming', 1, 1);

-- Flag any pre-existing rows with matching names as finishes
UPDATE ServiceTypes SET is_finish = 1
WHERE name IN ('Galvanising','Painting','Powder Coating','Shot Blasting','Priming')
  AND is_finish = 0;

-- ─────────────────────────────────────────────────────────────────
-- JobAssemblies (NEW)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE JobAssemblies (
  id                    INT IDENTITY PRIMARY KEY,
  job_id                INT          NOT NULL,
  assembly_mark         NVARCHAR(64) NOT NULL,
  quantity              INT          NOT NULL,
  finish_service_id     INT          NULL,
  finish_label_raw      NVARCHAR(128) NULL,
  total_area_m2         DECIMAL(10,3) NULL,
  total_weight_kg       DECIMAL(10,3) NULL,
  sharepoint_file_id    NVARCHAR(256) NOT NULL,
  sharepoint_drive_id   NVARCHAR(256) NOT NULL,
  sharepoint_web_url    NVARCHAR(1024) NULL,
  file_name             NVARCHAR(256) NOT NULL,
  status                NVARCHAR(32) NOT NULL CONSTRAINT DF_JobAssemblies_Status DEFAULT 'pending',
  fabricated_at         DATETIME2    NULL,
  fabricated_by         NVARCHAR(256) NULL,
  welder_id             INT          NULL,
  welding_machine_id    INT          NULL,
  created_at            DATETIME2    NOT NULL CONSTRAINT DF_JobAssemblies_Created DEFAULT SYSUTCDATETIME(),
  created_by            NVARCHAR(256) NULL,
  CONSTRAINT FK_JobAssemblies_Job
    FOREIGN KEY (job_id) REFERENCES DrawingJobs(id) ON DELETE CASCADE,
  CONSTRAINT FK_JobAssemblies_Finish
    FOREIGN KEY (finish_service_id) REFERENCES ServiceTypes(id),
  CONSTRAINT FK_JobAssemblies_Welder
    FOREIGN KEY (welder_id) REFERENCES Employees(id),
  CONSTRAINT FK_JobAssemblies_Machine
    FOREIGN KEY (welding_machine_id) REFERENCES WeldingMachines(id),
  CONSTRAINT UQ_JobAssemblies_JobMark UNIQUE (job_id, assembly_mark),
  CONSTRAINT CK_JobAssemblies_Status CHECK (status IN ('pending','fabricated'))
);

CREATE INDEX IX_JobAssemblies_Status ON JobAssemblies(status, fabricated_at);
CREATE INDEX IX_JobAssemblies_Job ON JobAssemblies(job_id);

-- ─────────────────────────────────────────────────────────────────
-- JobAssemblyParts (NEW)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE JobAssemblyParts (
  id            INT IDENTITY PRIMARY KEY,
  assembly_id   INT          NOT NULL,
  part_mark     NVARCHAR(64) NOT NULL,
  quantity      INT          NOT NULL,
  profile       NVARCHAR(128) NOT NULL,
  length_mm     DECIMAL(10,2) NULL,
  material      NVARCHAR(64)  NULL,
  area_m2       DECIMAL(10,3) NULL,
  weight_kg     DECIMAL(10,3) NULL,
  sort_order    INT NOT NULL CONSTRAINT DF_JobAssemblyParts_Sort DEFAULT 0,
  CONSTRAINT FK_JobAssemblyParts_Assembly
    FOREIGN KEY (assembly_id) REFERENCES JobAssemblies(id) ON DELETE CASCADE
);

CREATE INDEX IX_JobAssemblyParts_Assembly ON JobAssemblyParts(assembly_id, sort_order);

-- ─────────────────────────────────────────────────────────────────
-- JobBomItems (NEW)
-- ─────────────────────────────────────────────────────────────────
CREATE TABLE JobBomItems (
  id                    INT IDENTITY PRIMARY KEY,
  job_id                INT          NOT NULL,
  source                NVARCHAR(16) NOT NULL,
  source_assembly_id    INT          NULL,
  description           NVARCHAR(256) NOT NULL,
  quantity              INT          NOT NULL,
  finish_service_id     INT          NULL,
  status                NVARCHAR(32) NOT NULL CONSTRAINT DF_JobBomItems_Status DEFAULT 'pending',
  -- manual upload tracking
  sharepoint_file_id    NVARCHAR(256) NULL,
  sharepoint_drive_id   NVARCHAR(256) NULL,
  sharepoint_web_url    NVARCHAR(1024) NULL,
  file_name             NVARCHAR(256) NULL,
  -- supplier / DN tracking
  supplier_id           INT          NULL,
  delivery_note_id      INT          NULL,
  sent_at               DATETIME2    NULL,
  returned_at           DATETIME2    NULL,
  despatched_at         DATETIME2    NULL,
  created_at            DATETIME2    NOT NULL CONSTRAINT DF_JobBomItems_Created DEFAULT SYSUTCDATETIME(),
  created_by            NVARCHAR(256) NULL,
  CONSTRAINT FK_JobBomItems_Job
    FOREIGN KEY (job_id) REFERENCES DrawingJobs(id) ON DELETE CASCADE,
  CONSTRAINT FK_JobBomItems_Assembly
    FOREIGN KEY (source_assembly_id) REFERENCES JobAssemblies(id),
    -- NO ACTION (default). See note below.
  CONSTRAINT FK_JobBomItems_Finish
    FOREIGN KEY (finish_service_id) REFERENCES ServiceTypes(id),
  CONSTRAINT FK_JobBomItems_Supplier
    FOREIGN KEY (supplier_id) REFERENCES Suppliers(id),
  CONSTRAINT CK_JobBomItems_Source CHECK (source IN ('manual','assembly')),
  CONSTRAINT CK_JobBomItems_SourceAssembly CHECK (
    (source = 'manual'   AND source_assembly_id IS NULL) OR
    (source = 'assembly' AND source_assembly_id IS NOT NULL)
  ),
  CONSTRAINT CK_JobBomItems_Status CHECK (
    status IN ('pending','at_supplier','ready_for_despatch','despatched')
  )
);

CREATE INDEX IX_JobBomItems_Job_Status ON JobBomItems(job_id, status);
CREATE INDEX IX_JobBomItems_Supplier ON JobBomItems(supplier_id) WHERE supplier_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────
-- DN reference sequence
-- ─────────────────────────────────────────────────────────────────
IF NOT EXISTS (SELECT 1 FROM Settings WHERE [key] = 'dn_next_seq')
  INSERT INTO Settings ([key], value, updated_at)
  VALUES ('dn_next_seq', '1', SYSUTCDATETIME());
```

### Pre-cutover wipe

Run **only after** the new code is deployed and the next workshop shift
hasn't started yet. Workshop staff must use the new flow from first
clock-in after this runs.

```sql
-- Drop legacy job data (the SharePoint drawings.json blob is also
-- deleted manually via SharePoint UI — see deployment notes).
DELETE FROM DrawingNotes;
DELETE FROM DrawingElements;
DELETE FROM DrawingJobs;
```

(Then in SharePoint: delete `drawings.json` and any `bom-*.json` files
under the BAMA timesheet folder. Old per-job element subfolders inside
project folders can be left alone — they're benign.)

---

## 10. API endpoints

New endpoints (added in `api/src/functions/drawings.js` or a new
`job-assemblies.js` — TBD during build):

| Verb | Route | Purpose |
|---|---|---|
| GET | `/api/drawing-jobs?project_number=X` | List jobs for a project |
| POST | `/api/drawing-jobs` | Create a new job (replaces SharePoint JSON write) |
| GET | `/api/job-assemblies?job_id=X` | List assemblies + their parts |
| POST | `/api/job-assemblies` | Insert assembly + parts (post-OCR-review) |
| PUT | `/api/job-assemblies/:id/replace` | Replace flow (delete old + insert new) |
| PUT | `/api/job-assemblies/:id/fabricate` | Mark fabricated; creates the BOM row in same txn |
| DELETE | `/api/job-assemblies/:id` | Delete (only if status='pending') |
| GET | `/api/job-assemblies/kiosk` | List for the kiosk Fabrication tile (24h window) |
| GET | `/api/job-bom-items?job_id=X` | List BOM rows for a job |
| POST | `/api/job-bom-items` | Manual upload — insert a new BOM row |
| PUT | `/api/job-bom-items/:id/status` | Advance status (returned / despatched) |
| POST | `/api/job-bom-items/generate-dn` | Body: `{item_ids:[…], supplier_id}` → returns DN ref, sets at_supplier |

All endpoints follow the existing auth pattern (`requireAuth` →
short-circuit on `auth.status`).

---

## 11. Permissions

No new permission key. The flow uses existing keys:

- `editProjects` / `viewProjects` — gate `projects.html` as today.
- Kiosk fabrication tile — no permission gate; anyone at the kiosk can
  flip status. The welder identity is captured from the dropdown.

The `00 - SE Drawings` folder is plain SharePoint folder ACL — no
ERP-level permission needed.

---

## 12. Build order

Suggested commit sequence so each step is shippable in isolation:

1. **Schema migration** — `ALTER` + `CREATE TABLE` block from §9. Wipe
   not yet run. Existing flow continues to work because nothing reads
   the new tables yet.
2. **API for DrawingJobs in SQL** — POST/GET/DELETE endpoints. Frontend
   still writes to SharePoint JSON.
3. **Projects list rework** — filter to In Progress, sort by open jobs.
   Pure frontend change.
4. **`00 - SE Drawings` folder** — add to `ELEMENT_FOLDERS`. One line.
5. **Default-collapsed elements** — one-line change in `renderAllElements`.
6. **Migrate job CRUD frontend → SQL** — replace the
   `drawingsData.projects[p].jobs[]` reads/writes with API calls.
7. **Assembly upload + OCR review + persistence** — `04 - Assembly`
   becomes the new flow.
8. **Mark-fabricated + auto-BOM row generation** — single transaction.
9. **BOM list redesign** — group by status, action buttons.
10. **Delivery note generation** — supplier picker, PDF, status flip.
11. **Kiosk Fabrication tile** — pulls the kiosk endpoint.
12. **Wipe + cutover** — drop legacy data, remove old SharePoint JSON
    files, restart Function App (cached query plans, see CLAUDE.md).

Each commit ships independently. The schema lands first; the wipe lands
last.

---

## 13. Open / deferred questions

- **DN PDF template** — not designed yet. Will reuse BAMA letterhead
  pattern from `drawBamaInvoicePDF` but the body layout is TBD when we
  get to step 10.
- **DeliveryNotes table** — deferred. v1 stores supplier + sent_at on
  the BOM row. When a proper table lands, the existing
  `delivery_note_id` column gets FK'd.
- **PDF viewer** — deferred. SharePoint link only for v1.
- **Materials arrival tracking** — separate future feature.
- **Backward status transitions** ("undo despatched") — deferred. Delete
  and recreate for now.

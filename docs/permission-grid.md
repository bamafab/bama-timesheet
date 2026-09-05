# Permission grid — server-side enforcement (Session 3)

**Status: DRAFT for ticking.** Rows = every non-OPTIONS `app.http` route in `api/src/functions` (grouped by file). Columns = permission keys. `●` = proposed requirement; a row with several `●` is **ANY-OF**. `OPEN` = any authenticated tenant user (kiosk / PWA device). `—` in OPEN with no `●` would be a bug (none). ⚠ = decision needed, see notes and §Questions.

| code | key | | code | key |
|---|---|---|---|---|
| byP | `byProject` | | byE | `byEmployee` |
| clk | `clockingInOut` | | pay | `payroll` |
| arc | `archive` | | stf | `staff` |
| hol | `holidays` | | rep | `reports` |
| set | `settings` | | tpl | `templates` |
| uAc | `userAccess` | | drf | `draftsmanMode` |
| tnd | `tenders` | | eQ | `editQuotes` |
| vQ | `viewQuotes` | | eP | `editProjects` |
| vP | `viewProjects` | | vPO | `viewPurchaseOrders` |
| ePO | `editPurchaseOrders` | | inv | `invoicing` |
| afp | `afps` | | rec | `reconcile` |
| ED | `estimatingDashboard` | | cmp* | `compliance` |

`cmp*` = **proposed NEW key `compliance`** (QMS / H&S / company docs / plant / training / welder & NDT) — see Q1. `tpl` (`templates`) is in PERMISSION_DEFS but has **no SQL column and no permCols entry** (four-places drift) — see Q2.


### amendments.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/amendments` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk raises amendment |
| POST | `/api/amendments` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk raises amendment |
| PUT | `/api/amendments/{id}` |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | office Review tab |

### babcock-quotes.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/babcock-quotes` |  |  |  |  |  |  |  |  |  |  |  |  | ● |  | ● |  |  |  |  |  |  |  |  |  |  | sidebar gates Babcock under `tenders` today |
| GET | `/api/babcock-quotes/{id}` |  |  |  |  |  |  |  |  |  |  |  |  | ● |  | ● |  |  |  |  |  |  |  |  |  |  | sidebar gates Babcock under `tenders` today |
| GET | `/api/babcock-quote-next-ref` |  |  |  |  |  |  |  |  |  |  |  |  | ● |  | ● |  |  |  |  |  |  |  |  |  |  | sidebar gates Babcock under `tenders` today |
| POST | `/api/babcock-quotes` |  |  |  |  |  |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |
| PUT | `/api/babcock-quotes/{id}` |  |  |  |  |  |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |
| DELETE | `/api/babcock-quotes/{id}` |  |  |  |  |  |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |

### capacity.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/capacity-summary` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |  |  | ● |  |  |  |

### change-log.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/change-log` |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  | ● |  |  |  |  |  |  | ● |  |  |  |

### claude-proxy.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| POST | `/api/claude-proxy` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | ⚠ PWA voice stock + kiosk use it; alt: any-one-permission |

### client-errors.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| POST | `/api/client-error` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | fire-and-forget reporter, all pages |
| GET | `/api/client-errors` |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |

### clients.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/clients` |  |  |  |  |  |  |  |  |  |  |  |  | ● | ● | ● | ● | ● |  |  | ● | ● |  |  |  |  |  |
| GET | `/api/clients/{id}` |  |  |  |  |  |  |  |  |  |  |  |  | ● | ● | ● | ● | ● |  |  | ● | ● |  |  |  |  |  |
| POST | `/api/clients` |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  | ● |  |  |  | ● |  |  |  |  |  |  |
| PUT | `/api/clients/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  | ● |  |  |  | ● |  |  |  |  |  |  |
| GET | `/api/client-contacts` |  |  |  |  |  |  |  |  |  |  |  |  | ● | ● | ● | ● | ● |  |  | ● | ● |  |  |  |  |  |
| POST | `/api/client-contacts` |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  | ● |  |  |  | ● |  |  |  |  |  |  |
| PUT | `/api/client-contacts/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  | ● |  |  |  | ● |  |  |  |  |  |  |
| DELETE | `/api/client-contacts/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  | ● |  |  |  | ● |  |  |  |  |  |  |
| DELETE | `/api/clients/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  | ● |  |  |  | ● |  |  |  |  |  |  |

### clockings.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| POST | `/api/clock-in` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk |
| POST | `/api/clock-out` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk |
| GET | `/api/clockings` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk init load |
| PUT | `/api/clockings/{id}` |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| POST | `/api/clockings` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk "missing clocking" form |
| DELETE | `/api/clockings/{id}` |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |

### company-documents.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/company-documents` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | PWA policy list; ED expiry strip |
| GET | `/api/company-documents/expiring` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | PWA policy list; ED expiry strip |
| POST | `/api/company-documents` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| PUT | `/api/company-documents/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| DELETE | `/api/company-documents/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |

### consumables.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/consumables` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |  |  |  | ● |  |  |
| POST | `/api/consumables` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  | ● |  |  |
| PUT | `/api/consumables/{id}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  | ● |  |  |
| DELETE | `/api/consumables/{id}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  | ● |  |  |
| GET | `/api/consumable-movements` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |  |  |  | ● |  |  |
| POST | `/api/consumable-movements` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  | ● |  |  |
| POST | `/api/consumable-movements-bulk` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  | ● |  |  |
| DELETE | `/api/consumable-movements/{id}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  | ● |  |  |
| GET | `/api/consumable-reorders` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |  |  |  | ● |  |  |
| POST | `/api/consumable-reorders` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  | ● |  |  |
| PUT | `/api/consumable-reorders/{id}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  | ● |  |  |
| DELETE | `/api/consumable-reorders/{id}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  | ● |  |  |

### cvr.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/cvr-summary` |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  | ● |  |  | ● |  |  |  |

### dn-register.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/dn-register` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |  |  |  |  |  |  |
| POST | `/api/dn-register` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |

### document-acknowledgements.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/acknowledgements` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | PWA |
| POST | `/api/acknowledgements` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | PWA RAMS/policy signing |
| GET | `/api/acknowledgements/{id}/signature` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | PWA shows own signature |
| DELETE | `/api/acknowledgements/{id}` |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |

### drawing-elements.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/drawing-elements/{jobId}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk/PWA |
| POST | `/api/drawing-elements/{jobId}/approval-revision` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |
| PATCH | `/api/drawing-elements/{jobId}/approval-revision/{revId}/status` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |
| DELETE | `/api/drawing-elements/{jobId}/approval-revision/{revId}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |
| POST | `/api/drawing-elements/{jobId}/file` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |
| DELETE | `/api/drawing-elements/{jobId}/file/{fileId}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |
| DELETE | `/api/drawing-elements/{jobId}/revision-file/{fileId}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |
| POST | `/api/drawing-elements/{jobId}/note` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |
| DELETE | `/api/drawing-elements/{jobId}/note/{noteId}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |
| PUT | `/api/drawing-elements/{jobId}/site-complete` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |

### drawings.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| POST | `/api/drawings` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |
| GET | `/api/drawings` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk/PWA |
| GET | `/api/drawings/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk/PWA |
| PUT | `/api/drawings/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | ⚠ kiosk self-heals sharepoint_file_id via ensureJobFolderAlive — alt: W_PROJ and let kiosk skip relink |
| POST | `/api/drawings/{id}/elements` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |
| PUT | `/api/drawing-elements/{id}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |
| POST | `/api/drawings/{id}/notes` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |
| DELETE | `/api/drawings/{id}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |
| POST | `/api/drawings-relink-files` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | ⚠ same self-heal path |

### employee-documents.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/employee-documents` |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| GET | `/api/employee-documents/expiring` |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |
| POST | `/api/employee-documents` |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | HR: contracts, RTW |
| PUT | `/api/employee-documents/{id}` |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | HR: contracts, RTW |
| DELETE | `/api/employee-documents/{id}` |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | HR: contracts, RTW |

### employees.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/employees/{id?}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk name picker. ⚠ proposal: strip `rate`/`pay_type` when caller has no UserPermissions row |
| POST | `/api/employees` |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| PUT | `/api/employees/{id}` |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| GET | `/api/employees/{id}/pin` |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | PIN reveal — FIRST |

### fab-output.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/fab-output` |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  | ● | ● |  |  |  |  |  | ● |  |  |  |

### health-check.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/health-check` |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  | ● |  |  | ED Health tab |

### heat-allocations.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/heat-allocations` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |  |  |  |  |  |  |
| POST | `/api/heat-allocations` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |
| POST | `/api/heat-allocations-bulk` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |
| DELETE | `/api/heat-allocations/{id}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |

### holidays.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| POST | `/api/holidays` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk request + balance |
| GET | `/api/holidays` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk request + balance |
| PUT | `/api/holidays/{id}` |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | approve / decline / delete |
| PUT | `/api/holidays/{id}/notification-seen` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk |
| DELETE | `/api/holidays/{id}` |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | approve / decline / delete |

### inspection-plans.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/ndt-rules` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |  |  |  | ● |  |  |
| PUT | `/api/ndt-rules/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| GET | `/api/inspection-plans` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |  |  |  | ● |  |  |
| POST | `/api/inspection-plans` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  | ● |  |  |
| PUT | `/api/inspection-plans/{id}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  | ● |  |  |
| GET | `/api/inspection-records` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |  |  |  | ● |  |  |
| POST | `/api/inspection-records` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  | ● |  |  |
| DELETE | `/api/inspection-records/{id}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  | ● |  |  |

### invoicing.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/applications` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |
| GET | `/api/applications-next-ref` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |
| GET | `/api/applications/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |
| POST | `/api/applications` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |
| PUT | `/api/applications/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |
| POST | `/api/applications/{id}/submit` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |
| POST | `/api/applications/{id}/uncertify` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |
| POST | `/api/applications/{id}/link-invoice` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |
| POST | `/api/applications/{id}/certificate` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |
| PUT | `/api/applications/{id}/certificate` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |
| POST | `/api/applications/{id}/generate-invoice` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |
| POST | `/api/applications/{id}/cancel` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |
| DELETE | `/api/applications/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |
| GET | `/api/invoices` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  | invoices, receipts |
| GET | `/api/invoices-next-ref` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  | invoices, receipts |
| GET | `/api/invoices/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  | invoices, receipts |
| POST | `/api/invoices-import` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  | invoices, receipts |
| POST | `/api/invoices` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  | invoices, receipts |
| PUT | `/api/invoices/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  | invoices, receipts |
| POST | `/api/invoices/{id}/reopen` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  | invoices, receipts |
| POST | `/api/invoices/{id}/issue` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  | invoices, receipts |
| POST | `/api/invoices/{id}/payments` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  | invoices, receipts |
| DELETE | `/api/invoices/{id}/payments/{pid}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  | invoices, receipts |
| DELETE | `/api/invoices/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  | invoices, receipts |
| POST | `/api/invoices/{id}/void` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  | invoices, receipts |
| GET | `/api/receipts` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  | invoices, receipts |
| POST | `/api/receipts` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  | invoices, receipts |
| PUT | `/api/receipts/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  | invoices, receipts |
| DELETE | `/api/receipts/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  | invoices, receipts |
| PUT | `/api/purchase-orders/{id}/supplier-invoice` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |

### itp.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/itp-rows` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |  |  |  |  |  |  |
| POST | `/api/itp-rows` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |
| POST | `/api/itp-rows-bulk` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |
| PUT | `/api/itp-rows/{id}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |
| DELETE | `/api/itp-rows/{id}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |

### job-assemblies.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/job-assemblies` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk |
| POST | `/api/job-assemblies` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  | create / delete / weight / attach-pdf |
| DELETE | `/api/job-assemblies/{id}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  | create / delete / weight / attach-pdf |
| GET | `/api/job-assemblies/kiosk` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk |
| PUT | `/api/job-assemblies/{id}/fabricate` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk stage move |
| PUT | `/api/job-assemblies/{id}/fab` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk stage move |
| PUT | `/api/job-assemblies/{id}/weld` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk stage move |
| PUT | `/api/job-assemblies/{id}/complete` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk stage move |
| PUT | `/api/job-assemblies/{id}/rollback` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk undo |
| PUT | `/api/job-assemblies/{id}/weight` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  | create / delete / weight / attach-pdf |
| PUT | `/api/job-assemblies/{id}/attach-pdf` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  | create / delete / weight / attach-pdf |

### job-bom-items.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/job-bom-items` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk job open |
| POST | `/api/job-bom-items` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  | BOM edits, DN/SDN generation, amend |
| POST | `/api/job-bom-items/bulk` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  | BOM edits, DN/SDN generation, amend |
| PUT | `/api/job-bom-items/{id}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  | BOM edits, DN/SDN generation, amend |
| PUT | `/api/job-bom-items/{id}/status` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  | BOM edits, DN/SDN generation, amend |
| POST | `/api/job-bom-items/generate-dn` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  | BOM edits, DN/SDN generation, amend |
| POST | `/api/job-bom-items/generate-sdn` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  | BOM edits, DN/SDN generation, amend |
| POST | `/api/job-bom-items/generate-sdn/files` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  | BOM edits, DN/SDN generation, amend |
| POST | `/api/job-bom-items/bulk-status` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  | BOM edits, DN/SDN generation, amend |
| POST | `/api/job-bom-items/bulk-finish` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  | BOM edits, DN/SDN generation, amend |
| POST | `/api/job-bom-items/bulk-delete` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  | BOM edits, DN/SDN generation, amend |
| DELETE | `/api/job-bom-items/{id}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  | BOM edits, DN/SDN generation, amend |
| GET | `/api/sdn-detail` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |  |  |  |  |  |  |
| POST | `/api/sdn-amend` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  | BOM edits, DN/SDN generation, amend |

### job-certificates.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/job-certificates` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |  |  |  |  |  |  |
| POST | `/api/job-certificates` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  | ● |  |  |
| PUT | `/api/job-certificates/{id}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  | ● |  |  |
| DELETE | `/api/job-certificates/{id}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  | ● |  |  |

### labour-log.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| POST | `/api/labour-log` |  | ● |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | office week sync |
| GET | `/api/labour-log` | ● | ● |  | ● |  |  |  |  |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |  |  | Job Costing labour cost |
| DELETE | `/api/labour-log/{id}` |  | ● |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |

### observability.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/diag-throw` |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |

### office-tasks.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/office-tasks` |  |  |  | ● |  | ● | ● |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  | ⚠ no key owns Office Tasks today |
| POST | `/api/office-tasks` |  |  |  | ● |  | ● | ● |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  | ⚠ no key owns Office Tasks today |
| PUT | `/api/office-tasks/{id}` |  |  |  | ● |  | ● | ● |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  | ⚠ no key owns Office Tasks today |
| DELETE | `/api/office-tasks/{id}` |  |  |  | ● |  | ● | ● |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  | ⚠ no key owns Office Tasks today |

### payroll-extras.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/payroll-comments` |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| POST | `/api/payroll-comments` |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| PUT | `/api/payroll-comments/{id}` |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| DELETE | `/api/payroll-comments/{id}` |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| GET | `/api/payroll-revisions` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | ⚠ kiosk "last week review" reads this — alt: scope to own employee |
| POST | `/api/payroll-revisions` |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |

### payroll.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| POST | `/api/payroll/approve` |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| GET | `/api/archive` |  |  |  | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| GET | `/api/archive/weeks` |  |  |  | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |

### plant-register.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/plant-items` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |  |  | ● | ● |  | ED alert strip |
| GET | `/api/plant-items/expiring` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |  |  | ● | ● |  | ED alert strip |
| POST | `/api/plant-items` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| PUT | `/api/plant-items/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| DELETE | `/api/plant-items/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| GET | `/api/plant-documents` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |  |  | ● | ● |  | ED alert strip |
| POST | `/api/plant-documents` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| PUT | `/api/plant-documents/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| DELETE | `/api/plant-documents/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |

### policies.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/policies` |  |  |  |  |  |  |  |  | ● |  | ● |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| POST | `/api/policies` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| PUT | `/api/policies/{id:int}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| DELETE | `/api/policies/{id:int}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| GET | `/api/director-signature` |  |  |  |  |  |  |  |  | ● |  | ● |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| POST | `/api/director-signature` |  |  |  |  |  |  |  |  | ● |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  | director only |

### project-hours.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| POST | `/api/project-hours` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk submit day / init load |
| GET | `/api/project-hours` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk submit day / init load |
| PUT | `/api/project-hours/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk edits own unsubmitted entry |
| DELETE | `/api/project-hours/{id}` | ● | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| POST | `/api/project-hours/recompute-s000` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk clock-out |
| GET | `/api/project-hours/summary` | ● | ● |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |

### project-sheet.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/project-sheet/{projectId}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk Workshop Projects tile → job sheet |
| PUT | `/api/project-sheet/{projectId}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |
| GET | `/api/project-sheet/{projectId}/extras` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |  |  |  |  |  |  |
| GET | `/api/project-sheet/{projectId}/revisions` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |  |  |  |  |  |  |
| POST | `/api/project-sheet/{projectId}/revisions` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |
| DELETE | `/api/project-sheet-revisions/{id}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |

### projects.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/projects` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk picker, PWA. ⚠ proposal: strip `quote_value` for no-row callers |
| GET | `/api/projects/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | as above |
| POST | `/api/projects` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |
| PUT | `/api/projects/{id}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  | hidden_from_workshop toggle, SP folder self-heal |
| GET | `/api/projects-by-quote/{quoteId}` |  |  |  |  |  |  |  |  |  |  |  | ● | ● | ● | ● | ● | ● |  |  |  |  |  |  |  |  |  |
| GET | `/api/projects-by-babcock-quote/{quoteId}` |  |  |  |  |  |  |  |  |  |  |  | ● | ● | ● | ● | ● | ● |  |  |  |  |  |  |  |  |  |
| GET | `/api/projects-by-number/{projectNumber}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk/PWA |
| GET | `/api/project-contacts` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |  |  |  |  |  |  |
| POST | `/api/project-contacts` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |
| PUT | `/api/project-contacts/{id}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |
| DELETE | `/api/project-contacts/{id}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |
| GET | `/api/project-comments` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |  |  |  |  |  |  |
| POST | `/api/project-comments` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |
| DELETE | `/api/project-comments/{id}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |

### purchase-orders.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/purchase-orders-next-reference` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |
| GET | `/api/purchase-orders/{id?}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● | ● | ● | ● | ● |  |  |  |  |  |  |
| POST | `/api/purchase-orders` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |
| PUT | `/api/purchase-orders/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |
| DELETE | `/api/purchase-orders/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |
| POST | `/api/purchase-orders/{id}/attachments` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |
| DELETE | `/api/purchase-orders/{id}/attachments/{attId}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |

### qb-quotes.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/qb-next-ref` |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |
| GET | `/api/qb-quotes` |  |  |  |  |  |  |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |  | ● |  |  |  |
| GET | `/api/qb-quotes/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |  | ● |  |  |  |
| POST | `/api/qb-quotes` |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |
| PUT | `/api/qb-quotes/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |
| PUT | `/api/qb-quotes/{id}/log-chase` |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |
| PUT | `/api/qb-quotes/{id}/mark-won` |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  | creates Project — Session 4.1 rebuild target |
| DELETE | `/api/qb-quotes/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |
| POST | `/api/qb-snapshots` |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |
| GET | `/api/qb-snapshots` |  |  |  |  |  |  |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |  | ● |  |  |  |

### qms-forms.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/qms-forms` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | PWA |
| GET | `/api/qms-submissions` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | PWA fills check sheets |
| POST | `/api/qms-submissions` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | PWA fills check sheets |

### quote-financials.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/quote-line-items` |  |  |  |  |  |  |  |  |  |  |  | ● |  | ● | ● | ● | ● |  |  | ● | ● |  |  |  |  |  |
| POST | `/api/quote-line-items/seed/{tender_id}` |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  | ● |  |  |  |  |  |  |  |  |  |  |
| POST | `/api/quote-line-items/seed-qb/{qb_quote_id}` |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  | ● |  |  |  |  |  |  |  |  |  |  |
| PUT | `/api/quote-line-items/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  | ● |  |  |  |  |  |  |  |  |  |  |
| PUT | `/api/quote-line-items-bulk` |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  | ● |  |  |  |  |  |  |  |  |  |  |
| GET | `/api/project-quotes` |  |  |  |  |  |  |  |  |  |  |  | ● |  | ● | ● | ● | ● |  |  | ● | ● |  |  |  |  |  |
| POST | `/api/project-quotes` |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  | ● |  |  |  |  |  |  |  |  |  |  |
| DELETE | `/api/project-quotes/{project_id}/{tender_id}` |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  | ● |  |  |  |  |  |  |  |  |  |  |
| GET | `/api/project-line-progress` |  |  |  |  |  |  |  |  |  |  |  | ● |  | ● | ● | ● | ● |  |  | ● | ● |  |  |  |  |  |
| PUT | `/api/project-line-progress` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  | ● |  |  |  |  |  |

### rams-documents.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/rams-docs` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |  |  |  | ● |  |  |
| GET | `/api/rams-docs/{id:int}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |  |  |  | ● |  |  |
| GET | `/api/rams-next-no` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |  |  |  | ● |  |  |
| POST | `/api/rams-docs` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  | ● |  |  |

### reconcile.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/bank-accounts` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |
| POST | `/api/bank-accounts` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |
| PUT | `/api/bank-accounts/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |
| GET | `/api/bank-statements` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |
| POST | `/api/bank-statements` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |
| DELETE | `/api/bank-statements/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |
| GET | `/api/bank-transactions` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |
| PUT | `/api/bank-transactions/{id}/match` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |
| POST | `/api/bank-transactions/check-duplicates` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |
| GET | `/api/bank-transactions/{id}/documents` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |
| POST | `/api/bank-transactions/{id}/documents` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |
| DELETE | `/api/bank-transaction-docs/{docId}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |
| PUT | `/api/bank-transactions/{id}/unmatch` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |
| PUT | `/api/bank-transactions/{id}/edit` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |

### schema-check.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/schema-check` |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |

### settings.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/settings/{key?}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk loads settings at init |
| PUT | `/api/settings` |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| POST | `/api/auth/verify-pin` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk PIN gate |
| GET | `/api/health` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | no-auth | keep-warm ping, no SQL |

### site-personnel.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/site-personnel` |  |  |  |  |  | ● |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |  |  |  | ● |  | RAMS pulls crew list |
| POST | `/api/site-personnel` |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| PUT | `/api/site-personnel/{id}` |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| DELETE | `/api/site-personnel/{id}` |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| POST | `/api/site-personnel/{id}/cert` |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| DELETE | `/api/site-personnel/{id}/cert/{certId}` |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| GET | `/api/cert-types` |  |  |  |  |  | ● |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |  |  |  | ● |  | RAMS pulls crew list |
| POST | `/api/cert-types` |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| DELETE | `/api/cert-types/{id}` |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |

### steel-test-certs.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/steel-test-certs` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |  |  |  |  |  |  |
| POST | `/api/steel-test-certs` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  | ● |  |  |
| DELETE | `/api/steel-test-certs/{id}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  | ● |  |  |

### stock.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/stock` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | PWA |
| POST | `/api/stock-bulk` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | ⚠ PWA voice stock write — alt: draftsmanMode|editProjects |
| PUT | `/api/stock/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | ⚠ PWA qty edit / remove — same decision |
| DELETE | `/api/stock/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | ⚠ PWA qty edit / remove — same decision |

### supplier-documents.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/supplier-documents` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● | ● | ● |  |  |  | ● |  |  |
| GET | `/api/supplier-documents/expiring` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● | ● | ● |  |  |  | ● |  |  |
| POST | `/api/supplier-documents` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  | ● |  |  |
| PUT | `/api/supplier-documents/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  | ● |  |  |
| DELETE | `/api/supplier-documents/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  | ● |  |  |
| PUT | `/api/supplier-approval/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  | ● |  |  |

### supplier-invoices.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/supplier-invoices/{id?}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● | ● | ● |  |  |  |  |  |  |
| POST | `/api/supplier-invoices` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |
| PUT | `/api/supplier-invoices/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |
| DELETE | `/api/supplier-invoices/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |
| POST | `/api/supplier-invoices-match` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |
| GET | `/api/supplier-payment-runs` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● | ● | ● |  |  |  |  |  |  |
| POST | `/api/supplier-payment-runs` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |
| POST | `/api/supplier-invoices-recompute-due` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |

### tender-register.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/tender-register` |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| POST | `/api/tender-register` |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| GET | `/api/tender-register/{id}` |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| PUT | `/api/tender-register/{id}` |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| PUT | `/api/tender-register/{id}/open-in-qb` |  |  |  |  |  |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |  |  |  |  |  |  |
| PUT | `/api/tender-register/{id}/resend-notify` |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| POST | `/api/tender-sp/{id}` |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| GET | `/api/tender-assignees` |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |
| POST | `/api/tender-assignees` |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |

### tenders.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/tenders` |  |  |  |  |  |  |  |  |  |  |  | ● | ● | ● | ● | ● | ● |  |  |  |  |  |  |  |  | legacy read-only; PT Attach Quote modal |
| GET | `/api/tenders/{id}` |  |  |  |  |  |  |  |  |  |  |  | ● | ● | ● | ● | ● | ● |  |  |  |  |  |  |  |  | legacy read-only; PT Attach Quote modal |

### toolbox-talks.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/toolbox-talks` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | PWA |
| POST | `/api/toolbox-talks` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| PUT | `/api/toolbox-talks/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| DELETE | `/api/toolbox-talks/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| GET | `/api/toolbox-deliveries` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | PWA |
| POST | `/api/toolbox-deliveries` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| DELETE | `/api/toolbox-deliveries/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |

### traceability.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/welding-machines/{id?}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | kiosk weld stage picks machine |
| POST | `/api/welding-machines` |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| PUT | `/api/welding-machines/{id}` |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| DELETE | `/api/welding-machines/{id}` |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| GET | `/api/service-types` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● | ● | ● |  |  |  |  |  |  |
| POST | `/api/service-types` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |
| PUT | `/api/service-types/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |
| DELETE | `/api/service-types/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |
| GET | `/api/suppliers/{id?}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● | ● | ● | ● | ● |  | ● |  |  |  | ⚠ strip bank_* fields unless invoicing|reconcile|editPurchaseOrders — FIRST |
| POST | `/api/suppliers` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |
| PUT | `/api/suppliers/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |
| DELETE | `/api/suppliers/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |
| POST | `/api/suppliers/merge` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● | ● |  |  |  |  |  |  |

### user-access.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/user-access/{employee_id?}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | frontend gating needs the matrix; flags only, no PII |
| PUT | `/api/user-access/{employee_id}` |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  | + bootstrap: allowed for anyone while NO row has any flag set |
| GET | `/api/access-requests` |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| POST | `/api/access-requests` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | **OPEN** | "I don't have permission" form |
| PUT | `/api/access-requests/{id}` |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |
| DELETE | `/api/access-requests/{id}` |  |  |  |  |  |  |  |  |  |  | ● |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |

### welder-qualifications.js

| Method | Route | byP | byE | clk | pay | arc | stf | hol | rep | set | tpl | uAc | drf | tnd | eQ | vQ | eP | vP | vPO | ePO | inv | afp | rec | ED | cmp* | OPEN | Note |
|---|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|---|
| GET | `/api/welder-quals` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |  |  | ● | ● |  |  |
| GET | `/api/welder-quals/expiring` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |  |  | ● | ● |  |  |
| POST | `/api/welder-quals` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| PUT | `/api/welder-quals/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| DELETE | `/api/welder-quals/{id}` |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |
| POST | `/api/welder-qual-confirm/{id}` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● |  |  |  |  |  |  |  | ● |  | 6-month confirmation |
| GET | `/api/welder-qual-confirmations` |  |  |  |  |  |  |  |  |  |  |  | ● |  |  |  | ● | ● |  |  |  |  |  | ● | ● |  |  |

## Totals

349 routes. 53 OPEN (25 of them are writes — all kiosk/PWA flows, listed in Q4). 295 permission-gated. Files: 56.

## Identity: how the API knows who is calling

Today the token gives `{oid, name, email}` (Microsoft account) and the Employee identity exists only in the browser (PIN → `currentManagerUser`). `UserPermissions` is keyed by `employee_id`; **no column links an Employee to a Microsoft account**. `requirePerm` needs that link:

- **Proposed (Q3-A):** `ALTER TABLE Employees ADD email NVARCHAR(256) NULL` (+ unique filtered index) — ADD COLUMN → Function App restart. You set it once per office user in Staff › Edit (Mateusz, Natasza, Leszek, …). Lookup: `token.email` → `Employees.email` (case-insensitive) → `UserPermissions`. No match = no permissions = OPEN routes only.
- **Fallback while `email` is NULL (Q3-B):** case-insensitive match of `token.name` against `Employees.name`. Cheap, no migration, but breaks on "M. Braczyk" vs "Mateusz Braczyk". Proposed as a transitional fallback only, logged once per request when used.
- **Bootstrap rule (kept):** while **no** `UserPermissions` row has any flag set, `PUT /api/user-access/{id}` is allowed for any authenticated user — exactly the client's first-user-auto-admin path. The moment one flag exists, `userAccess` is required.
- Cache: one `UserPermissions` lookup per request, stored on the request object (WeakMap, same pattern as `getAuthUser`).

## Field-level rules (data, not routes)

Three OPEN reads leak data the kiosk doesn't need. Proposed: strip when the caller has **no** `UserPermissions` row (kiosk / PWA device accounts, unassigned staff):

| Route | Strip | Unless caller has |
|---|---|---|
| `GET /api/employees` | `rate`, `pay_type`, `carryover_days`, `holiday_entitlement` | any permission row (Job Costing / Reports / Payroll read `rate` client-side) |
| `GET /api/suppliers` | `bank_sort_code`, `bank_account_number`, `bank_account_name`, CIS fields | `invoicing` or `reconcile` or `editPurchaseOrders` |
| `GET /api/projects` | `quote_value` (and any future `*_value` money columns) | any permission row |

## Questions (tick / answer, then I code)

1. **New key `compliance`** (`cmp*` column) for the office QMS / H&S / docs world — company docs, policies, plant, training matrix & cert types, welder quals, NDT rules, inspection plans, toolbox talks, QMS form defs, RAMS write, job/steel certs, consumables. Today none of these tabs has a key (office PIN only). Alternatives: reuse `settings` or `staff`; or two keys `qms` + `hs`. New key = one ADD COLUMN (rolled into the same restart as Q3-A) and it is the first key added under the new one-place rule.
2. **`templates` key**: in `PERMISSION_DEFS` but has **no SQL column and is not in `permCols`/`keyMap`** — the toggle is silently dropped today. Add the column (same restart) or delete the key? No route uses it; propose **delete**.
3. **Identity mapping**: A (add `Employees.email`) + B (name fallback while NULL) as above — yes? And: **which Microsoft account is the workshop kiosk signed in as?** If it's yours, the kiosk has full permissions server-side and the field-stripping never applies there; a dedicated `kiosk@…` account fixes that (no code change).
4. **OPEN writes** (25) — all are kiosk/PWA flows: clock-in/out, clockings (missing-clocking form), project-hours POST/PUT + recompute-s000, holidays POST + notification-seen, amendments POST, verify-pin, access-requests POST, client-error, claude-proxy, job-assemblies fab/weld/complete/rollback/fabricate, qms-submissions POST, acknowledgements POST (RAMS/policy signing), **stock-bulk POST / stock PUT / stock DELETE (PWA voice stock)**, **PUT drawings/{id} + POST drawings-relink-files (kiosk SharePoint self-heal via `ensureJobFolderAlive`)**. The last two groups are the ones I'm least sure about — your rule was "writes require a permission". Options: keep OPEN (as drawn), or gate on `draftsmanMode|editProjects` and make the kiosk skip relinking / the PWA stock require a permission row.
5. **Babcock quotes** gated `tenders|viewQuotes` (read) / `tenders|editQuotes` (write) because the sidebar gates the Babcock button under `tenders` today — but CLAUDE.md says `tenders`-only staff must see no money. Keep as drawn, or drop `tenders` and make Babcock `viewQuotes`/`editQuotes` only?
6. **`GET /api/payroll-revisions` OPEN** — the kiosk "last week review" reads it (all employees' revisions). Keep OPEN, or add `?employee_id=` scoping in the same sweep (small change in payroll-extras.js)?
7. **Office Tasks** (`office-tasks.js`) — no key owns them; drawn as `staff|settings|compliance|holidays|payroll`. Fine, or pick one?
8. **`claude-proxy` OPEN** — PWA voice stock and the kiosk need it; any tenant user can spend AI tokens. Keep OPEN, or require *any* permission row (which forces the PWA/kiosk account to have at least one flag)?
9. **PERMISSION_DEFS single source (step 5)** — proposal: **`api/src/permission-defs.json`** (`{key, label, desc, column, routes:[...], nav:[...]}`), required by `authz.js`, and served read-only by **`GET /api/permission-defs`** (OPEN, no SQL, cacheable) which `loadUserAccessData()` fetches once; `shared.js` keeps a *generated* copy `PERMISSION_DEFS` written by `tools/build-permission-defs.js` as the offline fallback + gate `tests/permission-defs-in-sync.js` fails on drift. One file to edit, one restart-free deploy. Alternative: JSON only, no endpoint (frontend copy generated at commit time). I prefer the endpoint so a stale `shared.js` cache can never disagree with the server.

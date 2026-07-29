# TEMPLATE — QMS Check Sheets (D4 draft, 2026-07-30)

> **Status: DRAFT for Mateusz to tweak.** Sheet set derived from the FPC
> (001-Rev.01-BAMA-FPC) — every form the FPC references, plus the ones a
> BSI/EXC3 audit expects to see filled in. Each sheet is defined as a
> data-driven form (fields, types, who fills it, where it files) so D4 can
> render them on phone/kiosk without per-sheet code. Delete rows you don't
> want; wording of questions is fully editable.
>
> Field types: text · number · date · select(...) · yesno · signature ·
> photo · table(cols…). `→ files to` = SharePoint destination + register row.

---

## 1. BAMA tec 001 — Tender & Technical Contract Review  (FPC s6)
**When:** Part 1 at enquiry (estimator), Part 2 pre-start (MD + Basic RWC).
**→ files to:** project folder `01 - Contract Review` + ChangeLog.
Part 1: enquiry ref (auto from TD) · client · scope summary (text) ·
execution class select(EXC1|EXC2|EXC3) · within manufacturing capability?
yesno · special processes needed (NDT/PWHT/coatings) yesno+text ·
qualification gaps (text) · reviewed by + signature + date.
Part 2: contract no (auto C-ref) · drawings received rev list (table:
drawing no, rev) · connections within standard WPS range? yesno ·
new PQR needed? yesno · NDT extent per Table 24 select(0%|5%|10%|20%) ·
design responsibility on BAMA? yesno · differences vs tender (text) ·
attendees · signatures.

## 2. BAM VER 001 — Welding Equipment Checksheet  (FPC s14.1, fortnightly)
**When:** fortnightly, Workshop Team Leader. **→ files to:** `02 - Quality
(QMS) / 02 - Forms & Check Sheets` + register.
Machine ID (select from Welding Equipment tab — already in ERP) · date ·
settings verified (amps/volts/wire feed) table · gas type select(Ar/CO2 mix|
CO2|Ar) · gas flow l/min number · leads & clamps condition yesno · calibration
label in date yesno · defects found text · checked by signature.

## 3. CON 001 — Welding Consumables Issue Register  (FPC s11.1)
**When:** on each issue, Storeman/MD. **→ files to:** QMS forms folder.
Date · consumable (select: wire/electrode type from a small lookup) · batch
/cast no · qty issued · issued to (personnel picker — SitePersonnel) · WPS
ref · condition ok yesno · issued by signature.

## 4. Material Receiving Inspection  (FPC s11.4 + SSOW001/002)
**When:** every steel delivery, receiving personnel. **→ files to:** project
folder `04 - Material Certs` (or stock) + links the PO.
PO number (picker from ERP POs) · supplier (auto) · delivery date · items
table(size/grade/qty/heat no) · matches PO? yesno · test certs received?
yesno + 3.1 cert photo upload · material marked with PO no? yesno ·
condition ok (no damage/corrosion)? yesno · discrepancy action
select(accepted|quarantined|rejected) · received by signature.
*Photo-of-cert upload → Claude reads heat numbers for traceability (reader-
only, same two-engine rule).*

## 5. Fabrication Inspection Record  (FPC s13/14 — per assembly or batch)
**When:** welder signs at completion, WTL countersigns. **→ files to:**
project folder `05 - QA Records`; ties to JobAssemblyActions ledger.
Job (picker) · drawing no + rev (picker from job drawings) · assembly marks
(multi-select from BOM) · fit-up checked to drawing yesno · WPS used (text/
select) · welder (personnel picker, must hold in-date coded cert — warn from
SitePersonnelCerts) · visual weld inspection pass yesno · dims checked yesno ·
defects/CAR raised? yesno+text · welder signature · inspector signature.

## 6. Final Inspection & Release  (FPC s14.3, pre-despatch)
**When:** before despatch, WTL/MD. **→ files to:** project folder; gate for
the Delivery Note (warn in despatch flow if missing).
Job · assemblies (auto from despatch selection) · visual & dimensional final
check yesno · surface treatment as spec yesno (prep grade text) · touch-up
needed yesno · marking/part numbers visible yesno · NDT complete & reports
filed yesno/n-a · released by signature + date.

## 7. Calibration Log  (FPC s12)
**When:** on check/receipt of any measuring kit. **→ files to:** `02 -
Quality (QMS) / 05 - Calibration Records`; expiry feeds the reminder strip
(same pattern as document expiry).
Instrument ID · description (tape/weld gauge/voltmeter…) · serial no ·
cert no · calibrated by (UKAS lab text) · cal date · due date · routine
validation check ok yesno · checked by signature.

## 8. Site Daily / Erection Record  (supports RAMS + FPC site scope)
**When:** daily on site, Site Supervisor (phone). **→ files to:** project
folder `06 - Site`.
Job · date · personnel on site (multi picker) · briefing/toolbox talk given
yesno + topic · plant on site table(item, insp ok) · work completed today
text · bolts torqued/checked yesno/n-a · issues/near misses text + photo ·
supervisor signature.

## 9. NCR / Corrective Action Report (CAR)  (FPC s15)
**When:** any non-conformance. **→ files to:** QMS folder + ChangeLog;
open-CAR count surfaces on ED Health tab.
CAR no (auto) · job/PO ref · raised by · description + photo · root cause
text · containment action text · corrective action text · responsible
person · due date · verified/closed by + signature + close date.

---

## D4 engine notes (build later)
- One `QmsForms` definition table (JSON schema per sheet, versioned) + one
  `QmsSubmissions` table (form_id, job_id?, answers JSON, signatures,
  created_by). New sheets = new definition row, **no code**.
- Render: phone/kiosk-friendly single-column; signature = finger-draw canvas;
  photos → project folder alongside the PDF.
- Output: native jsPDF per submission (PDF-generation rules apply), filed
  per the `→ files to` above + register row; ChangeLog on submit.
- Pickers pull live ERP data (jobs, drawings, BOM marks, POs, SitePersonnel,
  Welding Equipment) — the reason paper can't compete.
- Suggested build order: 2 & 7 (simplest, self-contained) → 4 → 5/6 → 1 → 8 → 9.

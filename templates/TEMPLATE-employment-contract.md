# TEMPLATE — Employment Contract (D3 draft, 2026-07-30)

> **Status: DRAFT for Mateusz to tweak.** Written to cover the s.1 Employment
> Rights Act 1996 "written statement of particulars" requirements for a UK
> micro fabrication business. `{{placeholders}}` become merge fields in the
> D3 generator (two-engine rule: template deterministic, values from the
> Employees table + a small per-hire form; AI drafts nothing binding).
> ⚠ Not legal advice — worth a one-off review by an HR adviser/ACAS
> checklist before first real use.

---

## STATEMENT OF MAIN TERMS OF EMPLOYMENT

**Employer:** BAMA Fabrication Ltd, Gloucester House Office 2, London Road,
Peterborough PE2 8AN ("the Company")
**Employee:** {{employee_name}}, {{employee_address}}
**Job title:** {{job_title}}   <!-- e.g. Fabricator/Welder · Steel Erector · Draftsman · Office Administrator -->
**Start date:** {{start_date}} — no previous employment counts towards
continuous employment. {{probation_clause}}

### 1. Place of work
Your normal place of work is the Company's manufacturing facility at
46 Culley Court, Peterborough PE2 6WA. You may be required to work at the
Company's offices, client sites and construction sites within the UK as the
needs of the business require. {{site_travel_clause}}
<!-- default site_travel_clause: "Travel time and expenses for site work are
paid in accordance with the Company's current site-work arrangements." -->

### 2. Pay
Your pay is £{{pay_rate}} per {{pay_basis:hour|week|year}}, paid
{{pay_frequency:weekly|monthly}} in arrears by bank transfer.
Overtime: {{overtime_clause}}
<!-- default: "Overtime is available at the Company's discretion and paid at
the rates notified from time to time." Tweak if you run fixed x1.5/x2. -->
Deductions are only made where required by law (PAYE, NI, court orders,
pension) or where you have agreed in writing.

### 3. Hours of work
Normal hours: {{weekly_hours}} hours per week, {{working_pattern}}.
<!-- default pattern: "Monday to Friday, 07:30–16:30 with a 60-minute unpaid
break" — align with the kiosk clocking rules. -->
You may be required to work reasonable additional hours to meet production
and site deadlines.

### 4. Holidays
Holiday year: {{holiday_year_start}} to {{holiday_year_end}}.
Entitlement: {{holiday_days}} days including public holidays
<!-- default 28 incl. bank holidays, matching the ERP holiday module -->.
Requests are made through the Company's time-keeping system (kiosk/ERP) and
are subject to approval. Untaken holiday may not be carried over except as
required by law. On termination, accrued untaken holiday is paid; holiday
taken in excess of accrual is deducted from final pay.

### 5. Sickness
You must notify {{sickness_contact}} before {{sickness_notify_time}} on the
first day of absence. Statutory Sick Pay applies; there is no contractual
sick pay unless notified in writing. Fit notes are required after 7 days.

### 6. Pension
You will be auto-enrolled into the Company's workplace pension scheme
({{pension_provider}}) where eligible, with contributions at statutory
minimum rates unless otherwise agreed.

### 7. PPE, tools & training
The Company provides required PPE free of charge; you must use it and keep it
in good condition. {{tools_clause}}
<!-- e.g. "Personal hand tools are your own responsibility; Company plant and
machines may only be used with authorisation" — mirrors POL001/FPC s8. -->
You must hold and maintain the certifications required for your role
(e.g. CSCS, coded welder, CPCS); the Company records these in its training
matrix and may fund renewals at its discretion.

### 8. Health, safety & conduct
You must comply with the Company's Health & Safety Policy (POL001), COSHH
arrangements, safe systems of work, and all policies as amended from time to
time (available on demand). Smoking, alcohol and drugs rules per POL001
apply. Failure to follow safety rules is a disciplinary matter and may be
gross misconduct.

### 9. Notice
During probation: {{probation_notice}} <!-- default 1 week either side -->.
After probation: from you, {{employee_notice}} <!-- default 1 month -->;
from the Company, the greater of {{employer_notice}} and the statutory
minimum (1 week per complete year of service, up to 12).

### 10. Disciplinary & grievance
The Company follows the ACAS Code of Practice. Disciplinary and grievance
matters should be raised with {{grievance_contact:Mateusz Braczyk, Managing
Director}}. The procedures are non-contractual.

### 11. Confidentiality & IP
You must not disclose confidential information (pricing, client lists,
drawings, the Company's systems) during or after employment. Work products,
drawings and designs created in the course of employment belong to the
Company.

### 12. Collective agreements / other
There are no collective agreements affecting your employment. There is no
requirement to work outside the UK.

---

Signed for the Company: ____________________  Mateusz Braczyk, Managing Director  Date: {{issue_date}}

Signed by the Employee: ____________________  {{employee_name}}  Date: __________

---

## D3 generator notes (build later)
- Merge fields resolve from Employees table + a "New contract" form
  (role preset dropdowns fill sensible defaults per role: Fabricator/Welder,
  Erector, Draftsman, Office).
- Output: docx (docx.js, editable) + PDF (jsPDF) — same twin-renderer
  pattern as RAMS Phase 7. Signed copy uploaded back → filed to
  `BAMA / 03 - Employees / <Employee Name>/` + register row (reuse the
  D1/D2 documents pattern with an EmployeeDocuments table).
- Version the template: keep this file as the single source; generator reads
  it so wording tweaks don't need code changes.

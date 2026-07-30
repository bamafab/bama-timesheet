-- seed-qms-forms-phase2.sql (D4 phase 2 — remaining 7 FPC check sheets, 2026-07-30)
-- Definition rows only — NO code needed (the engine renders from JSON).
-- Field types available: text number date select textarea yesno(+allowNa)
--                        job machine drawing personnel photo signature table
-- folder: 'checksheets' | 'calibration'
-- Idempotent by form_code. Run after create-qms-forms.sql.

IF NOT EXISTS (SELECT 1 FROM QmsForms WHERE form_code = 'BAMA tec 001')
INSERT INTO QmsForms (form_code, title, definition) VALUES ('BAMA tec 001', 'Tender & Technical Contract Review',
N'{"folder":"checksheets","fields":[
{"key":"contract_no","label":"Contract / enquiry ref","type":"text","required":true},
{"key":"client","label":"Client","type":"text","required":true},
{"key":"review_date","label":"Review date","type":"date","required":true},
{"key":"part","label":"Review stage","type":"select","options":["Part 1 - enquiry stage","Part 2 - pre-start"],"required":true},
{"key":"scope","label":"Scope summary","type":"textarea","rows":3},
{"key":"exec_class","label":"Execution class","type":"select","options":["EXC1","EXC2","EXC3"],"required":true},
{"key":"within_capability","label":"Within BAMA manufacturing capability","type":"yesno","required":true},
{"key":"drawings","label":"Drawings received (no / rev)","type":"table","columns":["Drawing no","Rev"]},
{"key":"std_wps","label":"Connections within standard pre-qualified WPS range","type":"yesno","allowNa":true},
{"key":"new_pqr","label":"New PQR required","type":"yesno","allowNa":true},
{"key":"ndt_extent","label":"NDT extent required (EN 1090-2 Table 24)","type":"select","options":["0%","5%","10%","20%","Per spec"]},
{"key":"special_processes","label":"Special processes (PWHT / coatings / galv)","type":"textarea"},
{"key":"design_resp","label":"BAMA carries design responsibility","type":"yesno","allowNa":true},
{"key":"differences","label":"Differences vs tender / actions","type":"textarea","rows":3},
{"key":"attendees","label":"Attendees","type":"personnel"},
{"key":"reviewed_by","label":"Reviewed by","type":"text","required":true},
{"key":"signature","label":"Signature","type":"signature"}]}');

IF NOT EXISTS (SELECT 1 FROM QmsForms WHERE form_code = 'CON 001')
INSERT INTO QmsForms (form_code, title, definition) VALUES ('CON 001', 'Welding Consumables Issue Register',
N'{"folder":"checksheets","fields":[
{"key":"issue_date","label":"Date of issue","type":"date","required":true},
{"key":"consumable","label":"Consumable type","type":"text","required":true},
{"key":"batch_no","label":"Batch / cast number","type":"text","required":true},
{"key":"qty","label":"Quantity issued","type":"text","required":true},
{"key":"issued_to","label":"Issued to","type":"personnel","required":true},
{"key":"wps_ref","label":"WPS reference","type":"text"},
{"key":"job","label":"Job / contract","type":"job"},
{"key":"condition_ok","label":"Packaging intact & markings correct","type":"yesno","required":true},
{"key":"issued_by","label":"Issued by","type":"text","required":true},
{"key":"signature","label":"Signature","type":"signature"}]}');

IF NOT EXISTS (SELECT 1 FROM QmsForms WHERE form_code = 'BAMA MAT 001')
INSERT INTO QmsForms (form_code, title, definition) VALUES ('BAMA MAT 001', 'Material Receiving Inspection',
N'{"folder":"checksheets","fields":[
{"key":"po_number","label":"Purchase order number","type":"text","required":true},
{"key":"supplier","label":"Supplier","type":"text","required":true},
{"key":"delivery_date","label":"Delivery date","type":"date","required":true},
{"key":"job","label":"Job / contract (or stock)","type":"job"},
{"key":"items","label":"Items received","type":"table","columns":["Size / section","Grade","Qty","Heat / cast no"]},
{"key":"matches_po","label":"Matches purchase order (qty, size, grade)","type":"yesno","required":true},
{"key":"certs_received","label":"Test certificates (3.1) received","type":"yesno","required":true},
{"key":"cert_photo","label":"Photo of material certificate","type":"photo"},
{"key":"marked","label":"Material marked with PO number","type":"yesno","required":true},
{"key":"condition_ok","label":"Condition acceptable (no damage / corrosion)","type":"yesno","required":true},
{"key":"action","label":"Outcome","type":"select","options":["Accepted","Quarantined","Rejected"],"required":true},
{"key":"notes","label":"Discrepancies / action taken","type":"textarea"},
{"key":"received_by","label":"Received by","type":"text","required":true},
{"key":"signature","label":"Signature","type":"signature"}]}');

IF NOT EXISTS (SELECT 1 FROM QmsForms WHERE form_code = 'BAMA FAB 001')
INSERT INTO QmsForms (form_code, title, definition) VALUES ('BAMA FAB 001', 'Fabrication Inspection Record',
N'{"folder":"checksheets","fields":[
{"key":"job","label":"Job / contract","type":"job","required":true},
{"key":"drawing_no","label":"Drawing number","type":"text","required":true},
{"key":"drawing_rev","label":"Drawing revision","type":"text","required":true},
{"key":"assembly_marks","label":"Assembly marks covered","type":"text","required":true},
{"key":"inspect_date","label":"Date","type":"date","required":true},
{"key":"fitup_ok","label":"Fit-up checked to drawing","type":"yesno","required":true},
{"key":"wps_used","label":"WPS used","type":"text"},
{"key":"welder","label":"Welder(s)","type":"personnel","required":true},
{"key":"visual_ok","label":"Visual weld inspection pass","type":"yesno","required":true},
{"key":"dims_ok","label":"Dimensions checked to drawing","type":"yesno","required":true},
{"key":"defects","label":"Defects found / CAR raised","type":"textarea"},
{"key":"photo","label":"Photo (optional)","type":"photo"},
{"key":"welder_sig","label":"Welder signature","type":"signature"},
{"key":"inspector","label":"Inspected by","type":"text","required":true},
{"key":"inspector_sig","label":"Inspector signature","type":"signature"}]}');

IF NOT EXISTS (SELECT 1 FROM QmsForms WHERE form_code = 'BAMA REL 001')
INSERT INTO QmsForms (form_code, title, definition) VALUES ('BAMA REL 001', 'Final Inspection & Release',
N'{"folder":"checksheets","fields":[
{"key":"job","label":"Job / contract","type":"job","required":true},
{"key":"release_date","label":"Date","type":"date","required":true},
{"key":"assemblies","label":"Assemblies released","type":"textarea","rows":2,"required":true},
{"key":"final_visual","label":"Final visual & dimensional check pass","type":"yesno","required":true},
{"key":"surface_ok","label":"Surface treatment as specification","type":"yesno","required":true},
{"key":"prep_grade","label":"Preparation grade / coating spec","type":"text"},
{"key":"touchup","label":"Touch-up required","type":"yesno","allowNa":true},
{"key":"marking_ok","label":"Part marks visible after erection","type":"yesno","required":true},
{"key":"ndt_complete","label":"NDT complete & reports filed","type":"yesno","allowNa":true},
{"key":"photo","label":"Photo of finished work","type":"photo"},
{"key":"released_by","label":"Released by","type":"text","required":true},
{"key":"signature","label":"Signature","type":"signature"}]}');

IF NOT EXISTS (SELECT 1 FROM QmsForms WHERE form_code = 'BAMA SITE 001')
INSERT INTO QmsForms (form_code, title, definition) VALUES ('BAMA SITE 001', 'Site Daily / Erection Record',
N'{"folder":"checksheets","fields":[
{"key":"job","label":"Job / contract","type":"job","required":true},
{"key":"record_date","label":"Date","type":"date","required":true},
{"key":"personnel","label":"Personnel on site","type":"personnel","required":true},
{"key":"briefing_given","label":"RAMS briefing / toolbox talk given","type":"yesno","required":true},
{"key":"briefing_topic","label":"Briefing topic","type":"text"},
{"key":"plant","label":"Plant on site","type":"table","columns":["Item","Inspection OK"]},
{"key":"work_done","label":"Work completed today","type":"textarea","rows":3,"required":true},
{"key":"bolts_checked","label":"Bolts torqued / checked","type":"yesno","allowNa":true},
{"key":"issues","label":"Issues / near misses","type":"textarea"},
{"key":"photo","label":"Site photo","type":"photo"},
{"key":"supervisor","label":"Supervisor","type":"text","required":true},
{"key":"signature","label":"Supervisor signature","type":"signature"}]}');

IF NOT EXISTS (SELECT 1 FROM QmsForms WHERE form_code = 'BAMA CAR 001')
INSERT INTO QmsForms (form_code, title, definition) VALUES ('BAMA CAR 001', 'Non-Conformance / Corrective Action Report',
N'{"folder":"checksheets","fields":[
{"key":"car_no","label":"CAR number","type":"text","required":true},
{"key":"raised_date","label":"Date raised","type":"date","required":true},
{"key":"job","label":"Job / contract or PO","type":"job"},
{"key":"raised_by","label":"Raised by","type":"text","required":true},
{"key":"category","label":"Category","type":"select","options":["Fabrication","Welding","Material","Supplier","Site","Documentation","Other"],"required":true},
{"key":"description","label":"Description of non-conformance","type":"textarea","rows":3,"required":true},
{"key":"photo","label":"Photo evidence","type":"photo"},
{"key":"root_cause","label":"Root cause","type":"textarea","rows":2},
{"key":"containment","label":"Immediate containment action","type":"textarea","rows":2},
{"key":"corrective","label":"Corrective action","type":"textarea","rows":2},
{"key":"responsible","label":"Responsible person","type":"text"},
{"key":"due_date","label":"Action due date","type":"date"},
{"key":"client_concession","label":"Client concession obtained in writing","type":"yesno","allowNa":true},
{"key":"verified_by","label":"Verified / closed by","type":"text"},
{"key":"close_date","label":"Date closed","type":"date"},
{"key":"signature","label":"Signature","type":"signature"}]}');

SELECT form_code, title FROM QmsForms ORDER BY form_code;

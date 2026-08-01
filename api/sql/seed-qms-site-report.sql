-- seed-qms-site-report.sql (Site Report / Snagging, 2026-08-01)
-- A QMS-style site report the shop-floor / site team fills on their phone.
-- Doubles as a snagging report via the 'report_type' select. Definition row
-- only — NO code (the QMS engine renders it). Files to 06 - Completed Check
-- Sheets like other check sheets. Idempotent by form_code.
-- Field types: text number date select textarea yesno job machine drawing
--              personnel photo signature table. folder: checksheets|calibration.

IF NOT EXISTS (SELECT 1 FROM QmsForms WHERE form_code = 'BAMA SR 001')
BEGIN
    INSERT INTO QmsForms (form_code, title, definition) VALUES
    ('BAMA SR 001', 'Site Report / Snagging',
    N'{"folder":"checksheets","fields":[
      {"key":"job","label":"Job / contract","type":"job","required":true},
      {"key":"report_date","label":"Date","type":"date","required":true},
      {"key":"report_type","label":"Report type","type":"select","options":["Progress","Snagging","Progress + Snagging"],"required":true},
      {"key":"location","label":"Location / area","type":"text"},
      {"key":"reported_by","label":"Reported by","type":"text","required":true},
      {"key":"conditions","label":"Weather / site conditions","type":"text"},
      {"key":"summary","label":"Summary of works / observations","type":"textarea","rows":3,"required":true},
      {"key":"photos","label":"Photos","type":"photo"},
      {"key":"snags","label":"Snags / defects found","type":"textarea","rows":3},
      {"key":"actions","label":"Actions / follow-up required","type":"textarea","rows":2},
      {"key":"sign","label":"Signature","type":"signature"}
    ]}');
    PRINT 'BAMA SR 001 (Site Report / Snagging) seeded';
END
ELSE PRINT 'BAMA SR 001 already exists';

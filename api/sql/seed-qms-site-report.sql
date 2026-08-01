-- seed-qms-site-report.sql (Site Report / Snagging, 2026-08-01)
-- A QMS-style site report the shop-floor / site team fills on their phone.
-- Doubles as a snagging report via the 'report_type' select. Definition row
-- only — NO code (the QMS engine renders it). Files to 06 - Completed Check
-- Sheets like other check sheets.
-- reported_by = personnel dropdown (roster); location auto-fills from the job's
-- site address (still editable). Re-runnable: updates the definition in place.
-- Field types: text number date select textarea yesno job machine drawing
--              personnel(+single) photo signature table. folder: checksheets|calibration.

DECLARE @def NVARCHAR(MAX) = N'{"folder":"checksheets","fields":[
  {"key":"job","label":"Job / contract","type":"job","required":true},
  {"key":"report_date","label":"Date","type":"date","required":true},
  {"key":"report_type","label":"Report type","type":"select","options":["Progress","Snagging","Progress + Snagging"],"required":true},
  {"key":"location","label":"Site address / location","type":"text","autofrom":"job"},
  {"key":"reported_by","label":"Reported by","type":"personnel","single":true,"required":true},
  {"key":"conditions","label":"Weather / site conditions","type":"text"},
  {"key":"summary","label":"Summary of works / observations","type":"textarea","rows":3,"required":true},
  {"key":"photos","label":"Photos","type":"photo"},
  {"key":"snags","label":"Snags / defects found","type":"textarea","rows":3},
  {"key":"actions","label":"Actions / follow-up required","type":"textarea","rows":2},
  {"key":"sign","label":"Signature","type":"signature"}
]}';

IF EXISTS (SELECT 1 FROM QmsForms WHERE form_code = 'BAMA SR 001')
BEGIN
    UPDATE QmsForms SET title = 'Site Report / Snagging', definition = @def WHERE form_code = 'BAMA SR 001';
    PRINT 'BAMA SR 001 updated';
END
ELSE
BEGIN
    INSERT INTO QmsForms (form_code, title, definition) VALUES ('BAMA SR 001', 'Site Report / Snagging', @def);
    PRINT 'BAMA SR 001 seeded';
END

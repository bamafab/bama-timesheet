-- create-qms-forms.sql (D4 — QMS digital check sheets, 2026-07-30)
-- Data-driven form engine: QmsForms holds versioned JSON definitions
-- (new sheets = new row, NO code); QmsSubmissions holds filled-in answers.
-- PDFs render natively client-side and file to SharePoint per the
-- definition's folder hint. NEW TABLES => no restart. Idempotent.
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'QmsForms')
BEGIN
    CREATE TABLE QmsForms (
        id          INT IDENTITY(1,1) PRIMARY KEY,
        form_code   NVARCHAR(40)  NOT NULL,   -- e.g. 'BAM VER 001'
        title       NVARCHAR(200) NOT NULL,
        definition  NVARCHAR(MAX) NOT NULL,   -- JSON: {fields:[{key,label,type,options?,required?}], folder:'checksheets'|'calibration'}
        version     INT NOT NULL DEFAULT 1,
        is_active   BIT NOT NULL DEFAULT 1,
        created_at  DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
    PRINT 'QmsForms created';
END ELSE PRINT 'QmsForms exists';

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'QmsSubmissions')
BEGIN
    CREATE TABLE QmsSubmissions (
        id           INT IDENTITY(1,1) PRIMARY KEY,
        form_id      INT NOT NULL,
        form_code    NVARCHAR(40) NOT NULL,
        answers      NVARCHAR(MAX) NOT NULL,  -- JSON {key:value}
        submitted_by NVARCHAR(120) NULL,
        file_name    NVARCHAR(255) NULL,
        sharepoint_file_id NVARCHAR(120) NULL,
        web_url      NVARCHAR(1000) NULL,
        is_deleted   BIT NOT NULL DEFAULT 0,
        created_at   DATETIME2 NOT NULL DEFAULT SYSUTCDATETIME()
    );
    CREATE INDEX IX_QmsSubmissions_Form ON QmsSubmissions (form_code) WHERE is_deleted = 0;
    PRINT 'QmsSubmissions created';
END ELSE PRINT 'QmsSubmissions exists';

-- Seed the first two sheets (idempotent by form_code)
IF NOT EXISTS (SELECT 1 FROM QmsForms WHERE form_code = 'BAM VER 001')
INSERT INTO QmsForms (form_code, title, definition) VALUES ('BAM VER 001', 'Welding Equipment Checksheet',
N'{"folder":"checksheets","fields":[
{"key":"machine","label":"Machine ID / description","type":"text","required":true},
{"key":"check_date","label":"Date of check","type":"date","required":true},
{"key":"amps","label":"Amps setting verified","type":"text"},
{"key":"volts","label":"Volts setting verified","type":"text"},
{"key":"wire_feed","label":"Wire feed (m/min)","type":"text"},
{"key":"gas_type","label":"Gas type","type":"select","options":["Ar/CO2 mix","CO2","Argon","N/A"]},
{"key":"gas_flow","label":"Gas flow (l/min)","type":"number"},
{"key":"leads_ok","label":"Leads & clamps in good condition","type":"yesno","required":true},
{"key":"cal_ok","label":"Calibration label in date","type":"yesno","required":true},
{"key":"defects","label":"Defects found / action taken","type":"textarea"},
{"key":"checked_by","label":"Checked by","type":"text","required":true}]}');

IF NOT EXISTS (SELECT 1 FROM QmsForms WHERE form_code = 'BAMA CAL 001')
INSERT INTO QmsForms (form_code, title, definition) VALUES ('BAMA CAL 001', 'Calibration Log Entry',
N'{"folder":"calibration","fields":[
{"key":"instrument","label":"Instrument ID / description","type":"text","required":true},
{"key":"serial","label":"Serial number","type":"text"},
{"key":"cert_no","label":"Calibration certificate no","type":"text"},
{"key":"cal_by","label":"Calibrated by (UKAS lab / internal)","type":"text"},
{"key":"cal_date","label":"Calibration date","type":"date","required":true},
{"key":"due_date","label":"Calibration due date","type":"date","required":true},
{"key":"validation_ok","label":"Routine validation check OK","type":"yesno"},
{"key":"notes","label":"Notes","type":"textarea"},
{"key":"checked_by","label":"Recorded by","type":"text","required":true}]}');

SELECT form_code, title FROM QmsForms;

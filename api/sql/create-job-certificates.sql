-- ─────────────────────────────────────────────────────────────────────────────
-- create-job-certificates.sql  (F1b — issued certificates register, 2026-07-30)
--
-- Every Certificate of Conformity and Declaration of Performance BAMA issues,
-- kept as a record with a SNAPSHOT of the figures it was issued on.
--
-- Why the snapshot matters: a CoC states the NDT extent achieved, the heat
-- numbers supplied and the drawing revisions used. Those move on afterwards —
-- more welds get inspected, a drawing gets revised. If the certificate were
-- re-rendered from live data a year later it would no longer match the paper
-- the client holds. So `payload` freezes what was certified at the moment of
-- issue, and re-issuing creates a NEW revision rather than editing history.
--
-- Serves both document types (doc_type) so the DoP shares the register.
--
-- NEW TABLE ONLY — no Function App restart needed. Idempotent.
-- ─────────────────────────────────────────────────────────────────────────────

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'JobCertificates')
BEGIN
    CREATE TABLE JobCertificates (
        id                 INT IDENTITY(1,1) PRIMARY KEY,
        job_id             INT           NOT NULL,
        doc_type           NVARCHAR(10)  NOT NULL,          -- 'coc' | 'dop'
        cert_ref           NVARCHAR(80)  NOT NULL,          -- e.g. COC-C260412-01
        revision           INT           NOT NULL DEFAULT 1,
        issue_date         DATE          NULL,
        issued_by          NVARCHAR(200) NULL,
        exec_class         NVARCHAR(10)  NULL,
        scope_text         NVARCHAR(MAX) NULL,              -- narrative (AI-drafted, human-edited)
        payload            NVARCHAR(MAX) NULL,              -- JSON snapshot of every figure certified
        status             NVARCHAR(20)  NOT NULL DEFAULT 'issued',   -- draft | issued | superseded
        superseded_by      INT           NULL,
        file_name          NVARCHAR(255)  NULL,
        sharepoint_file_id NVARCHAR(120)  NULL,
        drive_id           NVARCHAR(140)  NULL,
        web_url            NVARCHAR(1000) NULL,
        notes              NVARCHAR(MAX) NULL,
        is_deleted         BIT           NOT NULL DEFAULT 0,
        created_at         DATETIME2     NOT NULL DEFAULT SYSUTCDATETIME(),
        updated_at         DATETIME2     NULL
    );
    CREATE INDEX IX_JobCertificates_Job ON JobCertificates (job_id, doc_type) WHERE is_deleted = 0;
    PRINT 'JobCertificates created';
END
ELSE
    PRINT 'JobCertificates already exists — no change';

SELECT (SELECT COUNT(*) FROM sys.columns WHERE object_id = OBJECT_ID('JobCertificates')) AS cert_cols;

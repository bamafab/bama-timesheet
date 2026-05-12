-- Office Tasks — migrate from SharePoint JSON to SQL
-- Run against bama-erp via Azure Portal Query Editor
-- 2026-05-12

CREATE TABLE OfficeTasks (
    id           INT IDENTITY(1,1) PRIMARY KEY,
    title        NVARCHAR(200)     NOT NULL,
    description  NVARCHAR(MAX),
    assigned_to  NVARCHAR(100),
    assigned_by  NVARCHAR(100),
    due_date     DATE,
    priority     NVARCHAR(20)      NOT NULL DEFAULT 'normal',
    status       NVARCHAR(20)      NOT NULL DEFAULT 'open',
    source       NVARCHAR(50)      NOT NULL DEFAULT 'manual',  -- 'manual' | 'instant_po' | 'quote_handler' etc.
    source_ref   NVARCHAR(50),                                  -- e.g. PO reference 'P260501'
    created_at   DATETIMEOFFSET    NOT NULL DEFAULT GETUTCDATE(),
    updated_at   DATETIMEOFFSET    NOT NULL DEFAULT GETUTCDATE(),
    completed_at DATETIMEOFFSET
);

-- Index for the common query: tasks assigned to me, not dismissed
CREATE INDEX IX_OfficeTasks_assigned_to_status ON OfficeTasks (assigned_to, status);

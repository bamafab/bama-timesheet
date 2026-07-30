#!/usr/bin/env python3
"""
build-manifest.py — regenerate api/src/schema-manifest.json from api/sql/*.sql

The manifest tells /api/schema-check what to look for in the live database so
"have I run this migration?" is answered by the database itself, not by memory.
Structural probes (tables, columns) are parsed straight out of the scripts;
data-only scripts (backfills, imports, constraint widenings) can't be detected
structurally and are listed with kind='manual' so they're visibly unverifiable
rather than silently assumed.

Run from the repo root:  python3 api/sql/build-manifest.py
Then commit api/src/schema-manifest.json.
"""
import re, os, json, sys

SQL_DIR = 'api/sql'
OUT = 'api/src/schema-manifest.json'

# Scripts whose effect isn't a table or column — described, not probed.
MANUAL = {
    'add-projecthours-unique.sql':          'Unique index on ProjectHours (emp, project, date) + duplicate merge',
    'add-sdn-sequence.sql':                 'Settings row seeding the Site DN number sequence',
    'add-zinc-phosphate-primer-finish.sql': 'ServiceTypes rows for zinc phosphate primer finish',
    'widen-approval-status.sql':            'Widens the DrawingApprovalRevisions status check constraint',
    'widen-bom-status-on-site.sql':         "Adds 'on_site' to the JobBomItems status check constraint",
    'approve-all-existing-project-hours.sql': 'One-off: approve historic ProjectHours',
    'backfill-labour-hours-f1.sql':         'One-off: backfill QuoteLineItems.labour_hours (Fault F1)',
    'backfill-po-approval.sql':             'One-off: backfill PO approval state',
    'backfill-po-project-links.sql':        'One-off: set PurchaseOrders.project_id from job_number',
    'cleanup-payroll-2026-04-27-test-data.sql': 'One-off: remove payroll test data',
    'import-po-tracker-2026.sql':           'One-off: import the 2026 PO tracker spreadsheet',
    'import-po-fixes-2026.sql':             'One-off: corrections to the 2026 PO import',
    'migrate-drawings-blob-to-sql.sql':     'One-off: move drawing blobs into SQL',
}

def parse(txt):
    tables = sorted(set(re.findall(r'CREATE\s+TABLE\s+(?:dbo\.)?\[?(\w+)\]?', txt, re.I)))
    cols = set()
    for m in re.finditer(r'ALTER\s+TABLE\s+(?:dbo\.)?\[?(\w+)\]?\s+ADD\s+'
                         r'(?!CONSTRAINT|CHECK|UNIQUE|PRIMARY|FOREIGN)\[?(\w+)\]?', txt, re.I):
        cols.add((m.group(1), m.group(2)))
    for m in re.finditer(r"COL_LENGTH\(\s*'(\w+)'\s*,\s*'(\w+)'\s*\)", txt, re.I):
        cols.add((m.group(1), m.group(2)))
    forms = sorted(set(re.findall(r"form_code\s*=\s*'([^']+)'", txt)))
    return tables, sorted(cols), forms

def main():
    if not os.path.isdir(SQL_DIR):
        sys.exit('Run me from the repo root.')
    entries = []
    for fn in sorted(os.listdir(SQL_DIR)):
        if not fn.endswith('.sql'):
            continue
        txt = open(os.path.join(SQL_DIR, fn), encoding='utf-8', errors='replace').read()
        tables, cols, forms = parse(txt)
        # First comment line makes a decent description.
        desc = ''
        for line in txt.splitlines():
            s = line.strip().lstrip('-').strip()
            if s and not s.startswith('─') and not s.lower().startswith(fn.lower()):
                desc = s[:160]; break
        entry = {
            'script': fn,
            'title': MANUAL.get(fn) or desc or fn,
            'kind': 'manual' if fn in MANUAL else 'structural',
            'tables': tables,
            'columns': [{'table': t, 'column': c} for t, c in cols],
            'seedForms': forms,
        }
        # Column adds on a table this script also creates are already covered.
        entry['columns'] = [c for c in entry['columns'] if c['table'] not in tables]
        entries.append(entry)
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    json.dump({'generated_from': SQL_DIR, 'migrations': entries}, open(OUT, 'w'), indent=2)
    struct = sum(1 for e in entries if e['kind'] == 'structural')
    print(f'{OUT}: {len(entries)} scripts ({struct} probeable, {len(entries)-struct} data-only)')

if __name__ == '__main__':
    main()

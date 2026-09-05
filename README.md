# bama-timesheet — BAMA Fabrication ERP

Bespoke ERP for BAMA Fabrication Ltd (structural steel, EN 1090 EXC3): timesheets/kiosk, payroll,
estimating (Quote Builder), projects & drawings, purchasing, QMS/traceability, invoicing & AFP,
mobile PWA. Frontend is static HTML/JS on Azure Static Web Apps (`*.html` + `shared.js`); the API is
Azure Functions v4 (`api/`) over Azure SQL, with documents on SharePoint via Microsoft Graph.

**Start with [`CLAUDE.md`](CLAUDE.md)** — it is the working manual: architecture, hard rules, data-model
facts, gate sequence and conventions. The current audit and forward plan is
[`docs/BAMA-ERP-Review-2026-09-05.md`](docs/BAMA-ERP-Review-2026-09-05.md). Before any push run
`bash tests/run-gates.sh` (the same gate CI enforces before deploying).

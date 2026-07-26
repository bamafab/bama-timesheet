// ─────────────────────────────────────────────────────────────────────────────
// site-personnel.js
//
// Site Personnel roster for the RAMS module (phase 2b). A single reusable roster
// of staff AND subcontractors, with normalised certs (expiry first-class) and an
// editable cert-type lookup. Money-free by design (tender/quote separation).
//
// Routes:
//   GET    /api/site-personnel                     — list active (+certs); ?all=true incl. inactive
//   POST   /api/site-personnel                     — create person (+optional certs[])
//   PUT    /api/site-personnel/:id                 — update person
//   DELETE /api/site-personnel/:id                 — soft-delete (active = 0)
//   POST   /api/site-personnel/:id/cert            — add a cert to a person
//   DELETE /api/site-personnel/:id/cert/:certId    — remove a cert
//   GET    /api/cert-types                         — list active cert types
//   POST   /api/cert-types                         — add a cert type
//   DELETE /api/cert-types/:id                     — soft-delete a cert type
// ─────────────────────────────────────────────────────────────────────────────

const { app } = require('@azure/functions');
const { requireAuth } = require('../auth');
const { query } = require('../db');
const { ok, created, badRequest, notFound, serverError, preflight } = require('../responses');

// ── OPTIONS preflights ───────────────────────────────────────────────────────
app.http('site-personnel-options', {
    methods: ['OPTIONS'], authLevel: 'anonymous',
    route: 'site-personnel/{*rest}',
    handler: async (req) => preflight(req)
});
app.http('cert-types-options', {
    methods: ['OPTIONS'], authLevel: 'anonymous',
    route: 'cert-types/{*rest}',
    handler: async (req) => preflight(req)
});

// ── helper: attach certs to a set of personnel rows ────────────────────────────
async function attachCerts(rows) {
    if (!rows.length) return rows;
    const ids = rows.map(r => r.id);
    // Build an IN clause with named params (ids are integers from the DB).
    const inList = ids.map((_, i) => `@p${i}`).join(', ');
    const params = {};
    ids.forEach((id, i) => { params['p' + i] = id; });
    const certRes = await query(
        `SELECT id, personnel_id, cert_type, cert_number, issue_date, expiry_date
         FROM SitePersonnelCerts
         WHERE personnel_id IN (${inList})
         ORDER BY cert_type`,
        params
    );
    const byPerson = {};
    for (const c of certRes.recordset) {
        (byPerson[c.personnel_id] = byPerson[c.personnel_id] || []).push(c);
    }
    return rows.map(r => ({ ...r, certs: byPerson[r.id] || [] }));
}

// ── GET /api/site-personnel  (list + certs) ────────────────────────────────────
app.http('site-personnel-list', {
    methods: ['GET'], authLevel: 'anonymous',
    route: 'site-personnel',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const showAll = new URL(request.url).searchParams.get('all') === 'true';
            const res = await query(
                `SELECT id, name, site_role, type, company, phone, employee_id, active
                 FROM SitePersonnel
                 ${showAll ? '' : 'WHERE active = 1'}
                 ORDER BY name`
            );
            const withCerts = await attachCerts(res.recordset);
            return ok(withCerts, request);
        } catch (err) {
            context.error('site-personnel list error:', err);
            return serverError('Failed to load site personnel', request);
        }
    }
});

// ── POST /api/site-personnel  (create, +optional certs[]) ──────────────────────
app.http('site-personnel-create', {
    methods: ['POST'], authLevel: 'anonymous',
    route: 'site-personnel',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const body = await request.json();
            const name = (body.name || '').trim();
            if (!name) return badRequest('name is required', request);
            const type = body.type === 'subcontractor' ? 'subcontractor' : 'staff';

            const ins = await query(
                `INSERT INTO SitePersonnel (name, site_role, type, company, phone, employee_id)
                 OUTPUT INSERTED.*
                 VALUES (@name, @role, @type, @company, @phone, @employeeId)`,
                {
                    name,
                    role:     (body.site_role || '').trim(),
                    type,
                    company:  (body.company || '').trim(),
                    phone:    (body.phone || '').trim(),
                    employeeId: body.employee_id != null ? parseInt(body.employee_id) : null
                }
            );
            const person = ins.recordset[0];

            // Optional certs on create.
            const certs = Array.isArray(body.certs) ? body.certs : [];
            for (const c of certs) {
                const ct = (typeof c === 'string' ? c : c.cert_type || '').trim();
                if (!ct) continue;
                await query(
                    `INSERT INTO SitePersonnelCerts (personnel_id, cert_type, cert_number, issue_date, expiry_date)
                     VALUES (@pid, @ct, @num, @iss, @exp)`,
                    {
                        pid: person.id, ct,
                        num: (typeof c === 'object' && c.cert_number ? String(c.cert_number).trim() : ''),
                        iss: (typeof c === 'object' && c.issue_date ) ? c.issue_date  : null,
                        exp: (typeof c === 'object' && c.expiry_date) ? c.expiry_date : null
                    }
                );
            }
            const [withCerts] = await attachCerts([person]);
            return created(withCerts, request);
        } catch (err) {
            context.error('site-personnel create error:', err);
            return serverError('Failed to create person', request);
        }
    }
});

// ── PUT /api/site-personnel/:id  (update) ──────────────────────────────────────
app.http('site-personnel-update', {
    methods: ['PUT'], authLevel: 'anonymous',
    route: 'site-personnel/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            const body = await request.json();
            const fields = [];
            const params = { id };
            if (body.name      !== undefined) { fields.push('name = @name');           params.name = String(body.name).trim(); }
            if (body.site_role !== undefined) { fields.push('site_role = @role');       params.role = String(body.site_role).trim(); }
            if (body.type      !== undefined) { fields.push('type = @type');            params.type = body.type === 'subcontractor' ? 'subcontractor' : 'staff'; }
            if (body.company   !== undefined) { fields.push('company = @company');       params.company = String(body.company).trim(); }
            if (body.phone     !== undefined) { fields.push('phone = @phone');           params.phone = String(body.phone).trim(); }
            if (body.active    !== undefined) { fields.push('active = @active');         params.active = body.active ? 1 : 0; }
            if (!fields.length) return badRequest('nothing to update', request);
            fields.push('updated_at = GETUTCDATE()');

            const res = await query(
                `UPDATE SitePersonnel SET ${fields.join(', ')} OUTPUT INSERTED.* WHERE id = @id`,
                params
            );
            if (!res.recordset.length) return notFound('Person not found', request);
            const [withCerts] = await attachCerts([res.recordset[0]]);
            return ok(withCerts, request);
        } catch (err) {
            context.error('site-personnel update error:', err);
            return serverError('Failed to update person', request);
        }
    }
});

// ── DELETE /api/site-personnel/:id  (soft-delete) ──────────────────────────────
app.http('site-personnel-delete', {
    methods: ['DELETE'], authLevel: 'anonymous',
    route: 'site-personnel/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            const res = await query(
                `UPDATE SitePersonnel SET active = 0, updated_at = GETUTCDATE()
                 OUTPUT INSERTED.id WHERE id = @id`,
                { id }
            );
            if (!res.recordset.length) return notFound('Person not found', request);
            return ok({ id, active: false }, request);
        } catch (err) {
            context.error('site-personnel delete error:', err);
            return serverError('Failed to remove person', request);
        }
    }
});

// ── POST /api/site-personnel/:id/cert  (add a cert) ────────────────────────────
app.http('site-personnel-cert-add', {
    methods: ['POST'], authLevel: 'anonymous',
    route: 'site-personnel/{id}/cert',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const pid = parseInt(request.params.id);
            const body = await request.json();
            const ct = (body.cert_type || '').trim();
            if (!ct) return badRequest('cert_type is required', request);
            const res = await query(
                `INSERT INTO SitePersonnelCerts (personnel_id, cert_type, cert_number, issue_date, expiry_date)
                 OUTPUT INSERTED.*
                 VALUES (@pid, @ct, @num, @iss, @exp)`,
                {
                    pid, ct,
                    num: (body.cert_number || '').trim(),
                    iss: body.issue_date  || null,
                    exp: body.expiry_date || null
                }
            );
            return created(res.recordset[0], request);
        } catch (err) {
            context.error('site-personnel cert add error:', err);
            return serverError('Failed to add cert', request);
        }
    }
});

// ── DELETE /api/site-personnel/:id/cert/:certId  (remove a cert) ───────────────
app.http('site-personnel-cert-delete', {
    methods: ['DELETE'], authLevel: 'anonymous',
    route: 'site-personnel/{id}/cert/{certId}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const certId = parseInt(request.params.certId);
            const res = await query(
                `DELETE FROM SitePersonnelCerts OUTPUT DELETED.id WHERE id = @certId`,
                { certId }
            );
            if (!res.recordset.length) return notFound('Cert not found', request);
            return ok({ id: certId, deleted: true }, request);
        } catch (err) {
            context.error('site-personnel cert delete error:', err);
            return serverError('Failed to remove cert', request);
        }
    }
});

// ── GET /api/cert-types ────────────────────────────────────────────────────────
app.http('cert-types-list', {
    methods: ['GET'], authLevel: 'anonymous',
    route: 'cert-types',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const showAll = new URL(request.url).searchParams.get('all') === 'true';
            const res = await query(
                `SELECT id, name, active, sort_order FROM CertTypes
                 ${showAll ? '' : 'WHERE active = 1'}
                 ORDER BY sort_order, name`
            );
            return ok(res.recordset, request);
        } catch (err) {
            context.error('cert-types list error:', err);
            return serverError('Failed to load cert types', request);
        }
    }
});

// ── POST /api/cert-types  (add; revives a soft-deleted one of the same name) ───
app.http('cert-types-create', {
    methods: ['POST'], authLevel: 'anonymous',
    route: 'cert-types',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const body = await request.json();
            const name = (body.name || '').trim();
            if (!name) return badRequest('name is required', request);

            const existing = await query('SELECT id FROM CertTypes WHERE name = @name', { name });
            if (existing.recordset.length) {
                const res = await query(
                    `UPDATE CertTypes SET active = 1 OUTPUT INSERTED.* WHERE id = @id`,
                    { id: existing.recordset[0].id }
                );
                return ok(res.recordset[0], request);
            }
            const res = await query(
                `INSERT INTO CertTypes (name, sort_order) OUTPUT INSERTED.*
                 VALUES (@name, @so)`,
                { name, so: body.sort_order != null ? parseInt(body.sort_order) : 99 }
            );
            return created(res.recordset[0], request);
        } catch (err) {
            context.error('cert-types create error:', err);
            return serverError('Failed to add cert type', request);
        }
    }
});

// ── DELETE /api/cert-types/:id  (soft-delete) ──────────────────────────────────
app.http('cert-types-delete', {
    methods: ['DELETE'], authLevel: 'anonymous',
    route: 'cert-types/{id}',
    handler: async (request, context) => {
        const auth = await requireAuth(request);
        if (auth.status) return auth;
        try {
            const id = parseInt(request.params.id);
            const res = await query(
                `UPDATE CertTypes SET active = 0 OUTPUT INSERTED.id WHERE id = @id`,
                { id }
            );
            if (!res.recordset.length) return notFound('Cert type not found', request);
            return ok({ id, active: false }, request);
        } catch (err) {
            context.error('cert-types delete error:', err);
            return serverError('Failed to remove cert type', request);
        }
    }
});

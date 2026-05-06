// ═══════════════════════════════════════════
// CONFIGURATION
// ═══════════════════════════════════════════
const API_BASE = 'https://bama-erp-api-deauckd2cja7ebd5.uksouth-01.azurewebsites.net';

// SharePoint config — ONLY used for file operations (PROJECT TRACKER.xlsx, drawing PDFs, emails)
const CONFIG = {
  driveId: 'b!CxTKk9lEwkyweUqAo3CRas-huywW4KtLqOk2tNzmx-P7CX86DNhTQo14pLuU_tZu',
  projectTrackerItemId: '012IX7LSI5MG6U55XFORBYNJORV3AQLGU7',
  timesheetFolderItemId: '012IX7LSKBTWWE4SJNNFEJGFDOXH3M3Z5B', // 01 - Accounts/DANIEL/Project Tracker (for drawings PDFs / BOM files)

  employees: [], // populated from API at startup

  timeSlots: (() => {
    const slots = [];
    for (let h = 4; h <= 23; h++) {
      for (let m of [0, 30]) {
        const hh = String(h).padStart(2,'0');
        const mm = String(m).padStart(2,'0');
        slots.push({ val: `${hh}:${mm}`, label: `${hh}:${mm}` });
      }
    }
    return slots;
  })()
};

// ═══════════════════════════════════════════
// API LAYER — All data operations go through here
// ═══════════════════════════════════════════
async function apiCall(method, endpoint, body = null, _isRetry = false) {
  const token = await getToken();
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  };
  if (body && method !== 'GET') opts.body = JSON.stringify(body);

  const res = await fetch(`${API_BASE}${endpoint}`, opts);

  if (res.status === 401 && !_isRetry) {
    // Token might be expired — try silent refresh first
    console.warn('API returned 401, attempting silent token refresh');
    sessionStorage.removeItem('bama_token');
    sessionStorage.removeItem('bama_token_expiry');
    try {
      // Try silent login (prompt=none)
      AUTH.login();
      // If we get here, the redirect is happening — wait
      await new Promise(() => {});
    } catch {
      // Silent failed — don't redirect, just throw
      throw new Error('Session expired — please refresh the page');
    }
  }

  if (!res.ok) {
    const errBody = await res.json().catch(() => ({ error: res.statusText }));
    const err = new Error(errBody.error || `API ${method} ${endpoint} failed (${res.status})`);
    err.status = res.status;
    err.body = errBody;
    throw err;
  }

  return res.json();
}

// Convenience wrappers
const api = {
  get:    (endpoint) => apiCall('GET', endpoint),
  post:   (endpoint, body) => apiCall('POST', endpoint, body),
  put:    (endpoint, body) => apiCall('PUT', endpoint, body),
  delete: (endpoint) => apiCall('DELETE', endpoint),
};

// ═══════════════════════════════════════════
// EMPLOYEE NAME ↔ ID MAPPING
// ═══════════════════════════════════════════
// The SQL database uses integer IDs, but the UI was built around employee names.
// These helpers bridge the gap during migration.
const _empNameToId = {};
const _empIdToName = {};

function buildEmployeeMaps() {
  // Clear existing maps
  for (const k in _empNameToId) delete _empNameToId[k];
  for (const k in _empIdToName) delete _empIdToName[k];
  // Build from current state
  (state.timesheetData.employees || []).forEach(emp => {
    _empNameToId[emp.name] = emp.id;
    _empIdToName[emp.id] = emp.name;
  });
}

function empIdByName(name) {
  return _empNameToId[name] || null;
}

function empNameById(id) {
  return _empIdToName[id] || null;
}

// ═══════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════
let state = {
  projects: [],       // { id, name, status } — from PROJECT TRACKER.xlsx
  timesheetData: {    // populated from SQL API at startup
    employees: [],    // { id, name, pin, rate, staff_type, erp_role, ... }
    entries: [],      // { id, employee_id, employee_name, project_number, hours, date, ... }
    clockings: [],    // { id, employee_id, employee_name, clock_in, clock_out, ... }
    holidays: [],     // { id, employee_id, employee_name, date_from, date_to, ... }
    settings: {}      // { managerPin, payrollEmail, ... }
  },
  currentEmployee: null,
  currentEntries: [],  // unsaved entries for today's session
  currentWeekOffset: 0,
  timesheetItemId: null
};

// ═══════════════════════════════════════════
// GRAPH API HELPERS
// ═══════════════════════════════════════════
async function graphGet(url) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${url}`, {
    headers: { 'Authorization': `Bearer ${await getToken()}` }
  });
  if (!res.ok) throw new Error(`Graph GET failed: ${url} ${res.status}`);
  return res.json();
}

async function graphPut(url, body) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${url}`, {
    method: 'PUT',
    headers: {
      'Authorization': `Bearer ${await getToken()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Graph PUT failed: ${url} ${res.status}`);
  return res.json();
}

async function graphPatch(url, body) {
  const res = await fetch(`https://graph.microsoft.com/v1.0${url}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${await getToken()}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error(`Graph PATCH failed ${res.status}`);
  return res.json();
}

// ═══════════════════════════════════════════
// AUTH — OAuth2 Implicit Flow for Microsoft Graph
// ═══════════════════════════════════════════
const AUTH = {
  clientId: '04b702fd-c53c-4f38-94bc-0334ce91d954',
  tenantId: 'c92626f5-e391-499a-9059-0113bd07da2d',
  redirectUri: 'https://proud-dune-0dee63110.2.azurestaticapps.net',
  scopes: 'https://graph.microsoft.com/Files.ReadWrite https://graph.microsoft.com/Sites.ReadWrite.All https://graph.microsoft.com/Mail.Send',

  getStoredToken() {
    const token = sessionStorage.getItem('bama_token');
    const expiry = parseInt(sessionStorage.getItem('bama_token_expiry') || '0');
    if (token && Date.now() < expiry) return token;
    return null;
  },

  handleRedirect() {
    if (!window.location.hash) return false;
    const params = new URLSearchParams(window.location.hash.replace('#', '?'));
    const token = params.get('access_token');
    const expiresIn = parseInt(params.get('expires_in') || '3600');
    if (token) {
      sessionStorage.setItem('bama_token', token);
      sessionStorage.setItem('bama_token_expiry', (Date.now() + (expiresIn - 60) * 1000).toString());
      window.history.replaceState({}, '', window.location.pathname);
      console.log('Auth: Token received from Microsoft login');

      // If we were redirected here from another page, bounce back
      const returnTo = sessionStorage.getItem('bama_return_page');
      if (returnTo) {
        sessionStorage.removeItem('bama_return_page');
        window.location.href = returnTo;
        return true;
      }
      return true;
    }
    return false;
  },

  login() {
    // Remember which page we're on so we can come back after auth
    sessionStorage.setItem('bama_return_page', window.location.pathname);
    const url = new URL(`https://login.microsoftonline.com/${AUTH.tenantId}/oauth2/v2.0/authorize`);
    url.searchParams.set('client_id', AUTH.clientId);
    url.searchParams.set('response_type', 'token');
    url.searchParams.set('redirect_uri', AUTH.redirectUri);
    url.searchParams.set('scope', AUTH.scopes);
    url.searchParams.set('response_mode', 'fragment');
    url.searchParams.set('nonce', Math.random().toString(36).slice(2));
    url.searchParams.set('prompt', 'none'); // try silent first
    window.location.href = url.toString();
  },

  loginInteractive() {
    // Remember which page we're on so we can come back after auth
    sessionStorage.setItem('bama_return_page', window.location.pathname);
    const url = new URL(`https://login.microsoftonline.com/${AUTH.tenantId}/oauth2/v2.0/authorize`);
    url.searchParams.set('client_id', AUTH.clientId);
    url.searchParams.set('response_type', 'token');
    url.searchParams.set('redirect_uri', AUTH.redirectUri);
    url.searchParams.set('scope', AUTH.scopes);
    url.searchParams.set('response_mode', 'fragment');
    url.searchParams.set('nonce', Math.random().toString(36).slice(2));
    window.location.href = url.toString();
  },

  async getToken() {
    const stored = AUTH.getStoredToken();
    if (stored) return stored;
    // No token — redirect to login
    AUTH.loginInteractive();
    await new Promise(() => {}); // wait for redirect
  }
};

async function getToken() {
  return AUTH.getToken();
}

// ═══════════════════════════════════════════
// DATA LAYER — SQL API
// ═══════════════════════════════════════════

// Normalise API employee row to the shape the UI expects
function normaliseEmployee(row) {
  return {
    id: row.id,
    name: row.name,
    hasPin: !!row.has_pin,
    role: row.erp_role || row.staff_type || 'employee',
    staffType: row.staff_type || 'workshop',
    erpRole: row.erp_role || 'employee',
    payType: row.pay_type || 'payee',
    rate: parseFloat(row.rate) || 0,
    annualDays: parseFloat(row.holiday_entitlement) || 28,
    holidayBalance: parseFloat(row.holiday_balance) || 0,
    carryoverDays: parseFloat(row.carryover_days) || 0,
    startDate: row.start_date ? (typeof row.start_date === 'string' ? row.start_date.split('T')[0] : new Date(row.start_date).toISOString().split('T')[0]) : '',
    active: row.is_active === undefined ? true : !!row.is_active,
    addedAt: row.created_at || new Date().toISOString()
  };
}

// Normalise API amendment row
function normaliseAmendment(row) {
  return {
    id: String(row.id),
    clockingId: String(row.clocking_id),
    employeeName: row.employee_name || empNameById(row.employee_id) || `Employee #${row.employee_id}`,
    employee_id: row.employee_id,
    date: row.clocking_date ? (typeof row.clocking_date === 'string' ? row.clocking_date.split('T')[0] : new Date(row.clocking_date).toISOString().split('T')[0]) : '',
    originalIn:   row.original_in   || null,
    originalOut:  row.original_out  || null,
    requestedIn:  row.requested_in  || null,
    requestedOut: row.requested_out || null,
    reason: row.reason || '',
    status: row.status || 'pending',
    resolvedBy: row.resolved_by || null,
    resolvedAt: row.resolved_at || null,
    submittedAt: row.submitted_at || new Date().toISOString()
  };
}

// Normalise API clocking row to the shape the UI expects
function normaliseClocking(row) {
  const clockIn = row.clock_in ? new Date(row.clock_in) : null;
  const clockOut = row.clock_out ? new Date(row.clock_out) : null;
  // approvalStatus only applies to amended clockings.
  //   is_amended = 0                  -> null  (original kiosk entry, nothing to approve)
  //   is_amended = 1, is_approved = 1 -> 'approved'
  //   is_amended = 1, is_approved = 0 -> 'pending'
  let approvalStatus = null;
  if (row.is_amended) approvalStatus = row.is_approved ? 'approved' : 'pending';
  // .date is the calendar day the shift STARTED, in local (browser) time.
  // dateStr() now uses local parts so this works even for early-AM clock-ins
  // (e.g. Mon 00:30 BST). Overnight shifts (e.g. Mon 17:00 -> Tue 02:00) are
  // anchored to the clock-in date by design — the whole shift is a "Monday
  // shift" for the purposes of project hours, S000 and payroll.
  return {
    id: row.id,
    employeeName: row.employee_name || empNameById(row.employee_id) || `Employee #${row.employee_id}`,
    employee_id: row.employee_id,
    date: clockIn ? dateStr(clockIn) : '',
    clockIn: clockIn ? `${String(clockIn.getHours()).padStart(2,'0')}:${String(clockIn.getMinutes()).padStart(2,'0')}` : null,
    clockOut: clockOut ? `${String(clockOut.getHours()).padStart(2,'0')}:${String(clockOut.getMinutes()).padStart(2,'0')}` : null,
    breakMins: row.break_mins || 0,
    source: row.source || 'kiosk',
    addedByManager: row.source === 'manual',
    manuallyEdited: !!row.is_amended,
    approvalStatus,
    approvedBy: row.approved_by || null,
    _raw: row // keep raw data for API updates
  };
}

// Normalise API project hours row
function normaliseEntry(row) {
  return {
    id: row.id,
    employeeName: row.employee_name || empNameById(row.employee_id) || `Employee #${row.employee_id}`,
    employee_id: row.employee_id,
    projectId: row.project_number,
    projectName: row.project_name || row.project_number,
    hours: parseFloat(row.hours) || 0,
    date: row.date ? (typeof row.date === 'string' ? row.date.split('T')[0] : new Date(row.date).toISOString().split('T')[0]) : '',
    status: row.is_approved ? 'approved' : 'pending',
    is_approved: !!row.is_approved,
    week_commencing: row.week_commencing,
    submittedAt: row.created_at || new Date().toISOString(),
    // Edit-audit fields (added via add-projecthours-edit-audit.sql)
    editReason: row.edit_reason || null,
    editedAt:   row.edited_at   || null,
    editedBy:   row.edited_by   || null,
    manuallyEdited: !!row.edit_reason || !!row.edited_at
  };
}

// Trigger a server-side recompute of an employee's S000 (Unproductive Time)
// for a given date and patch local state with the result. The server is the
// sole source of truth for S000 — see /api/project-hours/recompute-s000.
//
// Safe to call on any path that mutates a clocking row, a project-hours row,
// or a date's break_mins, including paths where there's no clock-out yet
// (the endpoint no-ops in that case and clears any stale S000 row).
//
// Failures are non-fatal: log a warning and carry on. The next mutation on
// that day will retry.
async function recomputeS000Local(empName, date) {
  if (!empName || !date) return;
  const empId = empIdByName(empName);
  if (!empId) return;
  try {
    const recompute = await api.post('/api/project-hours/recompute-s000', {
      employee_id: empId,
      date
    });
    // Drop any local S000 row for that emp+date and replace with the
    // server result (if any).
    state.timesheetData.entries = (state.timesheetData.entries || []).filter(
      e => !(e.employeeName === empName && e.date === date && e.projectId === 'S000')
    );
    if (recompute && recompute.entry) {
      state.timesheetData.entries.push(normaliseEntry({
        ...recompute.entry,
        employee_name: empName,
        project_name: 'Unproductive Time'
      }));
    }
  } catch (e) {
    console.warn(`S000 recompute failed for ${empName} on ${date}:`, e.message);
  }
}

// Normalise API holiday row
function normaliseHoliday(row) {
  const decidedAt = row.decided_at || null;
  const status = row.status || 'pending';
  return {
    id: row.id,
    employeeName: row.employee_name || empNameById(row.employee_id) || `Employee #${row.employee_id}`,
    employee_id: row.employee_id,
    dateFrom: row.date_from ? (typeof row.date_from === 'string' ? row.date_from.split('T')[0] : new Date(row.date_from).toISOString().split('T')[0]) : '',
    dateTo: row.date_to ? (typeof row.date_to === 'string' ? row.date_to.split('T')[0] : new Date(row.date_to).toISOString().split('T')[0]) : '',
    type: row.type || 'paid',
    reason: row.reason || '',
    status,
    workingDays: row.working_days || 0,
    submittedAt: row.submitted_at || new Date().toISOString(),
    decidedAt,
    // Populated based on status — checkHolidayClockInNotification reads these
    approvedAt: status === 'approved' ? decidedAt : null,
    rejectedAt: status === 'rejected' ? decidedAt : null,
    // notification_seen tracks whether the employee has already dismissed
    // the approval/rejection popup. Defaults to true server-side for older
    // rows (so existing approved/rejected holidays don't suddenly trigger).
    notificationSeen: row.notification_seen === undefined ? true : !!row.notification_seen
  };
}

async function loadTimesheetData() {
  // Load employees, clockings, project hours, holidays, settings, amendments in parallel from API
  const [employees, clockings, entries, holidays, settings, amendments] = await Promise.all([
    api.get('/api/employees?all=true').catch(e => { console.warn('Employee load failed:', e.message); return []; }),
    api.get('/api/clockings').catch(e => { console.warn('Clockings load failed:', e.message); return []; }),
    api.get('/api/project-hours').catch(e => { console.warn('Project hours load failed:', e.message); return []; }),
    api.get('/api/holidays').catch(e => { console.warn('Holidays load failed:', e.message); return []; }),
    api.get('/api/settings').catch(e => { console.warn('Settings load failed:', e.message); return {}; }),
    api.get('/api/amendments').catch(e => { console.warn('Amendments load failed:', e.message); return []; }),
  ]);

  // Normalise employees first (needed for name lookups)
  state.timesheetData.employees = (Array.isArray(employees) ? employees : []).map(normaliseEmployee);
  buildEmployeeMaps();

  // Now normalise the rest (they can use empNameById)
  state.timesheetData.clockings = (Array.isArray(clockings) ? clockings : []).map(normaliseClocking);
  state.timesheetData.entries = (Array.isArray(entries) ? entries : []).map(normaliseEntry);
  state.timesheetData.holidays = (Array.isArray(holidays) ? holidays : []).map(normaliseHoliday);
  state.timesheetData.settings = (settings && typeof settings === 'object') ? settings : {};
  state.timesheetData.amendments = (Array.isArray(amendments) ? amendments : []).map(normaliseAmendment);

  console.log(`API loaded: ${state.timesheetData.employees.length} employees, ${state.timesheetData.clockings.length} clockings, ${state.timesheetData.entries.length} entries, ${state.timesheetData.holidays.length} holidays, ${state.timesheetData.amendments.length} amendments`);
}

// saveTimesheetData is NO LONGER USED — each action calls its own API endpoint.
// This stub exists only to catch any missed call sites during migration.
async function saveTimesheetData() {
  console.warn('saveTimesheetData() called — this is a migration stub. The caller should use a targeted API endpoint instead.');
  console.trace('saveTimesheetData caller');
}

// ═══════════════════════════════════════════
// LOAD PROJECTS FROM PROJECT TRACKER + SQL
// ═══════════════════════════════════════════
// During the migration from PROJECT TRACKER.xlsx → SQL Projects table, this
// function reads from BOTH sources and merges them. SQL is treated as canonical;
// spreadsheet entries are kept for projects not yet in SQL. Dedupe is by
// project_number (case-insensitive).
async function loadProjects() {
  // Kick off SQL load in parallel — it doesn't depend on Graph
  const sqlPromise = api.get('/api/projects')
    .then(rows => Array.isArray(rows) ? rows : [])
    .catch(e => { console.warn('SQL projects load failed (non-fatal):', e.message); return []; });

  try {
    const token = await getToken();

    // Get worksheets
    const wsRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${CONFIG.driveId}/items/${CONFIG.projectTrackerItemId}/workbook/worksheets`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (!wsRes.ok) throw new Error(`Worksheets fetch failed: ${wsRes.status}`);
    const wsData = await wsRes.json();

    // Find the Hours Summary or Projects sheet — it has the Status column
    const sheet = wsData.value.find(s =>
      s.name.toLowerCase().includes('hour') ||
      s.name.toLowerCase() === 'projects' ||
      (s.name.toLowerCase().includes('project') && !s.name.toLowerCase().includes('detail'))
    ) || wsData.value[0];

    // Read the sheet data
    const rangeRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${CONFIG.driveId}/items/${CONFIG.projectTrackerItemId}/workbook/worksheets/${encodeURIComponent(sheet.name)}/usedRange`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (!rangeRes.ok) throw new Error(`Range fetch failed: ${rangeRes.status}`);
    const rangeData = await rangeRes.json();

    parseProjectsFromRange(rangeData.values || []);

    if (state.projects.length === 0) {
      console.warn('No In Progress projects found in sheet, trying all sheets...');
      // Try other sheets
      for (const s of wsData.value) {
        if (s.name === sheet.name) continue;
        try {
          const r2 = await fetch(
            `https://graph.microsoft.com/v1.0/drives/${CONFIG.driveId}/items/${CONFIG.projectTrackerItemId}/workbook/worksheets/${encodeURIComponent(s.name)}/usedRange`,
            { headers: { 'Authorization': `Bearer ${token}` } }
          );
          if (!r2.ok) continue;
          const d2 = await r2.json();
          parseProjectsFromRange(d2.values || []);
          if (state.projects.length > 0) break;
        } catch {}
      }
    }

  } catch (e) {
    console.warn('Live project load failed, using fallback:', e.message);
    state.projects = FALLBACK_PROJECTS.filter(p => p.status === 'In Progress');
    if (!state.projects.length) state.projects = FALLBACK_PROJECTS;
  }

  // Merge SQL projects on top — SQL is canonical
  try {
    const sqlProjects = await sqlPromise;
    if (sqlProjects.length) {
      const seen = new Set(state.projects.map(p => String(p.id || '').toUpperCase()));
      const sqlMapped = sqlProjects
        .filter(p => p.status === 'In Progress')
        .map(p => ({
          id: p.project_number,
          name: p.project_name,
          status: p.status,
          client: p.company_name || ''
        }))
        .filter(p => !seen.has(String(p.id).toUpperCase()));
      if (sqlMapped.length) {
        state.projects = [...sqlMapped, ...state.projects];
        console.log(`Projects merged: +${sqlMapped.length} from SQL`);
      }
    }
  } catch (e) {
    console.warn('SQL merge failed (non-fatal):', e.message);
  }
}

function parseProjectsFromRange(rows) {
  const projects = [];
  let idCol = -1, nameCol = -1, statusCol = -1, clientCol = -1;

  // Find header row
  for (let r = 0; r < Math.min(rows.length, 10); r++) {
    const row = rows[r].map(c => String(c).toLowerCase().trim());
    const iIdx = row.findIndex(c => c.includes('project id') || c === 'id');
    const nIdx = row.findIndex(c => c.includes('project name') || c === 'name');
    const sIdx = row.findIndex(c => c === 'status');
    const cIdx = row.findIndex(c => c.includes('client') || c.includes('customer'));
    if (iIdx >= 0 && nIdx >= 0) {
      idCol = iIdx; nameCol = nIdx; statusCol = sIdx; clientCol = cIdx;
      break;
    }
  }

  for (let r = 1; r < rows.length; r++) {
    const id = String(rows[r][idCol >= 0 ? idCol : 0] || '').trim();
    const name = String(rows[r][nameCol >= 0 ? nameCol : 1] || '').trim();
    const status = statusCol >= 0 ? String(rows[r][statusCol] || '').trim() : '';
    const client = clientCol >= 0 ? String(rows[r][clientCol] || '').trim() : '';

    if (!id || !/^S\d{3,}/i.test(id)) continue;

    if (status.toLowerCase() === 'in progress') {
      projects.push({ id, name, status, client });
    }
  }

  // If no In Progress found, fall back to all projects with IDs
  if (projects.length === 0) {
    for (let r = 1; r < rows.length; r++) {
      const id = String(rows[r][idCol >= 0 ? idCol : 0] || '').trim();
      const name = String(rows[r][nameCol >= 0 ? nameCol : 1] || '').trim();
      const client = clientCol >= 0 ? String(rows[r][clientCol] || '').trim() : '';
      if (id && /^S\d{3,}/i.test(id) && name) {
        projects.push({ id, name, status: 'Unknown', client });
      }
    }
  }

  state.projects = projects.length > 0 ? projects : FALLBACK_PROJECTS;
  console.log(`Projects loaded: ${state.projects.length} In Progress`);
}

// Fallback project list (from what we read from the tracker)
const FALLBACK_PROJECTS = [
  { id: 'S1901', name: 'Essex - Grill', status: 'Active' },
  { id: 'S1903', name: 'Hethersett Canopies', status: 'Active' },
  { id: 'S1904', name: 'Belfast Road', status: 'Active' },
  { id: 'S1905', name: 'Fairview', status: 'Active' },
  { id: 'S1906', name: 'Windpost', status: 'Active' },
  { id: 'S1907', name: 'Essex Stairs', status: 'Active' },
  { id: 'S1908', name: 'DS Developments', status: 'Active' },
  { id: 'S1909', name: 'Harrow School', status: 'Active' },
  { id: 'S1910', name: 'Palmerston Road', status: 'Active' },
  { id: 'S1911', name: 'Ben-Stairs', status: 'Active' },
  { id: 'S1912', name: 'Valour General Conversions', status: 'Active' },
  { id: 'S1913', name: 'Valour General Conversions', status: 'Active' },
  { id: 'S1914', name: 'Devonport Ph1 Temporary Works', status: 'Active' },
  { id: 'S1915', name: 'Screwfix Goalpost', status: 'Active' },
  { id: 'S1916', name: 'Eyebrook Gardens', status: 'Active' },
  { id: 'S1917', name: 'Sally Tomlinson', status: 'Active' },
  { id: 'S1918', name: '7 Cross Lane', status: 'Active' },
  { id: 'S1919', name: 'BBC', status: 'Active' },
  { id: 'S1920', name: 'Pembroke College', status: 'Active' },
  { id: 'S1921', name: 'Narayan T', status: 'Active' },
  { id: 'S1922', name: "St Paul's Girls School", status: 'Active' },
  { id: 'S1923', name: 'Stoneguard', status: 'Active' },
  { id: 'S1924', name: 'QLCH / Mary Wing', status: 'Active' },
  { id: 'S1925', name: 'Thomas School', status: 'Active' },
  { id: 'S1926', name: 'Needhams Contracts', status: 'Active' },
  { id: 'S1927', name: 'West Barn / Michael McDermid', status: 'Active' },
  { id: 'S1928', name: 'Manor High Sports Hall', status: 'Active' },
  { id: 'S1929', name: 'FPF Kentish Town', status: 'Active' },
  { id: 'S1930', name: 'Mill Barn', status: 'Active' },
  { id: 'S1931', name: 'Junction 17 / Trolleys', status: 'Active' },
  { id: 'S1932', name: 'FPF Slippers Place London', status: 'Active' },
  { id: 'S1933', name: 'Hertford Balustrades', status: 'Active' },
  { id: 'S1940', name: 'Virtue Staircase', status: 'Active' },
  { id: 'S1941', name: 'Gosling Racing', status: 'Active' },
  { id: 'S1944', name: 'Drakes Wall / Devonport', status: 'Active' },
  { id: 'S1945', name: 'Pentaco Shoreline Plates', status: 'Active' },
  { id: 'S1946', name: 'Saddlebank', status: 'Active' },
  { id: 'S1947', name: 'Chris Ord', status: 'Active' },
  { id: 'S1948', name: 'Mike Thomas', status: 'Active' },
  { id: 'S1949', name: 'Duct Alterations', status: 'Active' },
  { id: 'S1952', name: 'Gorton Market', status: 'Active' },
  { id: 'S1953', name: 'Bama Office Extension', status: 'Active' },
  { id: 'S1954', name: 'Earls Burton', status: 'Active' },
  { id: 'S1956', name: 'Christ College', status: 'Active' },
  { id: 'S1957', name: 'Multifab', status: 'Active' },
  { id: 'S1958', name: 'Corby Single Spine Staircase', status: 'Active' },
  { id: 'S1959', name: 'Orton Southgate', status: 'Active' },
  { id: 'S1961', name: 'Lifting Beam', status: 'Active' },
  { id: 'S1962', name: 'Alconbury / Orton Winstow', status: 'Active' },
  { id: 'S1963', name: 'Georgian House', status: 'Active' },
  { id: 'S1964', name: '9 Jones Hill Steelwork', status: 'Active' },
  { id: 'S1965', name: 'Brookhurst Farm', status: 'Active' },
  { id: 'S1966', name: 'Essex Projects Balustrades', status: 'Active' },
  { id: 'S1968', name: '12 Ash Grove', status: 'Active' },
  { id: 'S1969', name: 'Linford Wood Place Conversion - Steelwork', status: 'Active' },
  { id: 'S1977', name: '5 Basin', status: 'Active' }
];

// ═══════════════════════════════════════════
// WRITE APPROVED HOURS TO LABOUR LOG
// ═══════════════════════════════════════════
async function writeApprovedToLabourLog(entries) {
  try {
    setLoading(true);
    const token = await getToken();

    // Find the Labour Log sheet
    const wsRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${CONFIG.driveId}/items/${CONFIG.projectTrackerItemId}/workbook/worksheets`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const wsData = await wsRes.json();
    const labourSheet = wsData.value.find(s =>
      s.name.toLowerCase().includes('labour') || s.name.toLowerCase().includes('labor')
    );

    if (!labourSheet) {
      toast('Could not find Labour Log sheet in PROJECT TRACKER', 'error');
      return false;
    }

    const sheetName = encodeURIComponent(labourSheet.name);

    // Read the Labour Log sheet to find the first empty row starting from row 5
    // We read column A from row 5 downwards to find empty cells before TOTALS
    const rangeRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${CONFIG.driveId}/items/${CONFIG.projectTrackerItemId}/workbook/worksheets/${sheetName}/range(address='A5:A1000')`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const rangeData = await rangeRes.json();
    const colA = rangeData.values || [];

    // Find first empty row in column A (that isn't the TOTALS row)
    let insertRow = 5;
    for (let i = 0; i < colA.length; i++) {
      const cellVal = String(colA[i][0] || '').trim().toUpperCase();
      if (cellVal === '' || cellVal === '0') {
        insertRow = 5 + i;
        break;
      }
      // Stop if we hit TOTALS
      if (cellVal === 'TOTALS') break;
    }

    // Write each entry one by one into consecutive empty rows
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const row = insertRow + i;
      // Write A-E only (date, projectId, projectName, employeeName, hours)
      // Columns F (Rate) and G (Cost) are left alone — they have spreadsheet formulas
      const rangeAddr = `A${row}:E${row}`;
      const rowData = [[
        e.date,
        e.projectId,
        e.projectName,
        e.employeeName,
        e.hours
      ]];

      // Write notes to column H separately
      await fetch(
        `https://graph.microsoft.com/v1.0/drives/${CONFIG.driveId}/items/${CONFIG.projectTrackerItemId}/workbook/worksheets/${sheetName}/range(address='H${row}')`,
        {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [['Timesheet App']] })
        }
      );

      await fetch(
        `https://graph.microsoft.com/v1.0/drives/${CONFIG.driveId}/items/${CONFIG.projectTrackerItemId}/workbook/worksheets/${sheetName}/range(address='${rangeAddr}')`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ values: rowData })
        }
      );
    }

    return true;
  } catch (e) {
    console.error('writeApprovedToLabourLog error:', e);
    toast(`SharePoint sync error: ${e.message}`, 'error');
    return false;
  } finally {
    setLoading(false);
  }
}

// ═══════════════════════════════════════════
// WRITE UNPRODUCTIVE TIME TO SEPARATE SHEET
// ═══════════════════════════════════════════
async function writeUnproductiveTimeLog(entries) {
  try {
    const token = await getToken();
    const baseUrl = `https://graph.microsoft.com/v1.0/drives/${CONFIG.driveId}/items/${CONFIG.projectTrackerItemId}/workbook`;
    const sheetName = 'Unproductive%20Time';

    // Find first empty row (starting from row 4)
    const rangeRes = await fetch(
      `${baseUrl}/worksheets/${sheetName}/range(address='A5:A500')`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const rangeData = await rangeRes.json();
    const colA = rangeData.values || [];

    let insertRow = 5;
    for (let i = 0; i < colA.length; i++) {
      if (!String(colA[i][0] || '').trim()) {
        insertRow = 5 + i;
        break;
      }
    }

    // Write each S000 entry
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const row = insertRow + i;

      // Get clocked hours for this day
      const clocking = state.timesheetData.clockings.find(
        c => c.employeeName === e.employeeName && c.date === e.date && c.clockOut
      );
      const clockedHrs = clocking ? (calcHours(clocking.clockIn, clocking.clockOut, clocking.breakMins, clocking.date) || 0) : 0;
      const projectHrs = clockedHrs - e.hours;

      // Calculate week commencing (Monday)
      const d = new Date(e.date + 'T12:00:00');
      const dow = d.getDay();
      const mon = new Date(d);
      mon.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
      const weekCommencing = dateStr(mon);

      await fetch(
        `${baseUrl}/worksheets/${sheetName}/range(address='A${row}:G${row}')`,
        {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ values: [[
            e.date,
            e.employeeName,
            clockedHrs,
            parseFloat(projectHrs.toFixed(2)),
            e.hours,
            weekCommencing,
            'Timesheet App'
          ]] })
        }
      );
    }
    return true;
  } catch (e) {
    console.error('Unproductive time log write failed:', e.message);
    return false;
  }
}

// ═══════════════════════════════════════════
// WEEK HELPERS
// ═══════════════════════════════════════════
function getWeekDates(offset = 0) {
  const now = new Date();
  const day = now.getDay();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (day === 0 ? 6 : day - 1) + offset * 7);
  const sun = new Date(mon);
  sun.setDate(mon.getDate() + 6);
  return { mon, sun };
}

// Stringify a Date as YYYY-MM-DD using LOCAL time. Using toISOString().slice
// would give the UTC date, which drifts off the local calendar at midnight
// in BST (00:30 BST = 23:30 UTC the previous day). Every caller in this
// file passes a locally-constructed Date (new Date(), new Date(yyyy,mm,dd),
// or copies thereof), so this stays correct in all cases.
function dateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function fmtDate(d) {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Format a YYYY-MM-DD string to DD/MM/YYYY for display
function fmtDateStr(ds) {
  if (!ds || ds.length < 10) return ds || '';
  const [y, m, d] = ds.split('-');
  return `${d}/${m}/${y}`;
}

function todayStr() { return dateStr(new Date()); }

// Resolve the calendar date "this shift belongs to" for a given employee.
//   - If the employee has an OPEN clocking, return that clocking's date
//     (the shift's start date, even if we've crossed midnight).
//   - Otherwise return today's date.
//
// Used wherever the kiosk needs to filter "today's entries" or "today's
// clocking" — keeps overnight shifts (e.g. Mon 17:00 -> Tue 02:00) anchored
// to the clock-in date instead of jumping forward at midnight.
function activeShiftDate(employeeName) {
  if (employeeName) {
    const open = (state.timesheetData.clockings || []).find(
      c => c.employeeName === employeeName && !c.clockOut
    );
    if (open && open.date) return open.date;
  }
  return todayStr();
}

// ═══════════════════════════════════════════
// EMPLOYEE HOME
// ═══════════════════════════════════════════
function renderHome() {
  const grid = document.getElementById('employeeGrid');
  if (!grid) return; // not on kiosk page
  const today = todayStr();
  grid.innerHTML = '';

  const empList = (state.timesheetData.employees || [])
    .filter(e => e.active !== false)
    .filter(e => (e.staffType || 'workshop') === 'workshop')
    .map(e => e.name);

  if (!empList.length) {
    grid.innerHTML = '<div class="empty-state" style="padding:40px"><div class="icon" style="font-size:32px;margin-bottom:12px">&#128101;</div><div>No employees set up yet.</div><div style="margin-top:8px;font-size:12px">Go to Manager &#8594; Staff to add your team.</div></div>';
    return;
  }

  empList.forEach(name => {
    // Open shift = no clock_out yet. Don't filter by date — overnight shifts
    // (started yesterday, still ongoing) must still light up the green
    // "clocked-in" indicator.
    const clocking = state.timesheetData.clockings.find(
      c => c.employeeName === name && !c.clockOut
    );
    const initials = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    const colors = ['#ff6b00','#e05d00','#c84b00','#a83e00','#ff8c42','#f07030'];

    // Check holiday status — must be declared before use in col
    const isOnHoliday = (state.timesheetData.holidays || []).some(h =>
      h.employeeName === name && h.status === 'approved' &&
      h.dateFrom <= today && h.dateTo >= today
    );
    // Check clocked out today
    const clockedOutToday = state.timesheetData.clockings.find(
      c => c.employeeName === name && c.date === today && c.clockOut
    );

    const col = isOnHoliday ? '#ff69b4' : clocking ? '#3ecf8e' : clockedOutToday ? '#ff4444' : colors[name.charCodeAt(0) % colors.length];

    const div = document.createElement('div');
    div.className = 'emp-btn' + (clocking ? ' clocked-in' : '');

    if (isOnHoliday) {
      div.style.borderColor = '#ff69b4';
      div.style.background = 'rgba(255,105,180,.08)';
    } else if (clocking) {
      // Currently clocked in — green
      div.style.borderColor = 'var(--green)';
      div.style.background = 'rgba(62,207,142,.08)';
    } else if (clockedOutToday) {
      // Clocked out today — red
      div.style.borderColor = 'var(--red)';
      div.style.background = 'rgba(255,68,68,.08)';
    }
    div.innerHTML = `
      <div class="emp-avatar" style="background:linear-gradient(135deg,${col},${isOnHoliday?'#8b0057':clockedOutToday?'#7a0000':'#3e1a00'})">${initials}</div>
      <div class="emp-name">${name}</div>
      <div class="emp-status ${clocking ? 'in' : ''}">
        ${isOnHoliday
          ? '🌴 On Holiday'
          : clocking
          ? `<span class="status-dot"></span>In since ${clocking.clockIn}`
          : clockedOutToday
          ? `✓ Clocked out ${clockedOutToday.clockOut}`
          : 'Not clocked in'}
      </div>
    `;
    div.onclick = () => openEmployee(name);
    grid.appendChild(div);
  });

  // Load workshop notifications (assembly tasks, etc.)
  if (CURRENT_PAGE === 'index') renderWorkshopNotifications();
}

// ── Workshop Kiosk Notifications ──
function renderWorkshopNotifications() {
  const container = document.getElementById('workshopNotifications');
  if (!container) return;

  // Load drawings data in background if not already loaded
  if (!Object.keys(drawingsData.projects || {}).length) {
    loadDrawingsData().then(() => _renderWorkshopNotifs(container)).catch(() => {});
    return;
  }
  _renderWorkshopNotifs(container);
}

function _renderWorkshopNotifs(container) {
  // Scan all projects/jobs for open assembly tasks
  const notifications = [];

  for (const projId of Object.keys(drawingsData.projects || {})) {
    const projData = drawingsData.projects[projId];
    const proj = state.projects?.find(p => p.id === projId);
    const projName = proj ? `${proj.id} — ${proj.name}` : projId;
    for (const job of (projData.jobs || [])) {
      if (job.status === 'closed') continue;
      for (const task of (job.assembly?.tasks || [])) {
        if (task.status === 'complete') continue;
        const created = new Date(task.createdAt).getTime();
        const isNew = created > (Date.now() - 48 * 60 * 60 * 1000);
        notifications.push({
          type: 'assembly',
          projectId: projId,
          project: projName,
          jobId: job.id,
          job: job.name,
          task: task.name,
          finishing: task.finishing,
          createdAt: task.createdAt,
          isNew
        });
      }
    }
  }

  if (!notifications.length) { container.innerHTML = ''; return; }

  // Sort newest first
  notifications.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  const newCount = notifications.filter(n => n.isNew).length;

  let html = '';
  html += `<div style="font-size:13px;font-weight:600;margin-bottom:8px;display:flex;align-items:center;gap:8px">`;
  html += `<span>&#128295; Workshop Tasks</span>`;
  html += `<span style="background:var(--accent);color:#fff;font-size:10px;padding:2px 8px;border-radius:10px;font-weight:700">${notifications.length}</span>`;
  if (newCount) html += `<span style="font-size:11px;color:var(--green);font-weight:500">${newCount} new</span>`;
  html += `</div>`;

  for (const n of notifications) {
    const age = timeAgo(n.createdAt);
    const finLabel = n.finishing && n.finishing !== 'none' ? ` · ${n.finishing}` : '';
    const borderColor = n.isNew ? 'var(--accent)' : 'var(--border)';
    const deepLink = `projects.html?project=${encodeURIComponent(n.projectId)}&job=${encodeURIComponent(n.jobId)}&element=Assembly`;
    html += `<a href="${deepLink}" style="text-decoration:none;color:inherit;display:block">`;
    html += `<div class="notification-banner" style="cursor:pointer;margin-bottom:8px;text-align:left;border-left:3px solid ${borderColor}">`;
    html += `<span class="nb-icon">${n.isNew ? '&#128312;' : '&#128295;'}</span>`;
    html += `<span class="nb-text"><b>${n.isNew ? 'NEW: ' : ''}${n.task}</b>${finLabel}<br><span style="font-size:11px;color:var(--subtle)">${n.project} · ${n.job} · ${age}</span></span>`;
    html += `<span style="font-size:11px;color:var(--accent);margin-left:auto;padding-left:8px">View &rarr;</span>`;
    html += `</div></a>`;
  }
  container.innerHTML = html;
}

let _pendingEmployee = null;

function openEmployee(name) {
  const emp = (state.timesheetData.employees || []).find(e => e.name === name);

  // If employee has a PIN, show PIN modal first
  if (emp && emp.hasPin) {
    _pendingEmployee = name;
    document.getElementById('empPinModalName').textContent = name;
    document.getElementById('empPinInput').value = '';
    document.getElementById('empPinError').textContent = '';
    document.getElementById('empPinModal').classList.add('active');
    setTimeout(() => document.getElementById('empPinInput').focus(), 100);
    return;
  }

  // No PIN — open directly
  openEmployeePanel(name);
}

async function checkEmpPin() {
  const pin = document.getElementById('empPinInput').value;
  const emp = (state.timesheetData.employees || []).find(e => e.name === _pendingEmployee);

  if (!emp) return;

  let result;
  try {
    result = await api.post('/api/auth/verify-pin', { employee_id: emp.id, pin });
  } catch (err) {
    document.getElementById('empPinError').textContent = 'Verification failed — try again';
    return;
  }

  if (result && result.valid) {
    closeEmpPinModal();
    openEmployeePanel(emp.name);
  } else {
    document.getElementById('empPinError').textContent = (result && result.reason) || 'Incorrect PIN — try again';
    document.getElementById('empPinInput').value = '';
    document.getElementById('empPinInput').focus();
  }
}

function closeEmpPinModal() {
  document.getElementById('empPinModal').classList.remove('active');
  _pendingEmployee = null;
}

function openEmployeePanel(name) {
  state.currentEmployee = name;
  state.currentEntries = [];

  document.getElementById('empPanelName').textContent = name;

  // Show holiday approval/rejection notifications immediately on entry
  checkHolidayClockInNotification(name);

  // Set today's date as shift card title
  const shiftLabel = document.getElementById('shiftDateLabel');
  if (shiftLabel) {
    shiftLabel.textContent = new Date().toLocaleDateString('en-GB', {
      weekday: 'long', day: 'numeric', month: 'long'
    });
  }

  // Always show project time card — employees may log hours before or after clocking out
  const projectCard = document.getElementById('projectTimeCard');
  if (projectCard) projectCard.style.display = '';

  // Time selects
  fillTimeSelects();

  // Render My Week
  renderMyWeek(name);

  // Render Last Week Review (final chance to flag issues before payroll).
  // Async — checks payroll-revisions, may hide the card.
  renderLastWeekReview(name);

  // Render holiday balance
  renderEmpHolidayBalance(name);

  // Render booked/approved/declined holidays (excludes sick + unpaid)
  renderMyHolidays(name);

  // Reload projects live from PROJECT TRACKER in background
  loadProjects().then(() => {
    // Refresh the project dropdown if already on screen
    const sel = document.getElementById('projectSelect');
    if (sel) {
      sel.innerHTML = '<option value="">Select project…</option>';
      // Always add Workshop General Duties at the top
      const wgdOpt = document.createElement('option');
      wgdOpt.value = 'WGD';
      wgdOpt.textContent = '🔧 Workshop General Duties';
      sel.appendChild(wgdOpt);
      state.projects.forEach(p => {
        const opt = document.createElement('option');
        opt.value = p.id;
        opt.textContent = `${p.id} — ${p.name}`;
        sel.appendChild(opt);
      });
    }
  }).catch(() => {});

  // Check clocked in. Don't filter by date — overnight shifts started
  // yesterday must still show the "clocked in" UI today.
  const clocking = state.timesheetData.clockings.find(
    c => c.employeeName === name && !c.clockOut
  );

  if (clocking) {
    showClockedIn(clocking);
  } else {
    document.getElementById('clockInSection').style.display = '';
    document.getElementById('clockedInSection').style.display = 'none';
    document.getElementById('statusBar').style.display = 'none';
  }

  // Populate project select
  const sel = document.getElementById('projectSelect');
  sel.innerHTML = '<option value="">Select project…</option>';
  // WGD goes first so it's always available even if SharePoint projects fail to load
  const wgdOpt = document.createElement('option');
  wgdOpt.value = 'WGD';
  wgdOpt.textContent = '🔧 Workshop General Duties';
  sel.appendChild(wgdOpt);
  state.projects.forEach(p => {
    const opt = document.createElement('option');
    opt.value = p.id;
    opt.textContent = `${p.id} — ${p.name}`;
    sel.appendChild(opt);
  });

  // Load today's already-submitted entries
  renderTodayEntries();

  showScreen('screenEmployee');
}

function showClockedIn(clocking) {
  document.getElementById('clockInSection').style.display = 'none';
  document.getElementById('clockedInSection').style.display = '';
  document.getElementById('displayClockIn').textContent = clocking.clockIn;
  document.getElementById('statusBar').style.display = 'flex';
  document.getElementById('statusClockIn').textContent = clocking.clockIn;
  updateWorkingTime(clocking.clockIn);
}

let workingTimer = null;
function updateWorkingTime(clockInStr) {
  clearInterval(workingTimer);
  workingTimer = setInterval(() => {
    const [h, m] = clockInStr.split(':').map(Number);
    const start = new Date(); start.setHours(h, m, 0, 0);
    const diff = Math.floor((Date.now() - start) / 1000);
    if (diff < 0) { clearInterval(workingTimer); return; }
    const hrs = Math.floor(diff / 3600);
    const mins = Math.floor((diff % 3600) / 60);
    document.getElementById('statusWorking').textContent = `${hrs}h ${mins}m`;
  }, 10000);
}

function fillTimeSelects() {
  // Clock in time is now auto-captured — no dropdown to fill
  // Only populate time selects for add-clocking modals that still need them
  ['addClockIn', 'addClockOut', 'mgrClockIn', 'mgrClockOut'].forEach(id => {
    const sel = document.getElementById(id);
    if (sel && sel.tagName === 'SELECT') {
      sel.innerHTML = '';
      CONFIG.timeSlots.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s.val; opt.textContent = s.label;
        sel.appendChild(opt);
      });
    }
  });
}

function onProjectSelect() {
  const id = document.getElementById('projectSelect').value;
  const p = id === 'WGD'
    ? { name: 'Workshop General Duties' }
    : state.projects.find(x => x.id === id);
  document.getElementById('projectNameDisplay').textContent = p ? p.name : '—';
}

function addEntry() {
  const projId = document.getElementById('projectSelect').value;
  const hours = parseFloat(document.getElementById('hoursInput').value);

  if (!projId) { toast('Please select a project', 'error'); return; }
  if (!hours || hours <= 0) { toast('Please enter valid hours', 'error'); return; }

  const proj = projId === 'WGD'
    ? { id: 'WGD', name: 'Workshop General Duties' }
    : state.projects.find(p => p.id === projId);
  state.currentEntries.push({
    id: Date.now().toString(),
    projectId: projId,
    projectName: proj ? proj.name : projId,
    hours
  });

  document.getElementById('hoursInput').value = '';
  document.getElementById('projectSelect').value = '';
  document.getElementById('projectNameDisplay').textContent = '—';
  renderTodayEntries();
}

function removeEntry(id) {
  state.currentEntries = state.currentEntries.filter(e => String(e.id) !== String(id));
  renderTodayEntries();
}

function renderTodayEntries() {
  const container = document.getElementById('todayEntries');
  // If the worker is on an overnight shift, "today's entries" means
  // entries against the shift's start date — not the wall-clock date.
  const shiftDate = activeShiftDate(state.currentEmployee);

  // Submitted entries + current session entries
  const submitted = state.timesheetData.entries.filter(
    e => e.employeeName === state.currentEmployee && e.date === shiftDate
  );

  const all = [
    ...submitted.map(e => ({ ...e, saved: true })),
    ...state.currentEntries.map(e => ({ ...e, saved: false }))
  ];

  if (!all.length) {
    container.innerHTML = '<div class="empty-state" style="padding:20px"><span style="opacity:.4">No entries yet today</span></div>';
    return;
  }

  container.innerHTML = all.map(e => `
    <div class="entry-chip">
      <span class="proj-id">${e.projectId}</span>
      <span class="proj-name">${e.projectName}</span>
      <span class="proj-hrs">${e.hours}h</span>
      ${e.saved
        ? `<span style="font-size:11px;color:var(--muted);margin-left:8px">saved</span>`
        : `<button class="del-btn" onclick="removeEntry('${e.id}')">×</button>`
      }
    </div>
  `).join('');
}

async function doClock(direction) {
  try {
  const today = todayStr();
  const emp = state.currentEmployee;
  if (!emp) { toast('No employee selected', 'error'); return; }
  const empId = empIdByName(emp);
  if (!empId) { toast('Employee not found in system', 'error'); return; }

  if (direction === 'in') {
    // Hard block: workshop is closed on bank holidays.
    // See docs/SPEC-holiday-payroll.md.
    if (isBankHoliday(today)) {
      toast('The workshop is closed today (bank holiday). If this is wrong, speak to the office.', 'error');
      return;
    }

    // Check if already clocked in (local check for instant feedback). Don't
    // filter by date — an open shift from yesterday means the worker forgot
    // to clock out and needs to do that first, otherwise they'd end up with
    // two open shifts.
    const existing = state.timesheetData.clockings.find(
      c => c.employeeName === emp && !c.clockOut
    );
    if (existing) {
      const sameDay = existing.date === today;
      toast(
        sameDay
          ? `${emp} is already clocked in today at ${existing.clockIn}`
          : `${emp} has an open shift from ${fmtDateStr(existing.date)} (clocked in at ${existing.clockIn}). Clock out first.`,
        'error'
      );
      return;
    }

    // Block if already completed a full shift today
    const completedToday = state.timesheetData.clockings.find(
      c => c.employeeName === emp && c.date === today && c.clockOut
    );
    if (completedToday) {
      toast(`${emp} has already clocked in and out today (${completedToday.clockIn} – ${completedToday.clockOut})`, 'error');
      return;
    }

    // Call API
    const result = await api.post('/api/clock-in', {
      employee_id: empId,
      source: 'kiosk'
    });

    // Add to local state
    const newClocking = normaliseClocking(result);
    state.timesheetData.clockings.push(newClocking);

    // Check if they have an approved holiday today
    const hasApprovedHoliday = (state.timesheetData.holidays || []).some(h =>
      h.employeeName === emp && h.status === 'approved' &&
      h.dateFrom <= today && h.dateTo >= today
    );
    if (hasApprovedHoliday) {
      toast(`⚠️ You have approved holiday today — clocking in anyway`, 'info');
    }

    showClockedIn({ clockIn: newClocking.clockIn });
    renderHome();
    toast(`Clocked in at ${newClocking.clockIn}`, 'success');

  } else {
    // CLOCK OUT
    // Find the open shift for this employee. Don't filter by date — overnight
    // shifts (e.g. Mon 17:00 -> Tue 02:00) need to remain closeable after
    // midnight, when today != the clock-in date.
    const clocking = state.timesheetData.clockings.find(
      c => c.employeeName === emp && !c.clockOut
    );
    if (!clocking) { toast('Not clocked in — cannot clock out', 'error'); return; }

    // The shift belongs to its START date. Everything downstream (entry
    // filters, S000 recompute, toast text) is keyed off this, not today.
    const shiftDate = clocking.date;

    const breakEl = document.getElementById('breakDuration');
    let breakMins = breakEl ? (parseInt(breakEl.value) || 30) : 30;

    // Capture exact current time for clock out
    const now = new Date();
    const clockOut = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    // Check if any project hours logged for this shift (excluding S000 and WGD auto entries)
    const allEntries = state.timesheetData.entries || [];
    const currentEntries = state.currentEntries || [];
    const todayProjectHrs = [
      ...allEntries.filter(e => e.employeeName === emp && e.date === shiftDate && e.projectId !== 'S000' && e.projectId !== 'WGD'),
      ...currentEntries.filter(e => e.projectId !== 'S000' && e.projectId !== 'WGD')
    ];
    const todayWGDHrs = [
      ...allEntries.filter(e => e.employeeName === emp && e.date === shiftDate && e.projectId === 'WGD'),
      ...currentEntries.filter(e => e.projectId === 'WGD')
    ];

    if (todayProjectHrs.length === 0 && todayWGDHrs.length === 0) {
      _pendingClockOutData = { emp, today: shiftDate, clockOut, breakMins, clocking };
      const modal = document.getElementById('noProjectModal');
      if (modal) {
        modal.classList.add('active');
      } else {
        toast('Error: noProjectModal not found in page', 'error');
      }
      return;
    }

    await finishClockOut({ emp, today: shiftDate, clockOut, breakMins, clocking });
  }
  } catch (err) {
    console.error('doClock error:', err);
    toast('Clock error: ' + err.message, 'error');
  }
}

// Finalises a clock-out. NOTE: `today` here is the shift's START date
// (clocking.date), NOT necessarily the current calendar date — they differ
// for overnight shifts. Everything keyed off it (S000 recompute, entry
// filters) treats the whole shift as a single logical day anchored to the
// clock-in date.
async function finishClockOut({ emp, today, clockOut, breakMins, clocking }) {
    const empId = empIdByName(emp);

    // Call API to clock out — include break_mins so it persists to DB (was lost on refresh before)
    const result = await api.post('/api/clock-out', {
      employee_id: empId,
      break_mins: breakMins
    });

    // Update local state
    clocking.clockOut = clockOut;
    clocking.breakMins = breakMins;

    // Server-side S000 recompute. The API is the source of truth for
    // unproductive hours: it reads ClockEntries + ProjectHours directly,
    // recomputes, and inserts/deletes the S000 row atomically.
    let unproductiveHrs = 0;
    if (empId) {
      try {
        const empName = emp;
        const recompute = await api.post('/api/project-hours/recompute-s000', {
          employee_id: empId,
          date: today
        });
        unproductiveHrs = (recompute && recompute.hours) || 0;
        // Drop any local S000 for today and replace with the server's result.
        state.timesheetData.entries = state.timesheetData.entries.filter(
          e => !(e.employeeName === empName && e.date === today && e.projectId === 'S000')
        );
        if (recompute && recompute.entry) {
          state.timesheetData.entries.push(normaliseEntry({
            ...recompute.entry,
            employee_name: empName,
            project_name: 'Unproductive Time'
          }));
        }
      } catch (e) {
        console.warn('S000 recompute failed:', e.message);
      }
    }

    // Update UI immediately
    document.getElementById('clockedInSection').style.display = 'none';
    document.getElementById('clockInSection').style.display = '';
    document.getElementById('statusBar').style.display = 'none';
    clearInterval(workingTimer);
    renderHome();

    if (unproductiveHrs > 0) {
      toast(`Clocked out at ${clockOut} · ${unproductiveHrs}h added as Unproductive Time`, 'success');
    } else {
      toast(`Clocked out at ${clockOut}`, 'success');
    }
}

async function submitDay() {
  if (!state.currentEntries.length) {
    toast('No new entries to submit', 'error'); return;
  }
  // For overnight shifts, file entries against the shift's start date, not
  // the wall-clock date at the moment of submit. activeShiftDate falls back
  // to todayStr() if the worker isn't currently clocked in.
  const today = activeShiftDate(state.currentEmployee);
  const empId = empIdByName(state.currentEmployee);
  if (!empId) { toast('Employee not found in system', 'error'); return; }

  // Disable button immediately to prevent double-submission (creates duplicate rows in DB)
  const submitBtn = document.getElementById('submitDayBtn');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.style.opacity = '.5'; submitBtn.style.cursor = 'wait'; }

  try {
    setLoading(true);

    // Submit each entry to the API
    for (const e of state.currentEntries) {
      const result = await api.post('/api/project-hours', {
        employee_id: empId,
        project_number: e.projectId,
        date: today,
        hours: e.hours
      });

      // Add to local state
      state.timesheetData.entries.push(normaliseEntry({
        ...result,
        employee_name: state.currentEmployee,
        project_name: e.projectName
      }));
    }

    state.currentEntries = [];

    // After posting entries, recompute today's S000 server-side. This covers
    // the "log entries first, clock out, THEN submit" sequence: the clock-out
    // recompute saw zero project hours (entries were still in currentEntries
    // locally) and logged the full shift as unproductive. Now that the entries
    // exist in the DB, the recompute will subtract them. Endpoint is no-op /
    // self-clearing if the user isn't clocked out yet for today.
    await recomputeS000Local(state.currentEmployee, today);

    renderTodayEntries();
    toast(`Entries submitted ✓`, 'success');
    setTimeout(goHome, 1500);
  } catch (err) {
    console.error('Submit failed:', err);
    toast('Submit failed — ' + err.message, 'error');
    // Re-enable button on error so user can fix and retry
    if (submitBtn) { submitBtn.disabled = false; submitBtn.style.opacity = '1'; submitBtn.style.cursor = 'pointer'; }
  } finally { setLoading(false); }
}

// ═══════════════════════════════════════════
// MANAGER VIEW
// ═══════════════════════════════════════════
function showManagerAuth() {
  if (CURRENT_PAGE !== 'manager' && CURRENT_PAGE !== 'office') {
    window.location.href = 'manager.html';
    return;
  }
  currentManagerUser = null;
  _pendingManagerUser = null;
  if (CURRENT_PAGE === 'office') {
    showScreen('screenOfficeSelect');
    renderOfficeEmployeeGrid();
  } else {
    showScreen('screenManagerSelect');
    renderManagerEmployeeGrid();
  }
}

function renderManagerEmployeeGrid() {
  const grid = document.getElementById('mgrEmpGrid');
  if (!grid) return;
  const empList = (state.timesheetData.employees || []).filter(e => e.active !== false && (e.staffType || 'workshop') === 'office');

  if (!empList.length) {
    grid.innerHTML = '<div class="empty-state" style="padding:30px"><div style="font-size:28px;margin-bottom:10px">&#128101;</div><div>No office staff set up yet.</div><div style="margin-top:8px;font-size:12px;color:var(--subtle)">Go to Office → Staff to add office employees.</div></div>';
    return;
  }

  grid.innerHTML = empList.map(emp => {
    const ini = (emp.name || '').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    const col = empColor(emp.name);
    return `
      <div class="emp-btn" onclick="selectManagerUser('${emp.name.replace(/'/g, "\\'")}')" style="padding:22px 14px 16px">
        <div class="emp-avatar" style="width:48px;height:48px;font-size:19px;background:linear-gradient(135deg,${col},#3e1a00)">${ini}</div>
        <div class="emp-name" style="font-size:13px">${emp.name}</div>
        <div style="font-size:10px;color:var(--subtle);margin-top:3px">${emp.hasPin ? '&#128274; PIN set' : '&#128275; No PIN'}</div>
      </div>
    `;
  }).join('');
}

function selectManagerUser(name) {
  const emp = (state.timesheetData.employees || []).find(e => e.name === name);
  if (!emp) return;

  if (!emp.hasPin) {
    toast('No PIN set for this user. Set one in Staff management first.', 'error');
    return;
  }

  _pendingManagerUser = name;
  const ini = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const col = empColor(name);

  document.getElementById('mgrPinAvatar').innerHTML = ini;
  document.getElementById('mgrPinAvatar').style.background = `linear-gradient(135deg,${col},#3e1a00)`;
  document.getElementById('mgrPinName').textContent = name;
  document.getElementById('mgrPinInput').value = '';
  document.getElementById('mgrPinError').textContent = '';
  showScreen('screenManagerPin');
  setTimeout(() => document.getElementById('mgrPinInput').focus(), 100);
}

async function checkManagerPin() {
  const pin = document.getElementById('mgrPinInput').value;
  const emp = (state.timesheetData.employees || []).find(e => e.name === _pendingManagerUser);

  if (!emp || !emp.hasPin) {
    document.getElementById('mgrPinError').textContent = 'No PIN set for this user';
    return;
  }

  let result;
  try {
    result = await api.post('/api/auth/verify-pin', { employee_id: emp.id, pin });
  } catch (err) {
    document.getElementById('mgrPinError').textContent = 'Verification failed — try again';
    return;
  }

  if (!result || !result.valid) {
    document.getElementById('mgrPinError').textContent = (result && result.reason) || 'Incorrect PIN';
    document.getElementById('mgrPinInput').value = '';
    return;
  }

  // PIN correct — check permissions
  // BOOTSTRAP: if NO users have ANY permissions yet, grant this user full admin
  const anyoneHasPerms = Object.values(userAccessData.users || {}).some(u =>
    u.permissions && Object.values(u.permissions).some(v => v === true)
  );

  if (!anyoneHasPerms) {
    // First-time setup — auto-grant all permissions to this user
    console.log('Bootstrap: No permissions configured yet — granting full access to', _pendingManagerUser);
    if (!userAccessData.users[_pendingManagerUser]) {
      userAccessData.users[_pendingManagerUser] = { permissions: {} };
    }
    PERMISSION_DEFS.forEach(p => {
      userAccessData.users[_pendingManagerUser].permissions[p.key] = true;
    });
    // Save in background (non-blocking)
    saveUserAccessData().catch(e => console.warn('Bootstrap save failed:', e.message));
    toast('First-time setup — you have been granted full admin access', 'success');
  }

  const perms = getUserPermissions(_pendingManagerUser);
  if (!perms || !hasAnyPermission(_pendingManagerUser)) {
    // No permissions — show access denied
    currentManagerUser = _pendingManagerUser; // store so we know who for the request
    document.getElementById('accessDeniedMsg').textContent =
      `${_pendingManagerUser}, you don't have any manager permissions assigned yet. Contact an admin or request access below.`;
    showScreen('screenAccessDenied');
    return;
  }

  // Has permissions — enter dashboard
  currentManagerUser = _pendingManagerUser;
  sessionStorage.setItem('bama_mgr_authed', currentManagerUser);
  _pendingManagerUser = null;
  document.getElementById('mgrPinInput').value = '';

  // Filter sidebar tabs based on permissions
  filterSidebarTabs(perms);

  showScreen('screenManager');
  // Auto-switch to first allowed tab
  const firstTab = findFirstAllowedTab(perms);
  if (firstTab) switchTab(firstTab);
  renderManagerView();
}

function filterSidebarTabs(perms) {
  const sidebarId = CURRENT_PAGE === 'office' ? 'officeSidebar' : 'mgrSidebar';
  const sidebar = document.getElementById(sidebarId);
  if (!sidebar) return;

  sidebar.querySelectorAll('.sidebar-nav-item').forEach(btn => {
    const tab = btn.getAttribute('data-tab');
    // Dashboard is always visible on office page
    if (tab === 'dashboard' && CURRENT_PAGE === 'office') return;
    const permKey = Object.keys(PERM_TO_TAB).find(k => PERM_TO_TAB[k] === tab);
    if (permKey) {
      btn.style.display = perms[permKey] ? '' : 'none';
    }
  });

  // On office page, hide collapsible group labels if no child items are visible
  if (CURRENT_PAGE === 'office') {
    sidebar.querySelectorAll('.sidebar-nav-subitems').forEach(sub => {
      const anyVisible = Array.from(sub.querySelectorAll('.sidebar-nav-item')).some(btn => btn.style.display !== 'none');
      const groupEl = sub.closest('.sidebar-nav-group');
      if (groupEl) groupEl.style.display = anyVisible ? '' : 'none';
    });
    // Also hide People & Leave group labels if their items are hidden
    sidebar.querySelectorAll('.sidebar-nav-group').forEach(group => {
      const label = group.querySelector('.sidebar-nav-label');
      if (label) {
        const items = group.querySelectorAll('.sidebar-nav-item');
        const anyVisible = Array.from(items).some(btn => btn.style.display !== 'none');
        group.style.display = anyVisible ? '' : 'none';
      }
    });
  }
}

function findFirstAllowedTab(perms) {
  const tabOrder = CURRENT_PAGE === 'office'
    ? ['dashboard','staff','holidays','project','employee','clockinout','payroll','archive','welding','suppliers','reports']
    : ['settings','useraccess','templates'];
  for (const tab of tabOrder) {
    const permKey = Object.keys(PERM_TO_TAB).find(k => PERM_TO_TAB[k] === tab);
    if (permKey && perms[permKey]) return tab;
  }
  return CURRENT_PAGE === 'office' ? 'dashboard' : 'settings'; // fallback
}

// ═══════════════════════════════════════════
// OFFICE VIEW
// ═══════════════════════════════════════════
function renderOfficeEmployeeGrid() {
  const grid = document.getElementById('officeEmpGrid');
  if (!grid) return;
  const empList = (state.timesheetData.employees || []).filter(e => e.active !== false && (e.staffType || 'workshop') === 'office');

  if (!empList.length) {
    grid.innerHTML = '<div class="empty-state" style="padding:30px"><div style="font-size:28px;margin-bottom:10px">&#128101;</div><div>No office staff set up yet.</div><div style="margin-top:8px;font-size:12px;color:var(--subtle)">Go to Manager → Staff to add office employees.</div></div>';
    return;
  }

  grid.innerHTML = empList.map(emp => {
    const ini = (emp.name || '').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    const col = empColor(emp.name);
    return `
      <div class="emp-btn" onclick="selectOfficeUser('${emp.name.replace(/'/g, "\\\\'")}')" style="padding:22px 14px 16px">
        <div class="emp-avatar" style="width:48px;height:48px;font-size:19px;background:linear-gradient(135deg,${col},#3e1a00)">${ini}</div>
        <div class="emp-name" style="font-size:13px">${emp.name}</div>
        <div style="font-size:10px;color:var(--subtle);margin-top:3px">${emp.hasPin ? '&#128274; PIN set' : '&#128275; No PIN'}</div>
      </div>
    `;
  }).join('');
}

function selectOfficeUser(name) {
  const emp = (state.timesheetData.employees || []).find(e => e.name === name);
  if (!emp) return;

  if (!emp.hasPin) {
    toast('No PIN set for this user. Set one in Staff management first.', 'error');
    return;
  }

  _pendingManagerUser = name;
  const ini = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const col = empColor(name);

  document.getElementById('officePinAvatar').innerHTML = ini;
  document.getElementById('officePinAvatar').style.background = `linear-gradient(135deg,${col},#3e1a00)`;
  document.getElementById('officePinName').textContent = name;
  document.getElementById('officePinInput').value = '';
  document.getElementById('officePinError').textContent = '';
  showScreen('screenOfficePin');
  setTimeout(() => document.getElementById('officePinInput').focus(), 100);
}

async function checkOfficePin() {
  const pin = document.getElementById('officePinInput').value;
  const emp = (state.timesheetData.employees || []).find(e => e.name === _pendingManagerUser);

  if (!emp || !emp.hasPin) {
    document.getElementById('officePinError').textContent = 'No PIN set for this user';
    return;
  }

  let result;
  try {
    result = await api.post('/api/auth/verify-pin', { employee_id: emp.id, pin });
  } catch (err) {
    document.getElementById('officePinError').textContent = 'Verification failed — try again';
    return;
  }

  if (!result || !result.valid) {
    document.getElementById('officePinError').textContent = (result && result.reason) || 'Incorrect PIN';
    document.getElementById('officePinInput').value = '';
    return;
  }

  // PIN correct — check permissions (same bootstrap logic as manager)
  const anyoneHasPerms = Object.values(userAccessData.users || {}).some(u =>
    u.permissions && Object.values(u.permissions).some(v => v === true)
  );

  if (!anyoneHasPerms) {
    console.log('Bootstrap: No permissions configured yet — granting full access to', _pendingManagerUser);
    if (!userAccessData.users[_pendingManagerUser]) {
      userAccessData.users[_pendingManagerUser] = { permissions: {} };
    }
    PERMISSION_DEFS.forEach(p => {
      userAccessData.users[_pendingManagerUser].permissions[p.key] = true;
    });
    saveUserAccessData().catch(e => console.warn('Bootstrap save failed:', e.message));
    toast('First-time setup — you have been granted full admin access', 'success');
  }

  const perms = getUserPermissions(_pendingManagerUser);
  // For office page, check if they have any of the office-relevant permissions
  // Dashboard is always accessible, so any office user with at least one permission gets in
  const officePerms = ['byProject','byEmployee','clockingInOut','payroll','archive','staff','holidays'];
  const hasOfficeAccess = officePerms.some(k => perms[k] === true);

  // Even if they have no specific tab permissions, they always get the dashboard
  // Only deny if they truly have zero permissions AND this isn't a bootstrap scenario
  const anyoneHasPermsCheck = Object.values(userAccessData.users || {}).some(u =>
    u.permissions && Object.values(u.permissions).some(v => v === true)
  );
  if (!hasOfficeAccess && anyoneHasPermsCheck) {
    // They have no office tab permissions — but still let them in to see the dashboard
    // Dashboard shows their own tasks, messages, holiday status etc.
  }

  // Has permissions — enter office dashboard
  currentManagerUser = _pendingManagerUser;
  sessionStorage.setItem('bama_mgr_authed', currentManagerUser);
  _pendingManagerUser = null;
  document.getElementById('officePinInput').value = '';

  // Filter sidebar tabs based on permissions
  filterSidebarTabs(perms);

  showScreen('screenOffice');
  // Always land on dashboard first
  switchTab('dashboard');
  renderManagerView();
}

// Collapsible sidebar group toggle
function toggleSidebarGroup(labelEl) {
  labelEl.classList.toggle('collapsed');
  const subitems = labelEl.nextElementSibling;
  if (subitems && subitems.classList.contains('sidebar-nav-subitems')) {
    subitems.classList.toggle('collapsed');
  }
}

function renderManagerView() {
  const { mon, sun } = getWeekDates(state.currentWeekOffset);
  const weekLabelEl = document.getElementById('weekLabel');
  if (weekLabelEl) weekLabelEl.textContent = `${fmtDate(mon)} – ${fmtDate(sun)}`;

  // Check holiday notifications
  checkHolidayNotifications();

  const monStr = dateStr(mon);
  const sunStr = dateStr(sun);

  const weekEntries = state.timesheetData.entries.filter(
    e => e.date >= monStr && e.date <= sunStr
  );
  const weekClockings = state.timesheetData.clockings.filter(
    c => c.date >= monStr && c.date <= sunStr
  );

  // Stats
  // "Pending" = anything in this week that still needs a manager decision:
  //   - amended clockings awaiting approval (approvalStatus === 'pending')
  //   - employee-submitted amendment requests still pending
  // "Approved" = amended clockings that the manager has signed off this week.
  // Plain unaltered clockings don't count — there's nothing to approve.
  const totalHrs = weekEntries.reduce((s, e) => s + e.hours, 0);

  const pendingClockings = weekClockings.filter(c => c.approvalStatus === 'pending').length;
  const pendingAmendments = (state.timesheetData.amendments || []).filter(a =>
    a.status === 'pending' && a.date >= monStr && a.date <= sunStr
  ).length;
  const pending = pendingClockings + pendingAmendments;

  const approved = weekClockings.filter(c => c.approvalStatus === 'approved').length;

  const emps = new Set(weekEntries.map(e => e.employeeName)).size;

  const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
  el('stat-pending', pending);
  el('stat-approved', approved);
  el('stat-emps', emps);

  // Project table
  renderProjectTable(weekEntries);
  renderEmpSummary(weekEntries, weekClockings);
  // Clock log rendered by its own week navigator
  renderClockLogForWeek();
}

function renderProjectTable(entries) {
  const tbody = document.getElementById('projectTableBody');
  if (!tbody) return;
  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div class="empty-state"><div class="icon">📋</div>No entries this week</div></td></tr>';
    return;
  }

  tbody.innerHTML = entries.map(e => `
    <tr>
      <td><span class="mono" style="color:var(--accent2)">${e.projectId}</span></td>
      <td style="color:var(--muted)">${e.projectName}</td>
      <td>${e.employeeName}</td>
      <td class="mono" style="font-size:12px">${fmtDateStr(e.date)}</td>
      <td class="mono"><b>${e.hours}h</b></td>
      <td style="text-align:right">
        <button class="tiny-btn tiny-reject" onclick="deleteProjectEntry('${e.id}')" title="Remove this entry">🗑 Delete</button>
      </td>
    </tr>
  `).join('');
}

function renderEmpSummary(entries, clockings) {
  const area = document.getElementById('empSummaryArea');
  if (!area) return;
  const byEmp = {};
  entries.forEach(e => {
    if (!byEmp[e.employeeName]) byEmp[e.employeeName] = { entries: [], hours: 0 };
    byEmp[e.employeeName].entries.push(e);
    byEmp[e.employeeName].hours += e.hours;
  });

  if (!Object.keys(byEmp).length) {
    area.innerHTML = '<div class="empty-state"><div class="icon">👤</div>No entries this week</div>';
    return;
  }

  area.innerHTML = Object.entries(byEmp).map(([name, data]) => `
    <div class="card" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <div style="font-weight:600;font-size:15px">${name}</div>
        <div class="mono" style="color:var(--accent2)">${data.hours.toFixed(1)} hrs total</div>
      </div>
      ${data.entries.map(e => `
        <div class="entry-chip">
          <span class="proj-id">${e.projectId}</span>
          <span class="proj-name">${e.projectName}</span>
          <span style="font-size:12px;color:var(--muted);font-family:var(--font-mono)">${fmtDateStr(e.date)}</span>
          <span class="proj-hrs">${e.hours}h</span>
          <span class="tag tag-${e.status}" style="margin-left:8px">${e.status}</span>
        </div>
      `).join('')}
    </div>
  `).join('');
}

function calcHours(clockIn, clockOut, breakMins, dateStr) {
  if (!clockIn || !clockOut) return null;
  const [ih, im] = clockIn.split(':').map(Number);
  const [oh, om] = clockOut.split(':').map(Number);
  let diff = (oh * 60 + om) - (ih * 60 + im);
  // Handle overnight shifts (e.g. 22:00 → 06:00) — add 24h if clock-out earlier than clock-in
  if (diff < 0) diff += 1440;
  // Break is NOT deducted on Saturdays or Sundays (BAMA rule).
  // dateStr expected as 'YYYY-MM-DD'. If not supplied, fall back to deducting (back-compat).
  let skipBreak = false;
  if (dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const dow = d.getDay(); // 0=Sun, 6=Sat
    if (dow === 0 || dow === 6) skipBreak = true;
  }
  if (!skipBreak) diff -= (breakMins || 0);
  return diff > 0 ? diff / 60 : 0;
}

function renderClockLog(clockings) {
  const area = document.getElementById('clockLogArea');
  if (!area) return;
  const countEl = document.getElementById('clockLogCount');

  if (countEl) countEl.textContent = `${clockings.length} record${clockings.length !== 1 ? 's' : ''} this week`;

  if (!clockings.length) {
    area.innerHTML = '<div class="empty-state"><div class="icon">🕐</div>No clock-in/out records this week</div>';
    return;
  }

  // Build week days Mon-Sun based on current clock log week
  const { mon } = getWeekDates(clockLogWeekOffset);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    days.push({ label: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i], date: dateStr(d) });
  }

  // Group clockings by employee
  const empMap = {};
  clockings.forEach(c => {
    if (!empMap[c.employeeName]) empMap[c.employeeName] = {};
    empMap[c.employeeName][c.date] = c;
  });

  // Apply search filter
  const q = (document.getElementById('clockSearchBox')?.value || '').toLowerCase();
  const employees = Object.keys(empMap).filter(n => !q || n.toLowerCase().includes(q)).sort();

  if (!employees.length) {
    area.innerHTML = '<div class="empty-state">No results found</div>';
    return;
  }

  const rows = employees.map(emp => {
    const dayData = days.map(d => {
      const c = empMap[emp][d.date];
      if (!c) return { html: '<td style="text-align:center;color:var(--subtle)">—</td>', hrs: 0 };

      const hrs = calcHours(c.clockIn, c.clockOut, c.breakMins, c.date) || 0;
      const isPending = c.approvalStatus === 'pending' || (!c.approvalStatus && !c.addedByManager);
      const isEdited = c.manuallyEdited;

      // Inline edit mode
      if (c._editing) {
        const times = [];
        for (let h = 4; h <= 23; h++) {
          times.push(`${String(h).padStart(2,'0')}:00`);
          times.push(`${String(h).padStart(2,'0')}:15`);
          times.push(`${String(h).padStart(2,'0')}:30`);
          times.push(`${String(h).padStart(2,'0')}:45`);
        }
        // Include the actual clock times if they're not standard 15-min slots
        const actualIn = c.clockIn || '';
        const actualOut = c.clockOut || '';
        if (actualIn && !times.includes(actualIn)) times.push(actualIn);
        if (actualOut && !times.includes(actualOut)) times.push(actualOut);
        times.sort();
        const inOpts = times.map(t => `<option value="${t}" ${t === actualIn ? 'selected' : ''}>${t}</option>`).join('');
        const outEmpty = !c.clockOut ? '<option value="">— still in —</option>' : '';
        const outOpts = outEmpty + times.map(t => `<option value="${t}" ${t === actualOut ? 'selected' : ''}>${t}</option>`).join('');
        return {
          html: `<td style="text-align:center;padding:6px 4px;vertical-align:top;min-width:110px">
            <select id="edit-in-${c.id}" class="field-input" style="font-size:10px;padding:3px 4px;margin-bottom:3px;width:100%" onchange="markClockDirty('${c.id}')">${inOpts}</select>
            <select id="edit-out-${c.id}" class="field-input" style="font-size:10px;padding:3px 4px;margin-bottom:3px;width:100%" onchange="markClockDirty('${c.id}')">${outOpts}</select>
            <div style="font-size:9px;color:var(--muted);margin-bottom:3px" id="edit-total-${c.id}">${hrs > 0 ? hrs.toFixed(2)+'h' : ''}</div>
            <input type="hidden" id="edit-break-${c.id}" value="${c.breakMins||30}">
            <div style="display:flex;gap:3px;justify-content:center">
              <button id="save-btn-${c.id}" class="tiny-btn tiny-approve" onclick="saveClockEdit('${c.id}')" style="font-size:9px;padding:2px 6px">Save</button>
              <button class="tiny-btn" onclick="cancelClockEdit('${c.id}')" style="font-size:9px;padding:2px 5px;color:var(--muted)">✕</button>
            </div>
          </td>`,
          hrs
        };
      }

      const statusBadge = isPending
        ? `<div style="margin-top:3px"><span class="tag tag-pending" style="font-size:9px">pending</span>
           <button class="tiny-btn tiny-approve" onclick="approveClocking('${c.id}')" style="font-size:9px;padding:1px 5px">✓</button>
           <button class="tiny-btn tiny-reject" onclick="rejectClocking('${c.id}')" style="font-size:9px;padding:1px 5px">✕</button></div>`
        : c.approvalStatus === 'rejected'
        ? `<div style="margin-top:3px"><span class="tag tag-rejected" style="font-size:9px">rejected</span></div>`
        : `<div style="margin-top:3px"><span class="tag" style="font-size:9px;background:rgba(62,207,142,.15);color:var(--green);border:1px solid rgba(62,207,142,.3)">${c.approvedBy ? 'approved by ' + c.approvedBy : 'approved'}</span></div>`;

      const editedBadge = isEdited ? `<span style="color:var(--amber);font-size:9px"> ✎</span>` : '';

      return {
        html: `<td style="text-align:center;padding:8px 6px;vertical-align:top">
          <div style="font-family:var(--font-mono);font-size:11px;color:var(--text)">
            ${c.clockIn || '—'} – ${c.clockOut || '<span style="color:var(--amber)">in</span>'}${editedBadge}
          </div>
          <div style="font-size:11px;color:${hrs >= 8 ? 'var(--green)' : 'var(--accent2)'};font-family:var(--font-mono);margin-top:2px">
            ${hrs > 0 ? hrs.toFixed(1) + 'h' : ''}
          </div>
          ${statusBadge}
          <div style="margin-top:4px">
            <button class="tiny-btn" onclick="editClockingInline('${c.id}')"
              style="font-size:9px;padding:1px 6px;background:rgba(255,255,255,.05);border-color:var(--subtle);color:var(--subtle)">edit</button>
          </div>
        </td>`,
        hrs
      };
    });

    const totalHrs = dayData.reduce((s, d) => s + d.hrs, 0);
    const workedDays = dayData.filter(d => d.hrs > 0).length;

    return `
      <tr style="border-bottom:1px solid var(--border)">
        <td style="padding:10px 14px;font-weight:600;white-space:nowrap;vertical-align:middle">
          ${emp}
          <div style="font-size:11px;color:var(--muted);font-weight:400">${workedDays} day${workedDays !== 1 ? 's' : ''}</div>
        </td>
        ${dayData.map(d => d.html).join('')}
        <td style="text-align:center;padding:10px 8px;vertical-align:middle">
          <div style="font-family:var(--font-display);font-size:20px;color:${totalHrs >= 40 ? 'var(--green)' : 'var(--accent2)'}">${totalHrs.toFixed(1)}</div>
          <div style="font-size:10px;color:var(--muted)">hrs</div>
        </td>
      </tr>
    `;
  }).join('');

  // Day totals footer
  const dayTotals = days.map((d, i) => {
    const total = Object.values(empMap).reduce((s, emp) => {
      const c = emp[d.date];
      return s + (c ? calcHours(c.clockIn, c.clockOut, c.breakMins, c.date) || 0 : 0);
    }, 0);
    return `<td style="text-align:center;padding:8px 6px;font-family:var(--font-mono);font-size:12px;font-weight:600;color:var(--muted)">${total > 0 ? total.toFixed(1) + 'h' : '—'}</td>`;
  }).join('');

  const grandTotal = Object.values(empMap).reduce((s, emp) => {
    return s + Object.values(emp).reduce((ss, c) => ss + (calcHours(c.clockIn, c.clockOut, c.breakMins, c.date) || 0), 0);
  }, 0);

  // Build amendment requests banner
  const { mon: wMon, sun: wSun } = getWeekDates(clockLogWeekOffset);
  const wMonStr = dateStr(wMon);
  const wSunStr = dateStr(wSun);
  const pendingAmendments = (state.timesheetData.amendments || []).filter(
    a => a.status === 'pending' && a.date >= wMonStr && a.date <= wSunStr
  );

  let amendmentHtml = '';
  if (pendingAmendments.length > 0) {
    const items = pendingAmendments.map(a => {
      const dateLabel = new Date(a.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' });
      return `
        <div style="background:var(--surface);border:1px solid rgba(255,107,0,.25);border-radius:8px;padding:12px 16px;margin-bottom:8px;font-size:13px">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
            <div>
              <span style="font-weight:600;color:var(--text)">${a.employeeName}</span>
              <span style="color:var(--muted);margin:0 6px">·</span>
              <span style="font-family:var(--font-mono);font-size:12px;color:var(--accent2)">${dateLabel}</span>
            </div>
            <div style="display:flex;gap:6px">
              <button class="tiny-btn tiny-approve" onclick="approveAmendment('${a.id}')" style="font-size:11px;padding:4px 10px">&#10003; Approve</button>
              <button class="tiny-btn tiny-reject" onclick="rejectAmendment('${a.id}')" style="font-size:11px;padding:4px 10px">&#10005; Reject</button>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:10px">
            <div>
              <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Original</div>
              <span style="font-family:var(--font-mono);color:var(--subtle)">&#9650; ${a.originalIn || '—'} &#9660; ${a.originalOut || '—'}</span>
            </div>
            <div>
              <div style="font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px">Requested</div>
              <span style="font-family:var(--font-mono);color:var(--accent)">&#9650; ${a.requestedIn || 'no change'} &#9660; ${a.requestedOut || 'no change'}</span>
            </div>
          </div>
          <div style="margin-top:8px;font-size:12px;color:var(--muted)">
            <span style="font-weight:600">Reason:</span> ${a.reason}
          </div>
        </div>
      `;
    }).join('');

    amendmentHtml = `
      <div class="notification-banner" style="cursor:default;margin-bottom:16px">
        <div class="nb-icon">&#9998;</div>
        <div class="nb-text"><b>${pendingAmendments.length}</b> amendment request${pendingAmendments.length > 1 ? 's' : ''} pending review</div>
        <div class="nb-count">${pendingAmendments.length}</div>
      </div>
      ${items}
    `;
  }

  area.innerHTML = `
    ${amendmentHtml}
    <div style="overflow-x:auto">
      <table class="summary-table" style="min-width:800px;width:100%">
        <thead>
          <tr>
            <th style="text-align:left;min-width:140px">EMPLOYEE</th>
            ${days.map(d => `<th style="text-align:center;min-width:90px">${d.label}<br><span style="font-weight:400;font-size:9px;color:var(--muted)">${d.date.slice(5)}</span></th>`).join('')}
            <th style="text-align:center;min-width:60px">TOTAL</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
        <tfoot>
          <tr style="border-top:2px solid var(--border)">
            <td style="padding:8px 14px;font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px">Daily Total</td>
            ${dayTotals}
            <td style="text-align:center;font-family:var(--font-display);font-size:18px;color:var(--green)">${grandTotal.toFixed(1)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}


function markClockDirty(id) {
  const btn = document.getElementById(`save-btn-${id}`);
  if (btn) btn.style.display = 'inline-block';
  // Update total preview
  const inVal = document.getElementById(`edit-in-${id}`)?.value;
  const outVal = document.getElementById(`edit-out-${id}`)?.value;
  const breakVal = parseInt(document.getElementById(`edit-break-${id}`)?.value) || 0;
  const clocking = state.timesheetData.clockings.find(c => String(c.id) === String(id));
  const hrs = calcHours(inVal, outVal, breakVal, clocking?.date);
  const totalEl = document.getElementById(`edit-total-${id}`);
  if (totalEl && hrs !== null) totalEl.textContent = hrs.toFixed(2) + 'h';
}

function editClockingInline(id) {
  const clocking = state.timesheetData.clockings.find(c => String(c.id) === String(id));
  if (!clocking) return;
  // Store originals for cancel/reject
  if (!clocking.originalClockIn) {
    clocking.originalClockIn = clocking.clockIn;
    clocking.originalClockOut = clocking.clockOut;
    clocking.originalBreakMins = clocking.breakMins;
  }
  clocking._editing = true;
  renderManagerView();
}

function cancelClockEdit(id) {
  const clocking = state.timesheetData.clockings.find(c => String(c.id) === String(id));
  if (!clocking) return;
  clocking._editing = false;
  renderManagerView();
}

async function saveClockEdit(id) {
  const clocking = state.timesheetData.clockings.find(c => String(c.id) === String(id));
  if (!clocking) return;

  const newClockIn = document.getElementById(`edit-in-${id}`).value;
  const newClockOut = document.getElementById(`edit-out-${id}`).value;
  const newBreakMins = parseInt(document.getElementById(`edit-break-${id}`).value) || 0;

  try {
    // Use browser Date to convert local time → UTC ISO string (handles BST correctly)
    const clockInDT = new Date(`${clocking.date}T${newClockIn}:00`).toISOString();
    const clockOutDT = newClockOut ? new Date(`${clocking.date}T${newClockOut}:00`).toISOString() : null;

    await api.put(`/api/clockings/${id}`, {
      clock_in: clockInDT,
      clock_out: clockOutDT,
      break_mins: newBreakMins,
      amended_by: currentManagerUser || 'manager'
    });

    // Update local state
    clocking.clockIn = newClockIn;
    clocking.clockOut = newClockOut;
    clocking.breakMins = newBreakMins;
    clocking.manuallyEdited = true;
    clocking.approvalStatus = 'pending';
    clocking._editing = false;

    // Times changed → S000 (Unproductive Time) for that day is stale.
    // Server recomputes and patches local state. Only meaningful if the
    // shift is closed (has a clock_out), but the helper is safe regardless.
    if (clocking.clockOut) {
      await recomputeS000Local(clocking.employeeName, clocking.date);
    }

    toast('Clocking updated — pending approval ✓', 'success');
    renderManagerView();
  } catch (err) { toast('Save failed: ' + err.message, 'error'); }
}

async function approveClocking(id) {
  const c = state.timesheetData.clockings.find(c => String(c.id) === String(id));
  if (!c) return;
  try {
    const approver = currentManagerUser || 'manager';
    await api.put(`/api/clockings/${id}`, {
      is_approved: true,
      approved_by: approver,
      amended_by: c._raw && c._raw.amended_by ? c._raw.amended_by : approver
    });
    c.approvalStatus = 'approved';
    c.approvedBy = approver;
    toast('Clocking approved ✓', 'success');
    renderManagerView();
  } catch (err) { toast('Save failed: ' + err.message, 'error'); }
}

async function rejectClocking(id) {
  const c = state.timesheetData.clockings.find(c => String(c.id) === String(id));
  if (!c) return;
  try {
    // Revert to original times if available
    const revertIn = c.originalClockIn || c.clockIn;
    const revertOut = c.originalClockOut || c.clockOut;
    const clockInDT = `${c.date}T${revertIn}:00`;
    const clockOutDT = revertOut ? `${c.date}T${revertOut}:00` : null;

    const updateBody = { amended_by: currentManagerUser || 'manager' };
    if (c.originalClockIn) updateBody.clock_in = clockInDT;
    if (c.originalClockOut) updateBody.clock_out = clockOutDT;

    await api.put(`/api/clockings/${id}`, updateBody);

    if (c.originalClockIn) { c.clockIn = c.originalClockIn; c.clockOut = c.originalClockOut; c.breakMins = c.originalBreakMins || 0; }
    c.approvalStatus = 'rejected';
    c.manuallyEdited = false;

    // Times reverted → S000 stale, server recomputes.
    if (c.clockOut) {
      await recomputeS000Local(c.employeeName, c.date);
    }

    toast('Change rejected', 'success');
    renderManagerView();
  } catch (err) { toast('Save failed: ' + err.message, 'error'); }
}

// Delete a full day's record for a single employee:
// - Removes the ClockEntries row
// - Removes every ProjectHours row for that employee on that date
// Triggered from the "🗑 Delete Day" button next to "+ Add Manual Clocking"
// on the office Clocking In/Out review page.

function openDeleteClockingDay() {
  const sel = document.getElementById('delClockEmp');
  if (!sel) return;
  const placeholder = '<option value="">— select employee —</option>';
  sel.innerHTML = placeholder + (state.timesheetData.employees || [])
    .filter(e => e.active !== false)
    .map(e => `<option value="${e.name}">${e.name}</option>`).join('');
  document.getElementById('delClockDate').value = '';
  document.getElementById('delClockConfirmBtn').disabled = true;
  document.getElementById('delClockPreview').innerHTML =
    '<span style="color:var(--muted)">Pick an employee and date to see what will be deleted.</span>';
  document.getElementById('deleteClockingDayModal').classList.add('active');
}

function closeDeleteClockingDay() {
  document.getElementById('deleteClockingDayModal').classList.remove('active');
}

function refreshDeleteClockingPreview() {
  const empName = document.getElementById('delClockEmp').value;
  const date = document.getElementById('delClockDate').value;
  const previewEl = document.getElementById('delClockPreview');
  const btn = document.getElementById('delClockConfirmBtn');
  btn.disabled = true;

  if (!empName || !date) {
    previewEl.innerHTML = '<span style="color:var(--muted)">Pick an employee and date to see what will be deleted.</span>';
    return;
  }

  const clocking = (state.timesheetData.clockings || []).find(
    c => c.employeeName === empName && c.date === date
  );
  const entries = (state.timesheetData.entries || []).filter(
    e => e.employeeName === empName && e.date === date
  );

  if (!clocking && !entries.length) {
    previewEl.innerHTML = '<span style="color:var(--amber)">No record found for this employee on this date.</span>';
    return;
  }

  const dayLabel = new Date(date + 'T12:00:00').toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'short', year: 'numeric'
  });
  const projHrsTotal = entries.reduce((s, e) => s + (parseFloat(e.hours) || 0), 0);

  let html = `<div style="font-weight:600;color:var(--text);margin-bottom:6px">${empName} — ${dayLabel}</div>`;
  if (clocking) {
    html += `<div style="font-family:var(--font-mono);font-size:12px;margin-bottom:4px">Clock: ${clocking.clockIn || '—'} – ${clocking.clockOut || 'still in'}</div>`;
  } else {
    html += `<div style="color:var(--muted);font-size:12px;margin-bottom:4px">No clock-in/out record</div>`;
  }
  if (entries.length) {
    html += `<div style="font-size:12px">Project hours: <b>${entries.length}</b> entr${entries.length === 1 ? 'y' : 'ies'} (${projHrsTotal.toFixed(1)}h)</div>`;
  } else {
    html += `<div style="color:var(--muted);font-size:12px">No project-hour entries</div>`;
  }
  html += `<div style="color:var(--red);font-size:11px;margin-top:8px">⚠ Cannot be undone.</div>`;

  previewEl.innerHTML = html;
  // Stash for confirm
  previewEl.dataset.clockingId = clocking ? String(clocking.id) : '';
  previewEl.dataset.empName = empName;
  previewEl.dataset.date = date;
  btn.disabled = false;
}

async function confirmDeleteClockingDay() {
  const previewEl = document.getElementById('delClockPreview');
  const empName = previewEl.dataset.empName;
  const date = previewEl.dataset.date;
  const clockingId = previewEl.dataset.clockingId;

  if (!empName || !date) return;

  const btn = document.getElementById('delClockConfirmBtn');
  btn.disabled = true;
  btn.textContent = 'Deleting…';

  try {
    // Delete the clocking row if there is one
    if (clockingId) {
      await api.delete(`/api/clockings/${clockingId}`);
    }

    // Delete each project-hours entry for that employee+date.
    // No bulk endpoint — small batch per day, parallel deletes.
    const entries = (state.timesheetData.entries || []).filter(
      e => e.employeeName === empName && e.date === date
    );
    let failed = 0;
    if (entries.length) {
      const results = await Promise.allSettled(
        entries.map(e => api.delete(`/api/project-hours/${e.id}`))
      );
      failed = results.filter(r => r.status === 'rejected').length;
      if (failed) console.warn('Some project-hour deletes failed:', results.filter(r => r.status === 'rejected'));
    }

    // Patch local state
    if (clockingId) {
      state.timesheetData.clockings = state.timesheetData.clockings.filter(
        x => String(x.id) !== String(clockingId)
      );
    }
    state.timesheetData.entries = (state.timesheetData.entries || []).filter(
      e => !(e.employeeName === empName && e.date === date)
    );

    closeDeleteClockingDay();
    if (failed) {
      toast(`Deleted, but ${failed} project entr${failed === 1 ? 'y' : 'ies'} failed — refresh and retry`, 'error');
    } else {
      toast('Day deleted ✓', 'success');
    }
    renderManagerView();
  } catch (err) {
    console.error('confirmDeleteClockingDay error:', err);
    toast('Delete failed: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Delete Day';
  }
}

// Manager add clocking modal
function openMgrAddClocking() {
  const sel = document.getElementById('mgrClockEmp');
  sel.innerHTML = (state.timesheetData.employees||[])
    .filter(e => e.active !== false)
    .map(e => `<option value="${e.name}">${e.name}</option>`).join('');

  // Fill time selects
  ['mgrClockIn','mgrClockOut'].forEach(id => {
    const el = document.getElementById(id);
    el.innerHTML = CONFIG.timeSlots.map(s => `<option value="${s.val}">${s.label}</option>`).join('');
  });
  document.getElementById('mgrClockDate').value = todayStr();
  document.getElementById('mgrAddClockingModal').classList.add('active');
}

function closeMgrAddClocking() {
  document.getElementById('mgrAddClockingModal').classList.remove('active');
}

async function saveMgrClocking() {
  const empName = document.getElementById('mgrClockEmp').value;
  const date = document.getElementById('mgrClockDate').value;
  const clockIn = document.getElementById('mgrClockIn').value;
  const clockOut = document.getElementById('mgrClockOut').value;
  const breakMins = parseInt(document.getElementById('mgrClockBreak').value) || 0;

  if (!empName || !date || !clockIn || !clockOut) {
    toast('Please fill in all fields', 'error'); return;
  }

  // Hard block: workshop is closed on bank holidays.
  if (isBankHoliday(date)) {
    toast('Cannot add a clocking on a bank holiday — the workshop is closed.', 'error');
    return;
  }

  const empId = empIdByName(empName);
  if (!empId) { toast('Employee not found in system', 'error'); return; }

  try {
    const result = await api.post('/api/clockings', {
      employee_id: empId,
      clock_in: new Date(`${date}T${clockIn}:00`).toISOString(),
      clock_out: new Date(`${date}T${clockOut}:00`).toISOString(),
      break_mins: breakMins,
      amended_by: currentManagerUser || 'manager'
    });

    // Add to local state
    const newClocking = normaliseClocking({ ...result, employee_name: empName });
    newClocking.addedByManager = true;
    newClocking.approvalStatus = 'approved';
    newClocking.breakMins = breakMins;
    state.timesheetData.clockings.push(newClocking);

    // Manager just added a closed clocking out of band → S000 (Unproductive
    // Time) for that employee+date is stale. Server recomputes against
    // whatever ProjectHours rows exist for the day.
    await recomputeS000Local(empName, date);

    closeMgrAddClocking();
    toast(`Clocking added for ${empName} ✓`, 'success');
    renderManagerView();
  } catch (err) { toast('Save failed: ' + err.message, 'error'); }
}

// Employee My Week view
function renderMyWeek(employeeName) {
  const grid = document.getElementById('myWeekGrid');
  if (!grid) return;

  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const today = new Date();
  const dayOfWeek = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));

  // Calculate and display weekly total
  const monStr = dateStr(monday);
  const sun = new Date(monday); sun.setDate(monday.getDate() + 6);
  const sunStr = dateStr(sun);
  const weekClockings = (state.timesheetData.clockings || []).filter(c =>
    c.employeeName === employeeName && c.date >= monStr && c.date <= sunStr
  );
  const weekTotalHrs = weekClockings.reduce((s, c) => s + (calcHours(c.clockIn, c.clockOut, c.breakMins, c.date) || 0), 0);
  const totalEl = document.getElementById('myWeekTotal');
  if (totalEl) {
    totalEl.textContent = weekTotalHrs > 0 ? `${weekTotalHrs.toFixed(1)}h this week` : '';
    totalEl.style.color = weekTotalHrs >= 40 ? 'var(--green)' : 'var(--accent2)';
  }

  grid.innerHTML = days.map((day, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    const dStr = dateStr(d);
    const isToday = dStr === todayStr();
    const isFuture = d > today;

    const clocking = state.timesheetData.clockings.find(
      c => c.employeeName === employeeName && c.date === dStr
    );

    // Project entries for this day
    const dayEntries = (state.timesheetData.entries || []).filter(
      e => e.employeeName === employeeName && e.date === dStr
    );

    let content = '';
    if (clocking) {
      const hrs = calcHours(clocking.clockIn, clocking.clockOut, clocking.breakMins, clocking.date);
      const isPending = clocking.approvalStatus === 'pending';
      // Check for pending amendment
      const amendment = (state.timesheetData.amendments || []).find(a => String(a.clockingId) === String(clocking.id) && a.status === 'pending');
      const rejectedAmendment = (state.timesheetData.amendments || []).find(a => String(a.clockingId) === String(clocking.id) && a.status === 'rejected');
      content = `
        ${clocking.clockIn ? `<div class="week-day-time in">▲ ${clocking.clockIn}</div>` : '<div class="week-day-time" style="color:var(--subtle)">▲ —</div>'}
        ${clocking.clockOut ? `<div class="week-day-time out">▼ ${clocking.clockOut}</div>` : '<div class="week-day-time" style="color:var(--subtle)">▼ —</div>'}
        ${clocking.breakMins ? `<div class="week-day-break">&#9749; ${clocking.breakMins}m</div>` : ''}
        ${hrs !== null ? `<div class="week-day-total">${hrs.toFixed(1)}h</div>` : ''}
        ${isPending ? `<div style="margin-top:4px"><span class="tag tag-pending" style="font-size:9px">Pending</span></div>` : ''}
        ${clocking.manuallyEdited && !isPending ? `<div style="margin-top:4px"><span class="manually-edited-badge" style="font-size:9px">Edited</span></div>` : ''}
        ${amendment ? `<div style="margin-top:4px"><span class="tag tag-pending" style="font-size:9px">Amendment pending</span></div>` : ''}
        ${rejectedAmendment && !amendment ? `<div style="margin-top:4px"><span class="tag tag-rejected" style="font-size:9px">Amendment rejected</span></div>` : ''}
        ${!isFuture && clocking.clockOut && !amendment ? `<button class="week-day-add" onclick="openAmendmentRequest('${clocking.id}')">&#9998; Request Amendment</button>` : ''}
      `;
    } else if (!isFuture) {
      const isToday2 = dStr === todayStr();
      const isBH = isBankHoliday(dStr);
      if (isBH) {
        content = `<div style="color:var(--accent);font-size:11px;margin-top:8px">Bank holiday</div>`;
      } else {
        content = `
          <div style="color:var(--subtle);font-size:11px;margin-top:8px">No clocking</div>
          ${!isToday2 ? `<button class="week-day-add" onclick="openAddClocking('${dStr}')">+ Add</button>` : ''}
        `;
      }
    } else {
      content = `<div style="color:var(--subtle);font-size:11px;margin-top:16px">—</div>`;
    }

    const entriesHtml = dayEntries.length ? `
      <div style="margin-top:6px;border-top:1px solid var(--border);padding-top:4px">
        ${dayEntries.map(e => `<div style="font-size:9px;color:var(--muted);display:flex;justify-content:space-between;padding:1px 0">
          <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:70%">${e.projectId}</span>
          <span style="color:var(--accent2);font-family:var(--font-mono)">${e.hours}h</span>
        </div>`).join('')}
      </div>
    ` : '';

    return `
      <div class="week-day ${isToday ? 'today' : ''} ${clocking ? 'has-data' : ''}">
        <div class="week-day-name">${day}</div>
        <div class="week-day-date">${d.getDate()}/${d.getMonth()+1}</div>
        ${content}
        ${entriesHtml}
      </div>
    `;
  }).join('');
}

// Employee Last Week Review — final chance to flag wrong clockings before
// the office presses Email-to-Payroll. Hidden once a row exists in
// PayrollRevisions for that week's commencing Monday.
async function renderLastWeekReview(employeeName) {
  const card = document.getElementById('lastWeekReviewCard');
  const grid = document.getElementById('lastWeekReviewGrid');
  const totalEl = document.getElementById('lastWeekReviewTotal');
  if (!card || !grid) return;

  // Compute last week (Mon-Sun)
  const today = new Date();
  const dayOfWeek = today.getDay();
  const thisMonday = new Date(today);
  thisMonday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));
  const lastMonday = new Date(thisMonday);
  lastMonday.setDate(thisMonday.getDate() - 7);
  const lastSunday = new Date(lastMonday);
  lastSunday.setDate(lastMonday.getDate() + 6);
  const monStr = dateStr(lastMonday);
  const sunStr = dateStr(lastSunday);

  // Pull the employee's clockings for last week
  const weekClockings = (state.timesheetData.clockings || []).filter(c =>
    c.employeeName === employeeName && c.date >= monStr && c.date <= sunStr
  );

  // If they didn't work last week (no clockings at all) there's nothing to
  // review — keep the card hidden to avoid clutter.
  if (weekClockings.length === 0) {
    card.style.display = 'none';
    return;
  }

  // Check whether payroll has already been generated for this week. Presence
  // of any payroll-revisions row for this week_commencing means Email-to-Payroll
  // was pressed → review window is closed → hide the card.
  // If the API call fails we fall through and SHOW the card — better to let
  // the employee review than block them on transient server issues.
  try {
    const revisions = await api.get(`/api/payroll-revisions?week_commencing=${monStr}`);
    if (Array.isArray(revisions) && revisions.length > 0) {
      card.style.display = 'none';
      return;
    }
  } catch (err) {
    console.warn('Payroll-revisions check failed; showing review card anyway:', err.message);
  }

  // Render: same shape as renderMyWeek but for last week and read-only on
  // gaps (no "+ Add" — that flow is for the current week).
  const days = ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
  const weekTotalHrs = weekClockings.reduce((s, c) => s + (calcHours(c.clockIn, c.clockOut, c.breakMins, c.date) || 0), 0);
  if (totalEl) {
    totalEl.textContent = weekTotalHrs > 0 ? `${weekTotalHrs.toFixed(1)}h total` : '';
    totalEl.style.color = 'var(--accent2)';
  }

  grid.innerHTML = days.map((day, i) => {
    const d = new Date(lastMonday);
    d.setDate(lastMonday.getDate() + i);
    const dStr = dateStr(d);

    const clocking = weekClockings.find(c => c.date === dStr);

    let content = '';
    if (clocking) {
      const hrs = calcHours(clocking.clockIn, clocking.clockOut, clocking.breakMins, clocking.date);
      const amendment = (state.timesheetData.amendments || []).find(a => String(a.clockingId) === String(clocking.id) && a.status === 'pending');
      const rejectedAmendment = (state.timesheetData.amendments || []).find(a => String(a.clockingId) === String(clocking.id) && a.status === 'rejected');
      content = `
        ${clocking.clockIn ? `<div class="week-day-time in">▲ ${clocking.clockIn}</div>` : '<div class="week-day-time" style="color:var(--subtle)">▲ —</div>'}
        ${clocking.clockOut ? `<div class="week-day-time out">▼ ${clocking.clockOut}</div>` : '<div class="week-day-time" style="color:var(--subtle)">▼ —</div>'}
        ${clocking.breakMins ? `<div class="week-day-break">&#9749; ${clocking.breakMins}m</div>` : ''}
        ${hrs !== null ? `<div class="week-day-total">${hrs.toFixed(1)}h</div>` : ''}
        ${amendment ? `<div style="margin-top:4px"><span class="tag tag-pending" style="font-size:9px">Amendment pending</span></div>` : ''}
        ${rejectedAmendment && !amendment ? `<div style="margin-top:4px"><span class="tag tag-rejected" style="font-size:9px">Amendment rejected</span></div>` : ''}
        ${clocking.clockOut && !amendment ? `<button class="week-day-add" onclick="openAmendmentRequest('${clocking.id}')">&#9998; Request Amendment</button>` : ''}
      `;
    } else {
      const isBH = isBankHoliday(dStr);
      content = isBH
        ? `<div style="color:var(--accent);font-size:11px;margin-top:8px">Bank holiday</div>`
        : `<div style="color:var(--subtle);font-size:11px;margin-top:8px">No clocking</div>`;
    }

    return `
      <div class="week-day ${clocking ? 'has-data' : ''}">
        <div class="week-day-name">${day}</div>
        <div class="week-day-date">${d.getDate()}/${d.getMonth()+1}</div>
        ${content}
      </div>
    `;
  }).join('');

  card.style.display = '';
}

// Employee add missing clocking
let _addClockingDate = null;
function openAddClocking(date) {
  _addClockingDate = date;
  document.getElementById('addClockingDate').textContent = new Date(date + 'T12:00:00').toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' });

  ['addClockIn','addClockOut'].forEach(id => {
    const el = document.getElementById(id);
    el.innerHTML = CONFIG.timeSlots.map(s => `<option value="${s.val}">${s.label}</option>`).join('');
  });

  document.getElementById('addClockingModal').classList.add('active');
}

function closeAddClockingModal() {
  document.getElementById('addClockingModal').classList.remove('active');
  _addClockingDate = null;
}

async function submitMissingClocking() {
  if (!_addClockingDate || !state.currentEmployee) return;

  const clockIn = document.getElementById('addClockIn').value;
  const clockOut = document.getElementById('addClockOut').value;
  const breakMins = parseInt(document.getElementById('addClockBreak').value) || 0;

  if (!clockIn || !clockOut) { toast('Please select times', 'error'); return; }

  // Hard block: workshop is closed on bank holidays.
  if (isBankHoliday(_addClockingDate)) {
    toast('Cannot add a clocking on a bank holiday — the workshop is closed.', 'error');
    return;
  }

  const empId = empIdByName(state.currentEmployee);
  if (!empId) { toast('Employee not found', 'error'); return; }

  try {
    const result = await api.post('/api/clockings', {
      employee_id: empId,
      // Use ISO with timezone so the server interprets local BST correctly (was off by 1 hour before)
      clock_in: new Date(`${_addClockingDate}T${clockIn}:00`).toISOString(),
      clock_out: new Date(`${_addClockingDate}T${clockOut}:00`).toISOString(),
      break_mins: breakMins,
      amended_by: state.currentEmployee
    });

    const newClocking = normaliseClocking({ ...result, employee_name: state.currentEmployee });
    newClocking.breakMins = breakMins;
    newClocking.manuallyEdited = true;
    newClocking.approvalStatus = 'pending';
    state.timesheetData.clockings.push(newClocking);

    closeAddClockingModal();
    toast('Submitted for manager approval ✓', 'success');
    renderMyWeek(state.currentEmployee);
  } catch (err) { toast('Save failed: ' + err.message, 'error'); }
}

// ═══════════════════════════════════════════
// AMENDMENT REQUESTS
// ═══════════════════════════════════════════
let _amendmentClockingId = null;

function openAmendmentRequest(clockingId) {
  _amendmentClockingId = String(clockingId);
  const clocking = state.timesheetData.clockings.find(c => String(c.id) === String(clockingId));
  if (!clocking) { toast('Clocking not found', 'error'); return; }

  const modal = document.getElementById('amendmentModal');
  if (!modal) { toast('Amendment modal not found', 'error'); return; }

  // Show current times
  document.getElementById('amendCurrentDate').textContent =
    new Date(clocking.date + 'T12:00:00').toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long' });
  document.getElementById('amendCurrentIn').textContent = clocking.clockIn || '—';
  document.getElementById('amendCurrentOut').textContent = clocking.clockOut || '—';

  // Fill time dropdowns
  ['amendNewIn','amendNewOut'].forEach(id => {
    const sel = document.getElementById(id);
    if (!sel) return;
    sel.innerHTML = '<option value="">No change</option>' +
      CONFIG.timeSlots.map(s => `<option value="${s.val}">${s.label}</option>`).join('');
  });

  document.getElementById('amendReason').value = '';
  modal.classList.add('active');
}

function closeAmendmentModal() {
  const modal = document.getElementById('amendmentModal');
  if (modal) modal.classList.remove('active');
  _amendmentClockingId = null;
}

async function submitAmendment() {
  const newIn = document.getElementById('amendNewIn').value;
  const newOut = document.getElementById('amendNewOut').value;
  const reason = document.getElementById('amendReason').value.trim();

  if (!newIn && !newOut) {
    toast('Please select at least one time to change', 'error');
    return;
  }
  if (!reason) {
    toast('Please provide a reason for the amendment', 'error');
    return;
  }

  const clocking = state.timesheetData.clockings.find(c => String(c.id) === String(_amendmentClockingId));
  if (!clocking) return;

  const empId = empIdByName(state.currentEmployee);
  if (!empId) { toast('Employee not found', 'error'); return; }

  try {
    const result = await api.post('/api/amendments', {
      clocking_id:   clocking.id,
      employee_id:   empId,
      clocking_date: clocking.date,
      original_in:   clocking.clockIn  || null,
      original_out:  clocking.clockOut || null,
      requested_in:  newIn  || null,
      requested_out: newOut || null,
      reason
    });

    if (!state.timesheetData.amendments) state.timesheetData.amendments = [];
    // Remove any previous amendment for this clocking from local state
    state.timesheetData.amendments = state.timesheetData.amendments.filter(
      a => String(a.clockingId) !== String(clocking.id)
    );
    state.timesheetData.amendments.push(normaliseAmendment({ ...result, employee_name: state.currentEmployee }));

    closeAmendmentModal();
    toast('Amendment request submitted ✓', 'success');
    renderMyWeek(state.currentEmployee);
    renderLastWeekReview(state.currentEmployee);
  } catch (err) {
    toast('Failed to submit amendment: ' + err.message, 'error');
  }
}

async function approveAmendment(id) {
  const amendment = (state.timesheetData.amendments || []).find(a => String(a.id) === String(id));
  if (!amendment) return;

  const clocking = state.timesheetData.clockings.find(c => String(c.id) === String(amendment.clockingId));
  if (!clocking) return;

  try {
    // Apply the time change to the clocking
    const updateBody = { amended_by: currentManagerUser || 'manager' };
    if (amendment.requestedIn)  updateBody.clock_in  = new Date(`${clocking.date}T${amendment.requestedIn}:00`).toISOString();
    if (amendment.requestedOut) updateBody.clock_out = new Date(`${clocking.date}T${amendment.requestedOut}:00`).toISOString();
    await api.put(`/api/clockings/${clocking.id}`, updateBody);

    // Mark amendment as approved in DB
    await api.put(`/api/amendments/${id}`, {
      status: 'approved',
      resolved_by: currentManagerUser || 'manager'
    });

    // Update local state
    if (amendment.requestedIn)  clocking.clockIn  = amendment.requestedIn;
    if (amendment.requestedOut) clocking.clockOut = amendment.requestedOut;
    clocking.manuallyEdited = true;
    amendment.status = 'approved';
    amendment.resolvedAt = new Date().toISOString();

    toast('Amendment approved — clocking updated ✓', 'success');
    renderManagerView();
  } catch (err) { toast('Save failed: ' + err.message, 'error'); }
}

async function rejectAmendment(id) {
  const amendment = (state.timesheetData.amendments || []).find(a => String(a.id) === String(id));
  if (!amendment) return;

  try {
    await api.put(`/api/amendments/${id}`, {
      status: 'rejected',
      resolved_by: currentManagerUser || 'manager'
    });

    amendment.status = 'rejected';
    amendment.resolvedAt = new Date().toISOString();

    toast('Amendment rejected', 'info');
    renderManagerView();
  } catch (err) { toast('Failed to reject: ' + err.message, 'error'); }
}


// Delete a project hours entry from the office view.
// Project hours no longer require manager approval — they're saved as-is and
// can be removed by the office team if logged in error.
async function deleteProjectEntry(id) {
  const entry = state.timesheetData.entries.find(e => String(e.id) === String(id));
  if (!entry) return;
  const label = `${entry.projectId} \u2014 ${entry.hours}h on ${fmtDateStr(entry.date)} (${entry.employeeName})`;
  if (!confirm(`Delete this entry?\n\n${label}\n\nThis cannot be undone.`)) return;
  try {
    await api.delete(`/api/project-hours/${id}`);
    state.timesheetData.entries = state.timesheetData.entries.filter(
      e => String(e.id) !== String(id)
    );

    // Deleted entry → S000 (Unproductive Time) for that day is stale.
    // Skip if the deleted row was itself the S000 — server will rebuild it
    // from the remaining ProjectHours, but no point round-tripping if the
    // user was specifically removing the S000 row.
    if (entry.projectId !== 'S000') {
      await recomputeS000Local(entry.employeeName, entry.date);
    }

    toast('Entry deleted', 'success');
    renderManagerView();
  } catch (err) { toast('Delete failed: ' + err.message, 'error'); }
}

async function writeToSharePoint() {
  const { mon, sun } = getWeekDates(state.currentWeekOffset);
  // All entries this week that haven't been synced yet (approval workflow removed)
  const toSync = state.timesheetData.entries.filter(
    e => e.date >= dateStr(mon) && e.date <= dateStr(sun) &&
         !e.synced &&
         e.projectId !== 'S000'  // Never write unproductive time to Project Tracker
  );

  if (!toSync.length) {
    toast('No new entries to sync', 'info'); return;
  }

  // Write S000 unproductive time to separate sheet
  const s000Entries = state.timesheetData.entries.filter(
    e => e.date >= dateStr(mon) && e.date <= dateStr(sun) &&
         !e.synced &&
         e.projectId === 'S000'
  );
  if (s000Entries.length) {
    await writeUnproductiveTimeLog(s000Entries);
  }

  const ok = await writeApprovedToLabourLog(toSync);
  if (ok) {
    toSync.forEach(e => e.synced = true);
    s000Entries.forEach(e => e.synced = true);
    toast(`${toSync.length} entries written to PROJECT TRACKER ✓`, 'success');
    renderManagerView();
  }
}

function changeWeek(dir) {
  state.currentWeekOffset += dir;
  renderManagerView();
}

function switchTab(name) {
  // Scope sidebar items to the correct sidebar
  const sidebarId = CURRENT_PAGE === 'office' ? 'officeSidebar' : 'mgrSidebar';
  const sidebar = document.getElementById(sidebarId);
  if (sidebar) {
    sidebar.querySelectorAll('.sidebar-nav-item').forEach(item => {
      item.classList.toggle('active', item.getAttribute('data-tab') === name);
    });
  }
  document.querySelectorAll('.tab-content').forEach(tc => {
    tc.classList.toggle('active', tc.id === `tab-${name}`);
  });
  if (name === 'dashboard') renderDashboard();
  if (name === 'staff') renderStaffList();
  if (name === 'clockinout') { clockLogWeekOffset = 0; renderClockLogForWeek(); }
  if (name === 'holidays') setTimeout(() => renderHolidayTab(), 50);
  if (name === 'payroll') { renderPayroll(); renderPayrollExtras(); checkArchiveReminder(); }
  if (name === 'archive') renderArchive();
  if (name === 'reports') setTimeout(() => renderReports(), 50);
  if (name === 'settings') { loadEmailSettings(); renderOfficeStaffList(); }
  if (name === 'useraccess') renderUserAccessTab();
  if (name === 'welding') renderWeldingTab();
  if (name === 'suppliers') renderSuppliersTab();
}

let activeReport = 'overview';
function selectReport(name) {
  if (document.querySelector(`.report-picker-card[data-report="${name}"]`)?.classList.contains('disabled')) return;
  activeReport = name;
  document.querySelectorAll('.report-picker-card').forEach(card => {
    card.classList.toggle('active', card.getAttribute('data-report') === name);
  });
  document.querySelectorAll('.report-panel').forEach(panel => {
    panel.classList.toggle('active', panel.id === `rptPanel-${name}`);
  });
  renderReports();
}

// ═══════════════════════════════════════════
// UI HELPERS
// ═══════════════════════════════════════════
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

function goHome() {
  clearInterval(workingTimer);
  state.currentEmployee = null;
  state.currentEntries = [];
  if (CURRENT_PAGE === 'manager') {
    currentManagerUser = null;
    _pendingManagerUser = null;
    showScreen('screenManagerSelect');
    renderManagerEmployeeGrid();
  } else if (CURRENT_PAGE === 'office') {
    currentManagerUser = null;
    _pendingManagerUser = null;
    showScreen('screenOfficeSelect');
    renderOfficeEmployeeGrid();
  } else if (CURRENT_PAGE === 'projects') {
    window.location.href = 'index.html';
  } else if (CURRENT_PAGE === 'templates') {
    window.location.href = 'manager.html';
  } else if (CURRENT_PAGE === 'hub') {
    window.location.href = 'hub.html';
  } else {
    showScreen('screenHome');
    renderHome();
  }
}

function setLoading(on) {
  document.getElementById('loadingBar').style.width = on ? '70%' : '0';
}

let toastTimer;
function toast(msg, type = 'info') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `toast show ${type}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

// ═══════════════════════════════════════════
// HOLIDAY KIOSK (home screen)
// ═══════════════════════════════════════════
let _hkEmployee = null;

function openHolidayKiosk() {
  const modal = document.getElementById('holidayKioskModal');
  modal.classList.add('active');
  renderHKStep1();
}

function closeHolidayKiosk() {
  document.getElementById('holidayKioskModal').classList.remove('active');
  _hkEmployee = null;
}

function renderHKStep1() {
  document.getElementById('hkStep1').style.display = '';
  document.getElementById('hkStep2').style.display = 'none';
  document.getElementById('hkStep3').style.display = 'none';

  const grid = document.getElementById('hkEmpGrid');
  const employees = (state.timesheetData.employees || []).filter(e => e.active !== false);
  grid.innerHTML = employees.map(emp => {
    const col = ['#ff6b00','#e05d00','#c84b00','#a83e00','#ff8c42','#f07030'][emp.name.charCodeAt(0) % 6];
    const ini = emp.name.split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase();
    return `
      <div class="emp-btn" onclick="hkSelectEmp('${emp.name.replace(/'/g,"\'")}')">
        <div class="emp-avatar" style="width:44px;height:44px;font-size:18px;background:linear-gradient(135deg,${col},#3e1a00);margin-bottom:8px">${ini}</div>
        <div class="emp-name" style="font-size:13px">${emp.name}</div>
      </div>
    `;
  }).join('');
}

function hkSelectEmp(name) {
  _hkEmployee = name;
  const emp = (state.timesheetData.employees || []).find(e => e.name === name);
  if (emp && emp.hasPin) {
    document.getElementById('hkStep1').style.display = 'none';
    document.getElementById('hkStep2').style.display = '';
    document.getElementById('hkPinName').textContent = name;
    document.getElementById('hkPinInput').value = '';
    document.getElementById('hkPinError').textContent = '';
    setTimeout(() => document.getElementById('hkPinInput').focus(), 100);
  } else {
    showHKStep3(name);
  }
}

async function checkHKPin() {
  const pin = document.getElementById('hkPinInput').value;
  const emp = (state.timesheetData.employees || []).find(e => e.name === _hkEmployee);
  if (!emp) return;

  let result;
  try {
    result = await api.post('/api/auth/verify-pin', { employee_id: emp.id, pin });
  } catch (err) {
    document.getElementById('hkPinError').textContent = 'Verification failed — try again';
    return;
  }

  if (result && result.valid) {
    showHKStep3(_hkEmployee);
  } else {
    document.getElementById('hkPinError').textContent = (result && result.reason) || 'Incorrect PIN — try again';
    document.getElementById('hkPinInput').value = '';
  }
}

function hkBack() {
  if (document.getElementById('hkStep2').style.display !== 'none') {
    document.getElementById('hkStep2').style.display = 'none';
    document.getElementById('hkStep1').style.display = '';
  } else if (document.getElementById('hkStep3').style.display !== 'none') {
    document.getElementById('hkStep3').style.display = 'none';
    document.getElementById('hkStep1').style.display = '';
    _hkEmployee = null;
  }
}

function showHKStep3(name) {
  document.getElementById('hkStep1').style.display = 'none';
  document.getElementById('hkStep2').style.display = 'none';
  document.getElementById('hkStep3').style.display = '';
  document.getElementById('hkEmpName').textContent = name;

  // Set default dates
  const today = todayStr();
  document.getElementById('hkFromDate').value = today;
  document.getElementById('hkToDate').value = today;
  document.getElementById('hkReason').value = '';

  // Render balance
  const bal = calculateHolidayBalance(name);
  const balEl = document.getElementById('hkBalance');
  if (bal) {
    balEl.innerHTML = `
      <div class="holiday-balance-bar" style="flex-wrap:wrap">
        <div class="hbal-item"><div class="hbal-value" style="color:var(--green)">${bal.remainingDays}</div><div class="hbal-label">Holidays Available</div></div>
        <div class="hbal-item"><div class="hbal-value">${bal.usedDays}</div><div class="hbal-label">Holidays Used</div></div>
        <div class="hbal-item"><div class="hbal-value" style="color:var(--accent2)">${bal.accruedDays}</div><div class="hbal-label">Holidays Accrued</div></div>
        <div class="hbal-item"><div class="hbal-value" style="color:var(--muted)">${bal.totalAllowance}</div><div class="hbal-label">Holiday Allowance</div></div>
      </div>
    `;
  }

  // Render holiday list
  renderHKHolidayList(name);
}

function renderHKHolidayList(name) {
  const el = document.getElementById('hkHolidayList');
  const hols = (state.timesheetData.holidays || [])
    .filter(h => h.employeeName === name)
    .sort((a, b) => b.dateFrom.localeCompare(a.dateFrom));

  if (!hols.length) {
    el.innerHTML = '<div style="color:var(--subtle);font-size:12px;text-align:center;padding:12px">No holiday requests yet</div>';
    return;
  }

  el.innerHTML = `<table class="summary-table" style="font-size:12px">
    <thead><tr><th>DATES</th><th>TYPE</th><th>DAYS</th><th>REASON</th><th>STATUS</th></tr></thead>
    <tbody>
      ${hols.map(h => `
        <tr>
          <td class="mono">${h.dateFrom}${h.dateFrom !== h.dateTo ? ' → '+h.dateTo : ''}</td>
          <td><span class="htype ${h.type}" style="font-size:10px">${h.type}</span></td>
          <td class="mono">${h.workingDays}d</td>
          <td style="color:var(--muted)">${h.reason || '—'}</td>
          <td><span class="tag tag-${h.status === 'approved' ? 'approved' : h.status === 'rejected' ? 'rejected' : 'pending'}" style="font-size:10px">${h.status}</span></td>
        </tr>
      `).join('')}
    </tbody>
  </table>`;
}

async function submitHKHoliday() {
  const from = document.getElementById('hkFromDate').value;
  const to = document.getElementById('hkToDate').value;
  const type = document.getElementById('hkType').value;
  const reason = document.getElementById('hkReason').value;

  if (!from || !to) { toast('Please select dates', 'error'); return; }
  if (from > to) { toast('End date must be after start date', 'error'); return; }

  let workingDays = countWorkingDays(from, to);
  if (type === 'half') workingDays = 0.5; // Half day always counts as 0.5
  if (workingDays === 0) { toast('No working days in selected range', 'error'); return; }

  if (type === 'paid' || type === 'half') {
    const bal = calculateHolidayBalance(_hkEmployee);
    if (bal && workingDays > bal.remainingDays) {
      toast(`Only ${bal.remainingDays} days remaining — request is ${workingDays} days`, 'error');
      return;
    }
  }

  const empId = empIdByName(_hkEmployee);
  if (!empId) { toast('Employee not found', 'error'); return; }

  try {
    const result = await api.post('/api/holidays', {
      employee_id: empId,
      date_from: from,
      date_to: to,
      type,
      reason,
      working_days: workingDays
    });

    const newHoliday = normaliseHoliday({ ...result, employee_name: _hkEmployee });
    if (!state.timesheetData.holidays) state.timesheetData.holidays = [];
    state.timesheetData.holidays.push(newHoliday);

    await sendHolidayNotificationEmail(newHoliday);
    document.getElementById('hkFromDate').value = todayStr();
    document.getElementById('hkToDate').value = todayStr();
    document.getElementById('hkReason').value = '';
    toast(`Holiday request submitted (${workingDays} working days) ✓`, 'success');
    renderHKHolidayList(_hkEmployee);
    showHKStep3(_hkEmployee);
    // If this modal was opened from the employee panel, refresh that view too
    if (state.currentEmployee === _hkEmployee) {
      renderMyHolidays(state.currentEmployee);
      renderEmpHolidayBalance(state.currentEmployee);
    }
  } catch (err) { toast('Submit failed: ' + err.message, 'error'); }
}

// ── Holiday notification on clock-in ──
// Shows a one-time approval/rejection notification for HOLIDAY requests only
// (paid + half-day). Sickness, unpaid leave, and other absence types do NOT
// trigger this popup. The "seen" state is persisted server-side via
// /api/holidays/:id/notification-seen so the user only sees each one once,
// across devices and browsers.
function checkHolidayClockInNotification(employeeName) {
  const unseen = (state.timesheetData.holidays || []).filter(h => {
    if (h.employeeName !== employeeName) return false;
    // Only paid and half-day holidays trigger the notification.
    if (h.type !== 'paid' && h.type !== 'half') return false;
    // Only show for actioned (approved/rejected) requests.
    if (h.status !== 'approved' && h.status !== 'rejected') return false;
    // Skip if already seen by the employee.
    if (h.notificationSeen) return false;
    return true;
  });

  if (!unseen.length) return;

  // Show notification for each unseen holiday
  unseen.forEach(h => {
    const approved = h.status === 'approved';
    const color = approved ? 'var(--green)' : 'var(--red)';

    // Show a full-screen notification overlay
    const overlay = document.createElement('div');
    overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:500;display:flex;align-items:center;justify-content:center;`;
    overlay.innerHTML = `
      <div style="background:var(--card);border:2px solid ${color};border-radius:16px;padding:40px;text-align:center;max-width:400px;margin:20px">
        <div style="font-size:48px;margin-bottom:16px">${approved ? '✅' : '❌'}</div>
        <div style="font-family:var(--font-display);font-size:28px;color:${color};margin-bottom:12px">
          HOLIDAY ${approved ? 'APPROVED' : 'DECLINED'}
        </div>
        <div style="color:var(--muted);font-size:14px;margin-bottom:8px">${h.dateFrom}${h.dateFrom !== h.dateTo ? ' → ' + h.dateTo : ''}</div>
        <div style="color:var(--text);font-size:16px;margin-bottom:24px">${h.workingDays} working days · ${h.type}</div>
        <button class="btn btn-primary" style="width:100%" data-holiday-id="${h.id}">OK</button>
      </div>
    `;
    document.body.appendChild(overlay);

    // Mark seen on dismiss — patch local state immediately so the popup
    // never re-appears in this session even if the API call fails, then
    // persist server-side so it survives logout/refresh.
    const okBtn = overlay.querySelector('button[data-holiday-id]');
    okBtn.addEventListener('click', async () => {
      h.notificationSeen = true;
      overlay.remove();
      try {
        await api.put(`/api/holidays/${h.id}/notification-seen`, {});
      } catch (err) {
        // Non-fatal: notification will reappear next login if persistence failed.
        console.warn('Failed to persist holiday notification seen flag:', err);
      }
    });
  });
}

let _editEntryId = null;

function openEditEntry(id) {
  const entry = state.timesheetData.entries.find(e => String(e.id) === String(id));
  if (!entry) return;
  _editEntryId = id;
  document.getElementById('editEntryProject').textContent = `${entry.projectId} — ${entry.projectName}`;
  document.getElementById('editEntryHours').value = entry.hours;
  document.getElementById('editEntryReason').value = '';
  document.getElementById('editEntryModal').classList.add('active');
}

function closeEditEntry() {
  document.getElementById('editEntryModal').classList.remove('active');
  _editEntryId = null;
}

async function saveEditEntry() {
  if (!_editEntryId) return;
  const entry = state.timesheetData.entries.find(e => String(e.id) === String(_editEntryId));
  if (!entry) return;

  const newHours = parseFloat(document.getElementById('editEntryHours').value);
  const reason = document.getElementById('editEntryReason').value.trim();
  if (!newHours || newHours <= 0) { toast('Please enter valid hours', 'error'); return; }
  if (!reason) { toast('Please provide a reason for the change', 'error'); document.getElementById('editEntryReason').focus(); return; }

  try {
    await api.put(`/api/project-hours/${_editEntryId}`, {
      hours: newHours,
      edit_reason: reason,
      edited_by: state.currentEmployee
      // is_approved kept as-is — project hours no longer require approval
    });

    entry.originalHours = entry.originalHours || entry.hours;
    entry.hours = newHours;
    entry.manuallyEdited = true;
    entry.editReason = reason;
    entry.editedAt = new Date().toISOString();

    // Recalculate S000 for this day if clocked
    const today = entry.date;
    const emp = entry.employeeName;
    const clocking = state.timesheetData.clockings.find(
      c => c.employeeName === emp && c.date === today && c.clockOut
    );
    if (clocking) {
      await recomputeS000Local(emp, today);
    }

    closeEditEntry();
    renderMyWeek(state.currentEmployee);
    toast('Hours updated ✓', 'success');
  } catch (err) { toast('Save failed: ' + err.message, 'error'); }
}

// ── Workshop General Duties / No Project Hours ──
let _pendingClockOutData = null;

function toggleWGDOption() {
  const box = document.getElementById('wgdOptionBox');
  const check = document.getElementById('wgdCheckbox');
  const btn = document.getElementById('noProjectClockOutBtn');
  const isChecked = check.textContent === '✓';

  if (isChecked) {
    check.textContent = '';
    check.style.background = 'var(--card)';
    check.style.borderColor = 'var(--border)';
    box.style.borderColor = 'var(--border)';
    box.style.background = 'var(--surface)';
    btn.disabled = true;
    btn.style.opacity = '.4';
    btn.style.cursor = 'not-allowed';
  } else {
    check.textContent = '✓';
    check.style.background = 'var(--green)';
    check.style.borderColor = 'var(--green)';
    check.style.color = '#fff';
    box.style.borderColor = 'var(--green)';
    box.style.background = 'rgba(62,207,142,.06)';
    btn.disabled = false;
    btn.style.opacity = '1';
    btn.style.cursor = 'pointer';
  }
}

function closeNoProjectModal() {
  document.getElementById('noProjectModal').classList.remove('active');
  _pendingClockOutData = null;
  // Reset checkbox
  const check = document.getElementById('wgdCheckbox');
  const box = document.getElementById('wgdOptionBox');
  const btn = document.getElementById('noProjectClockOutBtn');
  check.textContent = '';
  check.style.background = 'var(--card)';
  check.style.borderColor = 'var(--border)';
  box.style.borderColor = 'var(--border)';
  box.style.background = 'var(--surface)';
  btn.disabled = true;
  btn.style.opacity = '.4';
  btn.style.cursor = 'not-allowed';
}

async function confirmNoProjectClockOut() {
  if (!_pendingClockOutData) return;
  // Snapshot the data — closeNoProjectModal() below clears _pendingClockOutData,
  // and finishClockOut still needs it.
  const data = _pendingClockOutData;
  const { emp, today, clockOut, breakMins, clocking } = data;

  // Log full shift as WGD
  const clockedHrs = calcHours(clocking.clockIn, clockOut, breakMins, today) || 0;
  if (clockedHrs > 0) {
    const empId = empIdByName(emp);
    if (empId) {
      try {
        const result = await api.post('/api/project-hours', {
          employee_id: empId,
          project_number: 'WGD',
          date: today,
          hours: clockedHrs
        });
        state.timesheetData.entries.push(normaliseEntry({
          ...result,
          employee_name: emp,
          project_name: 'Workshop General Duties'
        }));
      } catch (e) {
        // ABORT: if WGD fails to save, do NOT proceed to clock-out — that would
        // log the entire shift as S000 (Unproductive Time) which is wrong.
        console.error('WGD entry save failed:', e.message);
        toast('Could not save Workshop General Duties — please try again', 'error');
        return;  // user stays on the modal, can retry
      }
    }
  }

  closeNoProjectModal();
  // Proceed with clock-out (use the snapshot — closeNoProjectModal nulled the global)
  await finishClockOut(data);
}

// ═══════════════════════════════════════════
// SEARCH FILTERS
// ═══════════════════════════════════════════
function filterProjectTable() {
  const q = (document.getElementById('projectSearchBox')?.value || '').toLowerCase();
  document.querySelectorAll('#projectTableBody tr').forEach(row => {
    row.style.display = !q || row.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

function filterEmployeeTable() {
  const q = (document.getElementById('employeeSearchBox')?.value || '').toLowerCase();
  document.querySelectorAll('#employeeTableBody tr').forEach(row => {
    row.style.display = !q || row.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

function filterClockLog() {
  const q = (document.getElementById('clockSearchBox')?.value || '').toLowerCase();
  document.querySelectorAll('#clockLogArea tr').forEach(row => {
    if (row.tagName === 'TR' && row.closest('thead')) return;
    row.style.display = !q || row.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

// ═══════════════════════════════════════════
// EMAIL SETTINGS
// ═══════════════════════════════════════════

// ═══════════════════════════════════════════
// OFFICE STAFF MANAGEMENT
// ═══════════════════════════════════════════
function renderOfficeStaffList() {
  const list = document.getElementById('officeStaffList');
  if (!list) return;
  const staff = (state.timesheetData.settings && state.timesheetData.settings.officeStaff) || [];
  if (!staff.length) {
    list.innerHTML = '<div style="font-size:13px;color:var(--subtle);padding:8px 0">No office staff added yet.</div>';
    return;
  }
  list.innerHTML = staff.map((name, i) => `
    <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-bottom:6px">
      <span style="font-size:14px">${name}</span>
      <button class="tiny-btn tiny-reject" onclick="removeOfficeStaff(${i})" style="font-size:11px;padding:2px 8px">Remove</button>
    </div>
  `).join('');
}

async function addOfficeStaff() {
  const input = document.getElementById('newOfficeStaffName');
  const name = (input.value || '').trim();
  if (!name) { toast('Please enter a name', 'error'); return; }
  if (!state.timesheetData.settings) state.timesheetData.settings = {};
  if (!state.timesheetData.settings.officeStaff) state.timesheetData.settings.officeStaff = [];
  if (state.timesheetData.settings.officeStaff.includes(name)) { toast('Name already exists', 'error'); return; }
  state.timesheetData.settings.officeStaff.push(name);
  input.value = '';
  try {
    await api.put('/api/settings', { officeStaff: state.timesheetData.settings.officeStaff });
    renderOfficeStaffList();
    toast(`${name} added to office staff ✓`, 'success');
  } catch (err) { toast('Save failed: ' + err.message, 'error'); }
}

async function removeOfficeStaff(index) {
  if (!state.timesheetData.settings || !state.timesheetData.settings.officeStaff) return;
  const name = state.timesheetData.settings.officeStaff[index];
  state.timesheetData.settings.officeStaff.splice(index, 1);
  try {
    await api.put('/api/settings', { officeStaff: state.timesheetData.settings.officeStaff });
    renderOfficeStaffList();
    toast(`${name} removed ✓`, 'success');
  } catch (err) { toast('Save failed: ' + err.message, 'error'); }
}

// ═══════════════════════════════════════════
// APPROVE WEEK MODAL
// ═══════════════════════════════════════════
function openApproveWeekModal() {
  const { mon, sun } = getWeekDates(clockLogWeekOffset);
  const monStr = dateStr(mon);
  const sunStr = dateStr(sun);

  // Count pending clockings for this week
  const weekClockings = (state.timesheetData.clockings || []).filter(
    c => c.date >= monStr && c.date <= sunStr
  );
  const pending = weekClockings.filter(c => c.approvalStatus === 'pending' || (!c.approvalStatus && !c.addedByManager));
  const alreadyApproved = weekClockings.filter(c => c.approvalStatus === 'approved');

  const summary = document.getElementById('approveWeekSummary');
  if (summary) {
    summary.innerHTML = `
      <div style="margin-bottom:6px"><span style="color:var(--text);font-weight:600">${weekClockings.length}</span> total clockings for ${fmtDate(mon)} – ${fmtDate(sun)}</div>
      <div style="color:var(--amber)">⏳ ${pending.length} pending approval</div>
      <div style="color:var(--green)">✓ ${alreadyApproved.length} already approved</div>
    `;
  }

  // Populate approver dropdown from employees with approval permissions
  const sel = document.getElementById('approveWeekApprover');
  if (sel) {
    sel.innerHTML = '<option value="">— Select approver —</option>';
    
    // Get names from employees with approval-capable ERP roles
    const approvalRoles = ['director', 'finance', 'office_admin'];
    const approvers = new Set();
    (state.timesheetData.employees || [])
      .filter(e => e.active !== false && approvalRoles.includes(e.erpRole))
      .forEach(e => approvers.add(e.name));
    
    // Also include legacy officeStaff names as fallback
    const legacyStaff = (state.timesheetData.settings && state.timesheetData.settings.officeStaff) || [];
    legacyStaff.forEach(name => approvers.add(name));

    approvers.forEach(name => {
      const opt = document.createElement('option');
      opt.value = name; opt.textContent = name;
      sel.appendChild(opt);
    });
    sel.onchange = () => {
      const btn = document.getElementById('approveWeekConfirmBtn');
      if (btn) btn.disabled = !sel.value;
    };
  }

  document.getElementById('approveWeekModal').classList.add('active');
}

function closeApproveWeekModal() {
  document.getElementById('approveWeekModal').classList.remove('active');
  const sel = document.getElementById('approveWeekApprover');
  if (sel) sel.value = '';
  const btn = document.getElementById('approveWeekConfirmBtn');
  if (btn) btn.disabled = true;
}

async function confirmApproveWeek() {
  const approver = document.getElementById('approveWeekApprover').value;
  if (!approver) { toast('Please select your name', 'error'); return; }

  const { mon, sun } = getWeekDates(clockLogWeekOffset);
  const monStr = dateStr(mon);
  const sunStr = dateStr(sun);

  // Find clockings to approve
  const toApprove = (state.timesheetData.clockings || []).filter(c => {
    if (c.date < monStr || c.date > sunStr) return false;
    return c.approvalStatus === 'pending' || (!c.approvalStatus && !c.addedByManager);
  });

  try {
    // Approve each clocking via API
    await Promise.all(toApprove.map(c =>
      api.put(`/api/clockings/${c.id}`, { amended_by: approver })
    ));

    toApprove.forEach(c => {
      c.approvalStatus = 'approved';
      c.approvedBy = approver;
      c.approvedAt = new Date().toISOString();
    });

    closeApproveWeekModal();
    renderClockLogForWeek();
    toast(`Week approved by ${approver} — ${toApprove.length} clocking${toApprove.length !== 1 ? 's' : ''} approved ✓`, 'success');
  } catch (err) { toast('Save failed: ' + err.message, 'error'); }
}

function loadEmailSettings() {
  const settings = state.timesheetData.settings || {};
  const payEl = document.getElementById('settingPayrollEmail');
  const ordEl = document.getElementById('settingOrderEmail');
  const draftEl = document.getElementById('settingDraftsmanEmail');
  const taskEl = document.getElementById('settingTaskCompletionEmails');
  const siteEl = document.getElementById('settingSiteCompletionEmails');
  if (payEl) payEl.value = settings.payrollEmail || '';
  if (ordEl) ordEl.value = settings.orderEmail || 'daniel@bamafabrication.co.uk';
  if (draftEl) draftEl.value = settings.draftsmanEmail || '';
  if (taskEl) taskEl.value = settings.taskCompletionEmails || '';
  if (siteEl) siteEl.value = settings.siteCompletionEmails || '';
  const attEl = document.getElementById('settingAttendanceStart');
  if (attEl) attEl.value = settings.attendanceStartTime || '07:00';
  const qhNameEl = document.getElementById('settingQuoteHandlerName');
  if (qhNameEl) qhNameEl.value = settings.quoteHandlerName || '';
  const qhEmailEl = document.getElementById('settingQuoteHandlerEmail');
  if (qhEmailEl) qhEmailEl.value = settings.quoteHandlerEmail || '';
}

async function saveEmailSettings() {
  if (!state.timesheetData.settings) state.timesheetData.settings = {};
  const payEl = document.getElementById('settingPayrollEmail');
  const ordEl = document.getElementById('settingOrderEmail');
  if (payEl) state.timesheetData.settings.payrollEmail = payEl.value;
  if (ordEl) state.timesheetData.settings.orderEmail = ordEl.value;
  const draftEl2 = document.getElementById('settingDraftsmanEmail');
  if (draftEl2) state.timesheetData.settings.draftsmanEmail = draftEl2.value;
  const taskEl = document.getElementById('settingTaskCompletionEmails');
  if (taskEl) state.timesheetData.settings.taskCompletionEmails = taskEl.value;
  const siteEl = document.getElementById('settingSiteCompletionEmails');
  if (siteEl) state.timesheetData.settings.siteCompletionEmails = siteEl.value;
  const attEl = document.getElementById('settingAttendanceStart');
  if (attEl) state.timesheetData.settings.attendanceStartTime = attEl.value;
  const qhNameEl = document.getElementById('settingQuoteHandlerName');
  if (qhNameEl) state.timesheetData.settings.quoteHandlerName = qhNameEl.value;
  const qhEmailEl = document.getElementById('settingQuoteHandlerEmail');
  if (qhEmailEl) state.timesheetData.settings.quoteHandlerEmail = qhEmailEl.value;
  try {
    await api.put('/api/settings', {
      payrollEmail: state.timesheetData.settings.payrollEmail || '',
      orderEmail: state.timesheetData.settings.orderEmail || '',
      draftsmanEmail: state.timesheetData.settings.draftsmanEmail || '',
      taskCompletionEmails: state.timesheetData.settings.taskCompletionEmails || '',
      siteCompletionEmails: state.timesheetData.settings.siteCompletionEmails || '',
      attendanceStartTime: state.timesheetData.settings.attendanceStartTime || '07:00',
      quoteHandlerName: state.timesheetData.settings.quoteHandlerName || '',
      quoteHandlerEmail: state.timesheetData.settings.quoteHandlerEmail || ''
    });
    toast('Email settings saved ✓', 'success');
  } catch (err) { toast('Save failed: ' + err.message, 'error'); }
}

// ═══════════════════════════════════════════
// ORDER FORM
// ═══════════════════════════════════════════
function openOrderForm() {
  buildOrderTable();
  document.getElementById('orderFormModal').classList.add('active');
}

function closeOrderForm() {
  document.getElementById('orderFormModal').classList.remove('active');
}

function buildOrderTable() {
  const tbody = document.getElementById('orderTableBody');
  tbody.innerHTML = '';

  // Build project dropdown options
  const projOpts = state.projects.map(p =>
    `<option value="${p.id}">${p.id} — ${p.name}</option>`
  ).join('');

  // Build employee dropdown options
  const empOpts = (state.timesheetData.employees || [])
    .filter(e => e.active !== false)
    .map(e => `<option value="${e.name}">${e.name}</option>`)
    .join('');

  for (let i = 1; i <= 10; i++) {
    const tr = document.createElement('tr');
    tr.style.borderBottom = '1px solid var(--border)';
    tr.innerHTML = `
      <td style="padding:6px 10px;color:var(--subtle);font-size:12px;font-family:var(--font-mono)">${i}</td>
      <td style="padding:4px 6px"><input type="text" class="field-input" id="ord-product-${i}" placeholder="Product or description" style="padding:7px 10px;font-size:12px"></td>
      <td style="padding:4px 6px"><input type="number" class="field-input" id="ord-qty-${i}" placeholder="1" min="1" style="padding:7px 10px;font-size:12px;text-align:center"></td>
      <td style="padding:4px 6px"><input type="text" class="field-input" id="ord-supplier-${i}" placeholder="Optional" style="padding:7px 10px;font-size:12px"></td>
      <td style="padding:4px 6px"><input type="date" class="field-input" id="ord-needby-${i}" style="padding:7px 10px;font-size:12px"></td>
      <td style="padding:4px 6px">
        <select class="field-input" id="ord-project-${i}" style="padding:7px 10px;font-size:12px">
          <option value="">— Not project specific</option>
          ${projOpts}
        </select>
      </td>
      <td style="padding:4px 6px">
        <select class="field-input" id="ord-orderedby-${i}" style="padding:7px 10px;font-size:12px">
          <option value="">— Select</option>
          ${empOpts}
        </select>
      </td>
    `;
    tbody.appendChild(tr);
  }
}

function clearOrderForm() {
  buildOrderTable();
}

async function submitOrderForm() {
  // Collect filled rows
  const lines = [];
  for (let i = 1; i <= 10; i++) {
    const product = document.getElementById(`ord-product-${i}`)?.value?.trim();
    const qty = document.getElementById(`ord-qty-${i}`)?.value?.trim();
    if (!product) continue;
    lines.push({
      line: i,
      product,
      qty: qty || '1',
      supplier: document.getElementById(`ord-supplier-${i}`)?.value?.trim() || '—',
      needBy: document.getElementById(`ord-needby-${i}`)?.value || '—',
      projectId: document.getElementById(`ord-project-${i}`)?.value || '—',
      orderedBy: document.getElementById(`ord-orderedby-${i}`)?.value || '—'
    });
  }

  if (!lines.length) { toast('Please add at least one item', 'error'); return; }

  const orderEmail = state.timesheetData.settings?.orderEmail || 'daniel@bamafabrication.co.uk';
  const submitted = new Date().toLocaleString('en-GB');

  // Build email HTML table
  const tableRows = lines.map(l => `
    <tr style="border-bottom:1px solid #eee">
      <td style="padding:8px 10px">${l.line}</td>
      <td style="padding:8px 10px"><b>${l.product}</b></td>
      <td style="padding:8px 10px;text-align:center">${l.qty}</td>
      <td style="padding:8px 10px">${l.supplier}</td>
      <td style="padding:8px 10px">${l.needBy}</td>
      <td style="padding:8px 10px">${l.projectId}</td>
      <td style="padding:8px 10px">${l.orderedBy}</td>
    </tr>
  `).join('');

  const emailBody = {
    message: {
      subject: `Workshop Order Request — ${lines.length} item${lines.length > 1 ? 's' : ''} — ${submitted}`,
      body: {
        contentType: 'HTML',
        content: `
          <h2 style="color:#ff6b00;font-family:sans-serif;margin-bottom:4px">BAMA FABRICATION</h2>
          <h3 style="font-family:sans-serif;color:#333;margin-bottom:20px">Workshop Order Request</h3>
          <p style="font-family:sans-serif;font-size:13px;color:#888;margin-bottom:16px">Submitted: ${submitted}</p>
          <table style="width:100%;border-collapse:collapse;font-family:sans-serif;font-size:13px">
            <thead>
              <tr style="background:#f5f5f5">
                <th style="padding:8px 10px;text-align:left;font-size:11px;color:#888">#</th>
                <th style="padding:8px 10px;text-align:left;font-size:11px;color:#888">PRODUCT</th>
                <th style="padding:8px 10px;text-align:center;font-size:11px;color:#888">QTY</th>
                <th style="padding:8px 10px;text-align:left;font-size:11px;color:#888">SUPPLIER</th>
                <th style="padding:8px 10px;text-align:left;font-size:11px;color:#888">NEED BY</th>
                <th style="padding:8px 10px;text-align:left;font-size:11px;color:#888">PROJECT ID</th>
                <th style="padding:8px 10px;text-align:left;font-size:11px;color:#888">ORDERED BY</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
          </table>
          <p style="margin-top:24px;font-family:sans-serif;font-size:12px;color:#aaa">
            Sent from BAMA Workshop Timesheet App —
            <a href="https://proud-dune-0dee63110.2.azurestaticapps.net" style="color:#ff6b00">Open App</a>
          </p>
        `
      },
      toRecipients: [{ emailAddress: { address: orderEmail } }]
    },
    saveToSentItems: true
  };

  try {
    const token = await getToken();
    const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(emailBody)
    });

    if (res.ok || res.status === 202) {
      toast(`Order sent to ${orderEmail} ✓`, 'success');
      closeOrderForm();
    } else {
      const err = await res.text();
      console.error('Order email error:', err);
      toast('Email failed — check console', 'error');
    }
  } catch (e) {
    console.error('Order submit error:', e);
    toast('Failed to send order', 'error');
  }
}

// Live clock
function updateClock() {
  const el = document.getElementById('liveClock');
  if (!el) return;
  const now = new Date();
  const h = String(now.getHours()).padStart(2,'0');
  const m = String(now.getMinutes()).padStart(2,'0');
  el.textContent =
    `${h}:${m} — ${now.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' })}`;
}
setInterval(updateClock, 1000);
updateClock();

const _todayDateEl = document.getElementById('todayDate');
if (_todayDateEl) _todayDateEl.textContent =
  new Date().toLocaleDateString('en-GB', { weekday:'long', day:'numeric', month:'long', year:'numeric' });

// ═══════════════════════════════════════════
// HOLIDAY ENGINE
// ═══════════════════════════════════════════

// UK Bank Holidays 2025-2027
const UK_BANK_HOLIDAYS = [
  '2025-01-01','2025-04-18','2025-04-21','2025-05-05','2025-05-26',
  '2025-08-25','2025-12-25','2025-12-26',
  '2026-01-01','2026-04-03','2026-04-06','2026-05-04','2026-05-25',
  '2026-08-31','2026-12-25','2026-12-28',
  '2027-01-01','2027-03-26','2027-03-29','2027-05-03','2027-05-31',
  '2027-08-30','2027-12-27','2027-12-28'
];

const HOLIDAY_YEAR_START = '2026-03-30';
const DEFAULT_ANNUAL_DAYS = 20;
let holidayMonthOffset = 0;

function isBankHoliday(dateStr) {
  return UK_BANK_HOLIDAYS.includes(dateStr);
}

function isWeekend(dateStr) {
  const d = new Date(dateStr + 'T12:00:00');
  return d.getDay() === 0 || d.getDay() === 6;
}

function countWorkingDays(fromStr, toStr) {
  let count = 0;
  const from = new Date(fromStr + 'T12:00:00');
  const to = new Date(toStr + 'T12:00:00');
  const cur = new Date(from);
  while (cur <= to) {
    const ds = dateStr(cur);
    if (!isWeekend(ds) && !isBankHoliday(ds)) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count;
}

function getHolidayYearStart(forDate) {
  // Returns the start of the holiday year that contains forDate
  const base = new Date(HOLIDAY_YEAR_START + 'T00:00:00');
  const target = new Date((forDate || todayStr()) + 'T00:00:00');
  let yearStart = new Date(base);
  while (yearStart <= target) {
    const next = new Date(yearStart);
    next.setFullYear(next.getFullYear() + 1);
    if (next > target) break;
    yearStart = next;
  }
  return dateStr(yearStart);
}

function calculateHolidayBalance(employeeName) {
  const emp = (state.timesheetData.employees || []).find(e => e.name === employeeName);
  if (!emp) return null;

  const yearStart = getHolidayYearStart(todayStr());
  const yearEnd = new Date(yearStart + 'T00:00:00');
  yearEnd.setFullYear(yearEnd.getFullYear() + 1);
  yearEnd.setDate(yearEnd.getDate() - 1);
  const yearEndStr = dateStr(yearEnd);

  // Use employee's actual entitlement (was hardcoded to 20 — ignored emp.annualDays)
  const BASE_ENTITLEMENT = (emp.annualDays && emp.annualDays > 0) ? emp.annualDays : 20;
  let allocation = BASE_ENTITLEMENT;

  // Pro-rata only if employee started AFTER the holiday year start
  if (emp.startDate && emp.startDate > yearStart) {
    const totalDays = countWorkingDays(yearStart, yearEndStr);
    const remainingDays = countWorkingDays(emp.startDate, yearEndStr);
    allocation = totalDays > 0 ? Math.round((remainingDays / totalDays) * BASE_ENTITLEMENT * 2) / 2 : 0;
  }
  // If started on or before holiday year start → full 20 days

  const carryover = emp.carryoverDays || 0;
  const totalAllowance = allocation + carryover;

  // Count approved holidays in this year
  const approved = (state.timesheetData.holidays || []).filter(h =>
    h.employeeName === employeeName &&
    h.status === 'approved' &&
    (h.type === 'paid' || h.type === 'half') &&
    h.dateFrom >= yearStart && h.dateFrom <= yearEndStr
  );
  const usedDays = approved.reduce((s, h) => s + (h.workingDays || countWorkingDays(h.dateFrom, h.dateTo)), 0);

  // Count pending
  const pending = (state.timesheetData.holidays || []).filter(h =>
    h.employeeName === employeeName &&
    h.status === 'pending' &&
    (h.type === 'paid' || h.type === 'half') &&
    h.dateFrom >= yearStart
  );
  const pendingDays = pending.reduce((s, h) => s + (h.workingDays || countWorkingDays(h.dateFrom, h.dateTo)), 0);

  // Holidays accrued — what they've earned so far based on time worked this year.
  // Formula: allocation × (working days worked since accrual-start ÷ working days
  // from accrual-start to year-end). Accrual-start is whichever is later: their
  // start_date or the holiday year start. Result rounded to nearest 0.5 day.
  const today = todayStr();
  const accrualStart = (emp.startDate && emp.startDate > yearStart) ? emp.startDate : yearStart;
  let accruedDays = 0;
  if (accrualStart <= today) {
    const totalAccrualWindow = countWorkingDays(accrualStart, yearEndStr);
    const workedSoFar = countWorkingDays(accrualStart, today);
    if (totalAccrualWindow > 0) {
      accruedDays = Math.round((allocation * workedSoFar / totalAccrualWindow) * 2) / 2;
    }
  }

  return {
    allocation,
    carryover,
    totalAllowance,
    usedDays,
    pendingDays,
    accruedDays,
    remainingDays: totalAllowance - usedDays,
    yearStart,
    yearEndStr
  };
}

// ── Employee holiday request ──
function renderEmpHolidayBalance(employeeName) {
  const el = document.getElementById('empHolidayBalance');
  if (!el) return;
  const bal = calculateHolidayBalance(employeeName);
  if (!bal) return;

  el.innerHTML = `
    <div class="holiday-balance-bar">
      <div class="hbal-item">
        <div class="hbal-value" style="color:var(--green)">${bal.remainingDays}</div>
        <div class="hbal-label">Holidays Available</div>
      </div>
      <div class="hbal-item">
        <div class="hbal-value">${bal.usedDays}</div>
        <div class="hbal-label">Holidays Used</div>
      </div>
      <div class="hbal-item">
        <div class="hbal-value" style="color:var(--accent2)">${bal.accruedDays}</div>
        <div class="hbal-label">Holidays Accrued</div>
      </div>
      <div class="hbal-item">
        <div class="hbal-value" style="color:var(--muted)">${bal.totalAllowance}</div>
        <div class="hbal-label">Holiday Allowance</div>
      </div>
      ${bal.carryover > 0 ? `
      <div class="hbal-item">
        <div class="hbal-value" style="color:var(--accent2)">${bal.carryover}</div>
        <div class="hbal-label">Carried Over</div>
      </div>` : ''}
    </div>
  `;

  // Show history
  const history = document.getElementById('empHolidayHistory');
  if (!history) return;
  const myHols = (state.timesheetData.holidays || [])
    .filter(h => h.employeeName === employeeName)
    .sort((a, b) => b.dateFrom.localeCompare(a.dateFrom));

  if (!myHols.length) {
    history.innerHTML = '<div style="color:var(--subtle);font-size:12px;text-align:center;padding:8px">No holiday requests yet</div>';
    return;
  }

  history.innerHTML = `
    <div class="section-label" style="margin-bottom:10px">Your Requests</div>
    ${myHols.map(h => `
      <div class="holiday-chip">
        <span class="hdate">${fmtDateStr(h.dateFrom)} → ${fmtDateStr(h.dateTo)}</span>
        <span class="htype ${h.type}">${h.type === 'paid' ? 'Paid' : h.type === 'unpaid' ? 'Unpaid Absence' : h.type === 'sick' ? 'Sick' : h.type === 'half' ? 'Half Day' : h.type}</span>
        <span style="flex:1;color:var(--muted);font-size:12px">${h.reason || ''}</span>
        <span style="font-family:var(--font-mono);font-size:12px">${h.workingDays || 0}d</span>
        <span class="tag tag-${h.status === 'approved' ? 'approved' : h.status === 'rejected' ? 'rejected' : 'pending'}" style="margin-left:8px">${h.status}</span>
      </div>
    `).join('')}
  `;
}

// ── My Holidays card on employee panel ──
// Shows paid + half-day holidays only (excludes sick / unpaid absence per design)
function renderMyHolidays(employeeName) {
  const el = document.getElementById('myHolidaysList');
  if (!el) return;

  const today = todayStr();
  const myHols = (state.timesheetData.holidays || [])
    .filter(h => h.employeeName === employeeName)
    .filter(h => h.type === 'paid' || h.type === 'half')
    // Sort: future first (most imminent at top), then past in reverse chronological
    .sort((a, b) => {
      const aFuture = a.dateFrom >= today;
      const bFuture = b.dateFrom >= today;
      if (aFuture && !bFuture) return -1;
      if (!aFuture && bFuture) return 1;
      return aFuture
        ? a.dateFrom.localeCompare(b.dateFrom)   // future: ascending (soonest first)
        : b.dateFrom.localeCompare(a.dateFrom);  // past: descending (most recent first)
    });

  if (!myHols.length) {
    el.innerHTML = '<div style="color:var(--subtle);font-size:13px;text-align:center;padding:18px">No holiday requests yet — tap <b>+ Request</b> to book one</div>';
    return;
  }

  // Cap at 12 most relevant entries to keep the card a sensible size on the kiosk
  const visible = myHols.slice(0, 12);
  const hidden = myHols.length - visible.length;

  const dayMs = 1000 * 60 * 60 * 24;
  const todayDate = new Date(today + 'T12:00:00');

  el.innerHTML = visible.map(h => {
    const fromDate = new Date(h.dateFrom + 'T12:00:00');
    const toDate   = new Date(h.dateTo   + 'T12:00:00');
    const daysUntil = Math.round((fromDate - todayDate) / dayMs);

    // Status colour for the left rail
    const statusColor = h.status === 'approved' ? 'var(--green)'
                      : h.status === 'rejected' ? 'var(--red)'
                      : 'var(--amber)';
    const statusLabel = h.status === 'approved' ? 'Approved'
                      : h.status === 'rejected' ? 'Declined'
                      : 'Pending';

    const typeLabel = h.type === 'half' ? 'Half Day' : 'Paid';
    const dateRange = h.dateFrom === h.dateTo
      ? fmtDateStr(h.dateFrom)
      : `${fmtDateStr(h.dateFrom)} → ${fmtDateStr(h.dateTo)}`;

    // Future-relative label (only for approved/pending — declined doesn't matter)
    let timing = '';
    if (h.status !== 'rejected') {
      if (daysUntil > 0)        timing = `<span style="color:var(--muted);font-size:11px">in ${daysUntil} day${daysUntil !== 1 ? 's' : ''}</span>`;
      else if (daysUntil === 0) timing = `<span style="color:var(--green);font-size:11px;font-weight:600">today</span>`;
      else if (daysUntil >= -7 && h.status === 'approved' && toDate >= todayDate) timing = `<span style="color:var(--green);font-size:11px">currently on holiday</span>`;
    }

    return `
      <div style="display:flex;align-items:center;gap:12px;padding:10px 12px;background:var(--surface);border:1px solid var(--border);border-left:3px solid ${statusColor};border-radius:8px;margin-bottom:6px">
        <div style="flex:1;min-width:0">
          <div style="font-family:var(--font-mono);font-size:13px;color:var(--text)">${dateRange}</div>
          <div style="display:flex;gap:8px;align-items:center;margin-top:2px;flex-wrap:wrap">
            <span style="font-size:11px;color:var(--muted)">${typeLabel} · ${h.workingDays}d</span>
            ${timing}
            ${h.reason ? `<span style="font-size:11px;color:var(--subtle);font-style:italic">· ${h.reason}</span>` : ''}
          </div>
        </div>
        <span class="tag tag-${h.status === 'approved' ? 'approved' : h.status === 'rejected' ? 'rejected' : 'pending'}" style="font-size:10px;flex-shrink:0">${statusLabel}</span>
      </div>
    `;
  }).join('') + (hidden > 0
    ? `<div style="text-align:center;font-size:11px;color:var(--subtle);padding:8px 0 4px">+ ${hidden} older request${hidden !== 1 ? 's' : ''} not shown</div>`
    : '');
}

// Opens the holiday kiosk from the employee panel, pre-selecting the current employee
// (skips the "select your name" step since we already know who they are)
function openHolidayKioskFromPanel() {
  if (!state.currentEmployee) {
    openHolidayKiosk();
    return;
  }
  const emp = (state.timesheetData.employees || []).find(e => e.name === state.currentEmployee);
  if (!emp) { openHolidayKiosk(); return; }

  document.getElementById('holidayKioskModal').classList.add('active');
  // They've already PIN-authed to get into the panel — go straight to step 3
  _hkEmployee = state.currentEmployee;
  showHKStep3(state.currentEmployee);
}

async function submitHolidayRequest() {
  const from = document.getElementById('holFromDate').value;
  const to = document.getElementById('holToDate').value;
  const type = document.getElementById('holType').value;
  const reason = document.getElementById('holReason').value;

  if (!from || !to) { toast('Please select dates', 'error'); return; }
  if (from > to) { toast('End date must be after start date', 'error'); return; }

  // Check for bank holidays in range
  const workingDays = countWorkingDays(from, to);
  if (workingDays === 0) { toast('No working days in selected range', 'error'); return; }

  // Check balance for paid holiday
  if (type === 'paid') {
    const bal = calculateHolidayBalance(state.currentEmployee);
    if (bal && workingDays > bal.remainingDays) {
      toast(`Only ${bal.remainingDays} days remaining — request is ${workingDays} days`, 'error');
      return;
    }
  }

  const empId = empIdByName(state.currentEmployee);
  if (!empId) { toast('Employee not found', 'error'); return; }

  try {
    const result = await api.post('/api/holidays', {
      employee_id: empId,
      date_from: from,
      date_to: to,
      type,
      reason,
      working_days: workingDays
    });

    const newHoliday = normaliseHoliday({ ...result, employee_name: state.currentEmployee });
    if (!state.timesheetData.holidays) state.timesheetData.holidays = [];
    state.timesheetData.holidays.push(newHoliday);

    // Send email notification
    await sendHolidayNotificationEmail(newHoliday);
    document.getElementById('holFromDate').value = '';
    document.getElementById('holToDate').value = '';
    document.getElementById('holReason').value = '';
    toast(`Holiday request submitted (${workingDays} working days) ✓`, 'success');
    renderEmpHolidayBalance(state.currentEmployee);
  } catch (err) { toast('Submit failed: ' + err.message, 'error'); }
}

async function sendHolidayNotificationEmail(request) {
  // Uses Microsoft Graph to send email via the logged-in user's account
  try {
    const token = await getToken();
    const emailBody = {
      message: {
        subject: `Holiday Request — ${request.employeeName} (${request.dateFrom} to ${request.dateTo})`,
        body: {
          contentType: 'HTML',
          content: `
            <h2 style="color:#ff6b00;font-family:sans-serif">BAMA Workshop — Holiday Request</h2>
            <table style="font-family:sans-serif;font-size:14px;border-collapse:collapse">
              <tr><td style="padding:6px 16px 6px 0;color:#888">Employee</td><td><b>${request.employeeName}</b></td></tr>
              <tr><td style="padding:6px 16px 6px 0;color:#888">From</td><td>${request.dateFrom}</td></tr>
              <tr><td style="padding:6px 16px 6px 0;color:#888">To</td><td>${request.dateTo}</td></tr>
              <tr><td style="padding:6px 16px 6px 0;color:#888">Working Days</td><td><b>${request.workingDays}</b></td></tr>
              <tr><td style="padding:6px 16px 6px 0;color:#888">Type</td><td>${request.type}</td></tr>
              <tr><td style="padding:6px 16px 6px 0;color:#888">Reason</td><td>${request.reason || '—'}</td></tr>
              <tr><td style="padding:6px 16px 6px 0;color:#888">Submitted</td><td>${new Date(request.submittedAt).toLocaleString('en-GB')}</td></tr>
            </table>
            <p style="margin-top:20px;font-family:sans-serif;font-size:13px;color:#888">
              Log in to the BAMA Workshop Timesheet to approve or reject this request.<br>
              <a href="https://proud-dune-0dee63110.2.azurestaticapps.net" style="color:#ff6b00">Open Timesheet App</a>
            </p>
          `
        },
        toRecipients: [{ emailAddress: { address: 'daniel@bamafabrication.co.uk' } }]
      },
      saveToSentItems: false
    };

    await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(emailBody)
    });
    console.log('Holiday notification email sent ✓');
  } catch (e) {
    console.warn('Email notification failed:', e.message, e);
    // Non-critical — holiday still saved, just email didn't send
  }
}

// ── Manager holiday tab ──
function renderHolidayTab() {
  renderHolidayCalendar();
  renderHolidayRequests();
  renderHolidayNotificationBanner();
  renderHolidayEmpFilter();
}

function renderHolidayNotificationBanner() {
  const el = document.getElementById('holidayNotificationBanner');
  if (!el) return;
  // On office page, the top-level checkHolidayNotifications banner already shows this
  if (CURRENT_PAGE === 'office') { el.innerHTML = ''; return; }
  const pending = (state.timesheetData.holidays || []).filter(h => h.status === 'pending');
  if (!pending.length) { el.innerHTML = ''; return; }
  el.innerHTML = `
    <div class="notification-banner" onclick="switchTab('holidays')">
      <span class="nb-icon">&#127959;</span>
      <span class="nb-text"><b>${pending.length} holiday request${pending.length > 1 ? 's' : ''}</b> awaiting your approval</span>
      <span class="nb-count">${pending.length}</span>
    </div>
  `;
}

function renderHolidayEmpFilter() {
  const sel = document.getElementById('holidayEmpFilter');
  if (!sel) return;
  const current = sel.value;
  sel.innerHTML = '<option value="">All Employees</option>';
  (state.timesheetData.employees || [])
    .filter(e => e.active !== false)
    .forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.name; opt.textContent = e.name;
      if (e.name === current) opt.selected = true;
      sel.appendChild(opt);
    });
}

function renderHolidayCalendar() {
  const wrap = document.getElementById('holidayGanttWrap');
  const rangeLabel = document.getElementById('ganttRangeLabel');
  if (!wrap) return;

  const empFilter = document.getElementById('holidayEmpFilter')?.value || '';
  const employees = (state.timesheetData.employees || [])
    .filter(e => e.active !== false && (!empFilter || e.name === empFilter));

  // Build 3-month date range starting from holidayMonthOffset
  const now = new Date();
  const startMonth = new Date(now.getFullYear(), now.getMonth() + holidayMonthOffset, 1);
  const months = [];
  for (let m = 0; m < 3; m++) {
    const mo = new Date(startMonth.getFullYear(), startMonth.getMonth() + m, 1);
    months.push(mo);
  }

  const endMonth = new Date(months[2].getFullYear(), months[2].getMonth() + 1, 0);

  if (rangeLabel) {
    rangeLabel.textContent = `${startMonth.toLocaleDateString('en-GB',{month:'short',year:'numeric'})} – ${endMonth.toLocaleDateString('en-GB',{month:'short',year:'numeric'})}`;
  }

  // Build all days in the range
  const allDays = [];
  const cur = new Date(startMonth);
  while (cur <= endMonth) {
    allDays.push(dateStr(cur));
    cur.setDate(cur.getDate() + 1);
  }

  // Cell width
  const cellW = 22;
  const labelW = 130;
  const totalW = labelW + allDays.length * cellW;

  // Build HTML
  let ganttHtml = `<div style="min-width:${totalW}px;width:${totalW}px;font-size:11px;font-family:var(--font-mono);display:block">`;

  // Month headers
  ganttHtml += `<div style="display:flex;margin-left:${labelW}px;margin-bottom:2px">`;
  months.forEach(mo => {
    const daysInMo = new Date(mo.getFullYear(), mo.getMonth() + 1, 0).getDate();
    ganttHtml += `<div style="width:${daysInMo * cellW}px;text-align:center;font-size:11px;font-weight:600;color:var(--text);letter-spacing:.5px;border-left:1px solid var(--border);padding:2px 0">
      ${mo.toLocaleDateString('en-GB',{month:'short',year:'numeric'})}
    </div>`;
  });
  ganttHtml += '</div>';

  // Day number header
  ganttHtml += `<div style="display:flex;margin-left:${labelW}px;margin-bottom:4px">`;
  allDays.forEach(ds => {
    const d = new Date(ds + 'T12:00:00');
    const isWE = isWeekend(ds);
    const isBH = isBankHoliday(ds);
    const isToday = ds === todayStr();
    ganttHtml += `<div style="width:${cellW}px;text-align:center;font-size:9px;
      color:${isToday ? 'var(--accent)' : isWE || isBH ? 'var(--subtle)' : 'var(--muted)'};
      font-weight:${isToday ? '700' : '400'}">
      ${d.getDate()}
    </div>`;
  });
  ganttHtml += '</div>';

  // Employee rows
  employees.forEach(emp => {
    ganttHtml += `<div style="display:flex;align-items:center;margin-bottom:3px">`;
    ganttHtml += `<div style="width:${labelW}px;padding-right:10px;font-weight:600;font-size:12px;
      color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-family:var(--font-body)">
      ${emp.name}
    </div>`;

    allDays.forEach(ds => {
      const isWE = isWeekend(ds);
      const isBH = isBankHoliday(ds);
      const isToday = ds === todayStr();

      const hol = (state.timesheetData.holidays || []).find(h =>
        h.employeeName === emp.name && h.dateFrom <= ds && h.dateTo >= ds
      );

      let bg = 'transparent';
      let title = '';
      let border = '1px solid transparent';

      if (isBH) {
        bg = 'rgba(96,165,250,.3)';
        title = 'Bank Holiday';
      } else if (isWE) {
        bg = 'rgba(100,100,100,.15)';
      } else if (hol) {
        if (hol.status === 'pending') {
          bg = 'rgba(236,72,153,.4)';
          title = 'Pending approval';
          border = '1px solid rgba(236,72,153,.6)';
        } else if (hol.status === 'approved') {
          if (hol.type === 'sick') {
            bg = 'rgba(239,68,68,.45)';
            title = 'Sick (approved)';
          } else if (hol.type === 'unpaid') {
            bg = 'rgba(255,159,67,.45)';
            title = 'Unpaid absence (approved)';
          } else {
            bg = 'rgba(62,207,142,.5)';
            title = `${hol.type === 'half' ? 'Half day' : 'Paid'} holiday (approved)`;
          }
        }
      }

      if (isToday) border = '1px solid var(--accent)';

      ganttHtml += `<div style="width:${cellW}px;height:22px;background:${bg};border:${border};
        border-radius:2px;cursor:default" title="${title}"></div>`;
    });

    ganttHtml += '</div>';
  });

  ganttHtml += '</div>';
  wrap.innerHTML = ganttHtml;
}

function changeHolidayMonth(dir) {
  holidayMonthOffset += dir;
  renderHolidayCalendar();
}

function renderHolidayRequests() {
  const container = document.getElementById('holidayRequestsList');
  if (!container) return;
  const empFilter = document.getElementById('holidayEmpFilter')?.value || '';

  let holidays = (state.timesheetData.holidays || [])
    .filter(h => !empFilter || h.employeeName === empFilter)
    .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));

  if (!holidays.length) {
    container.innerHTML = '<div class="empty-state" style="padding:24px">No holiday requests yet</div>';
    return;
  }

  const pending = holidays.filter(h => h.status === 'pending');
  const others = holidays.filter(h => h.status !== 'pending');

  const renderGroup = (list, title) => list.length ? `
    <div class="section-label" style="margin-bottom:10px;margin-top:${title === 'Pending Approval' ? '0' : '20px'}">${title}</div>
    ${list.map(h => {
      const isOwnRequest = currentManagerUser && h.employeeName === currentManagerUser;
      const loggedInEmp = (state.timesheetData.employees || []).find(e => e.name === currentManagerUser);
      const isDirector = loggedInEmp && loggedInEmp.erpRole === 'director';
      const canApprove = h.status === 'pending' && (!isOwnRequest || isDirector);
      const showEdit = canEditHolidays();
      return `
      <div class="holiday-chip" style="flex-wrap:wrap;gap:8px">
        <span style="font-weight:600;min-width:120px">${h.employeeName}</span>
        <span class="hdate">${fmtDateStr(h.dateFrom)} → ${fmtDateStr(h.dateTo)}</span>
        <span class="htype ${h.type}">${h.type === 'paid' ? 'Paid' : h.type === 'unpaid' ? 'Unpaid Absence' : h.type === 'sick' ? 'Sick' : h.type === 'half' ? 'Half Day' : h.type}</span>
        <span style="font-family:var(--font-mono);font-size:12px;color:var(--accent2)">${h.workingDays}d</span>
        <span style="color:var(--muted);font-size:12px;flex:1">${h.reason || ''}</span>
        <span class="tag tag-${h.status === 'approved' ? 'approved' : h.status === 'rejected' ? 'rejected' : 'pending'}">${h.status}</span>
        ${showEdit ? `<button class="tiny-btn" onclick="openEditHolidayModal('${h.id}')" style="padding:2px 8px;font-size:11px;background:var(--surface2);color:var(--muted);border:1px solid var(--border)" title="Edit">✏️</button>` : ''}
        ${canApprove ? `
          <div class="approve-row">
            <button class="tiny-btn tiny-approve" onclick="approveHoliday('${h.id}')">&#10003; Approve</button>
            <button class="tiny-btn tiny-reject" onclick="rejectHoliday('${h.id}')">&#10005; Reject</button>
          </div>
        ` : (h.status === 'pending' && isOwnRequest ? '<span style="font-size:11px;color:var(--subtle);font-style:italic">Awaiting approval from another user</span>' : '')}
      </div>
    `}).join('')}
  ` : '';

  container.innerHTML = renderGroup(pending, 'Pending Approval') + renderGroup(others, 'Previous Requests');
}

async function approveHoliday(id) {
  const h = (state.timesheetData.holidays || []).find(h => String(h.id) === String(id));
  if (!h) return;
  try {
    await api.put(`/api/holidays/${id}`, { status: 'approved' });
    h.status = 'approved';
    h.approvedAt = new Date().toISOString();
    toast(`Holiday approved for ${h.employeeName} ✓`, 'success');
    renderHolidayTab();
    renderHolidayNotificationBanner();
  } catch (err) { toast('Save failed: ' + err.message, 'error'); }
}

async function rejectHoliday(id) {
  const h = (state.timesheetData.holidays || []).find(h => String(h.id) === String(id));
  if (!h) return;
  try {
    await api.put(`/api/holidays/${id}`, { status: 'rejected' });
    h.status = 'rejected';
    h.rejectedAt = new Date().toISOString();
    toast(`Holiday rejected`, 'success');
    renderHolidayTab();
  } catch (err) { toast('Save failed: ' + err.message, 'error'); }
}

// ═══════════════════════════════════════════
// BOOK ABSENCE — Manager books on behalf of employee
// ═══════════════════════════════════════════
function canBookAbsences() {
  // Check if current user has permission to book absences for others
  const allowedRoles = ['director', 'finance', 'office_admin'];
  const currentEmp = (state.timesheetData.employees || []).find(e => e.name === currentManagerUser);
  if (!currentEmp) return false;

  // Check ERP role
  if (allowedRoles.includes(currentEmp.erpRole)) return true;

  // Check custom permission in settings
  const permitted = state.timesheetData.settings?.absenceBookingPermissions || [];
  if (permitted.includes(currentEmp.name) || permitted.includes(String(currentEmp.id))) return true;

  return false;
}

function openBookAbsenceModal() {
  if (!canBookAbsences()) {
    toast('You don\'t have permission to book absences. Contact a Director or Finance user.', 'error');
    return;
  }

  const sel = document.getElementById('absEmpSelect');
  sel.innerHTML = '<option value="">— Select employee —</option>';
  (state.timesheetData.employees || [])
    .filter(e => e.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name))
    .forEach(e => {
      sel.innerHTML += `<option value="${e.id}">${e.name}</option>`;
    });

  // Set default dates to today
  const today = todayStr();
  document.getElementById('absFromDate').value = today;
  document.getElementById('absToDate').value = today;
  document.getElementById('absType').value = 'paid';
  document.getElementById('absStatus').value = 'approved';
  document.getElementById('absReason').value = '';
  document.getElementById('absBalanceInfo').textContent = '';
  document.getElementById('absDaysInfo').textContent = '';

  document.getElementById('bookAbsenceModal').classList.add('active');
}

function closeBookAbsenceModal() {
  document.getElementById('bookAbsenceModal').classList.remove('active');
}

function updateAbsenceBalance() {
  const empId = document.getElementById('absEmpSelect').value;
  const balEl = document.getElementById('absBalanceInfo');
  if (!empId) { balEl.textContent = ''; return; }

  const emp = (state.timesheetData.employees || []).find(e => String(e.id) === String(empId));
  if (!emp) { balEl.textContent = ''; return; }

  const bal = calculateHolidayBalance(emp.name);
  if (bal) {
    balEl.innerHTML = `<span style="color:var(--green)">${bal.remainingDays} days remaining</span> of ${bal.totalAllowance} · ${bal.usedDays} used${bal.pendingDays > 0 ? ` · <span style="color:var(--amber)">${bal.pendingDays} pending</span>` : ''}`;
  } else {
    balEl.textContent = '';
  }
  updateAbsenceDays();
}

// Sync "to" date: if empty or before the new "from", set it to match "from"
function syncToDate(fromId, toId) {
  const from = document.getElementById(fromId)?.value;
  const to = document.getElementById(toId)?.value;
  if (from && (!to || to < from)) {
    document.getElementById(toId).value = from;
  }
}

function updateAbsenceDays() {
  const from = document.getElementById('absFromDate').value;
  const to = document.getElementById('absToDate').value;
  const type = document.getElementById('absType').value;
  const infoEl = document.getElementById('absDaysInfo');

  if (!from || !to) { infoEl.textContent = ''; return; }

  let days = type === 'half' ? 0.5 : countWorkingDays(from, to);
  if (days === 0 && type !== 'half') {
    infoEl.innerHTML = '<span style="color:var(--red)">No working days in selected range</span>';
    return;
  }

  infoEl.textContent = `${days} working day${days !== 1 ? 's' : ''}`;
}

async function submitBookAbsence() {
  const empId = document.getElementById('absEmpSelect').value;
  const from = document.getElementById('absFromDate').value;
  const to = document.getElementById('absToDate').value;
  const type = document.getElementById('absType').value;
  const status = document.getElementById('absStatus').value;
  const reason = document.getElementById('absReason').value;

  if (!empId) { toast('Please select an employee', 'error'); return; }
  if (!from || !to) { toast('Please select dates', 'error'); return; }
  if (from > to) { toast('End date must be after start date', 'error'); return; }

  let workingDays = type === 'half' ? 0.5 : countWorkingDays(from, to);
  if (workingDays === 0) { toast('No working days in selected range', 'error'); return; }

  const emp = (state.timesheetData.employees || []).find(e => String(e.id) === String(empId));
  const empName = emp ? emp.name : `Employee #${empId}`;

  // Balance check for paid holidays
  if ((type === 'paid' || type === 'half') && status === 'approved' && emp) {
    const bal = calculateHolidayBalance(emp.name);
    if (bal && workingDays > bal.remainingDays) {
      if (!confirm(`${emp.name} only has ${bal.remainingDays} days remaining but this is ${workingDays} days. Book anyway?`)) return;
    }
  }

  try {
    const result = await api.post('/api/holidays', {
      employee_id: parseInt(empId),
      date_from: from,
      date_to: to,
      type,
      reason: reason || `Booked by ${currentManagerUser || 'manager'}`,
      working_days: workingDays
    });

    const newHoliday = normaliseHoliday({ ...result, employee_name: empName });

    // If status should be approved, approve it immediately
    if (status === 'approved' && newHoliday.status === 'pending') {
      try {
        await api.put(`/api/holidays/${newHoliday.id}`, { status: 'approved' });
        newHoliday.status = 'approved';
        newHoliday.approvedAt = new Date().toISOString();
      } catch (e) {
        console.warn('Auto-approve failed:', e.message);
      }
    }

    if (!state.timesheetData.holidays) state.timesheetData.holidays = [];
    state.timesheetData.holidays.push(newHoliday);

    closeBookAbsenceModal();
    const typeLabel = { paid:'Holiday', unpaid:'Unpaid Absence', sick:'Sick Leave', half:'Half Day', compassionate:'Compassionate Leave', training:'Training' }[type] || type;
    toast(`${typeLabel} booked for ${empName} (${workingDays}d) ${status === 'approved' ? '✓' : '— pending approval'}`, 'success');
    renderHolidayTab();
  } catch (err) {
    toast('Failed to book absence: ' + err.message, 'error');
  }
}

// ═══════════════════════════════════════════
// EDIT HOLIDAY — Directors / Finance / Office Admin
// ═══════════════════════════════════════════
function canEditHolidays() {
  const allowedRoles = ['director', 'finance', 'office_admin'];
  const currentEmp = (state.timesheetData.employees || []).find(e => e.name === currentManagerUser);
  if (!currentEmp) return false;
  if (allowedRoles.includes(currentEmp.erpRole)) return true;
  return false;
}

function openEditHolidayModal(id) {
  if (!canEditHolidays()) {
    toast('You don\'t have permission to edit holidays. Contact a Director or Finance user.', 'error');
    return;
  }
  const h = (state.timesheetData.holidays || []).find(h => String(h.id) === String(id));
  if (!h) { toast('Holiday record not found', 'error'); return; }

  document.getElementById('editHolId').value = h.id;
  document.getElementById('editHolEmployee').value = h.employeeName || '';
  document.getElementById('editHolFrom').value = h.dateFrom || '';
  document.getElementById('editHolTo').value = h.dateTo || '';
  document.getElementById('editHolType').value = h.type || 'paid';
  document.getElementById('editHolStatus').value = h.status || 'pending';
  document.getElementById('editHolReason').value = h.reason || '';
  updateEditHolidayDays();
  document.getElementById('editHolidayModal').classList.add('active');
}

function closeEditHolidayModal() {
  document.getElementById('editHolidayModal').classList.remove('active');
}

function updateEditHolidayDays() {
  const from = document.getElementById('editHolFrom').value;
  const to = document.getElementById('editHolTo').value;
  const type = document.getElementById('editHolType').value;
  const infoEl = document.getElementById('editHolDaysInfo');
  if (!from || !to) { infoEl.textContent = ''; return; }
  let days = type === 'half' ? 0.5 : countWorkingDays(from, to);
  if (days === 0 && type !== 'half') {
    infoEl.innerHTML = '<span style="color:var(--red)">No working days in selected range</span>';
    return;
  }
  infoEl.textContent = `${days} working day${days !== 1 ? 's' : ''}`;
}

async function submitEditHoliday() {
  const id = document.getElementById('editHolId').value;
  const from = document.getElementById('editHolFrom').value;
  const to = document.getElementById('editHolTo').value;
  const type = document.getElementById('editHolType').value;
  const status = document.getElementById('editHolStatus').value;
  const reason = document.getElementById('editHolReason').value;

  if (!from || !to) { toast('Please select dates', 'error'); return; }
  if (from > to) { toast('End date must be after start date', 'error'); return; }

  let workingDays = type === 'half' ? 0.5 : countWorkingDays(from, to);
  if (workingDays === 0 && type !== 'half') { toast('No working days in selected range', 'error'); return; }

  try {
    await api.put(`/api/holidays/${id}`, {
      date_from: from,
      date_to: to,
      type,
      status,
      reason,
      working_days: workingDays
    });

    // Update local state
    const h = (state.timesheetData.holidays || []).find(h => String(h.id) === String(id));
    if (h) {
      h.dateFrom = from;
      h.dateTo = to;
      h.type = type;
      h.status = status;
      h.reason = reason;
      h.workingDays = workingDays;
    }

    closeEditHolidayModal();
    toast('Holiday updated ✓', 'success');
    renderHolidayTab();
    renderHolidayNotificationBanner();
  } catch (err) {
    toast('Failed to update: ' + err.message, 'error');
  }
}

async function deleteHolidayFromEdit() {
  const id = document.getElementById('editHolId').value;
  const h = (state.timesheetData.holidays || []).find(h => String(h.id) === String(id));
  if (!h) return;

  const label = `${h.employeeName} — ${h.type} (${fmtDateStr(h.dateFrom)} → ${fmtDateStr(h.dateTo)})`;
  if (!confirm(`Delete this record?\n\n${label}\n\nIf this was an approved paid holiday, the balance will be restored.`)) return;

  try {
    const result = await api.delete(`/api/holidays/${id}`);
    state.timesheetData.holidays = (state.timesheetData.holidays || []).filter(h => String(h.id) !== String(id));
    closeEditHolidayModal();
    const restored = result?.restored_days;
    toast(`Holiday deleted${restored ? ` — ${restored} day${restored !== 1 ? 's' : ''} restored` : ''} ✓`, 'success');
    renderHolidayTab();
    renderHolidayNotificationBanner();
  } catch (err) {
    toast('Failed to delete: ' + err.message, 'error');
  }
}

function checkHolidayNotifications() {
  // Remove any existing banner first
  const existingBanner = document.getElementById('holidayPendingBanner');
  if (existingBanner) existingBanner.remove();

  const pending = (state.timesheetData.holidays || []).filter(h => h.status === 'pending');
  if (!pending.length) return;

  const banner = document.createElement('div');
  banner.id = 'holidayPendingBanner';
  banner.className = 'notification-banner';
  banner.style.marginBottom = '16px';
  banner.innerHTML = `
    <span class="nb-icon">&#127959;</span>
    <span class="nb-text"><b>${pending.length} holiday request${pending.length > 1 ? 's' : ''}</b> awaiting your approval</span>
    <span class="nb-count">${pending.length}</span>
  `;
  banner.onclick = () => switchTab('holidays');
  const statsRow = document.getElementById('mgrStats');
  if (statsRow && statsRow.parentNode) {
    statsRow.parentNode.insertBefore(banner, statsRow);
  }
}

// ═══════════════════════════════════════════
// PAYROLL ENGINE
// ═══════════════════════════════════════════
let payrollWeekOffset = 0;

// How many holiday hours does this employee have on this date?
//   8 → approved 'paid' holiday covering this date
//   4 → approved 'half' holiday on this date
//   0 → otherwise
// Skips weekends and bank holidays (matches `working_days` at booking time).
function getHolidayHoursForEmployee(empName, ds) {
  const d = new Date(ds + 'T12:00:00');
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return 0;
  if (isBankHoliday(ds)) return 0;

  const matches = (state.timesheetData.holidays || []).filter(h =>
    h.employeeName === empName &&
    h.status === 'approved' &&
    (h.type === 'paid' || h.type === 'half') &&
    h.dateFrom <= ds && h.dateTo >= ds
  );
  if (!matches.length) return 0;
  // Half-day takes precedence if both somehow exist (defensive)
  if (matches.some(h => h.type === 'half')) return 4;
  return 8;
}

// Bank-holiday hours for this date (0 or 8). Active payee employees only —
// CIS contractors and inactive employees get 0.
function getBankHolidayHoursForEmployee(empName, ds) {
  const d = new Date(ds + 'T12:00:00');
  const dow = d.getDay();
  if (dow === 0 || dow === 6) return 0; // defensive: no BH on weekends in our list
  if (!isBankHoliday(ds)) return 0;
  const emp = (state.timesheetData.employees || []).find(e => e.name === empName);
  if (!emp || emp.active === false) return 0;
  if ((emp.payType || 'payee') !== 'payee') return 0;
  return 8;
}

function calculatePayroll(employeeName, weekMon, weekSun) {
  const monStr = dateStr(weekMon);
  const sunStr = dateStr(weekSun);

  // Get all approved clockings for this employee this week
  const clockings = state.timesheetData.clockings.filter(c =>
    c.employeeName === employeeName &&
    c.date >= monStr && c.date <= sunStr &&
    c.approvalStatus !== 'rejected'
  );

  // Calculate hours per day from clockings
  const dayHours = {};
  let workedSaturday = false;
  let workedSunday = false;
  let sundayHours = 0;

  clockings.forEach(c => {
    const hrs = calcHours(c.clockIn, c.clockOut, c.breakMins, c.date) || 0;
    dayHours[c.date] = (dayHours[c.date] || 0) + hrs;

    const d = new Date(c.date + 'T12:00:00');
    const dow = d.getDay(); // 0=Sun, 6=Sat
    if (dow === 6 && hrs > 0) workedSaturday = true;
    if (dow === 0 && hrs > 0) { workedSunday = true; sundayHours += hrs; }
  });

  const workedHours = Object.values(dayHours).reduce((s, h) => s + h, 0);

  // Walk the week to collect holiday + bank-holiday hours
  const dayHoliday = {};      // date → booked-holiday hours (display)
  const dayBankHoliday = {};  // date → bank-holiday hours (display)
  let holidayHours = 0;
  let bankHolidayHours = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekMon);
    d.setDate(weekMon.getDate() + i);
    const ds = dateStr(d);
    const hh = getHolidayHoursForEmployee(employeeName, ds);
    if (hh > 0) { dayHoliday[ds] = hh; holidayHours += hh; }
    const bh = getBankHolidayHoursForEmployee(employeeName, ds);
    if (bh > 0) { dayBankHoliday[ds] = bh; bankHolidayHours += bh; }
  }

  // Bail only if everything is zero
  if (workedHours === 0 && holidayHours === 0 && bankHolidayHours === 0) {
    return null;
  }

  // Get employee rate
  const emp = (state.timesheetData.employees || []).find(e => e.name === employeeName);
  const rate = emp ? (emp.rate || 0) : 0;

  // Calculate pay breakdown.
  // Holiday + bank-holiday hours fill the 40h bucket FIRST, pushing worked
  // hours into overtime if combined exceeds 40. Both are always paid at
  // basic rate (never OT, never double).
  const nonWorkedPaidHours = holidayHours + bankHolidayHours;
  const doubleTimeApplies = workedSaturday && workedSunday;

  let basicHours, overtimeHours, doubleHours;

  if (doubleTimeApplies) {
    doubleHours = sundayHours;
    const nonSundayWorked = workedHours - sundayHours;
    const nonSundayCombined = nonSundayWorked + nonWorkedPaidHours;
    if (nonSundayCombined <= 40) {
      basicHours = nonSundayWorked;
      overtimeHours = 0;
    } else {
      const cap = Math.max(0, 40 - nonWorkedPaidHours);
      basicHours = Math.min(nonSundayWorked, cap);
      overtimeHours = nonSundayWorked - basicHours;
    }
  } else {
    doubleHours = 0;
    if (workedHours + nonWorkedPaidHours <= 40) {
      basicHours = workedHours;
      overtimeHours = 0;
    } else {
      const cap = Math.max(0, 40 - nonWorkedPaidHours);
      basicHours = Math.min(workedHours, cap);
      overtimeHours = workedHours - basicHours;
    }
  }

  const basicPay        = basicHours        * rate;
  const overtimePay     = overtimeHours     * rate * 1.5;
  const doublePay       = doubleHours       * rate * 2;
  const holidayPay      = holidayHours      * rate;
  const bankHolidayPay  = bankHolidayHours  * rate;
  const totalPay = basicPay + overtimePay + doublePay + holidayPay + bankHolidayPay;
  const totalHours = workedHours + holidayHours + bankHolidayHours;

  return {
    employeeName,
    rate,
    totalHours: parseFloat(totalHours.toFixed(2)),
    basicHours: parseFloat(basicHours.toFixed(2)),
    overtimeHours: parseFloat(overtimeHours.toFixed(2)),
    doubleHours: parseFloat(doubleHours.toFixed(2)),
    holidayHours: parseFloat(holidayHours.toFixed(2)),
    bankHolidayHours: parseFloat(bankHolidayHours.toFixed(2)),
    basicPay: parseFloat(basicPay.toFixed(2)),
    overtimePay: parseFloat(overtimePay.toFixed(2)),
    doublePay: parseFloat(doublePay.toFixed(2)),
    holidayPay: parseFloat(holidayPay.toFixed(2)),
    bankHolidayPay: parseFloat(bankHolidayPay.toFixed(2)),
    totalPay: parseFloat(totalPay.toFixed(2)),
    doubleTimeApplies,
    dayHours,
    dayHoliday,
    dayBankHoliday
  };
}

// ═══════════════════════════════════════════
// REPORTS ENGINE
// ═══════════════════════════════════════════
let rptPeriod = 'week';
let rptOffset = 0;
let rptCharts = {};

function setReportPeriod(period) {
  rptPeriod = period;
  rptOffset = 0; // reset offset when changing period
  ['week','month','year'].forEach(p => {
    const btn = document.getElementById(`rpt-btn-${p}`);
    if (btn) {
      btn.style.background = p === period ? 'var(--accent)' : 'var(--surface)';
      btn.style.color = p === period ? '#fff' : 'var(--muted)';
    }
  });
  renderReports();
}

function changeReportOffset(dir) {
  rptOffset += dir;
  if (rptOffset > 0) rptOffset = 0;
  renderReports();
}

function getReportDateRange() {
  const now = new Date();
  let from, to;

  if (rptPeriod === 'week') {
    const dow = now.getDay();
    const mon = new Date(now);
    mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1) + rptOffset * 7);
    mon.setHours(0,0,0,0);
    from = dateStr(mon);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    to = dateStr(sun);
  } else if (rptPeriod === 'month') {
    const target = new Date(now.getFullYear(), now.getMonth() + rptOffset, 1);
    from = dateStr(target);
    const last = new Date(target.getFullYear(), target.getMonth() + 1, 0);
    to = dateStr(last);
  } else {
    const yr = now.getFullYear() + rptOffset;
    from = `${yr}-01-01`;
    to = `${yr}-12-31`;
  }
  return { from, to };
}

function getWeeklyData(empFilter) {
  // Build week-by-week data from all available data
  const clockings = (state.timesheetData.clockings || [])
    .filter(c => !empFilter || c.employeeName === empFilter);
  const entries = (state.timesheetData.entries || [])
    .filter(e => !empFilter || e.employeeName === empFilter);

  // Collect all unique weeks
  const weekMap = {};
  clockings.forEach(c => {
    const d = new Date(c.date + 'T12:00:00');
    const dow = d.getDay();
    const mon = new Date(d);
    mon.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
    const wk = dateStr(mon);
    if (!weekMap[wk]) weekMap[wk] = { label: wk, clocked: 0, project: 0, unproductive: 0 };
    const hrs = calcHours(c.clockIn, c.clockOut, c.breakMins, c.date) || 0;
    weekMap[wk].clocked = Math.round((weekMap[wk].clocked + hrs) * 10) / 10;
  });
  entries.forEach(e => {
    const d = new Date(e.date + 'T12:00:00');
    const dow = d.getDay();
    const mon = new Date(d);
    mon.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
    const wk = dateStr(mon);
    if (!weekMap[wk]) return;
    if (e.projectId === 'S000') weekMap[wk].unproductive = Math.round((weekMap[wk].unproductive + e.hours) * 10) / 10;
    else if (e.projectId === 'WGD') weekMap[wk].wgd = Math.round(((weekMap[wk].wgd||0) + e.hours) * 10) / 10;
    else weekMap[wk].project = Math.round((weekMap[wk].project + e.hours) * 10) / 10;
  });
  return Object.values(weekMap).sort((a,b) => a.label.localeCompare(b.label));
}

function getPeriodData(empFilter) {
  const { from, to } = getReportDateRange();
  const clockings = (state.timesheetData.clockings || [])
    .filter(c => c.date >= from && c.date <= to && (!empFilter || c.employeeName === empFilter));
  const entries = (state.timesheetData.entries || [])
    .filter(e => e.date >= from && e.date <= to && (!empFilter || e.employeeName === empFilter));

  const totalClocked = clockings.reduce((s,c) => s + (calcHours(c.clockIn, c.clockOut, c.breakMins, c.date)||0), 0);
  const totalProject = entries.filter(e => e.projectId !== 'S000' && e.projectId !== 'WGD').reduce((s,e) => s + e.hours, 0);
  const totalWGD = entries.filter(e => e.projectId === 'WGD').reduce((s,e) => s + e.hours, 0);
  const totalUnproductive = entries.filter(e => e.projectId === 'S000').reduce((s,e) => s + e.hours, 0);
  const utilisation = totalClocked > 0 ? Math.round(((totalProject + totalWGD) / totalClocked) * 100) : 0;

  // By employee
  const empMap = {};
  clockings.forEach(c => {
    if (!empMap[c.employeeName]) empMap[c.employeeName] = { clocked: 0, project: 0, wgd: 0, unproductive: 0 };
    empMap[c.employeeName].clocked = Math.round((empMap[c.employeeName].clocked + (calcHours(c.clockIn, c.clockOut, c.breakMins, c.date)||0)) * 10) / 10;
  });
  entries.forEach(e => {
    if (!empMap[e.employeeName]) return;
    if (e.projectId === 'S000') empMap[e.employeeName].unproductive = Math.round((empMap[e.employeeName].unproductive + e.hours) * 10) / 10;
    else if (e.projectId === 'WGD') empMap[e.employeeName].wgd = Math.round((empMap[e.employeeName].wgd + e.hours) * 10) / 10;
    else empMap[e.employeeName].project = Math.round((empMap[e.employeeName].project + e.hours) * 10) / 10;
  });

  // By project (exclude S000 and WGD from project doughnut)
  const projMap = {};
  entries.filter(e => e.projectId !== 'S000' && e.projectId !== 'WGD').forEach(e => {
    if (!projMap[e.projectId]) projMap[e.projectId] = { id: e.projectId, name: e.projectName, hours: 0 };
    projMap[e.projectId].hours = Math.round((projMap[e.projectId].hours + e.hours) * 10) / 10;
  });

  return { totalClocked, totalProject, totalWGD, totalUnproductive, utilisation, empMap, projMap, from, to };
}

function renderReports() {
  const empFilter = document.getElementById('rptEmployeeFilter')?.value || '';

  // Populate employee filter
  const sel = document.getElementById('rptEmployeeFilter');
  if (sel && sel.options.length <= 1) {
    (state.timesheetData.employees || []).filter(e => e.active !== false).forEach(e => {
      const opt = document.createElement('option');
      opt.value = e.name; opt.textContent = e.name;
      sel.appendChild(opt);
    });
  }

  const { totalClocked, totalProject, totalWGD, totalUnproductive, utilisation, empMap, projMap, from, to } = getPeriodData(empFilter);
  const periodLabels = { week: 'This Week', month: 'This Month', year: 'This Year' };
  let periodLabel = periodLabels[rptPeriod];
  if (rptOffset !== 0) {
    if (rptPeriod === 'week') periodLabel = `Week of ${fmtDateStr(from)}`;
    else if (rptPeriod === 'month') {
      const d = new Date(from + 'T12:00:00');
      periodLabel = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    } else periodLabel = from.slice(0, 4);
  }

  // Update range label
  const label = document.getElementById('rptRangeLabel');
  if (label) label.textContent = `${fmtDateStr(from)} → ${fmtDateStr(to)}`;

  // Calculate attendance rate for the general view
  const attendanceData = getAttendanceData(empFilter);

  // KPI cards — general view (all employees) shows hours + utilisation + attendance only
  const kpiRow = document.getElementById('rptKpiRow');
  if (kpiRow) {
    const kpis = [
      { label: 'Total Hours', value: totalClocked.toFixed(1) + 'h', color: 'var(--accent2)' },
      { label: 'Project Hours', value: totalProject.toFixed(1) + 'h', color: 'var(--green)' },
      { label: 'Workshop General', value: totalWGD.toFixed(1) + 'h', color: '#6366f1' },
      { label: 'Unproductive', value: totalUnproductive.toFixed(1) + 'h', color: 'var(--red)' },
      { label: 'Utilisation', value: utilisation + '%', color: utilisation >= 80 ? 'var(--green)' : utilisation >= 60 ? 'var(--amber)' : 'var(--red)' },
      { label: 'Attendance', value: attendanceData.attendanceRate + '%', color: attendanceData.attendanceRate >= 95 ? 'var(--green)' : attendanceData.attendanceRate >= 85 ? 'var(--amber)' : 'var(--red)' },
    ];
    kpiRow.innerHTML = kpis.map(k => `
      <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px 18px">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">${k.label}</div>
        <div style="font-family:var(--font-display);font-size:30px;color:${k.color}">${k.value}</div>
        <div style="font-size:10px;color:var(--subtle);margin-top:4px">${periodLabel}</div>
      </div>
    `).join('');
  }

  // Destroy old charts
  Object.values(rptCharts).forEach(c => { try { c.destroy(); } catch {} });
  rptCharts = {};

  const weeklyData = getWeeklyData(empFilter);
  const weekLabels = weeklyData.map(w => w.label.slice(5)); // MM-DD

  // ── Line chart: hours over time ──
  const lineCtx = document.getElementById('rptLineChart');
  if (lineCtx && weeklyData.length) {
    rptCharts.line = new Chart(lineCtx, {
      type: 'line',
      data: {
        labels: weekLabels,
        datasets: [
          { label: 'Clocked', data: weeklyData.map(w => w.clocked), borderColor: '#ffb347', backgroundColor: 'rgba(255,179,71,.1)', tension: 0.4, fill: true, pointRadius: 4 },
          { label: 'Project', data: weeklyData.map(w => w.project), borderColor: '#3ecf8e', backgroundColor: 'rgba(62,207,142,.1)', tension: 0.4, fill: true, pointRadius: 4 },
          { label: 'Unproductive', data: weeklyData.map(w => w.unproductive), borderColor: '#ff4444', backgroundColor: 'rgba(255,68,68,.1)', tension: 0.4, fill: true, pointRadius: 4 },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { labels: { color: '#888', font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: '#888', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,.05)' } },
          y: { ticks: { color: '#888', font: { size: 10 } }, grid: { color: 'rgba(255,255,255,.05)' }, beginAtZero: true }
        }
      }
    });
  }

  // ── Bar chart: hours by employee ──
  const empBarCtx = document.getElementById('rptEmpBar');
  if (empBarCtx) {
    const empNames = Object.keys(empMap);
    const colors = ['#ff6b00','#3ecf8e','#6366f1','#ffb347','#ff4444'];
    rptCharts.empBar = new Chart(empBarCtx, {
      type: 'bar',
      data: {
        labels: empNames.map(n => n.split(' ')[0]),
        datasets: [
          { label: 'Clocked', data: empNames.map(n => empMap[n].clocked), backgroundColor: colors.map(c => c + 'cc') },
          { label: 'Project', data: empNames.map(n => empMap[n].project), backgroundColor: empNames.map(() => 'rgba(62,207,142,.6)') },
          { label: 'Workshop General', data: empNames.map(n => empMap[n].wgd||0), backgroundColor: empNames.map(() => 'rgba(99,102,241,.6)') },
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        plugins: { legend: { labels: { color: '#888', font: { size: 11 } } } },
        scales: {
          x: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,.05)' } },
          y: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,.05)' }, beginAtZero: true }
        }
      }
    });
  }

  // ── Doughnut: project split ──
  const doughCtx = document.getElementById('rptProjectDoughnut');
  if (doughCtx) {
    const projects = Object.values(projMap).sort((a,b) => b.hours - a.hours).slice(0,8);
    const palette = ['#ff6b00','#3ecf8e','#6366f1','#ffb347','#ff4444','#06b6d4','#a855f7','#f59e0b'];
    rptCharts.dough = new Chart(doughCtx, {
      type: 'doughnut',
      data: {
        labels: projects.map(p => `${p.id}`),
        datasets: [{ data: projects.map(p => p.hours), backgroundColor: palette, borderWidth: 2, borderColor: '#1e1e1e' }]
      },
      options: {
        responsive: true, maintainAspectRatio: true,
        plugins: {
          legend: { position: 'right', labels: { color: '#888', font: { size: 10 }, boxWidth: 12 } },
          tooltip: { callbacks: { label: ctx => ` ${projects[ctx.dataIndex]?.name || ''}: ${ctx.parsed}h` } }
        }
      }
    });
  }

  // ── Unproductive bar per employee ──
  const unprodCtx = document.getElementById('rptUnproductiveBar');
  if (unprodCtx) {
    const empNames = Object.keys(empMap);
    rptCharts.unprod = new Chart(unprodCtx, {
      type: 'bar',
      data: {
        labels: empNames,
        datasets: [
          {
            label: 'Unproductive (S000)',
            data: empNames.map(n => empMap[n].unproductive),
            backgroundColor: 'rgba(255,68,68,.6)',
            borderColor: '#ff4444',
            borderWidth: 1,
            borderRadius: 4
          },
          {
            label: 'Workshop General Duties',
            data: empNames.map(n => empMap[n].wgd||0),
            backgroundColor: 'rgba(99,102,241,.6)',
            borderColor: '#6366f1',
            borderWidth: 1,
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: true, indexAxis: 'y',
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#888' }, grid: { color: 'rgba(255,255,255,.05)' }, beginAtZero: true },
          y: { ticks: { color: '#aaa' }, grid: { color: 'rgba(255,255,255,.05)' } }
        }
      }
    });
  }

  // ── Attendance report ──
  if (activeReport === 'attendance') renderAttendanceReport(empFilter);
}

// ═══════════════════════════════════════════
// ATTENDANCE REPORT
// ═══════════════════════════════════════════
function getExpectedStart() {
  return (state.timesheetData.settings && state.timesheetData.settings.attendanceStartTime) || '07:00';
}

function getAttendanceData(empFilter) {
  const { from, to } = getReportDateRange();
  const expectedStart = getExpectedStart();
  const [expH, expM] = expectedStart.split(':').map(Number);
  const expMins = expH * 60 + expM;

  const employees = (state.timesheetData.employees || [])
    .filter(e => e.active !== false && (!empFilter || e.name === empFilter));

  const clockings = state.timesheetData.clockings || [];
  const holidays = (state.timesheetData.holidays || []).filter(h => h.status === 'approved');

  // Sick days — approved holidays with type 'sick' in range
  const sickHolidays = holidays.filter(h =>
    h.type === 'sick' && h.dateTo >= from && h.dateFrom <= to &&
    (!empFilter || h.employeeName === empFilter)
  );
  const totalSickDays = sickHolidays.reduce((s, h) => s + (h.workingDays || countWorkingDays(h.dateFrom, h.dateTo)), 0);

  // Holidays taken (paid + half) in range
  const paidHolidays = holidays.filter(h =>
    (h.type === 'paid' || h.type === 'half') && h.dateTo >= from && h.dateFrom <= to &&
    (!empFilter || h.employeeName === empFilter)
  );
  const totalHolidayDays = paidHolidays.reduce((s, h) => s + (h.workingDays || countWorkingDays(h.dateFrom, h.dateTo)), 0);

  // Holiday balance (sum remaining across filtered employees)
  let totalHolidayBalance = 0;
  employees.forEach(emp => {
    const bal = calculateHolidayBalance(emp.name);
    if (bal) totalHolidayBalance += bal.remainingDays;
  });

  // Build absences list for the table
  const absenceList = sickHolidays.map(h => ({
    name: h.employeeName,
    dateFrom: h.dateFrom,
    dateTo: h.dateTo,
    days: h.workingDays || countWorkingDays(h.dateFrom, h.dateTo),
    reason: h.reason || ''
  })).sort((a, b) => b.dateFrom.localeCompare(a.dateFrom));

  // Build list of working days (Mon-Fri) in period up to today
  const workDays = [];
  const d = new Date(from + 'T12:00:00');
  const end = new Date(to + 'T12:00:00');
  while (d <= end) {
    const dow = d.getDay();
    if (dow >= 1 && dow <= 5) workDays.push(dateStr(d));
    d.setDate(d.getDate() + 1);
  }
  const today = todayStr();
  const relevantDays = workDays.filter(wd => wd <= today);

  let totalLate = 0;
  const lateList = [];

  // Late arrivals and avg shift length
  let totalShiftMins = 0, shiftCount = 0;
  employees.forEach(emp => {
    const empClockings = clockings.filter(c => c.employeeName === emp.name);
    relevantDays.forEach(day => {
      const dayClockings = empClockings
        .filter(c => c.date === day && c.clockIn)
        .sort((a, b) => a.clockIn.localeCompare(b.clockIn));
      if (!dayClockings.length) return;

      const firstIn = dayClockings[0].clockIn;
      const [inH, inM] = firstIn.split(':').map(Number);
      const inMins = inH * 60 + inM;

      // Calculate shift length from earliest clock with a clock-out
      const completed = empClockings.filter(c => c.date === day && c.clockIn && c.clockOut);
      if (completed.length) {
        const hrs = completed.reduce((s, c) => s + (calcHours(c.clockIn, c.clockOut, c.breakMins, c.date) || 0), 0);
        if (hrs > 0) { totalShiftMins += hrs * 60; shiftCount++; }
      }

      if (inMins > expMins) {
        totalLate++;
        lateList.push({ name: emp.name, date: day, clockIn: firstIn, minsLate: inMins - expMins });
      }
    });
  });

  const avgShiftMins = shiftCount ? Math.round(totalShiftMins / shiftCount) : 0;
  const avgShiftH = Math.floor(avgShiftMins / 60);
  const avgShiftM = avgShiftMins % 60;
  const avgShiftLength = `${avgShiftH}h ${avgShiftM}m`;

  // Attendance rate: (days with a clocking) / (working days × employees), excluding holidays & sick
  let totalPossible = 0, totalPresent = 0;
  employees.forEach(emp => {
    const empClockings = clockings.filter(c => c.employeeName === emp.name);
    const empHolidays = holidays.filter(h => h.employeeName === emp.name);
    relevantDays.forEach(day => {
      const onLeave = empHolidays.some(h => day >= h.dateFrom && day <= h.dateTo);
      if (onLeave) return; // don't count leave days in attendance rate
      totalPossible++;
      if (empClockings.some(c => c.date === day && c.clockIn)) totalPresent++;
    });
  });
  const attendanceRate = totalPossible > 0 ? Math.round((totalPresent / totalPossible) * 100) : 100;

  return {
    totalSickDays, totalHolidayDays, totalHolidayBalance,
    totalLate, attendanceRate, avgShiftLength, lateList, absenceList,
    expectedStart
  };
}

function renderAttendanceReport(empFilter) {
  const data = getAttendanceData(empFilter);

  // KPI cards
  const kpiRow = document.getElementById('rptAttendanceKpis');
  if (kpiRow) {
    const periodLabels = { week: 'This Week', month: 'This Month', year: 'This Year' };
    let periodLabel = periodLabels[rptPeriod];
    if (rptOffset !== 0) {
      const { from, to } = getReportDateRange();
      if (rptPeriod === 'week') periodLabel = `Week of ${fmtDateStr(from)}`;
      else if (rptPeriod === 'month') {
        const d = new Date(from + 'T12:00:00');
        periodLabel = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
      } else periodLabel = from.slice(0, 4);
    }
    kpiRow.innerHTML = [
      { label: 'Attendance Rate', value: data.attendanceRate + '%', color: data.attendanceRate >= 95 ? 'var(--green)' : data.attendanceRate >= 85 ? 'var(--amber)' : 'var(--red)' },
      { label: 'Days Absent', value: data.totalSickDays, color: data.totalSickDays > 0 ? 'var(--red)' : 'var(--green)' },
      { label: 'Late Arrivals', value: data.totalLate, color: data.totalLate > 0 ? 'var(--amber)' : 'var(--green)' },
      { label: 'Holidays Taken', value: data.totalHolidayDays, color: '#6366f1' },
      { label: 'Holiday Balance', value: data.totalHolidayBalance, color: data.totalHolidayBalance > 0 ? 'var(--green)' : 'var(--red)' },
      { label: 'Avg Shift Length', value: data.avgShiftLength, color: 'var(--accent2)' },
    ].map(k => `
      <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px 18px">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">${k.label}</div>
        <div style="font-family:var(--font-display);font-size:30px;color:${k.color}">${k.value}</div>
        <div style="font-size:10px;color:var(--subtle);margin-top:4px">${periodLabel}</div>
      </div>
    `).join('');
  }

  // Late arrivals table
  const lateEl = document.getElementById('rptLateArrivals');
  if (lateEl) {
    if (!data.lateList.length) {
      lateEl.innerHTML = `<div style="text-align:center;color:var(--muted);padding:24px;font-size:13px">No late arrivals — everyone on time! Expected start: ${data.expectedStart}</div>`;
    } else {
      const sorted = [...data.lateList].sort((a, b) => b.minsLate - a.minsLate);
      const lateRows = sorted.map(l => {
        const minsStr = l.minsLate >= 60 ? `${Math.floor(l.minsLate / 60)}h ${l.minsLate % 60}m` : `${l.minsLate}m`;
        return `<tr>
          <td style="padding:8px 12px;font-size:13px;color:var(--text)">${l.name}</td>
          <td style="padding:8px 12px;font-size:13px;color:var(--muted)">${fmtDateStr(l.date)}</td>
          <td style="padding:8px 12px;font-size:13px;color:var(--muted)">${l.clockIn}</td>
          <td style="padding:8px 12px;font-size:13px;color:var(--amber);font-weight:600">+${minsStr}</td>
        </tr>`;
      }).join('');
      lateEl.innerHTML = `
        <div style="font-size:11px;color:var(--subtle);margin-bottom:10px">Expected start: ${data.expectedStart} — sorted by latest arrival</div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr>
            <th style="text-align:left;font-size:11px;color:var(--muted);padding:6px 12px;border-bottom:1px solid var(--border)">Employee</th>
            <th style="text-align:left;font-size:11px;color:var(--muted);padding:6px 12px;border-bottom:1px solid var(--border)">Date</th>
            <th style="text-align:left;font-size:11px;color:var(--muted);padding:6px 12px;border-bottom:1px solid var(--border)">Clock In</th>
            <th style="text-align:left;font-size:11px;color:var(--muted);padding:6px 12px;border-bottom:1px solid var(--border)">Late By</th>
          </tr></thead>
          <tbody>${lateRows}</tbody>
        </table>`;
    }
  }

  // Absences table
  const absEl = document.getElementById('rptAbsences');
  if (absEl) {
    if (!data.absenceList.length) {
      absEl.innerHTML = '<div style="text-align:center;color:var(--muted);padding:24px;font-size:13px">No sick leave recorded in this period</div>';
    } else {
      const absRows = data.absenceList.map(a => {
        const rangeStr = a.dateFrom === a.dateTo ? fmtDateStr(a.dateFrom) : `${fmtDateStr(a.dateFrom)} – ${fmtDateStr(a.dateTo)}`;
        return `<tr>
          <td style="padding:8px 12px;font-size:13px;color:var(--text)">${a.name}</td>
          <td style="padding:8px 12px;font-size:13px;color:var(--muted)">${rangeStr}</td>
          <td style="padding:8px 12px;font-size:13px;color:var(--red);font-weight:600">${a.days} day${a.days !== 1 ? 's' : ''}</td>
          <td style="padding:8px 12px;font-size:13px;color:var(--muted)">${a.reason || '—'}</td>
        </tr>`;
      }).join('');
      absEl.innerHTML = `
        <table style="width:100%;border-collapse:collapse">
          <thead><tr>
            <th style="text-align:left;font-size:11px;color:var(--muted);padding:6px 12px;border-bottom:1px solid var(--border)">Employee</th>
            <th style="text-align:left;font-size:11px;color:var(--muted);padding:6px 12px;border-bottom:1px solid var(--border)">Dates</th>
            <th style="text-align:left;font-size:11px;color:var(--muted);padding:6px 12px;border-bottom:1px solid var(--border)">Duration</th>
            <th style="text-align:left;font-size:11px;color:var(--muted);padding:6px 12px;border-bottom:1px solid var(--border)">Reason</th>
          </tr></thead>
          <tbody>${absRows}</tbody>
        </table>`;
    }
  }
}

async function exportAttendancePDF() {
  const empFilter = document.getElementById('rptEmployeeFilter')?.value || '';
  const data = getAttendanceData(empFilter);
  const general = getPeriodData(empFilter);
  const { from, to } = getReportDateRange();
  const periodLabels = { week: 'This Week', month: 'This Month', year: 'This Year' };
  let periodLabel = periodLabels[rptPeriod];
  if (rptOffset !== 0) {
    if (rptPeriod === 'week') periodLabel = `Week of ${fmtDateStr(from)}`;
    else if (rptPeriod === 'month') {
      const d = new Date(from + 'T12:00:00');
      periodLabel = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    } else periodLabel = from.slice(0, 4);
  }
  const filterLabel = empFilter ? ` — ${empFilter}` : ' — All Employees';

  await loadLogoDataUri();

  const html = buildAttendanceHTML({
    periodLabel,
    from: fmtDateStr(from),
    to: fmtDateStr(to),
    filterLabel,
    general,
    data
  });
  const printWin = window.open('', '_blank');
  printWin.document.write(html + `<script>window.onload = function() { window.print(); }<\/script>`);
  printWin.document.close();
}

// ═══════════════════════════════════════════
// TRACEABILITY — WELDING EQUIPMENT
// ═══════════════════════════════════════════
let _weldingMachines = [];

async function renderWeldingTab() {
  const container = document.getElementById('weldingMachineList');
  if (!container) return;
  try {
    _weldingMachines = await api.get('/api/welding-machines');
  } catch (e) {
    container.innerHTML = '<div class="empty-state">Failed to load welding machines</div>';
    return;
  }

  if (!_weldingMachines.length) {
    container.innerHTML = '<div class="empty-state" style="padding:30px"><div class="icon">&#128293;</div>No welding machines registered yet</div>';
    return;
  }

  container.innerHTML = _weldingMachines.map(m => {
    const expiry = m.expiry_date ? m.expiry_date.split('T')[0] : null;
    const isExpired = expiry && expiry < todayStr();
    const isExpiringSoon = expiry && !isExpired && expiry <= dateStr(new Date(Date.now() + 90 * 86400000));
    const expiryColor = isExpired ? 'var(--red)' : isExpiringSoon ? 'var(--amber)' : 'var(--green)';
    const expiryLabel = isExpired ? 'EXPIRED' : isExpiringSoon ? 'Expiring soon' : 'Valid';
    const welderNames = (m.welders || []).map(w => w.employee_name).join(', ') || 'None assigned';

    return `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px;margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div>
            <div style="font-weight:600;font-size:15px;margin-bottom:2px">${m.machine_name}</div>
            <div style="font-size:12px;color:var(--muted);font-family:var(--font-mono)">S/N: ${m.serial_number || '—'}</div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-ghost" style="padding:4px 10px;font-size:11px" onclick="editWeldingMachine(${m.id})">&#9998; Edit</button>
            <button class="btn btn-ghost" style="padding:4px 10px;font-size:11px;color:var(--red)" onclick="deleteWeldingMachine(${m.id}, '${m.machine_name.replace(/'/g, "\\'")}')">&#10005;</button>
          </div>
        </div>
        <div style="display:flex;gap:20px;flex-wrap:wrap;font-size:13px;color:var(--muted)">
          <div>Expiry: <span style="color:${expiryColor};font-weight:600">${expiry ? fmtDateStr(expiry) : '—'}</span> <span style="font-size:10px;color:${expiryColor}">${expiry ? expiryLabel : ''}</span></div>
          <div>Authorised: <span style="color:var(--text)">${welderNames}</span></div>
        </div>
        ${m.notes ? `<div style="font-size:12px;color:var(--subtle);margin-top:6px">${m.notes}</div>` : ''}
      </div>`;
  }).join('');
}

function openAddWeldingMachineForm() {
  document.getElementById('weldEditId').value = '';
  document.getElementById('weldMachineName').value = '';
  document.getElementById('weldSerialNumber').value = '';
  document.getElementById('weldExpiryDate').value = '';
  document.getElementById('weldNotes').value = '';
  document.getElementById('weldingFormTitle').textContent = 'Add Welding Machine';
  populateWelderCheckboxes([]);
  document.getElementById('weldingMachineFormArea').style.display = 'block';
}

function closeWeldingMachineForm() {
  document.getElementById('weldingMachineFormArea').style.display = 'none';
}

function populateWelderCheckboxes(selectedIds) {
  const container = document.getElementById('weldWelderCheckboxes');
  if (!container) return;
  const workshopStaff = (state.timesheetData.employees || [])
    .filter(e => e.active !== false && e.staffType === 'workshop');
  container.innerHTML = workshopStaff.map(e => {
    const checked = selectedIds.includes(e.id) ? 'checked' : '';
    return `<label style="display:flex;align-items:center;gap:6px;font-size:13px;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:6px 12px;cursor:pointer">
      <input type="checkbox" class="weld-welder-cb" value="${e.id}" ${checked}> ${e.name}
    </label>`;
  }).join('');
}

async function editWeldingMachine(id) {
  try {
    const m = await api.get(`/api/welding-machines/${id}`);
    document.getElementById('weldEditId').value = m.id;
    document.getElementById('weldMachineName').value = m.machine_name || '';
    document.getElementById('weldSerialNumber').value = m.serial_number || '';
    document.getElementById('weldExpiryDate').value = m.expiry_date ? m.expiry_date.split('T')[0] : '';
    document.getElementById('weldNotes').value = m.notes || '';
    document.getElementById('weldingFormTitle').textContent = 'Edit Welding Machine';
    populateWelderCheckboxes((m.welders || []).map(w => w.employee_id));
    document.getElementById('weldingMachineFormArea').style.display = 'block';
  } catch (e) { toast('Failed to load machine details', 'error'); }
}

async function saveWeldingMachine() {
  const editId = document.getElementById('weldEditId').value;
  const machineName = document.getElementById('weldMachineName').value.trim();
  const serialNumber = document.getElementById('weldSerialNumber').value.trim();
  const expiryDate = document.getElementById('weldExpiryDate').value;
  const notes = document.getElementById('weldNotes').value.trim();
  const welderIds = [...document.querySelectorAll('.weld-welder-cb:checked')].map(cb => parseInt(cb.value));

  if (!machineName) { toast('Machine name is required', 'error'); return; }

  const body = { machine_name: machineName, serial_number: serialNumber, expiry_date: expiryDate || null, notes: notes || null, welder_ids: welderIds };

  try {
    if (editId) {
      await api.put(`/api/welding-machines/${editId}`, body);
      toast('Machine updated ✓', 'success');
    } else {
      await api.post('/api/welding-machines', body);
      toast('Machine added ✓', 'success');
    }
    closeWeldingMachineForm();
    renderWeldingTab();
  } catch (e) { toast('Save failed: ' + e.message, 'error'); }
}

async function deleteWeldingMachine(id, name) {
  if (!confirm(`Remove "${name}" from the register?`)) return;
  try {
    await api.delete(`/api/welding-machines/${id}`);
    toast('Machine removed', 'info');
    renderWeldingTab();
  } catch (e) { toast('Delete failed', 'error'); }
}

// ═══════════════════════════════════════════
// TRACEABILITY — SUPPLIERS
// ═══════════════════════════════════════════
let _suppliers = [];
let _serviceTypes = [];

async function loadServiceTypes() {
  try { _serviceTypes = await api.get('/api/service-types'); } catch { _serviceTypes = []; }
}

async function renderSuppliersTab() {
  await loadServiceTypes();
  const container = document.getElementById('supplierList');
  if (!container) return;
  try {
    _suppliers = await api.get('/api/suppliers');
  } catch (e) {
    container.innerHTML = '<div class="empty-state">Failed to load suppliers</div>';
    return;
  }

  if (!_suppliers.length) {
    container.innerHTML = '<div class="empty-state" style="padding:30px"><div class="icon">&#128666;</div>No suppliers registered yet</div>';
    return;
  }

  // Group by first service (or show all services per card)
  container.innerHTML = _suppliers.map(s => {
    const svcNames = (s.services || []).map(sv => sv.service_name);
    const svcLabel = svcNames.length ? svcNames.join(', ') : 'No services assigned';

    return `
      <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:6px">
          <div>
            <div style="font-weight:600;font-size:14px">${s.supplier_name}</div>
            <div style="font-size:11px;color:var(--accent);margin-top:2px">${svcLabel}</div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="btn btn-ghost" style="padding:4px 10px;font-size:11px" onclick="editSupplier(${s.id})">&#9998; Edit</button>
            <button class="btn btn-ghost" style="padding:4px 10px;font-size:11px;color:var(--red)" onclick="deleteSupplier(${s.id}, '${s.supplier_name.replace(/'/g, "\\'")}')">&#10005;</button>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 16px;font-size:12px;color:var(--muted)">
          ${s.contact_name ? `<div>Contact: <span style="color:var(--text)">${s.contact_name}</span></div>` : ''}
          ${s.telephone ? `<div>Tel: <span style="color:var(--text)">${s.telephone}</span></div>` : ''}
          ${s.email ? `<div>Email: <span style="color:var(--text)">${s.email}</span></div>` : ''}
          ${(s.address_line1 || s.city || s.postcode) ? `<div>Address: <span style="color:var(--text)">${[s.address_line1, s.address_line2, s.city, s.county, s.postcode].filter(Boolean).join(', ')}</span></div>` : ''}
        </div>
      </div>`;
  }).join('');

  // Also render service type list if visible
  renderServiceTypeList();
}

function populateServiceCheckboxes(selectedIds) {
  const container = document.getElementById('supplierServiceCheckboxes');
  if (!container) return;
  const _svcSelectedIds = new Set(selectedIds.map(Number));

  container.innerHTML = `
    <div style="position:relative;margin-bottom:8px">
      <input type="text" id="svcSearchBox" class="field-input" placeholder="Search services..." 
        style="padding-left:30px;font-size:13px"
        oninput="filterServiceCheckboxes()">
      <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:14px;pointer-events:none">&#128269;</span>
    </div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;font-size:12px;color:var(--muted)">
      <span id="svcSelectedCount">${_svcSelectedIds.size} selected</span>
      <span id="svcFilterInfo" style="display:none"></span>
    </div>
    <div id="svcCheckboxList" style="max-height:250px;overflow-y:auto;display:flex;flex-wrap:wrap;gap:8px;padding:2px">
      ${renderServiceCheckboxItems(_serviceTypes, _svcSelectedIds, '')}
    </div>`;
}

function renderServiceCheckboxItems(types, selectedSet, filter) {
  const lower = filter.toLowerCase();
  const sorted = [...types].sort((a, b) => {
    const aChecked = selectedSet.has(a.id) ? 0 : 1;
    const bChecked = selectedSet.has(b.id) ? 0 : 1;
    return aChecked - bChecked || a.name.localeCompare(b.name);
  });
  return sorted.map(st => {
    const match = !lower || st.name.toLowerCase().includes(lower);
    const checked = selectedSet.has(st.id) ? 'checked' : '';
    return `<label style="display:${match ? 'flex' : 'none'};align-items:center;gap:6px;font-size:13px;background:${checked ? 'var(--accent-bg, rgba(59,130,246,0.08))' : 'var(--card)'};border:1px solid ${checked ? 'var(--accent)' : 'var(--border)'};border-radius:8px;padding:6px 12px;cursor:pointer;transition:all .15s" data-svc-id="${st.id}" data-svc-name="${st.name.toLowerCase()}">
      <input type="checkbox" class="supplier-svc-cb" value="${st.id}" ${checked} onchange="onServiceCheckboxChange()"> ${st.name}
    </label>`;
  }).join('');
}

function filterServiceCheckboxes() {
  const search = (document.getElementById('svcSearchBox')?.value || '').toLowerCase();
  const labels = document.querySelectorAll('#svcCheckboxList label');
  let visible = 0;
  labels.forEach(lbl => {
    const name = lbl.dataset.svcName || '';
    const show = !search || name.includes(search);
    lbl.style.display = show ? 'flex' : 'none';
    if (show) visible++;
  });
  const info = document.getElementById('svcFilterInfo');
  if (info) {
    info.style.display = search ? 'inline' : 'none';
    info.textContent = search ? `(${visible} matching)` : '';
  }
}

function onServiceCheckboxChange() {
  const checked = document.querySelectorAll('.supplier-svc-cb:checked');
  const countEl = document.getElementById('svcSelectedCount');
  if (countEl) countEl.textContent = `${checked.length} selected`;
  // Re-sort: move checked to top
  const list = document.getElementById('svcCheckboxList');
  if (!list) return;
  const labels = [...list.querySelectorAll('label')];
  labels.sort((a, b) => {
    const aC = a.querySelector('input').checked ? 0 : 1;
    const bC = b.querySelector('input').checked ? 0 : 1;
    return aC - bC || (a.dataset.svcName || '').localeCompare(b.dataset.svcName || '');
  });
  labels.forEach(lbl => {
    const inp = lbl.querySelector('input');
    lbl.style.background = inp.checked ? 'var(--accent-bg, rgba(59,130,246,0.08))' : 'var(--card)';
    lbl.style.borderColor = inp.checked ? 'var(--accent)' : 'var(--border)';
    list.appendChild(lbl);
  });
}

function openAddSupplierForm() {
  document.getElementById('supplierEditId').value = '';
  document.getElementById('supplierName').value = '';
  document.getElementById('supplierContactName').value = '';
  document.getElementById('supplierTel').value = '';
  document.getElementById('supplierEmail').value = '';
  document.getElementById('supplierAddr1').value = '';
  document.getElementById('supplierAddr2').value = '';
  document.getElementById('supplierCity').value = '';
  document.getElementById('supplierCounty').value = '';
  document.getElementById('supplierPostcode').value = '';
  document.getElementById('supplierFormTitle').textContent = 'Add Supplier';
  populateServiceCheckboxes([]);
  document.getElementById('supplierFormArea').style.display = 'block';
}

function closeSupplierForm() {
  document.getElementById('supplierFormArea').style.display = 'none';
}

async function editSupplier(id) {
  try {
    const s = await api.get(`/api/suppliers/${id}`);
    document.getElementById('supplierEditId').value = s.id;
    document.getElementById('supplierName').value = s.supplier_name || '';
    document.getElementById('supplierContactName').value = s.contact_name || '';
    document.getElementById('supplierTel').value = s.telephone || '';
    document.getElementById('supplierEmail').value = s.email || '';
    document.getElementById('supplierAddr1').value = s.address_line1 || '';
    document.getElementById('supplierAddr2').value = s.address_line2 || '';
    document.getElementById('supplierCity').value = s.city || '';
    document.getElementById('supplierCounty').value = s.county || '';
    document.getElementById('supplierPostcode').value = s.postcode || '';
    document.getElementById('supplierFormTitle').textContent = 'Edit Supplier';
    populateServiceCheckboxes((s.services || []).map(sv => sv.service_type_id));
    document.getElementById('supplierFormArea').style.display = 'block';
  } catch (e) { toast('Failed to load supplier details', 'error'); }
}

async function saveSupplier() {
  const editId = document.getElementById('supplierEditId').value;
  const supplierName = document.getElementById('supplierName').value.trim();
  const contactName = document.getElementById('supplierContactName').value.trim();
  const telephone = document.getElementById('supplierTel').value.trim();
  const email = document.getElementById('supplierEmail').value.trim();
  const addr1 = document.getElementById('supplierAddr1').value.trim();
  const addr2 = document.getElementById('supplierAddr2').value.trim();
  const city = document.getElementById('supplierCity').value.trim();
  const county = document.getElementById('supplierCounty').value.trim();
  const postcode = document.getElementById('supplierPostcode').value.trim();
  const serviceTypeIds = [...document.querySelectorAll('.supplier-svc-cb:checked')].map(cb => parseInt(cb.value));

  if (!supplierName) { toast('Supplier name is required', 'error'); return; }
  if (!serviceTypeIds.length) { toast('Please select at least one service', 'error'); return; }

  const body = {
    supplier_name: supplierName,
    contact_name: contactName || null, telephone: telephone || null, email: email || null,
    address_line1: addr1 || null, address_line2: addr2 || null,
    city: city || null, county: county || null, postcode: postcode || null,
    service_type_ids: serviceTypeIds
  };

  try {
    if (editId) {
      await api.put(`/api/suppliers/${editId}`, body);
      toast('Supplier updated ✓', 'success');
    } else {
      await api.post('/api/suppliers', body);
      toast('Supplier added ✓', 'success');
    }
    closeSupplierForm();
    renderSuppliersTab();
  } catch (e) { toast('Save failed: ' + e.message, 'error'); }
}

async function deleteSupplier(id, name) {
  if (!confirm(`Remove supplier "${name}"?`)) return;
  try {
    await api.delete(`/api/suppliers/${id}`);
    toast('Supplier removed', 'info');
    renderSuppliersTab();
  } catch (e) { toast('Delete failed', 'error'); }
}

// ── Service Type Management ──
function toggleManageServices() {
  const area = document.getElementById('manageServicesArea');
  if (!area) return;
  area.style.display = area.style.display === 'none' ? 'block' : 'none';
  if (area.style.display === 'block') renderServiceTypeList();
}

function renderServiceTypeList() {
  const container = document.getElementById('serviceTypeList');
  if (!container) return;
  if (!_serviceTypes.length) {
    container.innerHTML = '<div style="font-size:13px;color:var(--muted)">No service types defined</div>';
    return;
  }

  const sorted = [..._serviceTypes].sort((a, b) => a.name.localeCompare(b.name));
  const groups = {};
  sorted.forEach(st => {
    const letter = (st.name[0] || '#').toUpperCase();
    if (!groups[letter]) groups[letter] = [];
    groups[letter].push(st);
  });

  container.innerHTML = `
    <div style="position:relative;margin-bottom:10px">
      <input type="text" id="svcMgmtSearch" class="field-input" placeholder="Filter services..." 
        style="padding-left:30px;font-size:13px"
        oninput="filterServiceTypeList()">
      <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--muted);font-size:14px;pointer-events:none">&#128269;</span>
    </div>
    <div style="font-size:12px;color:var(--muted);margin-bottom:8px">${_serviceTypes.length} service${_serviceTypes.length !== 1 ? 's' : ''} total</div>
    <div id="svcMgmtGroupedList" style="max-height:300px;overflow-y:auto;padding-right:4px">
      ${Object.keys(groups).sort().map(letter => `
        <div class="svc-mgmt-group" data-letter="${letter}">
          <div style="font-size:11px;font-weight:700;color:var(--accent);text-transform:uppercase;letter-spacing:1px;padding:6px 0 4px;border-bottom:1px solid var(--border);margin-bottom:6px">${letter}</div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px">
            ${groups[letter].map(st => `
              <div class="svc-mgmt-pill" data-svc-name="${st.name.toLowerCase()}" style="display:flex;align-items:center;gap:6px;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:5px 10px;font-size:13px">
                ${st.name}
                <button onclick="deleteServiceType(${st.id}, '${st.name.replace(/'/g, "\\'")}')"
                  style="background:none;border:none;color:var(--red);cursor:pointer;font-size:14px;padding:0 2px;line-height:1" title="Remove">&#10005;</button>
              </div>`).join('')}
          </div>
        </div>`).join('')}
    </div>`;
}

function filterServiceTypeList() {
  const search = (document.getElementById('svcMgmtSearch')?.value || '').toLowerCase();
  document.querySelectorAll('.svc-mgmt-group').forEach(group => {
    const pills = group.querySelectorAll('.svc-mgmt-pill');
    let anyVisible = false;
    pills.forEach(pill => {
      const name = pill.dataset.svcName || '';
      const show = !search || name.includes(search);
      pill.style.display = show ? 'flex' : 'none';
      if (show) anyVisible = true;
    });
    group.style.display = anyVisible ? 'block' : 'none';
  });
}

async function addServiceType() {
  const input = document.getElementById('newServiceTypeName');
  const name = (input?.value || '').trim();
  if (!name) { toast('Enter a service name', 'error'); return; }
  try {
    await api.post('/api/service-types', { name });
    input.value = '';
    await loadServiceTypes();
    renderServiceTypeList();
    toast('Service added ✓', 'success');
  } catch (e) { toast(e.message || 'Failed to add service', 'error'); }
}

async function deleteServiceType(id, name) {
  if (!confirm(`Remove service "${name}"? Existing supplier assignments will be unaffected.`)) return;
  try {
    await api.delete(`/api/service-types/${id}`);
    await loadServiceTypes();
    renderServiceTypeList();
    toast('Service removed', 'info');
  } catch (e) { toast('Delete failed', 'error'); }
}

let clockLogWeekOffset = 0;

function changeClockLogWeek(dir) {
  clockLogWeekOffset += dir;
  // Don't allow navigating into the future
  if (clockLogWeekOffset > 0) { clockLogWeekOffset = 0; return; }
  if (clockLogWeekOffset < -1) { clockLogWeekOffset = -1; return; }
  renderClockLogForWeek();
}

function renderClockLogForWeek() {
  const { mon, sun } = getWeekDates(clockLogWeekOffset);
  const monStr = dateStr(mon);
  const sunStr = dateStr(sun);
  const thisWeekMon = dateStr(getWeekDates(0).mon);

  // Update week label
  const label = document.getElementById('clockLogWeekLabel');
  if (label) label.textContent = `${fmtDate(mon)} – ${fmtDate(sun)}`;

  // Update badge — clear visual distinction between this week and last/previous
  const badge = document.getElementById('clockLogWeekBadge');
  if (badge) {
    if (clockLogWeekOffset === 0) {
      badge.innerHTML = '<span>THIS WEEK</span>';
      badge.style.background = 'rgba(62,207,142,.15)';
      badge.style.color = 'var(--green)';
      badge.style.border = '1px solid rgba(62,207,142,.3)';
    } else {
      badge.innerHTML = '<span>LAST WEEK — PENDING REVIEW</span>';
      badge.style.background = 'rgba(245,158,11,.15)';
      badge.style.color = 'var(--amber)';
      badge.style.border = '1px solid rgba(245,158,11,.3)';
    }
  }

  // Show/hide approve week button
  let approveBtn = document.getElementById('approveWeekBtn');
  if (clockLogWeekOffset !== 0) {
    if (!approveBtn) {
      approveBtn = document.createElement('button');
      approveBtn.id = 'approveWeekBtn';
      approveBtn.className = 'btn btn-success';
      approveBtn.style.cssText = 'padding:8px 18px;font-size:13px;font-weight:600';
      approveBtn.textContent = '✓ Approve the week';
      approveBtn.onclick = openApproveWeekModal;
      // Insert after badge
      badge.parentNode.insertBefore(approveBtn, badge.nextSibling);
    }
    approveBtn.style.display = '';
  } else {
    if (approveBtn) approveBtn.style.display = 'none';
  }

  // Filter clockings for this week
  const weekClockings = state.timesheetData.clockings.filter(
    c => c.date >= monStr && c.date <= sunStr
  );
  renderClockLog(weekClockings);
}

function checkArchiveReminder() {
  const today = new Date();
  const dow = today.getDay(); // 0=Sun, 1=Mon
  if (dow !== 1) return; // Only show on Monday

  const { mon } = getWeekDates(-1); // Last week's Monday
  const lastMonStr = dateStr(mon);
  const alreadyArchived = state.timesheetData.archive && state.timesheetData.archive[`week_${lastMonStr}`];
  if (alreadyArchived) return;

  // Show reminder
  const existing = document.getElementById('archiveReminderBanner');
  if (existing) return;
  const banner = document.createElement('div');
  banner.id = 'archiveReminderBanner';
  banner.style.cssText = 'background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:10px;padding:12px 18px;display:flex;align-items:center;gap:12px;margin-bottom:16px;';
  banner.innerHTML = `
    <span style="font-size:18px">📁</span>
    <span style="flex:1;font-size:13px">Last week's timesheet hasn't been archived yet.</span>
    <button class="btn btn-primary" style="padding:6px 14px;font-size:12px" onclick="changePayrollWeek(-1);archiveWeek()">Archive Last Week</button>
  `;
  const payrollTab = document.getElementById('tab-payroll');
  if (payrollTab) payrollTab.insertBefore(banner, payrollTab.firstChild);
}

function getDayHoursForEmployee(empName, dateStr) {
  // Get total approved clocked hours for an employee on a specific date
  const clockings = (state.timesheetData.clockings || []).filter(c =>
    c.employeeName === empName && c.date === dateStr &&
    c.approvalStatus !== 'rejected'
  );
  return clockings.reduce((s, c) => s + (calcHours(c.clockIn, c.clockOut, c.breakMins, c.date) || 0), 0);
}

function renderPayroll() {
  const { mon, sun } = getWeekDates(payrollWeekOffset);
  document.getElementById('payrollWeekLabel').textContent =
    `${fmtDate(mon)} – ${fmtDate(sun)}`;

  const container = document.getElementById('payrollSummary');
  if (!container) return;
  const employees = (state.timesheetData.employees || []).filter(e => e.active !== false && (e.payType || 'payee') !== 'cis');

  if (!employees.length) {
    container.innerHTML = '<div class="empty-state">No employees set up yet.</div>';
    return;
  }

  // Build day columns Mon-Sun
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon);
    d.setDate(mon.getDate() + i);
    days.push({ label: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i], date: dateStr(d) });
  }

  // Calculate payroll results
  const results = employees.map(e => {
    const payroll = calculatePayroll(e.name, mon, sun);
    const dayHrs = days.map(d => getDayHoursForEmployee(e.name, d.date) || 0);
    const totalHrs = dayHrs.reduce((s, h) => s + h, 0);
    return { emp: e, payroll, dayHrs, totalHrs };
  }).filter(r => r.totalHrs > 0 || r.payroll);

  if (!results.length) {
    container.innerHTML = '<div class="empty-state"><div class="icon">💷</div>No approved clockings this week</div>';
    return;
  }

  const grandTotal = results.reduce((s, r) => s + (r.payroll?.totalPay || 0), 0);
  const totalBasic = results.reduce((s, r) => s + (r.payroll?.basicPay || 0), 0);
  const totalOT    = results.reduce((s, r) => s + (r.payroll?.overtimePay || 0), 0);
  const totalDT    = results.reduce((s, r) => s + (r.payroll?.doublePay || 0), 0);
  const totalHol   = results.reduce((s, r) => s + ((r.payroll?.holidayPay || 0) + (r.payroll?.bankHolidayPay || 0)), 0);

  // Render a single day cell. Combines worked + booked-holiday + bank-holiday
  // into one display. BH and worked never co-occur (clock-in is blocked on
  // bank holidays). Holiday and worked CAN co-occur on a half-day.
  const renderDayCell = (r, ds) => {
    const worked = r.payroll?.dayHours?.[ds] || 0;
    const hol    = r.payroll?.dayHoliday?.[ds] || 0;
    const bh     = r.payroll?.dayBankHoliday?.[ds] || 0;
    const totalHol = hol + bh;

    if (totalHol > 0 && worked === 0) {
      return `<td class="mono" style="text-align:center;color:var(--accent)">${totalHol.toFixed(1)}<sub style="font-size:9px;color:var(--muted);margin-left:1px">H</sub></td>`;
    }
    if (worked > 0 && totalHol > 0) {
      // Half-day holiday + worked half-day
      return `<td class="mono" style="text-align:center">${worked.toFixed(1)}<br><span style="font-size:10px;color:var(--accent)">+${totalHol.toFixed(1)}H</span></td>`;
    }
    return `<td class="mono" style="text-align:center;color:${worked > 0 ? 'var(--text)' : 'var(--subtle)'}">${worked > 0 ? worked.toFixed(1) : '—'}</td>`;
  };

  container.innerHTML = `
    <div style="overflow-x:auto">
      <table class="summary-table" style="min-width:980px">
        <thead>
          <tr>
            <th style="min-width:140px">EMPLOYEE</th>
            ${days.map(d => `<th style="text-align:center;min-width:55px">${d.label}<br><span style="font-weight:400;font-size:9px;color:var(--subtle)">${d.date.slice(8)}</span></th>`).join('')}
            <th style="text-align:center">TOTAL HRS</th>
            <th>STD (£)</th>
            <th>O/T ×1.5 (£)</th>
            <th>DBL ×2 (£)</th>
            <th style="color:var(--accent)">HOL (£)</th>
            <th style="color:var(--green)">TOTAL PAY</th>
          </tr>
        </thead>
        <tbody>
          ${results.map(r => {
            const holHrs = (r.payroll?.holidayHours || 0) + (r.payroll?.bankHolidayHours || 0);
            const holPay = (r.payroll?.holidayPay   || 0) + (r.payroll?.bankHolidayPay   || 0);
            const totalAllHrs = r.totalHrs + holHrs; // include holiday in total hours column
            return `
            <tr>
              <td style="font-weight:600">
                ${r.emp.name}
                ${r.payroll?.doubleTimeApplies ? '<span class="manually-edited-badge" style="background:rgba(62,207,142,.15);color:var(--green);border-color:rgba(62,207,142,.3)">SAT+SUN</span>' : ''}
                <br><span style="font-size:11px;color:var(--muted);font-family:var(--font-mono)">£${(r.emp.rate||0).toFixed(2)}/hr</span>
              </td>
              ${days.map(d => renderDayCell(r, d.date)).join('')}
              <td class="mono" style="text-align:center;font-weight:700">${totalAllHrs.toFixed(1)}</td>
              <td class="mono">${r.payroll?.basicHours||0}h<br><span style="font-size:11px;color:var(--muted)">£${(r.payroll?.basicPay||0).toFixed(2)}</span></td>
              <td class="mono" style="color:var(--amber)">${r.payroll?.overtimeHours > 0 ? r.payroll.overtimeHours+'h' : '—'}<br><span style="font-size:11px;color:var(--muted)">${r.payroll?.overtimeHours > 0 ? '£'+r.payroll.overtimePay.toFixed(2) : ''}</span></td>
              <td class="mono" style="color:var(--accent)">${r.payroll?.doubleHours > 0 ? r.payroll.doubleHours+'h' : '—'}<br><span style="font-size:11px;color:var(--muted)">${r.payroll?.doubleHours > 0 ? '£'+r.payroll.doublePay.toFixed(2) : ''}</span></td>
              <td class="mono" style="color:var(--accent)">${holHrs > 0 ? holHrs+'h' : '—'}<br><span style="font-size:11px;color:var(--muted)">${holHrs > 0 ? '£'+holPay.toFixed(2) : ''}</span></td>
              <td class="mono" style="color:var(--green);font-weight:700;font-size:15px">£${(r.payroll?.totalPay||0).toFixed(2)}</td>
            </tr>
          `;}).join('')}
        </tbody>
        <tfoot>
          <tr style="border-top:2px solid var(--border)">
            <td style="font-weight:700;color:var(--muted);font-size:11px;letter-spacing:1px;text-transform:uppercase">TOTALS</td>
            ${days.map((d, i) => {
              // Day totals include holiday + BH for the day
              const dayTotal = results.reduce((s, r) => {
                const w = r.dayHrs[i] || 0;
                const h = r.payroll?.dayHoliday?.[d.date] || 0;
                const bh = r.payroll?.dayBankHoliday?.[d.date] || 0;
                return s + w + h + bh;
              }, 0);
              return `<td class="mono" style="text-align:center;font-weight:600">${dayTotal > 0 ? dayTotal.toFixed(1) : '—'}</td>`;
            }).join('')}
            <td class="mono" style="text-align:center;font-weight:700">${results.reduce((s,r)=>{
              const holHrs = (r.payroll?.holidayHours || 0) + (r.payroll?.bankHolidayHours || 0);
              return s + r.totalHrs + holHrs;
            },0).toFixed(1)}</td>
            <td class="mono" style="font-weight:600">£${totalBasic.toFixed(2)}</td>
            <td class="mono" style="font-weight:600;color:var(--amber)">£${totalOT.toFixed(2)}</td>
            <td class="mono" style="font-weight:600;color:var(--accent)">£${totalDT.toFixed(2)}</td>
            <td class="mono" style="font-weight:600;color:var(--accent)">£${totalHol.toFixed(2)}</td>
            <td class="mono" style="color:var(--green);font-weight:700;font-size:16px">£${grandTotal.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}

function changePayrollWeek(dir) {
  payrollWeekOffset += dir;
  renderPayroll();
  renderPayrollExtras();
}

function jumpToPayrollWeek(dateValue) {
  if (!dateValue) return;
  const picked = new Date(dateValue);
  const today = new Date();
  // Calculate how many weeks between the current week and the picked date's week
  const todayMon = new Date(today);
  todayMon.setDate(today.getDate() - ((today.getDay() + 6) % 7));
  todayMon.setHours(0,0,0,0);
  const pickedMon = new Date(picked);
  pickedMon.setDate(picked.getDate() - ((picked.getDay() + 6) % 7));
  pickedMon.setHours(0,0,0,0);
  const diffWeeks = Math.round((pickedMon - todayMon) / (7 * 24 * 60 * 60 * 1000));
  payrollWeekOffset = diffWeeks;
  renderPayroll();
  renderPayrollExtras();
}

// ═══════════════════════════════════════════════════════════════════════════
// PAYROLL COMMENTS + REVISIONS
// ═══════════════════════════════════════════════════════════════════════════

let _payrollExtras = { weekKey: null, comments: [], revisions: [] };
let _editingPayrollCommentId = null;

// Year folder name pattern: 2026 -> "00 - 2026", 2027 -> "01 - 2027", etc.
function getPayrollYearFolderName(year) {
  const offset = year - 2026;
  return `${String(offset).padStart(2, '0')} - ${year}`;
}

// "27 Apr 2026 \u2013 03 May 2026" + optional " rev{N}"
function getPayrollFileName(monDate, sunDate, revisionNumber) {
  const fmt = d => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const base = `${fmt(monDate)} \u2013 ${fmt(sunDate)}`;
  const suffix = revisionNumber > 0 ? ` rev${revisionNumber}` : '';
  return `${base}${suffix}.pdf`;
}

// Load comments + revisions for the currently-viewed week
async function loadPayrollExtras(weekCommencing) {
  try {
    const [comments, revisions] = await Promise.all([
      api.get(`/api/payroll-comments?week_commencing=${weekCommencing}`).catch(() => []),
      api.get(`/api/payroll-revisions?week_commencing=${weekCommencing}`).catch(() => [])
    ]);
    _payrollExtras = { weekKey: weekCommencing, comments: comments || [], revisions: revisions || [] };
  } catch (err) {
    console.warn('Failed to load payroll extras:', err);
    _payrollExtras = { weekKey: weekCommencing, comments: [], revisions: [] };
  }
}

// Render the comments + revisions block below the payroll table
async function renderPayrollExtras() {
  const container = document.getElementById('payrollExtras');
  if (!container) return;
  const { mon } = getWeekDates(payrollWeekOffset);
  const monStr = dateStr(mon);

  if (_payrollExtras.weekKey !== monStr) {
    container.innerHTML = '<div class="empty-state" style="padding:12px"><div class="spinner"></div></div>';
    await loadPayrollExtras(monStr);
  }

  const { comments, revisions } = _payrollExtras;
  const fmtDateTime = iso => {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleString('en-GB', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
  };

  let commentsHtml = '';
  if (!comments.length) {
    commentsHtml = `<div style="color:var(--subtle);font-size:13px;padding:12px;text-align:center">No instructions for this payroll week. Click <b>+ Add Payroll Instructions</b> to leave a note.</div>`;
  } else {
    commentsHtml = comments.map(c => {
      const wasEdited = c.updated_at && c.updated_by;
      return `
        <div style="background:var(--surface);border:1px solid var(--border);border-left:3px solid var(--accent2);border-radius:8px;padding:12px 14px;margin-bottom:8px">
          <div style="font-size:13px;color:var(--text);white-space:pre-wrap;margin-bottom:6px">${escapeHtml(c.comment)}</div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:11px;color:var(--muted)">
            <div>
              <span><b>${escapeHtml(c.created_by)}</b> &middot; ${fmtDateTime(c.created_at)}</span>
              ${wasEdited ? `<span style="margin-left:10px;color:var(--subtle)">(edited by ${escapeHtml(c.updated_by)} &middot; ${fmtDateTime(c.updated_at)})</span>` : ''}
            </div>
            <div style="display:flex;gap:6px">
              <button class="tiny-btn" style="padding:3px 10px;font-size:11px" onclick="editPayrollComment(${c.id})">Edit</button>
              <button class="tiny-btn tiny-reject" style="padding:3px 10px;font-size:11px" onclick="deletePayrollComment(${c.id})">Delete</button>
            </div>
          </div>
        </div>`;
    }).join('');
  }

  let revisionsHtml = '';
  if (revisions.length > 0) {
    revisionsHtml = `
      <div class="card" style="margin-top:14px">
        <div class="card-title" style="font-size:13px"><span class="icon">\u{1F4DC}</span> Revision History</div>
        <div style="font-size:12px;color:var(--muted);margin-bottom:10px">
          This week's payroll has been generated ${revisions.length} time${revisions.length !== 1 ? 's' : ''}. Each generation is preserved on SharePoint.
        </div>
        <table class="summary-table" style="font-size:12px">
          <thead><tr><th>VERSION</th><th>FILE</th><th>BY</th><th>WHEN</th></tr></thead>
          <tbody>
            ${revisions.map(r => `
              <tr>
                <td><b>${r.revision_number === 0 ? 'Original' : `rev${r.revision_number}`}</b></td>
                <td class="mono" style="font-size:11px">
                  ${r.file_url
                    ? `<a href="${escapeHtml(r.file_url)}" target="_blank" style="color:var(--accent2)">${escapeHtml(r.file_name)}</a>`
                    : escapeHtml(r.file_name)}
                </td>
                <td>${escapeHtml(r.created_by)}</td>
                <td>${fmtDateTime(r.created_at)}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>`;
  }

  container.innerHTML = `
    <div class="card">
      <div class="card-title" style="font-size:13px"><span class="icon">\u{1F4DD}</span> Payroll Instructions</div>
      ${commentsHtml}
    </div>
    ${revisionsHtml}
  `;
}

function openPayrollCommentModal() {
  _editingPayrollCommentId = null;
  document.getElementById('payrollCommentModalTitle').textContent = 'Add Payroll Instruction';
  document.getElementById('payrollCommentSaveBtn').textContent = 'Save';
  document.getElementById('payrollCommentText').value = '';
  const { mon, sun } = getWeekDates(payrollWeekOffset);
  document.getElementById('payrollCommentWeekLabel').textContent =
    `Week: ${fmtDate(mon)} \u2013 ${fmtDate(sun)}`;
  document.getElementById('payrollCommentModal').classList.add('active');
  setTimeout(() => document.getElementById('payrollCommentText').focus(), 100);
}

function editPayrollComment(id) {
  const c = (_payrollExtras.comments || []).find(x => x.id === id);
  if (!c) return;
  _editingPayrollCommentId = id;
  document.getElementById('payrollCommentModalTitle').textContent = 'Edit Payroll Instruction';
  document.getElementById('payrollCommentSaveBtn').textContent = 'Save Changes';
  document.getElementById('payrollCommentText').value = c.comment;
  const { mon, sun } = getWeekDates(payrollWeekOffset);
  document.getElementById('payrollCommentWeekLabel').textContent =
    `Week: ${fmtDate(mon)} \u2013 ${fmtDate(sun)}`;
  document.getElementById('payrollCommentModal').classList.add('active');
  setTimeout(() => document.getElementById('payrollCommentText').focus(), 100);
}

function closePayrollCommentModal() {
  document.getElementById('payrollCommentModal').classList.remove('active');
  _editingPayrollCommentId = null;
}

async function savePayrollComment() {
  const text = document.getElementById('payrollCommentText').value.trim();
  if (!text) { toast('Please enter a comment', 'error'); return; }
  const author = currentManagerUser || 'office';
  const { mon } = getWeekDates(payrollWeekOffset);
  const monStr = dateStr(mon);

  try {
    if (_editingPayrollCommentId) {
      await api.put(`/api/payroll-comments/${_editingPayrollCommentId}`, {
        comment: text, updated_by: author
      });
      toast('Comment updated \u2713', 'success');
    } else {
      await api.post('/api/payroll-comments', {
        week_commencing: monStr, comment: text, created_by: author
      });
      toast('Comment added \u2713', 'success');
    }
    closePayrollCommentModal();
    _payrollExtras.weekKey = null;
    await renderPayrollExtras();
  } catch (err) {
    toast('Save failed: ' + err.message, 'error');
  }
}

async function deletePayrollComment(id) {
  if (!confirm('Delete this payroll instruction?')) return;
  try {
    await api.delete(`/api/payroll-comments/${id}`);
    toast('Comment deleted', 'info');
    _payrollExtras.weekKey = null;
    await renderPayrollExtras();
  } catch (err) {
    toast('Delete failed: ' + err.message, 'error');
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// EMAIL TO PAYROLL — generate PDF, save to SharePoint, open Outlook draft
// ═══════════════════════════════════════════════════════════════════════════

async function findOrCreatePayrollYearFolder(year) {
  const token = await getToken();
  const payrollPath = '01 - Accounts/02 - Payroll';
  const lookup = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${BAMA_DRIVE_ID}/root:/${encodeURIComponent(payrollPath)}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  if (!lookup.ok) {
    throw new Error(`Cannot find SharePoint folder "01 - Accounts/02 - Payroll" (status ${lookup.status})`);
  }
  const parent = await lookup.json();
  const yearFolderName = getPayrollYearFolderName(year);
  const folder = await getOrCreateSubfolder(parent.id, yearFolderName, BAMA_DRIVE_ID);
  if (!folder) throw new Error(`Could not create year folder "${yearFolderName}"`);
  return folder;
}

// Renders the payroll PDF using the SAME mechanism as the Export to PDF
// button — a real browser window that natively renders the HTML — and uses
// html2pdf inside that window to capture a Blob. This is far more reliable
// than rasterising an off-screen iframe in the parent document context,
// which suffered from layout cropping, dark backgrounds bleeding from
// bama.css, and host-page coordinate confusion in html2canvas.
//
// `popupWin` MUST be opened by the caller synchronously inside the user's
// click handler — popup blockers will reject window.open() if it's called
// after any awaits. The caller should pass the resulting Window in.
async function renderPayrollPDFBlob(weekStr, popupWin) {
  if (!popupWin) throw new Error('Render window not provided — cannot generate PDF');

  const { mon, sun } = getWeekDates(payrollWeekOffset);
  const monStr = dateStr(mon);
  const employees = (state.timesheetData.employees || []).filter(e => e.active !== false && (e.payType || 'payee') !== 'cis');
  const results = employees.map(e => calculatePayroll(e.name, mon, sun)).filter(Boolean);
  if (!results.length) {
    try { popupWin.close(); } catch (e) {}
    throw new Error('No payroll data this week');
  }

  const totals = {
    basic: results.reduce((s, r) => s + r.basicPay, 0),
    ot:    results.reduce((s, r) => s + r.overtimePay, 0),
    dt:    results.reduce((s, r) => s + r.doublePay, 0),
    hol:   results.reduce((s, r) => s + (r.holidayPay || 0) + (r.bankHolidayPay || 0), 0),
    grand: results.reduce((s, r) => s + r.totalPay, 0)
  };

  // Pull payroll instruction comments for this week so they appear in the
  // PDF saved to SharePoint, same as the Export to PDF button.
  let comments = [];
  if (_payrollExtras.weekKey === monStr) {
    comments = _payrollExtras.comments || [];
  } else {
    try { comments = await api.get(`/api/payroll-comments?week_commencing=${monStr}`) || []; }
    catch (e) { console.warn('Could not load payroll comments for PDF:', e); }
  }

  await loadLogoDataUri();
  const baseHtml = buildPayrollHTML({ results, totals, weekStr, comments });

  // Inject the html2pdf library + a tiny capture bridge into the document
  // BEFORE writing it so it executes after the body parses. The bridge
  // signals back to us via a global flag once the PDF Blob is ready.
  const captureScript = `
    <script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"><\/script>
    <script>
      window.__pdfReady = false;
      window.__pdfBlob = null;
      window.__pdfError = null;
      async function __capturePDF() {
        try {
          // Wait for fonts.
          if (document.fonts && document.fonts.ready) {
            try { await document.fonts.ready; } catch (e) {}
          }
          // Wait for images.
          const imgs = Array.from(document.images);
          await Promise.all(imgs.map(img => {
            if (img.complete && img.naturalWidth > 0) return Promise.resolve();
            return new Promise(res => {
              img.addEventListener('load', res, { once: true });
              img.addEventListener('error', res, { once: true });
              setTimeout(res, 3000);
            });
          }));
          // Let layout settle.
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          const blob = await html2pdf().set({
            margin: [10, 10, 10, 10],
            filename: 'payroll.pdf',
            image: { type: 'jpeg', quality: 0.95 },
            html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
            jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
          }).from(document.body).outputPdf('blob');
          window.__pdfBlob = blob;
        } catch (err) {
          window.__pdfError = err && err.message ? err.message : String(err);
        } finally {
          window.__pdfReady = true;
        }
      }
      window.addEventListener('load', __capturePDF);
    <\/script>
  `;

  // Splice the capture script in just before </body>.
  const html = baseHtml.replace(/<\/body>/i, captureScript + '</body>');

  popupWin.document.open();
  popupWin.document.write(html);
  popupWin.document.close();

  // Poll for the bridge to signal completion. 30 s ceiling is generous —
  // a normal capture is < 2 s.
  const start = Date.now();
  while (!popupWin.__pdfReady) {
    if (Date.now() - start > 30000) {
      try { popupWin.close(); } catch (e) {}
      throw new Error('PDF render timed out after 30 s');
    }
    await new Promise(r => setTimeout(r, 100));
  }

  if (popupWin.__pdfError) {
    const errMsg = popupWin.__pdfError;
    try { popupWin.close(); } catch (e) {}
    throw new Error('PDF render failed: ' + errMsg);
  }

  const blob = popupWin.__pdfBlob;
  try { popupWin.close(); } catch (e) {}
  if (!blob) throw new Error('PDF render produced no blob');
  return blob;
}

function fillPayrollEmailTemplate(tpl, ctx) {
  if (!tpl) return '';
  return tpl
    .replace(/\{weekRange\}/g, ctx.weekRange || '')
    .replace(/\{totalPay\}/g, ctx.totalPay || '')
    .replace(/\{totalEmployees\}/g, ctx.totalEmployees != null ? String(ctx.totalEmployees) : '')
    .replace(/\{url\}/g, ctx.url || '')
    .replace(/\{instructions\}/g, ctx.instructions || '');
}

async function emailPayrollReport() {
  const { mon, sun } = getWeekDates(payrollWeekOffset);
  const monStr = dateStr(mon);
  const weekStr = `${fmtDate(mon)} \u2013 ${fmtDate(sun)}`;
  const fmtFull = d => d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const weekStrFull = `${fmtFull(mon)} \u2013 ${fmtFull(sun)}`;
  const author = currentManagerUser || 'office';

  let revisions = [];
  try {
    revisions = await api.get(`/api/payroll-revisions?week_commencing=${monStr}`) || [];
  } catch (e) {
    console.warn('Failed to load revisions:', e);
  }

  // Open the render window inside the modal's confirm-click handler so it's
  // a fresh user gesture (popup blockers reject window.open after awaits).
  // The window is positioned mostly off-screen so it doesn't disturb the user.
  const openRenderWindow = () => {
    const w = window.open('', '_blank',
      'width=860,height=400,left=' + (screen.width || 1200) + ',top=0,noopener=no');
    if (w) {
      try { w.document.write('<!DOCTYPE html><html><head><title>Generating payroll PDF…</title><style>body{font-family:sans-serif;color:#666;padding:40px;text-align:center}</style></head><body>Generating payroll PDF…</body></html>'); } catch (e) {}
    }
    return w;
  };

  let popupWin = null;
  if (revisions.length > 0) {
    // Already generated → confirm override (BAMA-styled)
    const lastRev = revisions[revisions.length - 1];
    const lastLabel = lastRev.revision_number === 0 ? 'the original' : `rev${lastRev.revision_number}`;
    const result = await showConfirmAsync(
      'Override existing payroll?',
      `<div style="margin-bottom:14px">Payroll for <b>${escapeHtml(weekStr)}</b> has already been generated (${escapeHtml(lastLabel)}, by <b>${escapeHtml(lastRev.created_by)}</b>).</div>
       <div style="margin-bottom:14px">Do you want to override and generate a <b>new revision</b>?</div>
       <div style="font-size:12px;color:var(--subtle)">The original file will be kept on SharePoint.</div>`,
      { okLabel: 'Generate revision', cancelLabel: 'Cancel', onConfirmSync: openRenderWindow }
    );
    if (!result.ok) return;
    popupWin = result.data;
  } else {
    // First-time generation → confirm to prevent accidental click
    const result = await showConfirmAsync(
      'Email payroll report?',
      `<div style="margin-bottom:14px">This will:</div>
       <ul style="margin:0 0 14px 18px;padding:0;color:var(--muted);font-size:13px;line-height:1.7">
         <li>Generate a payroll PDF for <b>${escapeHtml(weekStr)}</b></li>
         <li>Save it to SharePoint (<code style="font-size:12px">01 - Accounts/02 - Payroll</code>)</li>
         <li>Open an email draft with the file link</li>
       </ul>
       <div style="font-size:12px;color:var(--subtle)">Continue?</div>`,
      { okLabel: 'Generate & email', cancelLabel: 'Cancel', onConfirmSync: openRenderWindow }
    );
    if (!result.ok) return;
    popupWin = result.data;
  }

  if (!popupWin) {
    toast('Popup blocked — allow pop-ups for this site and try again', 'error');
    return;
  }

  const nextRevision = revisions.length === 0
    ? 0
    : Math.max(...revisions.map(r => r.revision_number)) + 1;
  const fileName = getPayrollFileName(mon, sun, nextRevision);

  toast(`Generating payroll PDF (${nextRevision === 0 ? 'original' : 'rev' + nextRevision})...`, 'info');
  setLoading(true);

  try {
    const pdfBlob = await renderPayrollPDFBlob(weekStrFull, popupWin);

    const year = mon.getFullYear();
    const yearFolder = await findOrCreatePayrollYearFolder(year);

    const token = await getToken();
    const uploadUrl = `https://graph.microsoft.com/v1.0/drives/${BAMA_DRIVE_ID}/items/${yearFolder.id}:/${encodeURIComponent(fileName)}:/content`;
    const upRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/pdf' },
      body: pdfBlob
    });
    if (!upRes.ok) throw new Error(`SharePoint upload failed: ${upRes.status}`);
    const uploaded = await upRes.json();

    await api.post('/api/payroll-revisions', {
      week_commencing: monStr,
      revision_number: nextRevision,
      file_name: fileName,
      file_url: uploaded.webUrl,
      created_by: author
    });

    const employees = (state.timesheetData.employees || []).filter(e => e.active !== false && (e.payType || 'payee') !== 'cis');
    const results = employees.map(e => calculatePayroll(e.name, mon, sun)).filter(Boolean);
    const grandTotal = results.reduce((s, r) => s + r.totalPay, 0);

    // Fetch comments first so they're available for the {instructions}
    // template placeholder.
    let comments = [];
    try { comments = await api.get(`/api/payroll-comments?week_commencing=${monStr}`) || []; }
    catch (e) { /* non-fatal */ }

    // Format instructions as a bulleted list. Empty string if there are
    // none — keeps the template clean (avoids 'Payroll instructions:' with
    // no items underneath).
    const instructionsText = comments.length
      ? comments.map(c => `- ${c.comment}`).join('\n')
      : '';

    const ctx = {
      weekRange: weekStrFull,
      totalPay: '\u00a3' + grandTotal.toFixed(2),
      totalEmployees: results.length,
      url: uploaded.webUrl,
      instructions: instructionsText
    };

    const subjectTpl = tplGet('payroll', 'emailSubject') || 'BAMA Payroll Report \u2014 Week {weekRange}';
    const bodyTpl    = tplGet('payroll', 'emailBody') || '';
    const subject = fillPayrollEmailTemplate(subjectTpl, ctx);
    let body = fillPayrollEmailTemplate(bodyTpl, ctx);

    // Backward-compatible fallback: if the user's template doesn't include
    // {url}, append the URL at the end (so old templates still produce a
    // working email). Same for {instructions}.
    body = body.replace(/\s+$/g, '');
    if (!/\{url\}/.test(bodyTpl)) {
      if (instructionsText && !/\{instructions\}/.test(bodyTpl)) {
        body += '\n\nPayroll Instructions:\n' + instructionsText;
      }
      body += `\n\nPlease find the below payroll file ready for processing:\n${uploaded.webUrl}`;
    }

    _payrollExtras.weekKey = null;
    await renderPayrollExtras();

    setLoading(false);
    toast(`PDF saved to SharePoint as ${fileName} \u2713`, 'success');

    const mailto = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    if (mailto.length > 2000) {
      console.info('Long mailto URL — some email clients may truncate. Body length:', body.length);
    }
    window.location.href = mailto;
  } catch (err) {
    setLoading(false);
    try { if (popupWin && !popupWin.closed) popupWin.close(); } catch (e) {}
    console.error('Payroll email flow failed:', err);
    toast('Failed: ' + err.message, 'error');
  }
}


async function generatePayrollPDF() {
  const { mon, sun } = getWeekDates(payrollWeekOffset);
  const monStr = dateStr(mon);
  const employees = (state.timesheetData.employees || []).filter(e => e.active !== false && (e.payType || 'payee') !== 'cis');
  const results = employees.map(e => calculatePayroll(e.name, mon, sun)).filter(Boolean);

  if (!results.length) { toast('No payroll data to export', 'error'); return; }

  // IMPORTANT: open the print window synchronously while we're still inside
  // the user-gesture stack, otherwise popup blockers will silently kill it
  // after the awaits below.
  const printWin = window.open('', '_blank');
  if (!printWin) {
    toast('Popup blocked — allow pop-ups for this site and try again', 'error');
    return;
  }
  printWin.document.write('<!DOCTYPE html><html><head><title>Generating payroll…</title><style>body{font-family:sans-serif;color:#666;padding:40px;text-align:center}</style></head><body>Generating payroll PDF…</body></html>');

  const totals = {
    basic: results.reduce((s, r) => s + r.basicPay, 0),
    ot: results.reduce((s, r) => s + r.overtimePay, 0),
    dt: results.reduce((s, r) => s + r.doublePay, 0),
    hol: results.reduce((s, r) => s + (r.holidayPay || 0) + (r.bankHolidayPay || 0), 0),
    grand: results.reduce((s, r) => s + r.totalPay, 0)
  };
  const weekStr = `${fmtDate(mon)} – ${fmtDate(sun)}`;

  // Ensure logo is loaded into cache so it embeds in the print window
  await loadLogoDataUri();

  // Pull payroll instruction comments for this week. Use cached value when
  // it matches the visible week; otherwise fetch fresh. Non-fatal on failure.
  let comments = [];
  if (_payrollExtras.weekKey === monStr) {
    comments = _payrollExtras.comments || [];
  } else {
    try { comments = await api.get(`/api/payroll-comments?week_commencing=${monStr}`) || []; }
    catch (e) { console.warn('Could not load payroll comments for PDF:', e); }
  }

  const html = buildPayrollHTML({ results, totals, weekStr, comments });
  // Replace the placeholder content with the real PDF view.
  printWin.document.open();
  printWin.document.write(html + `<script>window.onload = function() { window.print(); }<\/script>`);
  printWin.document.close();
}

// ═══════════════════════════════════════════
// WEEKLY ARCHIVE
// ═══════════════════════════════════════════
async function archiveWeek() {
  const { mon, sun } = getWeekDates(payrollWeekOffset);
  const monStr = dateStr(mon);
  const sunStr = dateStr(sun);

  try {
    // Call the API to approve the week — it calculates payroll server-side
    const result = await api.post('/api/payroll/approve', {
      week_commencing: monStr
    });

    // Store in local state for immediate display
    const weekKey = `week_${monStr}`;
    if (!state.timesheetData.archive) state.timesheetData.archive = {};
    state.timesheetData.archive[weekKey] = {
      weekCommencing: monStr,
      weekEnding: sunStr,
      archivedAt: new Date().toISOString(),
      entries: state.timesheetData.entries.filter(e => e.date >= monStr && e.date <= sunStr),
      clockings: state.timesheetData.clockings.filter(c => c.date >= monStr && c.date <= sunStr),
      payroll: (result.records || []).map(r => ({
        employeeName: empNameById(r.employee_id) || `Employee #${r.employee_id}`,
        totalHours: r.total_hours,
        basicHours: r.basic_hours,
        overtimeHours: r.overtime_hours,
        doubleHours: r.double_hours || 0,
        holidayHours: r.holiday_hours || 0,
        bankHolidayHours: r.bank_holiday_hours || 0,
        rate: r.rate,
        basicPay: r.basic_pay,
        overtimePay: r.overtime_pay,
        doublePay: r.double_pay || 0,
        holidayPay: r.holiday_pay || 0,
        bankHolidayPay: r.bank_holiday_pay || 0,
        totalPay: r.total_pay
      }))
    };

    // Mark entries as approved locally
    state.timesheetData.entries.forEach(e => {
      if (e.date >= monStr && e.date <= sunStr) {
        e.status = 'approved';
        e.is_approved = true;
      }
    });

    toast(`Week of ${fmtDate(mon)} archived ✓ — ${result.employees} employees, £${result.total_payroll.toFixed(2)} total`, 'success');
    renderArchive();
  } catch (err) { toast('Archive failed: ' + err.message, 'error'); }
}

function renderArchive() {
  const area = document.getElementById('archiveArea');
  if (!area) return;
  const archive = state.timesheetData.archive || {};
  const weeks = Object.values(archive).sort((a, b) => b.weekCommencing.localeCompare(a.weekCommencing));

  if (!weeks.length) {
    area.innerHTML = `
      <div class="empty-state">
        <div style="font-size:32px;margin-bottom:12px">&#128196;</div>
        <div>No archived weeks yet.</div>
        <div style="margin-top:8px;font-size:12px;color:var(--subtle)">Go to Payroll tab and click "Archive This Week" to save a week's records.</div>
      </div>`;
    return;
  }

  area.innerHTML = weeks.map(w => {
    const grandTotal = (w.payroll || []).reduce((s, r) => s + r.totalPay, 0);
    const totalHrs = (w.payroll || []).reduce((s, r) => s + r.totalHours, 0);
    return `
      <div class="card" style="margin-bottom:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
          <div>
            <div style="font-family:var(--font-display);font-size:20px;letter-spacing:1px">
              WC ${new Date(w.weekCommencing+'T12:00:00').toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'})}
            </div>
            <div style="font-size:12px;color:var(--muted);margin-top:4px">
              ${(w.payroll||[]).length} employees &nbsp;·&nbsp; ${totalHrs.toFixed(1)} total hours &nbsp;·&nbsp; Archived ${new Date(w.archivedAt).toLocaleDateString('en-GB')}
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:12px">
            <div style="font-family:var(--font-display);font-size:28px;color:var(--green)">£${grandTotal.toFixed(2)}</div>
            <button class="btn btn-ghost" style="padding:6px 12px;font-size:12px" onclick="toggleArchiveDetail('${w.weekCommencing}')">View Details</button>
          </div>
        </div>
        <div id="archive-detail-${w.weekCommencing}" style="display:none;margin-top:16px">
          <table class="summary-table">
            <thead>
              <tr><th>EMPLOYEE</th><th>TOTAL HRS</th><th>BASIC</th><th>O/T ×1.5</th><th>DBL ×2</th><th style="color:var(--accent)">HOL</th><th>TOTAL PAY</th></tr>
            </thead>
            <tbody>
              ${(w.payroll||[]).map(r => {
                const holHrs = (r.holidayHours || 0) + (r.bankHolidayHours || 0);
                const holPay = (r.holidayPay   || 0) + (r.bankHolidayPay   || 0);
                return `
                <tr>
                  <td style="font-weight:600">${r.employeeName}</td>
                  <td class="mono">${r.totalHours.toFixed(2)}h</td>
                  <td class="mono">${r.basicHours}h &nbsp; £${r.basicPay.toFixed(2)}</td>
                  <td class="mono" style="color:var(--amber)">${r.overtimeHours > 0 ? r.overtimeHours+'h &nbsp; £'+r.overtimePay.toFixed(2) : '—'}</td>
                  <td class="mono" style="color:var(--accent)">${r.doubleHours > 0 ? r.doubleHours+'h &nbsp; £'+r.doublePay.toFixed(2) : '—'}</td>
                  <td class="mono" style="color:var(--accent)">${holHrs > 0 ? holHrs+'h &nbsp; £'+holPay.toFixed(2) : '—'}</td>
                  <td class="mono" style="color:var(--green);font-weight:700">£${r.totalPay.toFixed(2)}</td>
                </tr>
              `;}).join('')}
            </tbody>
          </table>
        </div>
      </div>
    `;
  }).join('');
}

function toggleArchiveDetail(weekKey) {
  const el = document.getElementById(`archive-detail-${weekKey}`);
  if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}

// ═══════════════════════════════════════════
// STAFF MANAGEMENT
// ═══════════════════════════════════════════
function renderStaffList() {
  const container = document.getElementById('staffList');
  if (!container) return;
  const employees = state.timesheetData.employees || [];

  if (!employees.length) {
    container.innerHTML = `
      <div class="empty-state">
        <div style="font-size:32px;margin-bottom:12px">&#128101;</div>
        <div>No employees yet.</div>
        <div style="margin-top:8px;font-size:12px;color:var(--subtle)">Add your team using the form above.</div>
      </div>`;
    return;
  }

  container.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">
      ${employees.map(emp => {
        const staffType = emp.staffType || 'workshop';
        const erpRole = emp.erpRole || 'workshop';
        const payType = emp.payType || 'payee';
        const erpRoleLabels = { workshop:'Workshop', office_admin:'Office Admin', project_manager:'Project Manager', finance:'Finance', director:'Director' };
        const payTypeLabels = { payee:'PAYEE', cis:'CIS' };
        const typeBadge = staffType === 'office'
          ? `<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:4px;background:rgba(99,102,241,.15);color:#6366f1;border:1px solid rgba(99,102,241,.3)">OFFICE</span>`
          : `<span style="font-size:10px;font-weight:600;padding:2px 8px;border-radius:4px;background:rgba(62,207,142,.15);color:var(--green);border:1px solid rgba(62,207,142,.3)">WORKSHOP</span>`;

        return `
        <div class="card" style="margin-bottom:0;padding:18px;display:flex;align-items:center;gap:14px">
          <div class="emp-avatar" style="width:44px;height:44px;font-size:18px;flex-shrink:0;background:linear-gradient(135deg,${empColor(emp.name)},#3e1a00)">
            ${initials(emp.name)}
          </div>
          <div style="flex:1;min-width:0">
            ${emp.editing ? `
              <input type="text" class="field-input" id="edit-name-${emp.id}" value="${emp.name}"
                style="margin-bottom:6px;padding:6px 10px;font-size:13px">
              <input type="text" class="field-input" id="edit-role-${emp.id}" value="${emp.role||''}"
                placeholder="Job title (optional)" style="padding:6px 10px;font-size:12px;margin-bottom:6px">
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:6px;margin-bottom:6px">
                <div>
                  <div class="field-label" style="margin-bottom:3px">STAFF TYPE</div>
                  <select class="field-input" id="edit-stafftype-${emp.id}" style="padding:6px 10px;font-size:12px">
                    <option value="workshop" ${staffType==='workshop'?'selected':''}>Workshop</option>
                    <option value="office" ${staffType==='office'?'selected':''}>Office</option>
                  </select>
                </div>
                <div>
                  <div class="field-label" style="margin-bottom:3px">ERP ROLE</div>
                  <select class="field-input" id="edit-erprole-${emp.id}" style="padding:6px 10px;font-size:12px">
                    <option value="workshop" ${erpRole==='workshop'?'selected':''}>Workshop</option>
                    <option value="office_admin" ${erpRole==='office_admin'?'selected':''}>Office Admin</option>
                    <option value="project_manager" ${erpRole==='project_manager'?'selected':''}>Project Manager</option>
                    <option value="finance" ${erpRole==='finance'?'selected':''}>Finance</option>
                    <option value="director" ${erpRole==='director'?'selected':''}>Director</option>
                  </select>
                </div>
                <div>
                  <div class="field-label" style="margin-bottom:3px">PAY TYPE</div>
                  <select class="field-input" id="edit-paytype-${emp.id}" style="padding:6px 10px;font-size:12px">
                    <option value="payee" ${payType==='payee'?'selected':''}>PAYEE</option>
                    <option value="cis" ${payType==='cis'?'selected':''}>CIS</option>
                  </select>
                </div>
              </div>
              <div style="margin-bottom:6px">
                <div class="field-label" style="margin-bottom:3px">HOURLY RATE (£)</div>
                <input type="number" class="field-input" id="edit-rate-${emp.id}" value="${emp.rate||''}"
                  placeholder="e.g. 14.50" min="0" step="0.50" style="padding:6px 10px;font-size:12px">
              </div>
              <div style="margin-bottom:6px">
                <div class="field-label" style="margin-bottom:3px">PIN ${emp.hasPin ? '<span style="color:var(--green);font-weight:400">● set</span>' : '<span style="color:var(--amber);font-weight:400">● not set</span>'}</div>
                <div style="display:flex;gap:6px;align-items:center">
                  <input type="password" class="field-input" id="edit-pin-${emp.id}" value=""
                    placeholder="Leave blank to keep current" maxlength="6" style="padding:6px 10px;font-size:12px;flex:1;letter-spacing:3px">
                  ${emp.hasPin ? `<button type="button" class="btn btn-ghost" style="padding:5px 10px;font-size:11px;flex-shrink:0" onclick="revealEmployeePin('${emp.id}')">👁 View</button>` : ''}
                </div>
                <div style="font-size:11px;color:var(--subtle);margin-top:3px">4–6 digits. Leave blank to keep current PIN.</div>
              </div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
                <div>
                  <div class="field-label" style="margin-bottom:3px">ANNUAL DAYS</div>
                  <input type="number" class="field-input" id="edit-days-${emp.id}" value="${emp.annualDays||20}"
                    min="0" max="365" style="padding:6px 10px;font-size:12px">
                </div>
                <div>
                  <div class="field-label" style="margin-bottom:3px">CARRYOVER</div>
                  <input type="number" class="field-input" id="edit-carryover-${emp.id}" value="${emp.carryoverDays||0}"
                    min="0" step="0.5" style="padding:6px 10px;font-size:12px">
                </div>
              </div>
              <div class="field-label" style="margin-bottom:3px">START DATE</div>
              <input type="date" class="field-input" id="edit-startdate-${emp.id}" value="${emp.startDate||''}"
                style="padding:6px 10px;font-size:12px">
              <div style="display:flex;gap:6px;margin-top:8px">
                <button class="tiny-btn tiny-approve" onclick="saveEmployee('${emp.id}')">Save</button>
                <button class="tiny-btn" style="background:var(--surface);color:var(--muted);border:1px solid var(--border)"
                  onclick="cancelEdit('${emp.id}')">Cancel</button>
              </div>
            ` : `
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <span style="font-weight:600;font-size:14px">${emp.name}</span>
                ${typeBadge}
              </div>
              <div style="font-size:12px;color:var(--muted);margin-top:2px">${emp.role || 'No title set'} · <span style="color:var(--accent2)">${erpRoleLabels[erpRole] || erpRole}</span> · <span style="color:var(--muted)">${payTypeLabels[payType] || 'PAYEE'}</span></div>
              <div style="font-size:12px;color:var(--accent2);margin-top:2px;font-family:var(--font-mono)">£${(emp.rate||0).toFixed(2)}/hr</div>
              <div style="font-size:11px;color:var(--subtle);margin-top:2px">${emp.hasPin ? '&#128274; PIN set' : '&#128275; No PIN'}</div>
              <div style="font-size:11px;color:var(--muted);margin-top:2px">&#127959; ${emp.annualDays||20}d/yr ${emp.carryoverDays ? '+ '+emp.carryoverDays+'d carry' : ''}</div>
              ${emp.startDate ? `<div style="font-size:11px;color:var(--subtle);margin-top:2px">Started: ${emp.startDate}</div>` : ''}
              <div style="display:flex;gap:6px;margin-top:8px">
                <button class="tiny-btn" style="background:var(--surface);color:var(--muted);border:1px solid var(--border)"
                  onclick="editEmployee('${emp.id}')">&#9998; Edit</button>
                <button class="tiny-btn tiny-reject" onclick="toggleEmployeeActive('${emp.id}')">
                  ${emp.active === false ? '&#10003; Re-activate' : '&#9940; Deactivate'}
                </button>
                <button class="tiny-btn tiny-reject" onclick="deleteEmployee('${emp.id}')" style="margin-left:auto">
                  &#128465; Remove
                </button>
              </div>
            `}
          </div>
          ${emp.active === false ? `<div class="tag tag-rejected" style="flex-shrink:0">Inactive</div>` : ''}
        </div>
      `}).join('')}
    </div>
  `;
}

function empColor(name) {
  const colors = ['#ff6b00','#e05d00','#c84b00','#a83e00','#ff8c42','#f07030'];
  return colors[(name || '').charCodeAt(0) % colors.length];
}

function initials(name) {
  return (name || '?').split(' ').map(n => n[0]).join('').slice(0,2).toUpperCase();
}

async function addEmployee() {
  const nameInput = document.getElementById('newEmpName');
  const roleInput = document.getElementById('newEmpRole');
  const name = nameInput.value.trim();
  const role = roleInput.value.trim();

  if (!name) { toast('Please enter a name', 'error'); nameInput.focus(); return; }

  const exists = (state.timesheetData.employees || []).find(
    e => e.name.toLowerCase() === name.toLowerCase()
  );
  if (exists) { toast('Employee already exists', 'error'); return; }

  const rateInput = document.getElementById('newEmpRate');
  const rate = parseFloat(rateInput.value) || 0;

  const pinInput2 = document.getElementById('newEmpPin');
  const pin = pinInput2.value.trim();

  const daysInput = document.getElementById('newEmpDays');
  const annualDays = parseInt(daysInput.value) || 20;

  const staffTypeInput = document.getElementById('newEmpStaffType');
  const erpRoleInput = document.getElementById('newEmpErpRole');
  const staffType = staffTypeInput ? staffTypeInput.value : 'workshop';
  const erpRole = erpRoleInput ? erpRoleInput.value : 'employee';

    const startDateInput = document.getElementById('newEmpStartDate');
    const payTypeInput = document.getElementById('newEmpPayType');
    const startDate = startDateInput ? startDateInput.value || null : null;

    const carryoverInput = document.getElementById('newEmpCarryover');
    const carryover = carryoverInput ? parseFloat(carryoverInput.value) || 0 : 0;
    const payType = payTypeInput ? payTypeInput.value || 'payee' : 'payee';

    try {
    const result = await api.post('/api/employees', {
      name,
      pin: pin || '0000',
      rate,
      staff_type: staffType,
      erp_role: erpRole,
      holiday_entitlement: annualDays,
      start_date: startDate,
      pay_type: payType,
      carryover_days: carryover
    });

    // Add to local state
    const newEmp = normaliseEmployee(result);
    if (!state.timesheetData.employees) state.timesheetData.employees = [];
    state.timesheetData.employees.push(newEmp);
    buildEmployeeMaps();

    // Clear form
    nameInput.value = '';
    roleInput.value = '';
    rateInput.value = '';
    pinInput2.value = '';
    daysInput.value = '20';
    const carryoverInput = document.getElementById('newEmpCarryover');
    if (carryoverInput) carryoverInput.value = '0';
    if (startDateInput) startDateInput.value = '';
    if (staffTypeInput) staffTypeInput.value = 'workshop';
    if (erpRoleInput) erpRoleInput.value = 'workshop';
    if (payTypeInput) payTypeInput.value = 'payee';
    renderStaffList();
    renderHome();
    toast(`${name} added ✓`, 'success');
  } catch (err) {
    console.error('Add employee error:', err);
    toast('Failed to add employee: ' + err.message, 'error');
  }
}

function editEmployee(id) {
  const emp = state.timesheetData.employees.find(e => String(e.id) === String(id));
  if (!emp) return;
  emp.editing = true;
  renderStaffList();
}

function cancelEdit(id) {
  const emp = state.timesheetData.employees.find(e => String(e.id) === String(id));
  if (!emp) return;
  delete emp.editing;
  renderStaffList();
}

async function revealEmployeePin(id) {
  try {
    const result = await api.get(`/api/employees/${id}/pin`);
    const pinEl = document.getElementById(`edit-pin-${id}`);
    const btn = pinEl?.parentElement?.querySelector('button');
    if (pinEl) {
      pinEl.type = 'text';
      pinEl.value = result.pin || '';
      pinEl.style.letterSpacing = '3px';
    }
    if (btn) {
      btn.textContent = '🙈 Hide';
      btn.onclick = () => {
        pinEl.type = 'password';
        pinEl.value = '';
        btn.textContent = '👁 View';
        btn.onclick = () => revealEmployeePin(id);
      };
    }
  } catch (err) {
    toast('Could not retrieve PIN', 'error');
  }
}

async function saveEmployee(id) {
  const emp = state.timesheetData.employees.find(e => String(e.id) === String(id));
  if (!emp) return;

  const newName = document.getElementById(`edit-name-${id}`).value.trim();
  const newRole = document.getElementById(`edit-role-${id}`).value.trim();
  const newRate = parseFloat(document.getElementById(`edit-rate-${id}`).value) || 0;

  if (!newName) { toast('Name cannot be empty', 'error'); return; }

  const newPin = document.getElementById(`edit-pin-${id}`).value.trim();
  const newDays = parseInt(document.getElementById(`edit-days-${id}`).value) || 20;
  const newStaffType = document.getElementById(`edit-stafftype-${id}`)?.value || emp.staffType || 'workshop';
  const newErpRole = document.getElementById(`edit-erprole-${id}`)?.value || emp.erpRole || 'employee';

    const newCarryover = parseFloat(document.getElementById(`edit-carryover-${id}`).value) || 0;
    const newStartDate = document.getElementById(`edit-startdate-${id}`).value || '';
    const newPayType = document.getElementById(`edit-paytype-${id}`)?.value || emp.payType || 'payee';

    try {
    // Build update body — only include PIN if user typed a new one.
    // Empty field means "leave PIN alone"; the API also defends against this.
    const updateBody = {
      name: newName,
      rate: newRate,
      staff_type: newStaffType,
      erp_role: newErpRole,
      holiday_entitlement: newDays,
      pay_type: newPayType,
      carryover_days: newCarryover
    };
    if (newPin) updateBody.pin = newPin;
    if (newStartDate) updateBody.start_date = newStartDate;

    await api.put(`/api/employees/${id}`, updateBody);

    const oldName = emp.name;
    emp.name = newName;
    emp.role = newRole;
    emp.rate = newRate;
    if (newPin) emp.hasPin = true;  // PIN value never lives on the client
    emp.annualDays = newDays;
    emp.staffType = newStaffType;
    emp.erpRole = newErpRole;
    emp.carryoverDays = newCarryover;
    emp.startDate = newStartDate;
    emp.payType = newPayType;
    delete emp.editing;

    // Update name in local state lookups
    if (oldName !== newName) {
      state.timesheetData.entries.forEach(e => {
        if (e.employeeName === oldName) e.employeeName = newName;
      });
      state.timesheetData.clockings.forEach(c => {
        if (c.employeeName === oldName) c.employeeName = newName;
      });
      buildEmployeeMaps();
    }

    toast('Employee updated ✓', 'success');
    renderStaffList();
    renderHome();
  } catch (err) { toast('Save failed: ' + err.message, 'error'); }
}

async function toggleEmployeeActive(id) {
  const emp = state.timesheetData.employees.find(e => String(e.id) === String(id));
  if (!emp) return;
  const deactivating = emp.active !== false;
  if (deactivating && !confirm(`Deactivate ${emp.name}? They will no longer appear on the kiosk or in payroll.`)) return;
  try {
    await api.put(`/api/employees/${id}`, {
      is_active: !deactivating
    });
    emp.active = deactivating ? false : true;
    buildEmployeeMaps();
    toast(`${emp.name} ${emp.active ? 'reactivated' : 'deactivated'}`, 'success');
    renderStaffList();
    renderHome();
  } catch (err) { toast('Save failed: ' + err.message, 'error'); }
}

async function deleteEmployee(id) {
  const emp = state.timesheetData.employees.find(e => String(e.id) === String(id));
  if (!emp) return;

  if (!confirm(`Remove ${emp.name}? Their historical time entries will be kept.`)) return;

  try {
    // Deactivate rather than truly delete — preserve history
    await api.put(`/api/employees/${id}`, { is_active: false });
    state.timesheetData.employees = state.timesheetData.employees.filter(e => String(e.id) !== String(id));
    buildEmployeeMaps();
    toast(`${emp.name} removed`, 'success');
    renderStaffList();
    renderHome();
  } catch (err) { toast('Delete failed: ' + err.message, 'error'); }
}

// ═══════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════
async function refreshProjects() {
  toast('Refreshing projects from SharePoint…', 'info');
  try {
    await loadProjects();
    toast(`${state.projects.length} projects loaded ✓`, 'success');
  } catch { toast('Refresh failed', 'error'); }
}

function exportWeekCSV() {
  const { mon, sun } = getWeekDates(state.currentWeekOffset);
  const monStr = dateStr(mon);
  const sunStr = dateStr(sun);
  const entries = state.timesheetData.entries.filter(
    e => e.date >= monStr && e.date <= sunStr
  );
  if (!entries.length) { toast('No entries this week to export', 'info'); return; }

  const rows = [
    ['Date','Employee','Project ID','Project Name','Hours','Status'],
    ...entries.map(e => [fmtDateStr(e.date), e.employeeName, e.projectId, e.projectName, e.hours, e.status])
  ];
  const csv = rows.map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `BAMA-Timesheet-Week-${monStr}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}


// ═══════════════════════════════════════════
// OFFICE DASHBOARD — Tasks & Messages
// ═══════════════════════════════════════════
const OFFICE_TASKS_FILE = 'office-tasks.json';
let officeTasksData = { tasks: [], messages: [] };

async function loadOfficeTasksData() {
  try {
    const token = await getToken();
    const pathEnc = encodeURIComponent('01 - Accounts/DANIEL/Project Tracker/' + OFFICE_TASKS_FILE);
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${BAMA_DRIVE_ID}/root:/${pathEnc}:/content`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (res.status === 404) {
      console.log('No office-tasks.json yet — will create on first save');
      return;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    officeTasksData = await res.json();
    officeTasksData.tasks = officeTasksData.tasks || [];
    officeTasksData.messages = officeTasksData.messages || [];
    console.log('Office tasks loaded:', officeTasksData.tasks.length, 'tasks,', officeTasksData.messages.length, 'messages');
  } catch (e) {
    console.warn('Office tasks load failed:', e.message);
  }
}

async function saveOfficeTasksData() {
  const token = await getToken();
  const pathEnc = encodeURIComponent('01 - Accounts/DANIEL/Project Tracker/' + OFFICE_TASKS_FILE);
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${BAMA_DRIVE_ID}/root:/${pathEnc}:/content`,
    { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(officeTasksData, null, 2) }
  );
  if (!res.ok) throw new Error(`Save failed: HTTP ${res.status}`);
}

function renderDashboard() {
  if (CURRENT_PAGE !== 'office' || !currentManagerUser) return;
  const user = currentManagerUser;

  // Greeting based on time
  const hr = new Date().getHours();
  const greeting = hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening';
  const greetEl = document.getElementById('dashGreeting');
  if (greetEl) greetEl.textContent = `${greeting}, ${user.split(' ')[0]}`;

  // ── My Tasks ──
  const myTasks = (officeTasksData.tasks || [])
    .filter(t => t.assignedTo === user && t.status !== 'complete')
    .sort((a, b) => {
      const pri = { high: 0, medium: 1, low: 2 };
      return (pri[a.priority] || 1) - (pri[b.priority] || 1) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
    });
  const taskList = document.getElementById('dashTaskList');
  const taskCount = document.getElementById('dashTaskCount');
  if (taskCount) { taskCount.textContent = myTasks.length; taskCount.className = 'dash-count' + (myTasks.length === 0 ? ' zero' : ''); }
  if (taskList) {
    if (!myTasks.length) {
      taskList.innerHTML = '<div class="empty-state" style="padding:20px"><div class="icon">✅</div>No tasks assigned to you</div>';
    } else {
      taskList.innerHTML = myTasks.map(t => {
        const due = t.dueDate ? new Date(t.dueDate).toLocaleDateString('en-GB', { day:'numeric', month:'short' }) : '';
        const overdue = t.dueDate && t.dueDate < new Date().toISOString().slice(0,10) ? ' style="color:var(--red)"' : '';
        return `<div class="dash-item">
          <div class="dash-item-body">
            <div class="dash-item-title">${esc(t.title)}</div>
            ${t.description ? `<div style="font-size:12px;color:var(--muted);margin-bottom:3px">${esc(t.description)}</div>` : ''}
            <div class="dash-item-meta">
              <span class="priority-badge priority-${t.priority}">${t.priority}</span>
              ${due ? `<span${overdue}>Due: ${due}</span>` : ''}
              <span>From: ${esc(t.assignedBy)}</span>
            </div>
          </div>
          <div class="dash-item-actions">
            <button class="dash-complete" onclick="completeTask('${t.id}')">&#10003; Done</button>
          </div>
        </div>`;
      }).join('');
    }
  }

  // ── Messages ──
  const myMsgs = (officeTasksData.messages || [])
    .filter(m => m.to === user)
    .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  const msgList = document.getElementById('dashMsgList');
  const msgCount = document.getElementById('dashMsgCount');
  const unreadCount = myMsgs.filter(m => !m.read).length;
  if (msgCount) { msgCount.textContent = unreadCount; msgCount.className = 'dash-count' + (unreadCount === 0 ? ' zero' : ''); }
  if (msgList) {
    if (!myMsgs.length) {
      msgList.innerHTML = '<div class="empty-state" style="padding:20px"><div class="icon">📧</div>No messages</div>';
    } else {
      msgList.innerHTML = myMsgs.slice(0, 20).map(m => {
        const when = m.createdAt ? timeAgo(m.createdAt) : '';
        const unread = !m.read ? ' msg-unread' : '';
        return `<div class="dash-item${unread}">
          <div class="dash-item-body">
            <div class="dash-item-title">${esc(m.text)}</div>
            <div class="dash-item-meta">
              <span>From: ${esc(m.from)}</span>
              ${when ? `<span>${when}</span>` : ''}
            </div>
          </div>
          <div class="dash-item-actions">
            ${!m.read ? `<button onclick="markMessageRead('${m.id}')">&#10003; Read</button>` : ''}
            <button class="dash-delete" onclick="deleteMessage('${m.id}')">&#10005;</button>
          </div>
        </div>`;
      }).join('');
    }
  }

  // ── Pending Holiday Requests (all staff, for approvers) ──
  const pendingHols = (state.timesheetData.holidays || []).filter(h => h.status === 'pending');
  const holList = document.getElementById('dashHolidayList');
  const holCount = document.getElementById('dashHolidayCount');
  if (holCount) { holCount.textContent = pendingHols.length; holCount.className = 'dash-count' + (pendingHols.length === 0 ? ' zero' : ''); }
  if (holList) {
    if (!pendingHols.length) {
      holList.innerHTML = '<div class="empty-state" style="padding:20px"><div class="icon">🌴</div>No pending holiday requests</div>';
    } else {
      holList.innerHTML = pendingHols.map(h => {
        const from = new Date(h.dateFrom).toLocaleDateString('en-GB', { day:'numeric', month:'short' });
        const to = new Date(h.dateTo).toLocaleDateString('en-GB', { day:'numeric', month:'short' });
        return `<div class="dash-item">
          <div class="dash-item-body">
            <div class="dash-item-title">${esc(h.employeeName)}</div>
            <div class="dash-item-meta">
              <span>${from} — ${to}</span>
              <span>${h.workingDays || '?'} day${h.workingDays !== 1 ? 's' : ''}</span>
              <span>${esc(h.type || 'Holiday')}</span>
            </div>
          </div>
          <div class="dash-item-actions">
            <button onclick="switchTab('holidays')" style="background:#ff4444;color:#fff;border-color:#ff4444;font-weight:600">Review</button>
          </div>
        </div>`;
      }).join('');
    }
  }

  // ── Pending Clockings (current week) ──
  const { mon, sun } = getWeekDates(0);
  const monStr = dateStr(mon);
  const sunStr = dateStr(sun);
  const pendingClocks = (state.timesheetData.clockings || [])
    .filter(c => c.date >= monStr && c.date <= sunStr && c.status !== 'approved');
  const clockList = document.getElementById('dashClockList');
  const clockCount = document.getElementById('dashClockCount');
  if (clockCount) { clockCount.textContent = pendingClocks.length; clockCount.className = 'dash-count' + (pendingClocks.length === 0 ? ' zero' : ''); }
  if (clockList) {
    if (!pendingClocks.length) {
      clockList.innerHTML = '<div class="empty-state" style="padding:20px"><div class="icon">⏰</div>No clockings awaiting approval</div>';
    } else {
      // Group by employee
      const byEmp = {};
      pendingClocks.forEach(c => { if (!byEmp[c.employeeName]) byEmp[c.employeeName] = []; byEmp[c.employeeName].push(c); });
      clockList.innerHTML = Object.entries(byEmp).map(([name, clocks]) => {
        return `<div class="dash-item">
          <div class="dash-item-body">
            <div class="dash-item-title">${esc(name)}</div>
            <div class="dash-item-meta">
              <span>${clocks.length} pending clocking${clocks.length !== 1 ? 's' : ''} this week</span>
            </div>
          </div>
          <div class="dash-item-actions">
            <button onclick="switchTab('clockinout')">Review</button>
          </div>
        </div>`;
      }).join('');
    }
  }

  // ── My Holiday Status ──
  const myHols = (state.timesheetData.holidays || [])
    .filter(h => h.employeeName === user && h.status === 'pending');
  const myHolList = document.getElementById('dashMyHolidayList');
  const myHolCount = document.getElementById('dashMyHolidayCount');
  if (myHolCount) { myHolCount.textContent = myHols.length; myHolCount.className = 'dash-count' + (myHols.length === 0 ? ' zero' : ''); }
  if (myHolList) {
    if (!myHols.length) {
      myHolList.innerHTML = '<div class="empty-state" style="padding:20px"><div class="icon">&#127796;</div>You have no pending holiday requests</div>';
    } else {
      myHolList.innerHTML = myHols.map(h => {
        const from = new Date(h.dateFrom).toLocaleDateString('en-GB', { day:'numeric', month:'short' });
        const to = new Date(h.dateTo).toLocaleDateString('en-GB', { day:'numeric', month:'short' });
        return `<div class="dash-item">
          <div class="dash-item-body">
            <div class="dash-item-title">${from} — ${to}</div>
            <div class="dash-item-meta">
              <span>${h.workingDays || '?'} day${h.workingDays !== 1 ? 's' : ''}</span>
              <span class="priority-badge priority-medium">Pending</span>
            </div>
          </div>
        </div>`;
      }).join('');
    }
  }

  // ── My Access Requests ──
  const myAccess = (userAccessData.accessRequests || [])
    .filter(r => r.employeeName === user && r.status === 'pending');
  const accList = document.getElementById('dashAccessList');
  const accCount = document.getElementById('dashAccessCount');
  if (accCount) { accCount.textContent = myAccess.length; accCount.className = 'dash-count' + (myAccess.length === 0 ? ' zero' : ''); }
  if (accList) {
    if (!myAccess.length) {
      accList.innerHTML = '<div class="empty-state" style="padding:20px"><div class="icon">&#128274;</div>No outstanding access requests</div>';
    } else {
      accList.innerHTML = myAccess.map(r => {
        const when = r.date ? timeAgo(r.date) : '';
        return `<div class="dash-item">
          <div class="dash-item-body">
            <div class="dash-item-title">${esc(r.reason || 'Access requested')}</div>
            <div class="dash-item-meta">
              <span class="priority-badge priority-medium">Pending</span>
              ${when ? `<span>Submitted ${when}</span>` : ''}
            </div>
          </div>
        </div>`;
      }).join('');
    }
  }

  // ── Tasks I Assigned ──
  const assignedTasks = (officeTasksData.tasks || [])
    .filter(t => t.assignedBy === user && t.status !== 'dismissed')
    .sort((a, b) => {
      // Open tasks first, then completed
      if (a.status === 'complete' && b.status !== 'complete') return 1;
      if (a.status !== 'complete' && b.status === 'complete') return -1;
      return (b.createdAt || '').localeCompare(a.createdAt || '');
    });
  const assignedList = document.getElementById('dashAssignedList');
  const assignedCount = document.getElementById('dashAssignedCount');
  if (assignedCount) { assignedCount.textContent = assignedTasks.length; assignedCount.className = 'dash-count' + (assignedTasks.length === 0 ? ' zero' : ''); }
  if (assignedList) {
    if (!assignedTasks.length) {
      assignedList.innerHTML = '<div class="empty-state" style="padding:20px"><div class="icon">&#128203;</div>You haven\'t assigned any tasks</div>';
    } else {
      assignedList.innerHTML = assignedTasks.map(t => {
        const isComplete = t.status === 'complete';
        const due = t.dueDate ? new Date(t.dueDate).toLocaleDateString('en-GB', { day:'numeric', month:'short' }) : '';
        const completedWhen = t.completedAt ? timeAgo(t.completedAt) : '';
        return `<div class="dash-item${isComplete ? ' dash-item-complete' : ''}">
          <div class="dash-item-body">
            <div class="dash-item-title">${isComplete ? '<span style="color:var(--green)">&#10003;</span> ' : ''}${esc(t.title)}</div>
            <div class="dash-item-meta">
              <span>Assigned to: ${esc(t.assignedTo)}</span>
              <span class="priority-badge priority-${t.priority}">${t.priority}</span>
              ${isComplete ? `<span style="color:var(--green)">Completed ${completedWhen}</span>` : (due ? `<span>Due: ${due}</span>` : '')}
            </div>
          </div>
          <div class="dash-item-actions">
            <button class="dash-delete" onclick="dismissAssignedTask('${t.id}')">&#10005; Clear</button>
          </div>
        </div>`;
      }).join('');
    }
  }
}

function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('en-GB', { day:'numeric', month:'short' });
}

function esc(str) {
  if (!str) return '';
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// ── Task CRUD ──
function openDashTaskModal() {
  const sel = document.getElementById('taskAssignTo');
  if (!sel) return;
  const officeStaff = (state.timesheetData.employees || []).filter(e => e.active !== false && (e.staffType || 'workshop') === 'office');
  sel.innerHTML = officeStaff.map(e => `<option value="${esc(e.name)}">${esc(e.name)}</option>`).join('');
  document.getElementById('taskTitle').value = '';
  document.getElementById('taskDescription').value = '';
  document.getElementById('taskDueDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('taskPriority').value = 'medium';
  document.getElementById('dashCreateTaskModal').classList.add('active');
}

function closeDashTaskModal() {
  document.getElementById('dashCreateTaskModal').classList.remove('active');
}

async function submitDashTask() {
  const assignTo = document.getElementById('taskAssignTo').value;
  const title = document.getElementById('taskTitle').value.trim();
  const description = document.getElementById('taskDescription').value.trim();
  const dueDate = document.getElementById('taskDueDate').value;
  const priority = document.getElementById('taskPriority').value;

  if (!title) { toast('Task title is required', 'error'); return; }
  if (!assignTo) { toast('Select someone to assign the task to', 'error'); return; }

  const task = {
    id: 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    title,
    description: description || null,
    assignedTo: assignTo,
    assignedBy: currentManagerUser,
    dueDate: dueDate || null,
    priority,
    status: 'open',
    createdAt: new Date().toISOString()
  };

  officeTasksData.tasks.push(task);
  try {
    await saveOfficeTasksData();
    toast(`Task assigned to ${assignTo}`, 'success');
    closeDashTaskModal();
    renderDashboard();
  } catch (e) {
    toast('Failed to save task: ' + e.message, 'error');
    officeTasksData.tasks.pop();
  }
}

async function completeTask(taskId) {
  const task = officeTasksData.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.status = 'complete';
  task.completedAt = new Date().toISOString();
  try {
    await saveOfficeTasksData();
    toast('Task completed', 'success');
    renderDashboard();
  } catch (e) {
    toast('Failed to save: ' + e.message, 'error');
    task.status = 'open';
    delete task.completedAt;
  }
}

async function dismissAssignedTask(taskId) {
  const task = officeTasksData.tasks.find(t => t.id === taskId);
  if (!task) return;
  task.status = 'dismissed';
  try {
    await saveOfficeTasksData();
    renderDashboard();
  } catch (e) {
    toast('Failed to clear: ' + e.message, 'error');
    task.status = task.completedAt ? 'complete' : 'open';
  }
}

// ── Message CRUD ──
function openDashMessageModal() {
  const sel = document.getElementById('msgSendTo');
  if (!sel) return;
  const officeStaff = (state.timesheetData.employees || []).filter(e => e.active !== false && (e.staffType || 'workshop') === 'office' && e.name !== currentManagerUser);
  sel.innerHTML = officeStaff.map(e => `<option value="${esc(e.name)}">${esc(e.name)}</option>`).join('');
  document.getElementById('msgText').value = '';
  document.getElementById('dashSendMessageModal').classList.add('active');
}

function closeDashMessageModal() {
  document.getElementById('dashSendMessageModal').classList.remove('active');
}

async function submitDashMessage() {
  const to = document.getElementById('msgSendTo').value;
  const text = document.getElementById('msgText').value.trim();

  if (!text) { toast('Message cannot be empty', 'error'); return; }
  if (!to) { toast('Select a recipient', 'error'); return; }

  const msg = {
    id: 'msg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    to,
    from: currentManagerUser,
    text,
    read: false,
    createdAt: new Date().toISOString()
  };

  officeTasksData.messages.push(msg);
  try {
    await saveOfficeTasksData();
    toast(`Message sent to ${to}`, 'success');
    closeDashMessageModal();
    renderDashboard();
  } catch (e) {
    toast('Failed to send: ' + e.message, 'error');
    officeTasksData.messages.pop();
  }
}

async function markMessageRead(msgId) {
  const msg = officeTasksData.messages.find(m => m.id === msgId);
  if (!msg) return;
  msg.read = true;
  try {
    await saveOfficeTasksData();
    renderDashboard();
  } catch (e) {
    msg.read = false;
  }
}

async function deleteMessage(msgId) {
  const idx = officeTasksData.messages.findIndex(m => m.id === msgId);
  if (idx < 0) return;
  const removed = officeTasksData.messages.splice(idx, 1);
  try {
    await saveOfficeTasksData();
    renderDashboard();
  } catch (e) {
    toast('Failed to delete: ' + e.message, 'error');
    officeTasksData.messages.splice(idx, 0, ...removed);
  }
}

// ── Office Holiday Request ──
function openOfficeHolidayModal() {
  if (!currentManagerUser) return;
  document.getElementById('offHolFrom').value = '';
  document.getElementById('offHolTo').value = '';
  document.getElementById('offHolType').value = 'paid';
  document.getElementById('offHolReason').value = '';
  // Show balance
  const balEl = document.getElementById('offHolBalance');
  if (balEl) {
    const bal = calculateHolidayBalance(currentManagerUser);
    if (bal) {
      balEl.textContent = `Holiday balance: ${bal.remainingDays} days remaining out of ${bal.totalEntitlement}`;
    } else {
      balEl.textContent = '';
    }
  }
  document.getElementById('officeHolidayModal').classList.add('active');
}

function closeOfficeHolidayModal() {
  document.getElementById('officeHolidayModal').classList.remove('active');
}

async function submitOfficeHoliday() {
  const from = document.getElementById('offHolFrom').value;
  const to = document.getElementById('offHolTo').value;
  const type = document.getElementById('offHolType').value;
  const reason = document.getElementById('offHolReason').value;

  if (!from || !to) { toast('Please select dates', 'error'); return; }
  if (from > to) { toast('End date must be after start date', 'error'); return; }

  const workingDays = countWorkingDays(from, to);
  if (workingDays === 0) { toast('No working days in selected range', 'error'); return; }

  if (type === 'paid') {
    const bal = calculateHolidayBalance(currentManagerUser);
    if (bal && workingDays > bal.remainingDays) {
      toast(`Only ${bal.remainingDays} days remaining — request is ${workingDays} days`, 'error');
      return;
    }
  }

  const empId = empIdByName(currentManagerUser);
  if (!empId) { toast('Employee not found', 'error'); return; }

  try {
    const result = await api.post('/api/holidays', {
      employee_id: empId,
      date_from: from,
      date_to: to,
      type,
      reason,
      working_days: workingDays
    });

    const newHoliday = normaliseHoliday({ ...result, employee_name: currentManagerUser });
    if (!state.timesheetData.holidays) state.timesheetData.holidays = [];
    state.timesheetData.holidays.push(newHoliday);

    toast(`Holiday request submitted (${workingDays} working days) ✓`, 'success');
    closeOfficeHolidayModal();
    renderDashboard();
  } catch (e) {
    toast('Submit failed: ' + e.message, 'error');
  }
}

// ═══════════════════════════════════════════
// PROJECTS MODULE — Job-Based System
// ═══════════════════════════════════════════
const DRAWINGS_FILE = 'drawings-data.json';
const USER_ACCESS_FILE = 'user-access.json';
const BAMA_DRIVE_ID = 'b!CxTKk9lEwkyweUqAo3CRas-huywW4KtLqOk2tNzmx-P7CX86DNhTQo14pLuU_tZu';
const PROJECTS_FOLDER = 'Projects';

// Element folder names (auto-created inside each job folder)
const ELEMENT_FOLDERS = {
  bom:      '01 - BOM',
  approval: '02 - Approval',
  parts:    '03 - Parts',
  assembly: '04 - Assembly',
  site:     '05 - Site Installation'
};
const PARTS_SUBFOLDERS = ['01 - Sections', '02 - Plates'];

let drawingsData = { projects: {} };
// Data shape: drawingsData.projects[projectId] = {
//   jobs: [{ id, number, name, status:'open'|'closed', createdAt, closedAt, closedBy,
//     bom: { files: [{id,name,fileName,fileId,driveId,webUrl,uploadedAt}], notes:[] },
//     approval: { revisions: [{ id, type:'PO'|'CO', number:1, status:'sent'|'approved'|'rejected', files:[], uploadedAt }], notes:[] },
//     parts: { sections: { files:[], notes:[] }, plates: { files:[], notes:[] } },
//     assembly: { tasks: [{ id, number, name, finishing, status:'open'|'complete', files:[], notes:[], completedAt, completedBy }] },
//     site: { files:[], notes:[], completedAt, completedBy }
//   }]
// }

let userAccessData = { globalAdminEmail: '', users: {}, accessRequests: [] };
let bomDataCache = {}; // keyed by projectId: { jobs: { jobId: { materialLists:[], deliveryNotes:[] } } }
let currentManagerUser = null; // name of user currently logged into manager dashboard
let _pendingManagerUser = null; // name of user selected but not yet PIN-verified
let _pendingDraftsmanUser = null; // name of user selected for draftsman login

let currentProject = null;
let currentJob = null;
let isDraftsman = false;

// Upload state
let _uploadFiles = [];
let _uploadContext = null; // { element, subElement, jobId, projectId, taskId }
let _taskFiles = [];
let _pendingCompleteTask = null;
let _pendingCloseJob = null;

// ── Load / Save drawings data ──
async function loadDrawingsData() {
  try {
    const token = await getToken();
    const metaUrl = `https://graph.microsoft.com/v1.0/drives/${CONFIG.driveId}/items/${CONFIG.timesheetFolderItemId}:/${DRAWINGS_FILE}`;
    const metaRes = await fetch(metaUrl, { headers: { 'Authorization': `Bearer ${token}` } });
    if (metaRes.status === 404) return;
    if (!metaRes.ok) throw new Error(`Meta fetch failed: ${metaRes.status}`);
    const meta = await metaRes.json();
    const contentRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${CONFIG.driveId}/items/${meta.id}/content`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (!contentRes.ok) throw new Error('Content fetch failed');
    drawingsData = await contentRes.json();
    if (!drawingsData.projects) drawingsData.projects = {};
  } catch (e) {
    console.warn('Drawings data load failed:', e.message);
  }
}

async function saveDrawingsData() {
  const token = await getToken();
  const url = `https://graph.microsoft.com/v1.0/drives/${CONFIG.driveId}/items/${CONFIG.timesheetFolderItemId}:/${DRAWINGS_FILE}:/content`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(drawingsData)
  });
  if (!res.ok) throw new Error(`Save drawings failed: ${res.status}`);
}

// ── Load / Save BOM data (per-project file) ──
function bomFileName(projectId) { return `bom-${projectId}.json`; }

function getBomDataForJob(projectId, jobId) {
  const projBom = bomDataCache[projectId];
  if (!projBom || !projBom.jobs || !projBom.jobs[jobId]) return { materialLists: [], deliveryNotes: [] };
  return projBom.jobs[jobId];
}

function ensureBomDataForJob(projectId, jobId) {
  if (!bomDataCache[projectId]) bomDataCache[projectId] = { projectId, jobs: {}, settings: { weldingMachines: [] } };
  if (!bomDataCache[projectId].jobs[jobId]) bomDataCache[projectId].jobs[jobId] = { materialLists: [], deliveryNotes: [] };
  return bomDataCache[projectId].jobs[jobId];
}

async function loadBomData(projectId) {
  if (bomDataCache[projectId]) return bomDataCache[projectId];
  try {
    const token = await getToken();
    const metaUrl = `https://graph.microsoft.com/v1.0/drives/${CONFIG.driveId}/items/${CONFIG.timesheetFolderItemId}:/${bomFileName(projectId)}`;
    const metaRes = await fetch(metaUrl, { headers: { 'Authorization': `Bearer ${token}` } });
    if (metaRes.status === 404) {
      bomDataCache[projectId] = { projectId, jobs: {}, settings: { weldingMachines: [] } };
      return bomDataCache[projectId];
    }
    if (!metaRes.ok) throw new Error(`BOM meta fetch failed: ${metaRes.status}`);
    const meta = await metaRes.json();
    const contentRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${CONFIG.driveId}/items/${meta.id}/content`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (!contentRes.ok) throw new Error('BOM content fetch failed');
    bomDataCache[projectId] = await contentRes.json();
    if (!bomDataCache[projectId].jobs) bomDataCache[projectId].jobs = {};
    if (!bomDataCache[projectId].settings) bomDataCache[projectId].settings = { weldingMachines: [] };
    console.log(`BOM data loaded for ${projectId}:`, Object.keys(bomDataCache[projectId].jobs).length, 'jobs');
    return bomDataCache[projectId];
  } catch (e) {
    console.warn(`BOM data load failed for ${projectId}:`, e.message);
    bomDataCache[projectId] = { projectId, jobs: {}, settings: { weldingMachines: [] } };
    return bomDataCache[projectId];
  }
}

async function saveBomData(projectId) {
  if (!bomDataCache[projectId]) return;
  const token = await getToken();
  const url = `https://graph.microsoft.com/v1.0/drives/${CONFIG.driveId}/items/${CONFIG.timesheetFolderItemId}:/${bomFileName(projectId)}:/content`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(bomDataCache[projectId])
  });
  if (!res.ok) throw new Error(`Save BOM data failed: ${res.status}`);
  console.log(`BOM data saved for ${projectId}`);
}

// ── Load / Save user access data ──
async function loadUserAccessData() {
  try {
    // Load permissions from API
    const [permsData, requestsData] = await Promise.all([
      api.get('/api/user-access').catch(() => []),
      api.get('/api/access-requests').catch(() => [])
    ]);

    // Load globalAdminEmail from settings
    const settings = state.timesheetData.settings || {};
    const adminEmail = settings.globalAdminEmail || '';

    // Build the userAccessData structure from API rows
    const users = {};
    (Array.isArray(permsData) ? permsData : []).forEach(row => {
      const name = row.employee_name;
      if (!name) return;
      users[name] = {
        employee_id: row.employee_id,
        permissions: {
          byProject: !!row.by_project,
          byEmployee: !!row.by_employee,
          clockingInOut: !!row.clocking_in_out,
          payroll: !!row.payroll,
          archive: !!row.archive,
          staff: !!row.staff,
          holidays: !!row.holidays,
          reports: !!row.reports,
          settings: !!row.settings,
          userAccess: !!row.user_access,
          draftsmanMode: !!row.draftsman_mode,
          tenders: !!row.tenders,
          editQuotes: !!row.edit_quotes,
          viewQuotes: !!row.view_quotes,
          editProjects: !!row.edit_projects,
          viewProjects: !!row.view_projects
        }
      };
    });

    userAccessData = {
      globalAdminEmail: adminEmail,
      users,
      accessRequests: (Array.isArray(requestsData) ? requestsData : []).map(r => ({
        id: r.id,
        employeeName: r.employee_name,
        reason: r.reason,
        date: r.created_at ? r.created_at.slice(0, 16).replace('T', ' ') : '',
        status: r.status
      }))
    };
    console.log('User access loaded from API:', Object.keys(users).length, 'users');
  } catch (e) {
    console.warn('User access data load failed:', e.message);
  }
}

async function saveUserAccessData() {
  // No-op — individual operations now save directly via API
  // Kept for backwards compatibility with any code that still calls it
  console.log('saveUserAccessData: skipped (API handles individual saves)');
}

function getUserPermissions(empName) {
  const entry = userAccessData.users[empName];
  if (!entry || !entry.permissions) return null;
  return entry.permissions;
}

function hasAnyPermission(empName) {
  const perms = getUserPermissions(empName);
  if (!perms) return false;
  return Object.values(perms).some(v => v === true);
}

const PERMISSION_DEFS = [
  { key: 'byProject', label: 'By Project', desc: 'View timesheet entries grouped by project' },
  { key: 'byEmployee', label: 'By Employee', desc: 'View timesheet entries grouped by employee' },
  { key: 'clockingInOut', label: 'Clocking In/Out', desc: 'View and manage the clock log' },
  { key: 'payroll', label: 'Payroll', desc: 'View payroll summaries and export reports' },
  { key: 'archive', label: 'Archive', desc: 'View and manage archived weeks' },
  { key: 'staff', label: 'Staff', desc: 'Add, edit, and manage employees' },
  { key: 'holidays', label: 'Holidays', desc: 'Manage holiday requests and calendar' },
  { key: 'reports', label: 'Reports', desc: 'View analytics and reports' },
  { key: 'settings', label: 'Settings', desc: 'Manage email settings and system config' },
  { key: 'templates', label: 'Templates', desc: 'Edit document templates (payroll PDF, delivery notes, reports)' },
  { key: 'userAccess', label: 'User Access', desc: 'Manage who can access what' },
  { key: 'draftsmanMode', label: 'Draftsman Mode', desc: 'Upload drawings and manage jobs in Projects' },
  { key: 'tenders', label: 'Tenders', desc: 'View, add, and amend tenders' },
  { key: 'editQuotes', label: 'Edit Quotes', desc: 'Edit and manage quotes' },
  { key: 'viewQuotes', label: 'View Quotes', desc: 'View quotes (read-only)' },
  { key: 'editProjects', label: 'Edit Projects', desc: 'Edit project tracker entries (status, dates, comments)' },
  { key: 'viewProjects', label: 'View Projects', desc: 'View project tracker (read-only)' }
];

const PERM_TO_TAB = {
  byProject: 'project',
  byEmployee: 'employee',
  clockingInOut: 'clockinout',
  payroll: 'payroll',
  archive: 'archive',
  staff: 'staff',
  holidays: 'holidays',
  reports: 'reports',
  settings: 'settings',
  templates: 'templates',
  userAccess: 'useraccess'
};

// ── SharePoint folder helpers ──
async function findProjectFolder(projectId) {
  const token = await getToken();
  const searchRes = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${BAMA_DRIVE_ID}/root/search(q='${projectId}')`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  const searchData = await searchRes.json();
  return searchData.value?.find(item => item.folder && item.name.includes(projectId));
}

async function createFolderInDrive(parentItemId, folderName, driveId) {
  const token = await getToken();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId || BAMA_DRIVE_ID}/items/${parentItemId}/children`,
    {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: folderName, folder: {}, '@microsoft.graph.conflictBehavior': 'fail' })
    }
  );
  if (res.status === 409) {
    // Folder already exists, find it
    const listRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId || BAMA_DRIVE_ID}/items/${parentItemId}/children?$filter=name eq '${folderName}'`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const listData = await listRes.json();
    return listData.value?.[0] || null;
  }
  if (!res.ok) throw new Error(`Create folder failed: ${res.status}`);
  return await res.json();
}

async function getOrCreateSubfolder(parentItemId, folderName, driveId) {
  const token = await getToken();
  // Try to get existing
  const getRes = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId || BAMA_DRIVE_ID}/items/${parentItemId}:/${folderName}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  if (getRes.ok) return await getRes.json();
  // Create it
  return await createFolderInDrive(parentItemId, folderName, driveId);
}

async function uploadFileToFolder(parentItemId, fileName, fileData, contentType, driveId) {
  const token = await getToken();
  const url = `https://graph.microsoft.com/v1.0/drives/${driveId || BAMA_DRIVE_ID}/items/${parentItemId}:/${fileName}:/content`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': contentType || 'application/octet-stream' },
    body: fileData
  });
  if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
  return await res.json();
}

async function deleteFileFromDrive(fileId, driveId) {
  const token = await getToken();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${driveId || BAMA_DRIVE_ID}/items/${fileId}`,
    { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } }
  );
  if (!res.ok && res.status !== 404) throw new Error(`Delete failed: ${res.status}`);
}

// ═══════════════════════════════════════════
// OPEN PROJECTS / RENDER TILES
// ═══════════════════════════════════════════
async function openProjects() {
  if (CURRENT_PAGE !== 'projects') {
    window.location.href = 'projects.html';
    return;
  }
  showScreen('screenProjects');
  renderProjectTiles();
  loadDrawingsData().then(() => renderProjectTiles()).catch(() => {});
}

function renderProjectTiles() {
  const grid = document.getElementById('projectTilesGrid');
  if (!grid) return;
  const projects = state.projects.filter(p =>
    p.status?.toLowerCase() === 'in progress' || !p.status || p.status === 'Active'
  );

  if (!projects.length) {
    grid.innerHTML = '<div class="empty-state">No active projects found</div>';
    return;
  }

  grid.innerHTML = projects.map(p => {
    const projData = drawingsData.projects[p.id];
    const jobs = projData?.jobs || [];
    const openJobs = jobs.filter(j => j.status !== 'closed').length;
    const closedJobs = jobs.filter(j => j.status === 'closed').length;

    return `
      <div class="project-tile" onclick="openProjectDetail('${p.id}')">
        <div class="project-tile-id">${p.id}</div>
        <div class="project-tile-name">${p.name}</div>
        <div class="project-tile-client">${p.client || ''}</div>
        ${jobs.length > 0 ? `
          <div style="margin-top:12px;font-size:11px;font-family:var(--font-mono);color:var(--muted)">
            ${openJobs} open${closedJobs ? ` · ${closedJobs} closed` : ''}
          </div>
          <div style="margin-top:6px;height:3px;background:var(--border);border-radius:2px">
            <div style="height:100%;background:var(--green);border-radius:2px;width:${jobs.length ? Math.round(closedJobs/jobs.length*100) : 0}%"></div>
          </div>
        ` : '<div style="margin-top:12px;font-size:11px;color:var(--subtle)">No jobs yet</div>'}
        ${jobs.length > 0 ? `<div class="project-tile-badge">${jobs.length} job${jobs.length>1?'s':''}</div>` : ''}
      </div>
    `;
  }).join('');
}

// ═══════════════════════════════════════════
// PROJECT DETAIL — JOB LIST
// ═══════════════════════════════════════════
async function openProjectDetail(projectId) {
  const proj = state.projects.find(p => p.id === projectId);
  if (!proj) return;
  currentProject = proj;
  currentJob = null;

  document.getElementById('projDetailTitle').textContent = `${proj.id} — ${proj.name}`;
  document.getElementById('projDetailMeta').textContent = proj.client ? `Client: ${proj.client}` : '';
  document.getElementById('draftsmanBar').style.display = isDraftsman ? 'flex' : 'none';

  showScreen('screenProjectDetail');
  renderJobsList(projectId);

  // Load BOM data for this project in background
  loadBomData(projectId).catch(e => console.warn('BOM data load:', e.message));
}

function renderJobsList(projectId) {
  const container = document.getElementById('jobsList');
  if (!container) return;
  const projData = drawingsData.projects[projectId];
  const jobs = projData?.jobs || [];

  if (!jobs.length) {
    container.innerHTML = `
      <div class="empty-state" style="padding:60px 24px">
        <div style="font-size:36px;margin-bottom:12px">&#128221;</div>
        <div>No jobs created yet</div>
        ${isDraftsman ? '<div style="margin-top:8px;font-size:12px;color:var(--subtle)">Use the + Add Job button above</div>' : ''}
      </div>
    `;
    return;
  }

  container.innerHTML = jobs.map(job => {
    const isClosed = job.status === 'closed';
    // Calculate element progress
    const progress = getJobProgress(job);

    return `
      <div class="job-card ${isClosed ? 'closed' : ''}" onclick="openJobDetail('${projectId}', '${job.id}')">
        <div class="job-number">${String(job.number).padStart(2, '0')}</div>
        <div style="flex:1">
          <div class="job-name">${job.name}</div>
          <div style="font-size:11px;color:var(--subtle);margin-top:4px">
            Created ${new Date(job.createdAt).toLocaleDateString('en-GB')}
            ${isClosed ? ` · Closed ${new Date(job.closedAt).toLocaleDateString('en-GB')}` : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
          ${progress.fabPct >= 0 ? `<span style="font-size:11px;font-family:var(--font-mono);color:${progress.fabPct === 100 ? 'var(--green)' : 'var(--muted)'};font-weight:600">Fab ${progress.fabPct}%</span>` : ''}
          ${progress.tasksTotal > 0 ? `<span style="font-size:11px;font-family:var(--font-mono);color:${progress.tasksDone === progress.tasksTotal ? 'var(--green)' : 'var(--muted)'};font-weight:600">${progress.tasksDone}/${progress.tasksTotal} tasks</span>` : ''}
          ${progress.hasNewTasks ? `<span style="font-size:9px;font-weight:700;background:var(--accent);color:#fff;padding:2px 6px;border-radius:4px;letter-spacing:.3px">NEW TASK</span>` : ''}
        </div>
        <div class="job-badge ${isClosed ? 'closed' : 'open'}">${isClosed ? 'CLOSED' : 'OPEN'}</div>
      </div>
    `;
  }).join('');
}

function getJobProgress(job) {
  const elements = {};
  const projId = currentProject?.id;
  const bomJob = projId ? getBomDataForJob(projId, job.id) : { materialLists: [] };
  const bomItems = (bomJob.materialLists || []).flatMap(ml => ml.items || []);

  // BOM progress: based on item statuses — the primary measure
  if (bomItems.length > 0) {
    const allOnSite = bomItems.every(i => i.status === 'delivered_to_site' || i.status === 'complete');
    const anyProgress = bomItems.some(i => i.status !== 'not_started');
    elements.bom = allOnSite ? 'complete' : anyProgress ? 'active' : 'empty';
  } else {
    elements.bom = (job.bom?.files?.length > 0) ? 'active' : 'empty';
  }

  // Approval, Parts, Site — simple indicators, not measured progress
  const revs = job.approval?.revisions || [];
  elements.approval = revs.some(r => r.type === 'CO') ? 'complete' : revs.length > 0 ? 'active' : 'empty';

  elements.parts = ((job.parts?.sections?.files?.length || 0) + (job.parts?.plates?.files?.length || 0)) > 0 ? 'complete' : 'empty';

  // Assembly progress: based on task completion — the second measure
  const tasks = job.assembly?.tasks || [];
  const allDone = tasks.length > 0 && tasks.every(t => t.status === 'complete');
  elements.assembly = allDone ? 'complete' : tasks.length > 0 ? 'active' : 'empty';

  // Site: just an indicator
  const dns = bomJob.deliveryNotes || [];
  elements.site = job.site?.completedAt ? 'complete' : (dns.length > 0 || job.site?.files?.length > 0) ? 'active' : 'empty';

  // Progress label based on BOM + Assembly only
  const fabItems = bomItems.filter(i => i.fabricated);
  const fabDone = fabItems.filter(i => i.status !== 'not_started').length;
  const fabPct = fabItems.length > 0 ? Math.round(fabDone / fabItems.length * 100) : -1;
  const tasksDone = tasks.filter(t => t.status === 'complete').length;
  const tasksTotal = tasks.length;
  const newTaskCutoff = Date.now() - 48 * 60 * 60 * 1000;
  const hasNewTasks = tasks.some(t => t.status !== 'complete' && new Date(t.createdAt).getTime() > newTaskCutoff);

  const label = fabItems.length > 0 || tasks.length > 0
    ? `Fab: ${fabPct >= 0 ? fabPct + '%' : 'N/A'} · Tasks: ${tasksDone}/${tasksTotal}`
    : 'No progress data';
  return { elements, label, fabPct, tasksDone, tasksTotal, hasNewTasks };
}

// ═══════════════════════════════════════════
// CREATE JOB
// ═══════════════════════════════════════════
function openCreateJobModal() {
  if (!isDraftsman || !currentProject) return;
  document.getElementById('createJobProjectName').textContent = `${currentProject.id} — ${currentProject.name}`;
  document.getElementById('createJobName').value = '';
  document.getElementById('createJobProgress').style.display = 'none';
  document.getElementById('createJobBtn').disabled = false;
  document.getElementById('createJobModal').classList.add('active');
  setTimeout(() => document.getElementById('createJobName').focus(), 100);
}

function closeCreateJobModal() {
  document.getElementById('createJobModal').classList.remove('active');
}

async function createJob() {
  const jobName = document.getElementById('createJobName').value.trim();
  if (!jobName) { toast('Please enter a job name', 'error'); return; }

  const projectId = currentProject.id;
  if (!drawingsData.projects[projectId]) drawingsData.projects[projectId] = { jobs: [] };
  const jobs = drawingsData.projects[projectId].jobs;
  const jobNumber = jobs.length + 1;
  const folderName = `${String(jobNumber).padStart(2, '0')} - ${jobName}`;

  document.getElementById('createJobProgress').style.display = 'block';
  document.getElementById('createJobBtn').disabled = true;
  document.getElementById('createJobProgressBar').style.width = '10%';
  document.getElementById('createJobProgressText').textContent = 'Finding project folder...';

  try {
    // Find project folder on SharePoint
    const projectFolder = await findProjectFolder(projectId);
    if (!projectFolder) throw new Error('Project folder not found on SharePoint');

    document.getElementById('createJobProgressBar').style.width = '20%';
    document.getElementById('createJobProgressText').textContent = 'Creating 02 - Drawings folder...';

    // Get or create 02 - Drawings folder
    const drawingsFolder = await getOrCreateSubfolder(projectFolder.id, '02 - Drawings');
    if (!drawingsFolder) throw new Error('Could not create Drawings folder');

    document.getElementById('createJobProgressBar').style.width = '35%';
    document.getElementById('createJobProgressText').textContent = `Creating ${folderName}...`;

    // Create job folder
    const jobFolder = await createFolderInDrive(drawingsFolder.id, folderName);
    if (!jobFolder) throw new Error('Could not create job folder');

    // Create 5 element subfolders
    const elementNames = Object.values(ELEMENT_FOLDERS);
    for (let i = 0; i < elementNames.length; i++) {
      const pct = 40 + Math.round((i / elementNames.length) * 40);
      document.getElementById('createJobProgressBar').style.width = `${pct}%`;
      document.getElementById('createJobProgressText').textContent = `Creating ${elementNames[i]}...`;
      const elFolder = await createFolderInDrive(jobFolder.id, elementNames[i]);
      // For Parts, create sub-subfolders
      if (elementNames[i] === ELEMENT_FOLDERS.parts && elFolder) {
        for (const sub of PARTS_SUBFOLDERS) {
          await createFolderInDrive(elFolder.id, sub);
        }
      }
    }

    document.getElementById('createJobProgressBar').style.width = '90%';
    document.getElementById('createJobProgressText').textContent = 'Saving job data...';

    // Create job entry in drawingsData
    const newJob = {
      id: Date.now().toString(),
      number: jobNumber,
      name: jobName,
      folderName,
      spFolderId: jobFolder.id,
      spDriveId: jobFolder.parentReference?.driveId || BAMA_DRIVE_ID,
      status: 'open',
      createdAt: new Date().toISOString(),
      bom: { files: [], notes: [] },
      approval: { revisions: [], notes: [] },
      parts: {
        sections: { files: [], notes: [] },
        plates: { files: [], notes: [] }
      },
      assembly: { tasks: [] },
      site: { files: [], notes: [] }
    };

    jobs.push(newJob);
    await saveDrawingsData();

    document.getElementById('createJobProgressBar').style.width = '100%';
    document.getElementById('createJobProgressText').textContent = 'Done!';

    setTimeout(() => {
      closeCreateJobModal();
      toast(`Job "${jobName}" created`, 'success');
      renderJobsList(projectId);
    }, 400);

  } catch (e) {
    console.error('Create job error:', e);
    toast(`Failed: ${e.message}`, 'error');
    document.getElementById('createJobProgress').style.display = 'none';
  } finally {
    document.getElementById('createJobBtn').disabled = false;
  }
}

// ═══════════════════════════════════════════
// JOB DETAIL — 5 ELEMENTS VIEW
// ═══════════════════════════════════════════
function openJobDetail(projectId, jobId) {
  const proj = state.projects.find(p => p.id === projectId);
  if (!proj) return;
  currentProject = proj;
  const projData = drawingsData.projects[projectId];
  const job = projData?.jobs?.find(j => j.id === jobId);
  if (!job) return;
  currentJob = job;

  document.getElementById('jobDetailTitle').textContent = `${String(job.number).padStart(2,'0')} — ${job.name}`;
  document.getElementById('jobDetailMeta').textContent = `${proj.id} — ${proj.name}`;
  document.getElementById('jobDraftsmanBar').style.display = isDraftsman ? 'flex' : 'none';

  const badge = document.getElementById('jobStatusBadge');
  if (job.status === 'closed') {
    badge.textContent = 'CLOSED';
    badge.style.cssText = 'font-size:12px;font-weight:600;padding:6px 14px;border-radius:8px;background:rgba(62,207,142,.15);color:var(--green)';
  } else {
    badge.textContent = 'OPEN';
    badge.style.cssText = 'font-size:12px;font-weight:600;padding:6px 14px;border-radius:8px;background:rgba(255,107,0,.12);color:var(--accent)';
  }

  showScreen('screenJobDetail');
  // Ensure BOM data is loaded, then render
  loadBomData(projectId).then(() => renderAllElements()).catch(() => renderAllElements());
}

function toggleElement(name) {
  const body = document.getElementById(`element${name}Body`);
  const chevron = document.getElementById(`element${name}Chevron`);
  if (!body) return;
  body.classList.toggle('collapsed');
  chevron.classList.toggle('collapsed');
}

function renderAllElements() {
  if (!currentJob) return;
  renderBOM();
  renderApproval();
  renderParts();
  renderAssembly();
  renderSite();
}

// ═══════════════════════════════════════════
// ELEMENT 1: BOM — MATERIAL LIST SYSTEM
// ═══════════════════════════════════════════

// ── BOM State ──
let bomFilterCoating = '';
let bomFilterStatus = '';
let bomFilterFab = '';
let bomFilterMark = '';
let bomSelectedIds = new Set();
let parsedBomData = null; // temp storage during upload

// ── BOM Parser Constants ──
const NON_FAB_KEYWORDS = [
  'bolt','nut','washer','anchor','screw','rivet','hilti','hit-v','hit-re',
  'xox','hexagon','din 934','din 933','iso 4017','iso 4014','stud',
  'threaded rod','chemical anchor','fixings','fastener'
];
const BOM_HEADER_MAP = {
  'mark':'mark','quantity':'quantity','amount':'quantity',
  'size':'size','name':'description','description':'description',
  'coating':'coating','wt per assembly':'weightPerUnit',
  'weight (kg)':'weightPerUnit','weight':'weightPerUnit',
  'total wt (kg)':'totalWeight','total weight':'totalWeight',
  'x':'dimX','y':'dimY','z':'dimZ','length':'length','width':'width'
};
const BOM_NUMERIC_FIELDS = ['quantity','weightPerUnit','totalWeight','totalSurface','length','width','dimX','dimY','dimZ'];

// ── PDF Parser (uses PDF.js loaded on projects.html) ──
async function parseBomPdfBrowser(file) {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({data: arrayBuffer}).promise;
  const allPages = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const tc = await page.getTextContent();
    const vp = page.getViewport({scale: 1});
    const items = tc.items.map(it => ({
      text: it.str, x: Math.round(it.transform[4]),
      y: Math.round(vp.height - it.transform[5]),
      width: Math.round(it.width), height: Math.round(Math.abs(it.transform[0]))
    })).filter(it => it.text.trim());
    allPages.push(items);
  }

  // Get full page 1 text for type/metadata detection
  const p1Text = allPages[0]?.map(i => i.text).join(' ') || '';
  const bomType = detectBomTypeBrowser(p1Text);
  const metadata = extractMetadataBrowser(p1Text);

  let columns = null;
  const allItems = [];
  let itemCounter = 0;

  for (const pageItems of allPages) {
    const rows = groupRowsBrowser(pageItems);
    let headerRowIdx = -1;
    let bestCols = [];

    for (let ri = 0; ri < Math.min(rows.length, 8); ri++) {
      const detected = detectColumnsBrowser(rows[ri]);
      if (detected.length > bestCols.length) { bestCols = detected; headerRowIdx = ri; }
    }
    if (bestCols.length < 2) continue;
    if (!columns) columns = bestCols;

    for (let ri = headerRowIdx + 1; ri < rows.length; ri++) {
      const rowText = rows[ri].map(i => i.text).join(' ').toLowerCase();
      if (rowText.match(/page\s+\d+\s*\/\s*\d+/) || rowText.includes('total weight') && rows[ri].length <= 3) continue;
      if (rowText.includes('delivered by') || rowText.includes('received by')) continue;

      const vals = assignColsBrowser(rows[ri], columns);
      const nonEmpty = Object.values(vals).filter(v => v.trim());
      if (nonEmpty.length < 2) continue;
      if (vals.mark && /^\(.*\)$/.test(vals.mark)) continue;

      const item = {
        id: null, mark: vals.mark||'', description: vals.description||'',
        quantity: null, coating: vals.coating||'', size: vals.size||'',
        weightPerUnit: null, totalWeight: null, totalSurface: null,
        length: null, width: null, dimX: null, dimY: null, dimZ: null,
        fabricated: true, manuallyAdded: false, status: 'not_started',
        traceability: null, deliveryHistory: []
      };

      for (const f of BOM_NUMERIC_FIELDS) {
        if (vals[f] !== undefined) {
          const cleaned = String(vals[f]).trim().replace(/,/g, '');
          const n = parseFloat(cleaned);
          if (!isNaN(n)) item[f] = n;
        }
      }

      if (!item.mark && !item.description) continue;
      if (!item.mark && item.description) {
        itemCounter++;
        item.mark = `ITEM-${String(itemCounter).padStart(3, '0')}`;
      }

      const checkText = (item.description || item.mark || '').toLowerCase();
      if (bomType === 'bolt_anchor_list') item.fabricated = false;
      else item.fabricated = !NON_FAB_KEYWORDS.some(kw => checkText.includes(kw));

      item.id = `bom-${item.mark}-${allItems.length}`;
      allItems.push(item);
    }
  }

  return {
    metadata, bomType, fileName: file.name,
    columns: (columns||[]).map(c => ({key: c.key, label: c.label})),
    itemCount: allItems.length,
    fabricatedCount: allItems.filter(i => i.fabricated).length,
    nonFabricatedCount: allItems.filter(i => !i.fabricated).length,
    items: allItems
  };
}

function detectBomTypeBrowser(text) {
  const t = text.toLowerCase();
  if (t.includes('shipping list')) return 'shipping_list';
  if (t.includes('bolt') && (t.includes('anchor') || t.includes('list'))) return 'bolt_anchor_list';
  if (t.includes('grating')) return 'grating_list';
  return 'material_list';
}

function extractMetadataBrowser(text) {
  const meta = {title:'',date:'',project:'',client:'',jobNo:'',author:'',detailer:''};
  const lines = text.split(/\s{3,}|\n/).map(l => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 15)) {
    const ll = line.toLowerCase();
    if (!meta.title && (ll.includes('shipping list')||ll.includes('bolt')||ll.includes('grating list')||ll.includes('anchor list'))) {
      // Extract just the title portion — cut at first date/number pattern or limit to 60 chars
      const titleMatch = line.match(/(.*?(?:shipping list|bolt\s*&?\s*anchor\s*list|grating list))/i);
      meta.title = titleMatch ? titleMatch[1].trim() : line.substring(0, 60).trim();
    }
    let m;
    if ((m = line.match(/Date:\s*(.+?)(?:\s{2,}|Project|$)/i))) meta.date = m[1].trim();
    if ((m = line.match(/Project:\s*(.+?)(?:\s{2,}|Author|$)/i))) meta.project = m[1].trim();
    if ((m = line.match(/Client:\s*(.+?)(?:\s{2,}|Job|$)/i))) meta.client = m[1].trim();
    if ((m = line.match(/Job\s*No\.?:\s*(.+?)(?:\s{2,}|$)/i))) meta.jobNo = m[1].trim();
    if ((m = line.match(/Contract:\s*(.+?)(?:\s{2,}|$)/i)) && !meta.project) meta.project = m[1].trim();
  }
  if (!meta.title) meta.title = detectBomTypeBrowser(text).replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  return meta;
}

function groupRowsBrowser(items, tol = 4) {
  if (!items.length) return [];
  const sorted = [...items].sort((a,b) => a.y - b.y || a.x - b.x);
  const rows = [];
  let cur = [sorted[0]], curY = sorted[0].y;
  for (let i = 1; i < sorted.length; i++) {
    if (Math.abs(sorted[i].y - curY) <= tol) cur.push(sorted[i]);
    else { rows.push(cur); cur = [sorted[i]]; curY = sorted[i].y; }
  }
  rows.push(cur);
  return rows;
}

function detectColumnsBrowser(row) {
  const cols = [];
  for (const item of row) {
    const label = item.text.trim().toLowerCase();
    let norm = BOM_HEADER_MAP[label];
    if (!norm) {
      for (const [k,v] of Object.entries(BOM_HEADER_MAP)) {
        if (label.includes(k) || k.includes(label)) { norm = v; break; }
      }
    }
    if (norm && !cols.find(c => c.key === norm)) {
      cols.push({key: norm, label: item.text.trim(), x: item.x, width: item.width || 60});
    }
  }
  return cols.sort((a,b) => a.x - b.x);
}

function assignColsBrowser(rowItems, columns) {
  const result = {};
  for (const col of columns) result[col.key] = '';
  for (const item of rowItems) {
    let bestCol = null, bestDist = Infinity;
    for (const col of columns) {
      const dist = Math.abs((item.x + item.width/2) - (col.x + col.width/2));
      const inRange = item.x >= col.x - 30 && item.x <= col.x + col.width + 50;
      if (inRange && dist < bestDist) { bestDist = dist; bestCol = col; }
    }
    if (!bestCol) {
      for (const col of columns) {
        const dist = Math.abs(item.x - col.x);
        if (dist < bestDist) { bestDist = dist; bestCol = col; }
      }
    }
    if (bestCol) {
      result[bestCol.key] = result[bestCol.key] ? result[bestCol.key] + ' ' + item.text.trim() : item.text.trim();
    }
  }
  return result;
}

// ── BOM Upload Modal ──
function openUploadBomModal() {
  if (!isDraftsman || !currentJob || !currentProject) return;
  document.getElementById('uploadBomContext').textContent = `${currentProject.id} — ${currentProject.name} / ${currentJob.name}`;
  document.getElementById('bomFileInput').value = '';
  document.getElementById('bomUploadZoneText').textContent = 'Click or drag a BOM PDF here';
  document.getElementById('bomParsePreview').style.display = 'none';
  document.getElementById('bomUploadConfirmBtn').style.display = 'none';
  document.getElementById('bomUploadProgress').style.display = 'none';
  parsedBomData = null;
  document.getElementById('uploadBomModal').classList.add('active');
}
function closeUploadBomModal() { document.getElementById('uploadBomModal').classList.remove('active'); parsedBomData = null; }

async function onBomFileSelected() {
  const input = document.getElementById('bomFileInput');
  if (!input.files.length) return;
  const file = input.files[0];
  document.getElementById('bomUploadZoneText').textContent = file.name;
  document.getElementById('bomUploadProgress').style.display = 'block';
  document.getElementById('bomUploadProgressText').textContent = 'Parsing PDF...';
  document.getElementById('bomUploadProgressBar').style.width = '30%';

  try {
    parsedBomData = await parseBomPdfBrowser(file);
    parsedBomData._file = file;
    document.getElementById('bomUploadProgressBar').style.width = '100%';
    document.getElementById('bomUploadProgressText').textContent = 'Parsed!';

    // Show preview
    document.getElementById('bomParseTitle').textContent = `${parsedBomData.metadata.title || parsedBomData.bomType}`;
    document.getElementById('bomParseSummary').textContent =
      `${parsedBomData.itemCount} items found — ${parsedBomData.fabricatedCount} fabricated, ${parsedBomData.nonFabricatedCount} non-fabricated (bought-in)`;

    // Build preview table
    const cols = parsedBomData.columns;
    let tableHtml = '<thead><tr>';
    tableHtml += '<th style="padding:6px 8px;font-size:10px;border-bottom:1px solid var(--border);color:var(--subtle)">Type</th>';
    for (const c of cols.slice(0, 5)) {
      tableHtml += `<th style="padding:6px 8px;font-size:10px;border-bottom:1px solid var(--border);color:var(--subtle)">${c.label}</th>`;
    }
    tableHtml += '</tr></thead><tbody>';
    for (const item of parsedBomData.items.slice(0, 15)) {
      const rowClass = item.fabricated ? '' : 'non-fab';
      tableHtml += `<tr class="${rowClass}">`;
      tableHtml += `<td style="padding:4px 8px;font-size:11px">${item.fabricated ? '&#128296;' : '&#128230;'}</td>`;
      for (const c of cols.slice(0, 5)) {
        let val = item[c.key];
        if (val === null || val === undefined) val = '';
        if (typeof val === 'number') val = val.toLocaleString('en-GB');
        tableHtml += `<td style="padding:4px 8px;font-size:11px">${val}</td>`;
      }
      tableHtml += '</tr>';
    }
    if (parsedBomData.items.length > 15) {
      tableHtml += `<tr><td colspan="${cols.length+1}" style="padding:8px;text-align:center;color:var(--muted);font-size:11px">... and ${parsedBomData.items.length - 15} more items</td></tr>`;
    }
    tableHtml += '</tbody>';
    document.getElementById('bomPreviewTable').innerHTML = tableHtml;

    document.getElementById('bomParsePreview').style.display = 'block';
    document.getElementById('bomUploadConfirmBtn').style.display = '';
    setTimeout(() => { document.getElementById('bomUploadProgress').style.display = 'none'; }, 600);
  } catch (e) {
    console.error('BOM parse error:', e);
    document.getElementById('bomUploadProgressText').textContent = `Parse failed: ${e.message}`;
    document.getElementById('bomUploadProgressBar').style.width = '100%';
    document.getElementById('bomUploadProgressBar').style.background = 'var(--red)';
    toast('Failed to parse BOM PDF: ' + e.message, 'error');
  }
}

async function confirmUploadBom() {
  if (!parsedBomData || !currentJob || !currentProject) return;
  const projectId = currentProject.id;
  const btn = document.getElementById('bomUploadConfirmBtn');
  btn.disabled = true;
  btn.textContent = 'Saving...';

  try {
    // Upload the PDF file to SharePoint
    let fileRecord = {};
    if (parsedBomData._file) {
      document.getElementById('bomUploadProgress').style.display = 'block';
      document.getElementById('bomUploadProgressText').textContent = 'Uploading PDF to SharePoint...';
      document.getElementById('bomUploadProgressBar').style.width = '50%';
      document.getElementById('bomUploadProgressBar').style.background = 'var(--accent)';

      const projectFolder = await findProjectFolder(projectId);
      if (projectFolder) {
        const drawingsFolder = await getOrCreateSubfolder(projectFolder.id, '02 - Drawings');
        if (drawingsFolder) {
          const jobFolder = currentJob.spFolderId
            ? { id: currentJob.spFolderId }
            : await getOrCreateSubfolder(drawingsFolder.id, currentJob.folderName || currentJob.name);
          if (jobFolder) {
            const bomFolder = await getOrCreateSubfolder(jobFolder.id, '01 - BOM');
            if (bomFolder) {
              const uploaded = await uploadFileToFolder(bomFolder.id, parsedBomData._file.name, parsedBomData._file, parsedBomData._file.type || 'application/pdf');
              fileRecord = {
                fileId: uploaded.id,
                driveId: uploaded.parentReference?.driveId || BAMA_DRIVE_ID,
                webUrl: uploaded.webUrl
              };
            }
          }
        }
      }
      document.getElementById('bomUploadProgressBar').style.width = '80%';
      document.getElementById('bomUploadProgressText').textContent = 'Saving data...';
    }

    // Build material list entry
    const ml = {
      id: 'ml-' + Date.now(),
      fileName: parsedBomData.fileName,
      fileId: fileRecord.fileId || '',
      driveId: fileRecord.driveId || '',
      webUrl: fileRecord.webUrl || '',
      bomType: parsedBomData.bomType,
      uploadedAt: new Date().toISOString(),
      uploadedBy: 'Draftsman',
      metadata: parsedBomData.metadata,
      columns: parsedBomData.columns,
      items: parsedBomData.items
    };

    // Add to job
    const bomJob = ensureBomDataForJob(currentProject.id, currentJob.id);
    bomJob.materialLists.push(ml);

    await saveBomData(currentProject.id);

    document.getElementById('bomUploadProgressBar').style.width = '100%';
    document.getElementById('bomUploadProgressText').textContent = 'Done!';

    setTimeout(() => {
      closeUploadBomModal();
      toast(`BOM uploaded: ${ml.items.length} items parsed`, 'success');
      renderBOM();
    }, 400);

  } catch (e) {
    console.error('BOM upload error:', e);
    toast('Upload failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Upload & Save BOM';
  }
}

// ── Add Manual Item ──
function openAddBomItemModal() {
  if (!currentJob) return;
  document.getElementById('manualBomMark').value = '';
  document.getElementById('manualBomQty').value = '1';
  document.getElementById('manualBomDesc').value = '';
  document.getElementById('manualBomCoating').value = '';
  document.getElementById('manualBomWeight').value = '';
  document.querySelectorAll('input[name="manualBomFab"]')[0].checked = true;
  document.getElementById('addBomItemModal').classList.add('active');
}
function closeAddBomItemModal() { document.getElementById('addBomItemModal').classList.remove('active'); }

async function confirmAddBomItem() {
  const mark = document.getElementById('manualBomMark').value.trim();
  const qty = parseFloat(document.getElementById('manualBomQty').value) || 1;
  const desc = document.getElementById('manualBomDesc').value.trim();
  const coating = document.getElementById('manualBomCoating').value.trim();
  const weight = parseFloat(document.getElementById('manualBomWeight').value) || null;
  const fab = document.querySelector('input[name="manualBomFab"]:checked')?.value === 'true';

  if (!mark && !desc) { toast('Enter a mark or description', 'error'); return; }

  // Find the first material list to add to, or create a manual one
  const bomJob = ensureBomDataForJob(currentProject.id, currentJob.id);
  let targetList = bomJob.materialLists[0];
  if (!targetList) {
    targetList = {
      id: 'ml-manual-' + Date.now(), fileName: 'Manual entries', fileId: '', driveId: '', webUrl: '',
      bomType: 'manual', uploadedAt: new Date().toISOString(), uploadedBy: 'Manual',
      metadata: { title: 'Manual entries', date: '', project: '', client: '', jobNo: '', author: '', detailer: '' },
      columns: [{key:'mark',label:'Mark'},{key:'description',label:'Description'},{key:'quantity',label:'Quantity'},{key:'coating',label:'Coating'},{key:'totalWeight',label:'Weight'}],
      items: []
    };
    bomJob.materialLists.push(targetList);
  }

  const item = {
    id: `bom-manual-${Date.now()}`,
    mark: mark || `MANUAL-${targetList.items.length + 1}`,
    description: desc, quantity: qty, coating, size: '',
    weightPerUnit: null, totalWeight: weight, totalSurface: null,
    length: null, width: null, dimX: null, dimY: null, dimZ: null,
    fabricated: fab, manuallyAdded: true, status: 'not_started',
    traceability: null, deliveryHistory: []
  };

  targetList.items.push(item);
  await saveBomData(currentProject.id);
  closeAddBomItemModal();
  toast(`Added ${item.mark} to BOM`, 'success');
  renderBOM();
}

// ── Render BOM Element ──
function renderBOM() {
  const container = document.getElementById('bomContent');
  if (!container) return;

  const bomJob = getBomDataForJob(currentProject?.id, currentJob?.id);
  const lists = bomJob.materialLists || [];
  const allItems = lists.flatMap(ml => ml.items || []);
  const status = document.getElementById('elementBOMStatus');

  if (allItems.length > 0) {
    const fabDone = allItems.filter(i => i.fabricated && i.status !== 'not_started').length;
    const fabTotal = allItems.filter(i => i.fabricated).length;
    status.textContent = `${allItems.length} items · ${fabDone}/${fabTotal} fabricated`;
    status.style.cssText = fabDone === fabTotal && fabTotal > 0
      ? 'color:var(--green);background:rgba(62,207,142,.1);padding:3px 10px;border-radius:4px;font-size:11px;font-weight:600'
      : 'color:var(--accent);background:rgba(255,107,0,.1);padding:3px 10px;border-radius:4px;font-size:11px;font-weight:600';
  } else {
    const bom = currentJob.bom || { files: [], notes: [] };
    status.textContent = bom.files?.length > 0 ? `${bom.files.length} file${bom.files.length>1?'s':''}` : 'Empty';
    status.style.cssText = bom.files?.length > 0
      ? 'color:var(--green);background:rgba(62,207,142,.1);padding:3px 10px;border-radius:4px;font-size:11px;font-weight:600'
      : 'color:var(--subtle);font-size:11px;font-weight:600';
  }

  let html = '';

  // Toolbar
  html += '<div class="bom-toolbar">';
  if (isDraftsman && currentJob.status !== 'closed') {
    html += `<button class="btn btn-primary" style="padding:8px 16px;font-size:12px" onclick="openUploadBomModal()">&#128196; Upload BOM PDF</button>`;
    html += `<button class="btn" style="padding:8px 16px;font-size:12px;background:rgba(255,107,0,.08);border:1px solid rgba(255,107,0,.25);color:var(--accent)" onclick="openAddBomItemModal()">&#43; Add Item</button>`;
  }
  // Legacy file upload button
  if (isDraftsman && currentJob.status !== 'closed') {
    html += `<button class="btn btn-ghost" style="padding:8px 16px;font-size:12px" onclick="openUploadFileModal('bom')">&#128196; Upload File</button>`;
  }
  html += '</div>';

  // Show material lists
  if (allItems.length > 0) {
    // Progress bar
    const fabItems = allItems.filter(i => i.fabricated);
    const fabDone = fabItems.filter(i => i.status !== 'not_started').length;
    const pct = fabItems.length ? Math.round(fabDone / fabItems.length * 100) : 0;
    const dispatchedCount = allItems.filter(i => ['dispatched','returned','delivered_to_site','complete'].includes(i.status)).length;
    html += `<div style="background:var(--surface);border:1.5px solid ${pct === 100 ? 'rgba(62,207,142,.4)' : 'rgba(255,107,0,.25)'};border-radius:12px;padding:16px 20px;margin-bottom:16px">`;
    html += `<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">`;
    html += `<div style="font-size:14px;font-weight:600">Fabrication Progress</div>`;
    html += `<div style="font-size:28px;font-weight:700;font-family:var(--font-mono);color:${pct === 100 ? 'var(--green)' : 'var(--accent)'}">${pct}%</div>`;
    html += `</div>`;
    html += `<div style="height:12px;background:var(--border);border-radius:6px;overflow:hidden">`;
    html += `<div style="height:100%;border-radius:6px;width:${pct}%;background:${pct === 100 ? 'var(--green)' : 'var(--accent)'};transition:width .4s"></div>`;
    html += `</div>`;
    html += `<div style="display:flex;gap:16px;margin-top:10px;font-size:12px;color:var(--muted)">`;
    html += `<span>${fabDone}/${fabItems.length} fabricated</span>`;
    html += `<span>${allItems.length - fabItems.length} non-fab</span>`;
    html += `<span>${dispatchedCount} dispatched</span>`;
    html += `</div></div>`;

    // Per-list sections
    for (const ml of lists) {
      if (!ml.items?.length) continue;
      html += `<div class="bom-list-header">`;
      const displayTitle = ml.fileName || (ml.metadata?.title || 'Material List').substring(0, 60);
      html += `<div class="bom-list-title">${displayTitle}</div>`;
      html += `<div class="bom-list-badge">${ml.items.length} items</div>`;
      if (ml.webUrl) html += `<a href="${ml.webUrl}" target="_blank" style="font-size:11px;color:var(--accent);text-decoration:none">View PDF</a>`;
      html += `</div>`;

      // Filter bar
      const coatings = [...new Set(ml.items.map(i => i.coating).filter(Boolean))];
      const statuses = [...new Set(ml.items.map(i => i.status))];
      html += `<div class="bom-filter-bar">`;
      html += `<select onchange="bomFilterCoating=this.value;renderBomTable('${ml.id}')"><option value="">All coatings</option>${coatings.map(c => `<option value="${c}" ${bomFilterCoating===c?'selected':''}>${c}</option>`).join('')}</select>`;
      html += `<select onchange="bomFilterStatus=this.value;renderBomTable('${ml.id}')"><option value="">All statuses</option>${statuses.map(s => `<option value="${s}" ${bomFilterStatus===s?'selected':''}>${s.replace(/_/g,' ')}</option>`).join('')}</select>`;
      html += `<select onchange="bomFilterFab=this.value;renderBomTable('${ml.id}')"><option value="">All types</option><option value="true" ${bomFilterFab==='true'?'selected':''}>Fabricated</option><option value="false" ${bomFilterFab==='false'?'selected':''}>Non-fabricated</option></select>`;
      html += `<input type="text" placeholder="Search mark..." value="${bomFilterMark}" oninput="bomFilterMark=this.value;renderBomTable('${ml.id}')" style="max-width:120px">`;
      html += `</div>`;

      // Table container
      html += `<div id="bomTableWrap-${ml.id}" style="max-height:400px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;margin-bottom:16px"></div>`;
    }

    // Bulk actions bar
    html += `<div id="bomBulkBar" style="display:none" class="bom-select-all-bar">`;
    html += `<span id="bomSelCount">0 selected</span>`;
    html += `<div class="bom-bulk-actions">`;
    html += `<button class="btn btn-success" style="padding:6px 14px;font-size:12px" onclick="bulkMarkFabricated()">&#10003; Mark as fabricated</button>`;
    if (isDraftsman) {
      html += `<button class="btn btn-primary" style="padding:6px 14px;font-size:12px" onclick="openGenerateDnModal()">&#128666; Generate Delivery Note</button>`;
    }
    html += `</div></div>`;
  } else {
    // Legacy file list
    const bom = currentJob.bom || { files: [], notes: [] };
    if (bom.files?.length > 0) {
      html += bom.files.map(f => renderFileRow(f, 'bom')).join('');
    } else {
      html += '<div style="color:var(--subtle);font-size:13px;padding:12px 0">No material lists uploaded yet. Use "Upload BOM PDF" to parse a material list.</div>';
    }
  }

  // Notes
  const bom = currentJob.bom || { files: [], notes: [] };
  html += renderNotesSection(bom.notes || [], 'bom');

  container.innerHTML = html;

  // Render tables after DOM is ready
  for (const ml of lists) {
    if (ml.items?.length) {
      setTimeout(() => renderBomTable(ml.id), 0);
    }
  }
}

// ── Render BOM Table (filterable) ──
function renderBomTable(mlId) {
  const wrap = document.getElementById(`bomTableWrap-${mlId}`);
  if (!wrap) return;
  const bomJob = getBomDataForJob(currentProject?.id, currentJob?.id);
  const lists = bomJob.materialLists || [];
  const ml = lists.find(m => m.id === mlId);
  if (!ml) return;

  let items = [...ml.items];

  // Apply filters
  if (bomFilterCoating) items = items.filter(i => i.coating === bomFilterCoating);
  if (bomFilterStatus) items = items.filter(i => i.status === bomFilterStatus);
  if (bomFilterFab === 'true') items = items.filter(i => i.fabricated);
  else if (bomFilterFab === 'false') items = items.filter(i => !i.fabricated);
  if (bomFilterMark) items = items.filter(i => i.mark.toLowerCase().includes(bomFilterMark.toLowerCase()));

  // Auto-sort: not_started first, then fabricated, then dispatched/returned, then delivered_to_site last
  const STATUS_ORDER = { not_started: 0, fabricated: 1, returned: 2, dispatched: 3, delivered_to_site: 4, complete: 5 };
  items.sort((a, b) => (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3));

  // Select all bar
  const allFilteredIds = items.map(i => i.id);
  const allSelected = allFilteredIds.length > 0 && allFilteredIds.every(id => bomSelectedIds.has(id));

  let html = `<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;background:var(--surface);border-bottom:1px solid var(--border)">`;
  html += `<input type="checkbox" ${allSelected ? 'checked' : ''} onchange="toggleBomSelectAll('${mlId}', this.checked)" style="width:16px;height:16px;accent-color:var(--accent)">`;
  html += `<span style="font-size:11px;color:var(--muted)">${allSelected ? 'Deselect' : 'Select'} all ${items.length} filtered</span>`;
  html += `</div>`;

  html += '<table class="bom-table"><thead><tr>';
  html += '<th class="cb-cell"></th>';
  html += '<th>Mark</th>';
  const showDesc = ml.columns.some(c => c.key === 'description');
  const showSize = ml.columns.some(c => c.key === 'size');
  const showCoating = ml.columns.some(c => c.key === 'coating');
  if (showDesc || showSize) html += `<th>${showDesc ? 'Description' : 'Size'}</th>`;
  html += '<th>Qty</th>';
  if (showCoating) html += '<th>Coating</th>';
  html += '<th>Weight</th><th>Status</th>';
  html += '<th>Actions</th>';
  html += '</tr></thead><tbody>';

  for (const item of items) {
    const classes = [];
    if (!item.fabricated) classes.push('non-fab');
    if (item.manuallyAdded) classes.push('manual-item');

    html += `<tr class="${classes.join(' ')}">`;
    html += `<td class="cb-cell"><input type="checkbox" ${bomSelectedIds.has(item.id) ? 'checked' : ''} onchange="toggleBomSelect('${item.id}', this.checked)"></td>`;
    html += `<td style="font-weight:600;font-family:var(--font-mono)">${item.mark}${item.manuallyAdded ? ' <span style="color:var(--amber);font-size:10px" title="Manually added">&#9679;</span>' : ''}</td>`;
    if (showDesc || showSize) html += `<td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${item.description || item.size}">${item.description || item.size}</td>`;
    html += `<td>${item.quantity || ''}</td>`;
    if (showCoating) html += `<td>${item.coating}</td>`;
    html += `<td>${item.totalWeight != null ? item.totalWeight.toLocaleString('en-GB') : (item.weightPerUnit != null ? item.weightPerUnit.toLocaleString('en-GB') : '')}</td>`;

    // Status cell with delivery history
    const lastDn = item.deliveryHistory?.length ? item.deliveryHistory[item.deliveryHistory.length - 1] : null;
    let statusLabel = item.status.replace(/_/g, ' ');
    if (lastDn && item.status === 'dispatched') statusLabel = `Sent: ${lastDn.destinationName || lastDn.destination}`;
    if (lastDn && item.status === 'delivered_to_site') statusLabel = 'Delivered to site';
    html += `<td>`;
    html += `<span class="bom-status-badge ${item.status.replace(/_/g,'-')}">${statusLabel}</span>`;
    if (item.deliveryHistory?.length > 0) {
      html += `<button class="btn btn-ghost" style="padding:1px 6px;font-size:9px;margin-left:4px" onclick="showItemDeliveryHistory('${mlId}','${item.id}')" title="View delivery history">&#128196; ${item.deliveryHistory.length}</button>`;
    }
    html += `</td>`;

    // Actions cell
    html += '<td style="white-space:nowrap">';
    if (item.fabricated && item.status === 'not_started') {
      html += `<button class="btn btn-success" style="padding:3px 10px;font-size:10px" onclick="openFabricateItemModal('${mlId}','${item.id}')">&#10003; Mark as fabricated</button>`;
    } else if (item.status === 'dispatched') {
      html += `<button class="btn" style="padding:3px 10px;font-size:10px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);color:var(--amber)" onclick="markItemReturned('${mlId}','${item.id}')">&#8617; Returned</button>`;
    } else if (item.traceability) {
      html += `<span style="font-size:10px;color:var(--subtle)">${item.traceability.welder}${item.traceability.machine ? ' / ' + item.traceability.machine : ''}</span>`;
    } else if (!item.fabricated && item.status === 'not_started') {
      html += `<span style="font-size:10px;color:var(--subtle)">Ready for dispatch</span>`;
    }
    html += '</td>';
    html += '</tr>';
  }

  html += '</tbody></table>';
  wrap.innerHTML = html;
  updateBomBulkBar();
}

function toggleBomSelect(itemId, checked) {
  if (checked) bomSelectedIds.add(itemId);
  else bomSelectedIds.delete(itemId);
  updateBomBulkBar();
}

function toggleBomSelectAll(mlId, checked) {
  const bomJob = getBomDataForJob(currentProject?.id, currentJob?.id);
  const ml = (bomJob.materialLists || []).find(m => m.id === mlId);
  if (!ml) return;
  let items = [...ml.items];
  if (bomFilterCoating) items = items.filter(i => i.coating === bomFilterCoating);
  if (bomFilterStatus) items = items.filter(i => i.status === bomFilterStatus);
  if (bomFilterFab === 'true') items = items.filter(i => i.fabricated);
  else if (bomFilterFab === 'false') items = items.filter(i => !i.fabricated);
  if (bomFilterMark) items = items.filter(i => i.mark.toLowerCase().includes(bomFilterMark.toLowerCase()));

  for (const item of items) {
    if (checked) bomSelectedIds.add(item.id);
    else bomSelectedIds.delete(item.id);
  }
  renderBomTable(mlId);
}

function updateBomBulkBar() {
  const bar = document.getElementById('bomBulkBar');
  if (!bar) return;
  if (bomSelectedIds.size > 0) {
    bar.style.display = 'flex';
    document.getElementById('bomSelCount').textContent = `${bomSelectedIds.size} selected`;
  } else {
    bar.style.display = 'none';
  }
}

// ── Fabrication toggle (workshop) ──
async function openFabricateItemModal(mlId, itemId) {
  const bomJob = getBomDataForJob(currentProject?.id, currentJob?.id);
  const ml = (bomJob.materialLists || []).find(m => m.id === mlId);
  if (!ml) return;
  const item = ml.items.find(i => i.id === itemId);
  if (!item) return;

  const employees = (state.timesheetData.employees || []).filter(e => e.active !== false);

  // Load welding machines from the central SQL-backed API
  let machines = [];
  try { machines = await api.get('/api/welding-machines'); } catch (e) { console.warn('Failed to load welding machines:', e.message); }

  // Quick inline approach using confirm modal
  const empOptions = employees.map(e => `<option value="${e.name}">${e.name}</option>`).join('');
  const machOptions = machines.filter(m => m.is_active !== false).map(m => `<option value="${m.machine_name}">${m.machine_name}${m.serial_number ? ' (S/N ' + m.serial_number + ')' : ''}</option>`).join('');

  const content = `
    <div style="text-align:left;margin-top:12px">
      <div style="font-size:14px;font-weight:600;margin-bottom:12px">${item.mark} — Mark as fabricated</div>
      <div style="margin-bottom:10px">
        <div class="field-label">WELDER</div>
        <select class="field-input" id="fabWelder" style="font-size:13px"><option value="">Select welder...</option>${empOptions}</select>
      </div>
      <div style="margin-bottom:10px">
        <div class="field-label">WELDING MACHINE (if applicable)</div>
        <select class="field-input" id="fabMachine" style="font-size:13px"><option value="">N/A</option>${machOptions}</select>
      </div>
    </div>
  `;

  document.getElementById('confirmTitle').textContent = '&#10003; Mark as Fabricated';
  document.getElementById('confirmMsg').innerHTML = content;
  const okBtn = document.getElementById('confirmOk');
  okBtn.textContent = 'Confirm';
  okBtn.onclick = async () => {
    const welder = document.getElementById('fabWelder').value;
    if (!welder) { toast('Please select the welder', 'error'); return; }
    const machine = document.getElementById('fabMachine').value;

    item.status = 'fabricated';
    const selectedMachine = machines.find(m => m.machine_name === machine);
    item.traceability = {
      welder,
      machine: machine || null,
      machineSerialNumber: selectedMachine?.serial_number || null,
      projectNumber: currentProject?.id || null,
      jobName: currentJob?.job_name || currentJob?.jobName || null,
      completedAt: new Date().toISOString()
    };

    try {
      await saveBomData(currentProject.id);
      closeModal();
      toast(`${item.mark} marked as fabricated`, 'success');
      renderBOM();
    } catch (e) { toast('Save failed: ' + e.message, 'error'); }
  };
  document.getElementById('confirmModal').classList.add('active');
}

// ── Bulk Mark as Fabricated ──
async function bulkMarkFabricated() {
  if (bomSelectedIds.size === 0) { toast('Select items first', 'error'); return; }

  // Find selected fabricatable items
  const bomJob = getBomDataForJob(currentProject?.id, currentJob?.id);
  const allItems = (bomJob.materialLists || []).flatMap(ml => ml.items || []);
  const selected = allItems.filter(i => bomSelectedIds.has(i.id) && i.fabricated && i.status === 'not_started');

  if (!selected.length) { toast('No unfabricated items in selection', 'error'); return; }

  const employees = (state.timesheetData.employees || []).filter(e => e.active !== false);

  // Load welding machines from the central SQL-backed API
  let machines = [];
  try { machines = await api.get('/api/welding-machines'); } catch (e) { console.warn('Failed to load welding machines:', e.message); }

  const empOptions = employees.map(e => `<option value="${e.name}">${e.name}</option>`).join('');
  const machOptions = machines.filter(m => m.is_active !== false).map(m => `<option value="${m.machine_name}">${m.machine_name}${m.serial_number ? ' (S/N ' + m.serial_number + ')' : ''}</option>`).join('');

  const content = `
    <div style="text-align:left;margin-top:12px">
      <div style="font-size:14px;font-weight:600;margin-bottom:4px">Mark ${selected.length} items as fabricated</div>
      <div style="font-size:12px;color:var(--muted);margin-bottom:12px">${selected.map(i => i.mark).join(', ')}</div>
      <div style="margin-bottom:10px">
        <div class="field-label">WELDER</div>
        <select class="field-input" id="fabWelder" style="font-size:13px"><option value="">Select welder...</option>${empOptions}</select>
      </div>
      <div style="margin-bottom:10px">
        <div class="field-label">WELDING MACHINE (if applicable)</div>
        <select class="field-input" id="fabMachine" style="font-size:13px"><option value="">N/A</option>${machOptions}</select>
      </div>
    </div>
  `;

  document.getElementById('confirmTitle').textContent = 'Mark as Fabricated';
  document.getElementById('confirmMsg').innerHTML = content;
  const okBtn = document.getElementById('confirmOk');
  okBtn.textContent = 'Confirm';
  okBtn.onclick = async () => {
    const welder = document.getElementById('fabWelder').value;
    if (!welder) { toast('Please select the welder', 'error'); return; }
    const machine = document.getElementById('fabMachine').value;
    const now = new Date().toISOString();
    const selectedMachine = machines.find(m => m.machine_name === machine);

    for (const item of selected) {
      item.status = 'fabricated';
      item.traceability = {
        welder,
        machine: machine || null,
        machineSerialNumber: selectedMachine?.serial_number || null,
        projectNumber: currentProject?.id || null,
        jobName: currentJob?.job_name || currentJob?.jobName || null,
        completedAt: now
      };
    }

    try {
      await saveBomData(currentProject.id);
      bomSelectedIds.clear();
      closeModal();
      toast(`${selected.length} items marked as fabricated`, 'success');
      renderBOM();
    } catch (e) { toast('Save failed: ' + e.message, 'error'); }
  };
  document.getElementById('confirmModal').classList.add('active');
}

// ── Delivery Note Generation ──
async function openGenerateDnModal() {
  if (bomSelectedIds.size === 0) { toast('Select items first', 'error'); return; }
  document.getElementById('dnItemCount').textContent = `${bomSelectedIds.size} items selected`;
  document.getElementById('dnDestType').value = '';
  document.getElementById('dnDestName').value = '';
  document.getElementById('dnAddress').value = '';
  document.getElementById('dnSiteContact').value = '';

  // Populate supplier dropdown from SQL API
  let apiSuppliers = [];
  try { apiSuppliers = await api.get('/api/suppliers'); } catch (e) { console.warn('Failed to load suppliers:', e.message); }
  window._dnSuppliers = (apiSuppliers || []).filter(s => s.is_active !== false);
  const suppSelect = document.getElementById('dnSupplierSelect');
  if (suppSelect) {
    suppSelect.innerHTML = '<option value="">-- Select saved supplier --</option>' +
      window._dnSuppliers.map(s => {
        const svcLabel = (s.services || []).map(sv => sv.service_name).join(', ') || '';
        return `<option value="${s.id}">${s.supplier_name}${svcLabel ? ' (' + svcLabel + ')' : ''}</option>`;
      }).join('');
  }

  // Set default dates
  const today = new Date().toISOString().split('T')[0];
  const collEl = document.getElementById('dnCollectionDate');
  const delEl = document.getElementById('dnDeliveryDate');
  if (collEl) collEl.value = today;
  if (delEl) delEl.value = '';

  updateDnSummary();
  document.getElementById('generateDnModal').classList.add('active');
}
function closeGenerateDnModal() { document.getElementById('generateDnModal').classList.remove('active'); }

function onDnSupplierSelect() {
  const suppSelect = document.getElementById('dnSupplierSelect');
  const suppId = suppSelect?.value;
  if (!suppId) return;
  const supplier = (window._dnSuppliers || []).find(s => String(s.id) === suppId);
  if (!supplier) return;
  // Map service types to destination type
  const svcNames = (supplier.services || []).map(sv => sv.service_name.toLowerCase());
  let destType = '';
  if (svcNames.some(s => s.includes('galvan'))) destType = 'galvaniser';
  else if (svcNames.some(s => s.includes('paint'))) destType = 'painter';
  else if (svcNames.some(s => s.includes('powder'))) destType = 'powder_coater';
  else if (svcNames.some(s => s.includes('site'))) destType = 'site';
  else if (svcNames.length) destType = 'other';
  document.getElementById('dnDestType').value = destType;
  document.getElementById('dnDestName').value = supplier.supplier_name || '';
  const addrParts = [supplier.address_line1, supplier.address_line2, supplier.city, supplier.county, supplier.postcode].filter(Boolean);
  document.getElementById('dnAddress').value = addrParts.join(', ');
  document.getElementById('dnSiteContact').value = supplier.contact_name || '';
  updateDnSummary();
}

function onDnDestTypeChange() { updateDnSummary(); }

function updateDnSummary() {
  const destType = document.getElementById('dnDestType').value;
  const bomJob = getBomDataForJob(currentProject?.id, currentJob?.id);
  const allItems = (bomJob.materialLists || []).flatMap(ml => ml.items || []);
  const selected = allItems.filter(i => bomSelectedIds.has(i.id));
  const totalWeight = selected.reduce((sum, i) => sum + (i.totalWeight || i.weightPerUnit || 0), 0);
  const coatings = [...new Set(selected.map(i => i.coating).filter(Boolean))];

  let summary = `${selected.length} items · ${totalWeight.toLocaleString('en-GB')} kg total`;
  if (coatings.length) summary += ` · Coatings: ${coatings.join(', ')}`;
  if (destType) summary += ` · Destination: ${destType.replace(/_/g, ' ')}`;
  document.getElementById('dnSummary').textContent = summary;
}

async function confirmGenerateDn() {
  const destType = document.getElementById('dnDestType').value;
  const destName = document.getElementById('dnDestName').value.trim();
  const address = document.getElementById('dnAddress').value.trim();
  const siteContact = document.getElementById('dnSiteContact').value.trim();
  const collectionDate = document.getElementById('dnCollectionDate')?.value || '';
  const deliveryDate = document.getElementById('dnDeliveryDate')?.value || '';

  if (!destType) { toast('Select a destination type', 'error'); return; }
  if (!destName) { toast('Enter a destination name', 'error'); return; }

  const bomJob2 = ensureBomDataForJob(currentProject.id, currentJob.id);
  const allItems = (bomJob2.materialLists || []).flatMap(ml => ml.items || []);
  const selected = allItems.filter(i => bomSelectedIds.has(i.id));
  if (!selected.length) { toast('No items selected', 'error'); return; }

  // Generate DN number
  if (!bomJob2.deliveryNotes) bomJob2.deliveryNotes = [];
  const dnNumber = `DN-${String(bomJob2.deliveryNotes.length + 1).padStart(3, '0')}`;

  const dn = {
    id: 'dn-' + Date.now(),
    number: dnNumber,
    destination: destType,
    destinationName: destName,
    address,
    siteContact,
    collectionDate,
    deliveryDate,
    createdAt: new Date().toISOString(),
    createdBy: 'Office',
    itemIds: selected.map(i => i.id),
    totalWeight: selected.reduce((s, i) => s + (i.totalWeight || i.weightPerUnit || 0), 0),
    deliveredBy: '',
    deliveredAt: null,
    receivedBy: '',
    receivedAt: null
  };

  bomJob2.deliveryNotes.push(dn);

  // Update item statuses
  for (const item of selected) {
    item.status = destType === 'site' ? 'delivered_to_site' : 'dispatched';
    item.deliveryHistory.push({
      deliveryNoteId: dn.id,
      deliveryNoteNumber: dnNumber,
      destination: destType,
      destinationName: destName,
      createdAt: dn.createdAt,
      createdBy: dn.createdBy
    });
  }

  try {
    await saveBomData(currentProject.id);

    // Upload PDF copy to SharePoint: 07 - Deliveries / [Job Folder] / [ProjectId] - DN-NNNN.pdf
    try {
      const saved = await saveDeliveryNotePDFToSharePoint(dn, bomJob2, currentProject, currentJob);
      dn.fileId = saved.fileId;
      dn.driveId = saved.driveId;
      dn.webUrl = saved.webUrl;
      dn.fileName = saved.fileName;
      dn.savedAt = new Date().toISOString();
      await saveBomData(currentProject.id);
    } catch (pdfErr) {
      console.error('DN PDF save to SharePoint failed:', pdfErr);
      toast(`DN created but PDF save failed: ${pdfErr.message}`, 'warning');
    }

    bomSelectedIds.clear();
    closeGenerateDnModal();
    toast(`Delivery note ${dnNumber} created for ${selected.length} items`, 'success');
    renderBOM();
  } catch (e) {
    toast('Save failed: ' + e.message, 'error');
  }
}

// ── Mark Item Returned from Finishing ──
async function markItemReturned(mlId, itemId) {
  const bomJob = getBomDataForJob(currentProject?.id, currentJob?.id);
  const ml = (bomJob.materialLists || []).find(m => m.id === mlId);
  if (!ml) return;
  const item = ml.items.find(i => i.id === itemId);
  if (!item) return;

  item.status = 'returned';
  try {
    await saveBomData(currentProject.id);
    toast(`${item.mark} marked as returned`, 'success');
    renderBOM();
  } catch (e) { toast('Save failed: ' + e.message, 'error'); }
}

// ── Show Item Delivery History ──
function showItemDeliveryHistory(mlId, itemId) {
  const bomJob = getBomDataForJob(currentProject?.id, currentJob?.id);
  const ml = (bomJob.materialLists || []).find(m => m.id === mlId);
  if (!ml) return;
  const item = ml.items.find(i => i.id === itemId);
  if (!item || !item.deliveryHistory?.length) return;

  let content = `<div style="text-align:left;margin-top:12px">`;
  content += `<div style="font-size:14px;font-weight:600;margin-bottom:12px">${item.mark} — Delivery History</div>`;
  for (const dh of item.deliveryHistory) {
    const date = new Date(dh.createdAt).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'});
    const destLabel = dh.destination === 'site' ? 'Site' : (dh.destinationName || dh.destination);
    content += `<div class="dn-history-item">
      <div style="font-weight:600;color:var(--accent);min-width:60px">${dh.deliveryNoteNumber}</div>
      <div style="flex:1">
        <div style="font-weight:500">${destLabel}</div>
        <div style="color:var(--subtle);font-size:11px">${date} by ${dh.createdBy}</div>
      </div>
    </div>`;
  }
  content += `</div>`;

  document.getElementById('confirmTitle').textContent = 'Delivery History';
  document.getElementById('confirmMsg').innerHTML = content;
  document.getElementById('confirmOk').textContent = 'Close';
  document.getElementById('confirmOk').onclick = () => closeModal();
  document.getElementById('confirmModal').classList.add('active');
}

// ── Delivery Notes List (per job) ──
function renderDeliveryNotesList() {
  const bomJob = getBomDataForJob(currentProject?.id, currentJob?.id);
  const dns = bomJob.deliveryNotes || [];
  if (!dns.length) return '';

  let html = '<div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">';
  html += '<div style="font-size:13px;font-weight:600;margin-bottom:10px">Delivery Notes</div>';

  for (const dn of dns) {
    const date = new Date(dn.createdAt).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'});
    const destLabel = dn.destination === 'site' ? 'Site Delivery' :
      dn.destination === 'galvaniser' ? 'Galvaniser' :
      dn.destination === 'painter' ? 'Painter' :
      dn.destination === 'powder_coater' ? 'Powder Coater' : dn.destination;

    html += `<div class="dn-history-item">
      <div style="font-weight:700;color:var(--accent);min-width:70px;font-family:var(--font-mono)">${dn.number}</div>
      <div style="flex:1">
        <div style="font-weight:500">${dn.destinationName || destLabel}</div>
        <div style="color:var(--subtle);font-size:11px">${dn.itemIds.length} items · ${dn.totalWeight?.toLocaleString('en-GB') || 0} kg · ${date}</div>
      </div>
      <button class="btn btn-ghost" style="padding:4px 10px;font-size:11px" onclick="printDeliveryNote('${dn.id}')">&#128438; Print</button>
    </div>`;
  }
  html += '</div>';
  return html;
}

// ── Print Delivery Note (BAMA format) ──
function buildDeliveryNoteHTML(dn, bomJob, proj, job) {
  // Thin wrapper over buildDeliveryNoteHTMLCore so existing callers keep working.
  // Callers that want the logo embedded should `await loadLogoDataUri()` before calling this.
  return buildDeliveryNoteHTMLCore(dn, bomJob, proj, job);
}

// ── Upload generated Delivery Note PDF to SharePoint ──
// Saves to: [Project Folder]/07 - Deliveries/[Job Folder]/[ProjectId] - DN-NNNN.pdf
// Keeps original on re-save (conflict: fail) so reprints re-open the original.
async function saveDeliveryNotePDFToSharePoint(dn, bomJob, proj, job) {
  if (typeof html2pdf === 'undefined') throw new Error('PDF library not loaded');

  // Build HTML into a hidden container
  await loadLogoDataUri();
  const html = buildDeliveryNoteHTML(dn, bomJob, proj, job);
  const container = document.createElement('div');
  container.style.cssText = 'position:fixed;left:-10000px;top:0;width:794px;background:#fff;';
  container.innerHTML = html.replace(/^[\s\S]*?<body[^>]*>|<\/body>[\s\S]*$/g, '');
  document.body.appendChild(container);

  let pdfBlob;
  try {
    pdfBlob = await html2pdf().set({
      margin: [10, 10, 10, 10],
      filename: `${proj.id} - ${dn.number}.pdf`,
      image: { type: 'jpeg', quality: 0.95 },
      html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
      jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' }
    }).from(container).outputPdf('blob');
  } finally {
    document.body.removeChild(container);
  }

  // Find project folder on SharePoint
  const projectFolder = await findProjectFolder(proj.id);
  if (!projectFolder) throw new Error('Project folder not found on SharePoint');
  const driveId = projectFolder.parentReference?.driveId || BAMA_DRIVE_ID;

  // Ensure "07 - Deliveries" exists inside project folder
  const deliveriesFolder = await getOrCreateSubfolder(projectFolder.id, '07 - Deliveries', driveId);
  if (!deliveriesFolder) throw new Error('Could not create 07 - Deliveries folder');

  // Ensure subfolder named after the job exists
  const jobFolderName = (job && (job.folderName || job.name)) || 'Unassigned';
  const jobSubFolder = await getOrCreateSubfolder(deliveriesFolder.id, jobFolderName, driveId);
  if (!jobSubFolder) throw new Error('Could not create job delivery subfolder');

  // Upload PDF — use fail-on-conflict so existing originals are preserved
  const fileName = `${proj.id} - ${dn.number}.pdf`;
  const token = await getToken();
  const uploadUrl = `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${jobSubFolder.id}:/${encodeURIComponent(fileName)}:/content?@microsoft.graph.conflictBehavior=fail`;
  const upRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/pdf' },
    body: pdfBlob
  });
  if (upRes.status === 409) {
    // Already exists — look it up so we can still store the fileId
    const lookupRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${driveId}/items/${jobSubFolder.id}:/${encodeURIComponent(fileName)}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (!lookupRes.ok) throw new Error('DN exists on SharePoint but could not be read back');
    const existing = await lookupRes.json();
    return { fileId: existing.id, driveId, webUrl: existing.webUrl, fileName, reused: true };
  }
  if (!upRes.ok) throw new Error(`DN upload failed: ${upRes.status}`);
  const uploaded = await upRes.json();
  return { fileId: uploaded.id, driveId, webUrl: uploaded.webUrl, fileName, reused: false };
}

// ── Print / open a Delivery Note ──
// Preferred path: open the saved PDF on SharePoint (via printFile).
// Fallback: re-render HTML for DNs that were created before the SharePoint-save change.
async function printDeliveryNote(dnId) {
  const bomJob = getBomDataForJob(currentProject?.id, currentJob?.id);
  const dn = (bomJob.deliveryNotes || []).find(d => d.id === dnId);
  if (!dn) return;

  // If we have a SharePoint copy, open it
  if (dn.fileId) {
    return printFile(dn.fileId, dn.driveId);
  }

  // Fallback: render HTML directly for legacy DNs
  await loadLogoDataUri();
  const html = buildDeliveryNoteHTML(dn, bomJob, currentProject || {}, currentJob || {});
  const printWin = window.open('', '_blank');
  printWin.document.write(html);
  printWin.document.close();
  setTimeout(() => printWin.print(), 300);
}

// ── Supplier Management ──
function addSupplier() {
  if (!currentProject) return;
  const content = `
    <div style="text-align:left;margin-top:12px">
      <div style="font-size:14px;font-weight:600;margin-bottom:12px">Add Supplier / Destination</div>
      <div style="margin-bottom:10px">
        <div class="field-label">SUPPLIER NAME</div>
        <input type="text" class="field-input" id="suppName" placeholder="e.g. ABC Galvanising Ltd" style="font-size:13px">
      </div>
      <div style="margin-bottom:10px">
        <div class="field-label">TYPE</div>
        <select class="field-input" id="suppType" style="font-size:13px">
          <option value="galvaniser">Galvaniser</option>
          <option value="painter">Painter</option>
          <option value="powder_coater">Powder Coater</option>
          <option value="site">Site (Final Delivery)</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div style="margin-bottom:10px">
        <div class="field-label">ADDRESS (optional)</div>
        <input type="text" class="field-input" id="suppAddress" placeholder="Address" style="font-size:13px">
      </div>
      <div style="margin-bottom:10px">
        <div class="field-label">CONTACT (optional)</div>
        <input type="text" class="field-input" id="suppContact" placeholder="Contact name / phone" style="font-size:13px">
      </div>
    </div>
  `;
  document.getElementById('confirmTitle').textContent = 'Add Supplier';
  document.getElementById('confirmMsg').innerHTML = content;
  const okBtn = document.getElementById('confirmOk');
  okBtn.textContent = 'Add';
  okBtn.onclick = async () => {
    const name = document.getElementById('suppName').value.trim();
    if (!name) { toast('Enter a supplier name', 'error'); return; }
    const type = document.getElementById('suppType').value;
    const address = document.getElementById('suppAddress').value.trim();
    const contact = document.getElementById('suppContact').value.trim();

    ensureBomDataForJob(currentProject.id, '__settings__');
    const bomProjData = bomDataCache[currentProject.id];
    if (!bomProjData.settings) bomProjData.settings = { weldingMachines: [], suppliers: [] };
    if (!bomProjData.settings.suppliers) bomProjData.settings.suppliers = [];
    bomProjData.settings.suppliers.push({
      id: 'sup-' + Date.now(), name, type, address, contact, active: true
    });
    try {
      await saveBomData(currentProject.id);
      closeModal();
      toast(`${name} added`, 'success');
      renderBOM();
    } catch (e) { toast('Save failed: ' + e.message, 'error'); }
  };
  document.getElementById('confirmModal').classList.add('active');
  setTimeout(() => document.getElementById('suppName')?.focus(), 100);
}

async function removeSupplier(supplierId) {
  if (!currentProject) return;
  const bomProjData = bomDataCache[currentProject.id];
  if (!bomProjData?.settings?.suppliers) return;
  const supplier = bomProjData.settings.suppliers.find(s => s.id === supplierId);
  if (!supplier) return;
  supplier.active = false;
  try {
    await saveBomData(currentProject.id);
    toast(`${supplier.name} removed`, 'success');
    renderBOM();
  } catch (e) { toast('Save failed: ' + e.message, 'error'); }
}

// ── BOM Progress Calculation ──
function getBomProgress(projectId, jobId) {
  const bomJob = getBomDataForJob(projectId, jobId);
  const allItems = (bomJob.materialLists || []).flatMap(ml => ml.items || []);
  if (!allItems.length) return { total: 0, fabricated: 0, dispatched: 0, complete: 0, pct: 0 };

  const fabItems = allItems.filter(i => i.fabricated);
  const fabDone = fabItems.filter(i => i.status !== 'not_started').length;
  const dispatched = allItems.filter(i => ['dispatched','returned','delivered_to_site','complete'].includes(i.status)).length;
  const complete = allItems.filter(i => i.status === 'delivered_to_site' || i.status === 'complete').length;

  return {
    total: allItems.length,
    fabricated: fabDone,
    fabricatedTotal: fabItems.length,
    dispatched,
    complete,
    pct: fabItems.length ? Math.round(fabDone / fabItems.length * 100) : (allItems.length ? 100 : 0)
  };
}

// ═══════════════════════════════════════════
// ELEMENT 2: APPROVAL
// ═══════════════════════════════════════════
function renderApproval() {
  const container = document.getElementById('approvalContent');
  if (!container) return;
  const approval = currentJob.approval || { revisions: [], notes: [] };
  const revisions = approval.revisions || [];
  const status = document.getElementById('elementApprovalStatus');

  const latestCO = [...revisions].reverse().find(r => r.type === 'CO');
  const latestPO = [...revisions].reverse().find(r => r.type === 'PO');
  if (latestCO) {
    status.textContent = `CO${latestCO.number} Approved`;
    status.style.cssText = 'color:var(--green);background:rgba(62,207,142,.1);padding:3px 10px;border-radius:4px;font-size:11px;font-weight:600';
  } else if (latestPO) {
    if (latestPO.status === 'rejected') {
      status.textContent = `PO${latestPO.number} Not Approved`;
      status.style.cssText = 'color:var(--red);background:rgba(255,68,68,.1);padding:3px 10px;border-radius:4px;font-size:11px;font-weight:600';
    } else {
      status.textContent = `PO${latestPO.number} Sent for Approval`;
      status.style.cssText = 'color:#60a5fa;background:rgba(59,130,246,.1);padding:3px 10px;border-radius:4px;font-size:11px;font-weight:600';
    }
  } else {
    status.textContent = 'No submissions';
    status.style.cssText = 'color:var(--subtle);font-size:11px;font-weight:600';
  }

  let html = '';

  // Upload buttons (draftsman only)
  if (isDraftsman && currentJob.status !== 'closed') {
    html += '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">';
    html += `<button class="btn btn-primary" style="padding:8px 16px;font-size:12px" onclick="openUploadFileModal('approval','PO')">&#43; Upload for Approval (PO)</button>`;
    // Only show CO upload if there's an approved PO
    const hasApprovedPO = revisions.some(r => r.type === 'PO' && r.status === 'approved');
    if (hasApprovedPO) {
      html += `<button class="btn" style="padding:8px 16px;font-size:12px;background:rgba(62,207,142,.1);border:1px solid rgba(62,207,142,.3);color:var(--green)" onclick="openUploadFileModal('approval','CO')">&#43; Upload Approved (CO)</button>`;
    }
    html += '</div>';

    // Status toggles for latest PO revision (draftsman can change status)
    if (latestPO && latestPO.type === 'PO') {
      html += `<div style="display:flex;gap:8px;margin-bottom:16px;align-items:center">
        <span style="font-size:12px;color:var(--muted);font-weight:500">PO${latestPO.number} Status:</span>
        <label class="toggle-chip"><input type="radio" name="approvalStatusToggle" value="sent" ${latestPO.status==='sent'?'checked':''} style="display:none" onchange="updateApprovalStatus('${latestPO.id}','sent')"><span>&#128232; Sent</span></label>
        <label class="toggle-chip"><input type="radio" name="approvalStatusToggle" value="approved" ${latestPO.status==='approved'?'checked':''} style="display:none" onchange="updateApprovalStatus('${latestPO.id}','approved')"><span>&#9989; Approved</span></label>
        <label class="toggle-chip"><input type="radio" name="approvalStatusToggle" value="rejected" ${latestPO.status==='rejected'?'checked':''} style="display:none" onchange="updateApprovalStatus('${latestPO.id}','rejected')"><span>&#10060; Not Approved</span></label>
      </div>`;
    }
  }

  // Render revisions (latest first for visibility, CO on top)
  const sortedRevisions = [...revisions].reverse();
  const latestCOId = latestCO?.id;

  sortedRevisions.forEach(rev => {
    const isCurrent = (rev.type === 'CO' && rev.id === latestCOId);
    const isGrayed = !isDraftsman && !isCurrent;
    // PO rows always look "sent" (blue) unless explicitly rejected, even if their
    // stored status was flipped to 'approved' to unlock the CO upload.
    // CO rows always look "approved" (green).
    const badgeClass = rev.type === 'CO'
      ? 'approved'
      : rev.status === 'rejected' ? 'rejected' : 'sent';
    const labelHtml = rev.type === 'CO'
      ? '<span style="color:var(--green);background:rgba(62,207,142,.15);border:1px solid rgba(62,207,142,.45);padding:2px 10px;border-radius:4px;font-size:11px;font-weight:600;letter-spacing:.3px">Approved</span>'
      : rev.status === 'rejected'
        ? '<span style="font-size:12px;color:var(--red)">Not Approved</span>'
        : '<span style="font-size:12px;color:var(--muted)">Sent for Approval</span>';

    html += `<div class="revision-group ${isCurrent ? 'current' : ''} ${isGrayed ? 'grayed' : ''}">
      <div class="revision-header">
        <span class="revision-badge ${badgeClass}">${rev.type}${rev.number}</span>
        ${labelHtml}
        <span style="font-size:11px;color:var(--subtle);margin-left:auto">${new Date(rev.uploadedAt).toLocaleDateString('en-GB')}</span>
      </div>`;

    if (rev.files?.length > 0) {
      html += '<div style="padding:8px 14px">';
      rev.files.forEach(f => {
        if (isCurrent || isDraftsman) {
          html += renderFileRow(f, 'approval', false);
        } else {
          html += `<div class="file-row grayed"><div class="file-row-icon">&#128196;</div><div class="file-row-name">${f.name || f.fileName}</div></div>`;
        }
      });
      html += '</div>';
    }
    html += '</div>';
  });

  if (!revisions.length) {
    html += '<div style="color:var(--subtle);font-size:13px;padding:12px 0">No approval submissions yet</div>';
  }

  // Notes
  html += renderNotesSection(approval.notes, 'approval');

  container.innerHTML = html;
}

async function updateApprovalStatus(revisionId, newStatus) {
  if (!currentJob || !currentProject) return;
  const projectId = currentProject.id;
  const rev = currentJob.approval?.revisions?.find(r => r.id === revisionId);
  if (!rev) return;
  rev.status = newStatus;
  rev.statusUpdatedAt = new Date().toISOString();
  try {
    await saveDrawingsData();
    toast(`Status updated to ${newStatus === 'sent' ? 'Sent for Approval' : newStatus === 'approved' ? 'Approved' : 'Not Approved'}`, 'success');
    renderApproval();
  } catch (e) { toast('Save failed: ' + e.message, 'error'); }
}

// ═══════════════════════════════════════════
// ELEMENT 3: PARTS
// ═══════════════════════════════════════════
function renderParts() {
  const container = document.getElementById('partsContent');
  if (!container) return;
  const parts = currentJob.parts || { sections: { files: [], notes: [] }, plates: { files: [], notes: [] } };
  const secCount = parts.sections?.files?.length || 0;
  const platCount = parts.plates?.files?.length || 0;

  const status = document.getElementById('elementPartsStatus');
  if (secCount > 0 || platCount > 0) {
    status.textContent = `Sec: ${secCount} · Plt: ${platCount}`;
    status.style.cssText = 'color:var(--green);background:rgba(62,207,142,.1);padding:3px 10px;border-radius:4px;font-size:11px;font-weight:600';
  } else {
    status.textContent = 'Empty';
    status.style.cssText = 'color:var(--subtle);font-size:11px;font-weight:600';
  }

  let html = '';

  // Sections
  html += `<div class="parts-sub">
    <div class="parts-sub-header">
      <span>&#128297; Sections</span>
      ${isDraftsman && currentJob.status !== 'closed' ? `<button class="btn btn-primary" style="padding:6px 12px;font-size:11px" onclick="openUploadFileModal('parts','sections')">&#43; Upload</button>` : ''}
    </div>
    <div style="padding:12px 14px">`;
  if (secCount > 0) {
    html += parts.sections.files.map(f => renderFileRow(f, 'parts-sections')).join('');
  } else {
    html += '<div style="color:var(--subtle);font-size:12px">No section files yet</div>';
  }
  html += renderNotesSection(parts.sections?.notes || [], 'parts-sections');
  html += '</div></div>';

  // Plates
  html += `<div class="parts-sub">
    <div class="parts-sub-header">
      <span>&#128297; Plates</span>
      ${isDraftsman && currentJob.status !== 'closed' ? `<button class="btn btn-primary" style="padding:6px 12px;font-size:11px" onclick="openUploadFileModal('parts','plates')">&#43; Upload</button>` : ''}
    </div>
    <div style="padding:12px 14px">`;
  if (platCount > 0) {
    html += parts.plates.files.map(f => renderFileRow(f, 'parts-plates')).join('');
  } else {
    html += '<div style="color:var(--subtle);font-size:12px">No plate files yet</div>';
  }
  html += renderNotesSection(parts.plates?.notes || [], 'parts-plates');
  html += '</div></div>';

  container.innerHTML = html;
}

// ═══════════════════════════════════════════
// ELEMENT 4: ASSEMBLY
// ═══════════════════════════════════════════
function renderAssembly() {
  const container = document.getElementById('assemblyContent');
  if (!container) return;
  const assembly = currentJob.assembly || { tasks: [] };
  const tasks = assembly.tasks || [];

  const status = document.getElementById('elementAssemblyStatus');
  const completeTasks = tasks.filter(t => t.status === 'complete').length;
  if (tasks.length > 0) {
    status.textContent = `${completeTasks}/${tasks.length} tasks`;
    status.style.cssText = completeTasks === tasks.length
      ? 'color:var(--green);background:rgba(62,207,142,.1);padding:3px 10px;border-radius:4px;font-size:11px;font-weight:600'
      : 'color:var(--accent);background:rgba(255,107,0,.1);padding:3px 10px;border-radius:4px;font-size:11px;font-weight:600';
  } else {
    status.textContent = 'No tasks';
    status.style.cssText = 'color:var(--subtle);font-size:11px;font-weight:600';
  }

  let html = '';

  // Add task button (draftsman only)
  if (isDraftsman && currentJob.status !== 'closed') {
    html += `<button class="btn btn-primary" style="margin-bottom:12px;padding:8px 16px;font-size:12px" onclick="openCreateTaskModal()">&#43; Add Task</button>`;
  }

  // Render tasks
  tasks.forEach(task => {
    const isComplete = task.status === 'complete';
    const finishLabel = task.finishing === 'galvanising' ? '⚙️ Galvanising' : task.finishing === 'ppc' ? '⚙️ PPC' : task.finishing === 'painting' ? '🎨 Painting' : '';
    const finishColor = task.finishing === 'galvanising' ? 'rgba(99,102,241,.2);color:#818cf8' : task.finishing === 'ppc' ? 'rgba(99,102,241,.2);color:#818cf8' : task.finishing === 'painting' ? 'rgba(245,158,11,.2);color:var(--amber)' : '';

    html += `<div class="task-card ${isComplete ? 'complete' : ''}">
      <div class="task-header" onclick="this.nextElementSibling.classList.toggle('collapsed')">
        <div style="font-family:var(--font-mono);font-size:12px;font-weight:700;color:var(--accent);min-width:28px">${String(task.number).padStart(2,'0')}</div>
        <div class="task-name">${isComplete ? '&#9989; ' : ''}${task.name}</div>
        ${finishLabel ? `<span class="task-finish-badge" style="background:${finishColor}">${finishLabel}</span>` : ''}
        ${isComplete
          ? `<span style="font-size:11px;color:var(--green);font-weight:600">COMPLETE</span>`
          : `<button class="btn btn-success" style="padding:5px 12px;font-size:11px" onclick="event.stopPropagation();openCompleteTaskModal('${task.id}')">&#10003; Complete</button>`
        }
      </div>
      <div class="task-body">`;

    // Upload button for task files
    if (isDraftsman && currentJob.status !== 'closed') {
      html += `<button class="btn btn-primary" style="margin-bottom:8px;padding:6px 12px;font-size:11px" onclick="openUploadFileModal('assembly','${task.id}')">&#43; Upload File</button>`;
    }

    // Task files
    if (task.files?.length > 0) {
      html += task.files.map(f => renderFileRow(f, `assembly-${task.id}`)).join('');
    } else {
      html += '<div style="color:var(--subtle);font-size:12px;padding:4px 0">No files yet</div>';
    }

    // Task notes
    html += renderNotesSection(task.notes || [], `assembly-${task.id}`);

    if (isComplete) {
      html += `<div style="margin-top:8px;font-size:11px;color:var(--green)">Completed by ${task.completedBy} on ${new Date(task.completedAt).toLocaleDateString('en-GB')}</div>`;
    }

    html += '</div></div>';
  });

  if (!tasks.length) {
    html += '<div style="color:var(--subtle);font-size:13px;padding:12px 0">No assembly tasks yet</div>';
  }

  container.innerHTML = html;
}

// ═══════════════════════════════════════════
// ELEMENT 5: SITE INSTALLATION
// ═══════════════════════════════════════════
function renderSite() {
  const container = document.getElementById('siteContent');
  if (!container) return;
  const site = currentJob.site || { files: [], notes: [] };

  const status = document.getElementById('elementSiteStatus');
  if (site.completedAt) {
    status.textContent = 'Complete';
    status.style.cssText = 'color:var(--green);background:rgba(62,207,142,.1);padding:3px 10px;border-radius:4px;font-size:11px;font-weight:600';
  } else if (site.files?.length > 0) {
    status.textContent = `${site.files.length} file${site.files.length>1?'s':''}`;
    status.style.cssText = 'color:var(--accent);background:rgba(255,107,0,.1);padding:3px 10px;border-radius:4px;font-size:11px;font-weight:600';
  } else {
    status.textContent = 'Empty';
    status.style.cssText = 'color:var(--subtle);font-size:11px;font-weight:600';
  }

  let html = '';

  // Upload and complete buttons
  if (currentJob.status !== 'closed') {
    html += '<div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">';
    if (isDraftsman) {
      html += `<button class="btn btn-primary" style="padding:8px 16px;font-size:12px" onclick="openUploadFileModal('site')">&#43; Upload File</button>`;
    }
    if (isDraftsman) {
      html += `<button class="btn" style="padding:8px 16px;font-size:12px;background:rgba(59,130,246,.08);border:1px solid rgba(59,130,246,.25);color:#60a5fa" onclick="openDispatchPanel()">&#128666; Create Delivery Note</button>`;
    }
    if (!site.completedAt) {
      html += `<button class="btn btn-success" style="padding:8px 16px;font-size:12px" onclick="openCloseJobModal()">&#127919; Mark Site Complete &amp; Close Job</button>`;
    }
    html += '</div>';
  }

  // File list
  if (site.files?.length > 0) {
    html += site.files.map(f => renderFileRow(f, 'site')).join('');
  } else {
    html += '<div style="color:var(--subtle);font-size:13px;padding:12px 0">No site installation files yet</div>';
  }

  // Notes
  html += renderNotesSection(site.notes || [], 'site');

  // Delivery notes summary for this job (all DNs across all material lists)
  const bomJob = getBomDataForJob(currentProject?.id, currentJob?.id);
  const dns = bomJob.deliveryNotes || [];
  if (dns.length) {
    const allBomItems = (bomJob.materialLists || []).flatMap(ml => ml.items || []);
    html += '<div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--border)">';
    html += '<div style="font-size:13px;font-weight:600;margin-bottom:10px">Delivery Notes</div>';
    for (const dn of dns) {
      const date = new Date(dn.createdAt).toLocaleDateString('en-GB', {day:'numeric',month:'short',year:'numeric'});
      const destLabel = dn.destination === 'site' ? 'Site Delivery' :
        dn.destination === 'galvaniser' ? 'Galvaniser' :
        dn.destination === 'painter' ? 'Painter' :
        dn.destination === 'powder_coater' ? 'Powder Coater' : dn.destination;
      html += `<div class="dn-history-item">
        <div style="font-weight:700;color:var(--accent);min-width:70px;font-family:var(--font-mono)">${dn.number}</div>
        <div style="flex:1">
          <div style="font-weight:500">${dn.destinationName || destLabel}</div>
          <div style="color:var(--subtle);font-size:11px">${dn.itemIds.length} items · ${dn.totalWeight?.toLocaleString('en-GB') || 0} kg · ${date}</div>
        </div>
        <button class="btn btn-ghost" style="padding:4px 10px;font-size:11px" onclick="printDeliveryNote('${dn.id}')">&#128438; Print</button>
      </div>`;
    }
    html += '</div>';

    // Dispatch progress
    const totalItems = allBomItems.length;
    const siteItems = allBomItems.filter(i => i.status === 'delivered_to_site' || i.status === 'complete').length;
    const dispatchedItems = allBomItems.filter(i => ['dispatched','returned','delivered_to_site','complete'].includes(i.status)).length;
    if (totalItems > 0) {
      html += `<div style="margin-top:12px;padding:10px 14px;background:var(--surface);border:1px solid var(--border);border-radius:8px;font-size:12px">`;
      html += `<div style="display:flex;justify-content:space-between;margin-bottom:6px">`;
      html += `<span style="color:var(--muted)">Dispatch progress</span>`;
      html += `<span style="font-weight:600">${siteItems}/${totalItems} on site</span>`;
      html += `</div>`;
      html += `<div style="height:4px;background:var(--border);border-radius:2px">`;
      html += `<div style="height:100%;background:var(--green);border-radius:2px;width:${Math.round(siteItems/totalItems*100)}%;transition:width .3s"></div>`;
      html += `</div>`;
      html += `</div>`;
    }
  }

  if (site.completedAt) {
    html += `<div style="margin-top:12px;padding:12px;background:rgba(62,207,142,.08);border:1px solid rgba(62,207,142,.2);border-radius:8px;font-size:13px;color:var(--green)">
      &#127919; Site installation completed by ${site.completedBy} on ${new Date(site.completedAt).toLocaleDateString('en-GB')}
    </div>`;
  }

  container.innerHTML = html;
}

// ═══════════════════════════════════════════
// DISPATCH PANEL — Delivery Note Creation
// ═══════════════════════════════════════════
let _dispatchSelectedIds = new Set();

async function openDispatchPanel() {
  if (!currentProject || !currentJob) return;
  _dispatchSelectedIds.clear();

  const bomJob = getBomDataForJob(currentProject.id, currentJob.id);
  const allItems = (bomJob.materialLists || []).flatMap(ml => ml.items || []);
  if (!allItems.length) { toast('No BOM items found for this job — upload a BOM first', 'error'); return; }

  // Items eligible for dispatch:
  // - fabricated (welded, ready to go)
  // - not_started + non-fab (bought-in items, ready to dispatch)
  // - returned (back from finishing, can re-dispatch)
  // - dispatched (already at a service, can go to next destination or site)
  const eligible = allItems.filter(i =>
    i.status === 'fabricated' ||
    (i.status === 'not_started' && !i.fabricated) ||
    i.status === 'returned' ||
    i.status === 'dispatched'
  );

  if (!eligible.length) { toast('No items are ready for dispatch', 'error'); return; }

  // Build the modal content
  let content = '';
  content += `<div style="text-align:left;max-height:70vh;overflow-y:auto">`;
  content += `<div style="font-size:15px;font-weight:600;margin-bottom:4px">Create Delivery Note</div>`;
  content += `<div style="font-size:12px;color:var(--muted);margin-bottom:16px">${currentProject.id} — ${currentJob.name}</div>`;

  // Quick-select buttons
  content += `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">`;
  content += `<button class="btn btn-ghost" style="padding:4px 10px;font-size:11px" onclick="dispatchSelectGroup('all')">Select all eligible</button>`;
  content += `<button class="btn btn-ghost" style="padding:4px 10px;font-size:11px" onclick="dispatchSelectGroup('fabricated')">All fabricated</button>`;
  content += `<button class="btn btn-ghost" style="padding:4px 10px;font-size:11px" onclick="dispatchSelectGroup('non-fab')">All non-fab</button>`;
  content += `<button class="btn btn-ghost" style="padding:4px 10px;font-size:11px" onclick="dispatchSelectGroup('returned')">All returned</button>`;
  content += `<button class="btn btn-ghost" style="padding:4px 10px;font-size:11px" onclick="dispatchSelectGroup('none')">Clear</button>`;
  content += `</div>`;

  // Items table
  content += `<div style="max-height:280px;overflow-y:auto;border:1px solid var(--border);border-radius:8px;margin-bottom:16px">`;
  content += `<table class="bom-table" style="width:100%;font-size:11px"><thead><tr>`;
  content += `<th style="width:30px;padding:6px"><input type="checkbox" id="dispatchSelectAll" onchange="dispatchToggleAll(this.checked)"></th>`;
  content += `<th>Mark</th><th>Description</th><th>Qty</th><th>Weight</th><th>Status</th>`;
  content += `</tr></thead><tbody>`;

  for (const item of allItems) {
    const isEligible = eligible.includes(item);
    const statusLabel = item.status === 'fabricated' ? 'Fabricated' :
      item.status === 'not_started' && !item.fabricated ? 'Ready (non-fab)' :
      item.status === 'returned' ? 'Returned' :
      item.status === 'dispatched' ? 'Dispatched' :
      item.status === 'delivered_to_site' ? 'On site' :
      item.status.replace(/_/g, ' ');
    const statusColor = isEligible ? 'var(--green)' :
      item.status === 'delivered_to_site' ? 'var(--accent)' :
      item.status === 'not_started' ? 'var(--subtle)' : 'var(--muted)';
    const lastDn = item.deliveryHistory?.length ? item.deliveryHistory[item.deliveryHistory.length - 1] : null;
    const dnHint = lastDn ? ` (${lastDn.deliveryNoteNumber} \u2192 ${lastDn.destinationName || lastDn.destination})` : '';

    content += `<tr style="opacity:${isEligible ? '1' : '0.4'}">`;
    content += `<td style="padding:4px 6px"><input type="checkbox" ${isEligible ? '' : 'disabled'} data-dispatch-id="${item.id}" onchange="dispatchToggleItem('${item.id}', this.checked)"></td>`;
    content += `<td style="font-weight:600;font-family:var(--font-mono);padding:4px 8px">${item.mark}</td>`;
    content += `<td style="max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;padding:4px 8px">${item.description || item.size || ''}</td>`;
    content += `<td style="padding:4px 8px">${item.quantity || ''}</td>`;
    content += `<td style="padding:4px 8px">${item.totalWeight != null ? item.totalWeight.toLocaleString('en-GB') : ''}</td>`;
    content += `<td style="padding:4px 8px;color:${statusColor};font-size:10px">${statusLabel}${dnHint}</td>`;
    content += `</tr>`;
  }
  content += `</tbody></table></div>`;

  // Selection summary
  content += `<div id="dispatchSummary" style="padding:8px 12px;background:var(--surface);border:1px solid var(--border);border-radius:6px;font-size:12px;color:var(--muted);margin-bottom:16px">Select items above</div>`;

  // Destination form — suppliers loaded from SQL API
  let apiSuppliers = [];
  try { apiSuppliers = await api.get('/api/suppliers'); } catch (e) { console.warn('Failed to load suppliers:', e.message); }
  const activeSuppliers = (apiSuppliers || []).filter(s => s.is_active !== false);
  // Store on window for the onchange handler
  window._dispatchSuppliers = activeSuppliers;

  const suppOptions = activeSuppliers.map(s => {
    const svcLabel = (s.services || []).map(sv => sv.service_name).join(', ') || '';
    return `<option value="${s.id}">${s.supplier_name}${svcLabel ? ' (' + svcLabel + ')' : ''}</option>`;
  }).join('');

  content += `<div style="margin-bottom:10px">`;
  content += `<div class="field-label">SAVED SUPPLIER / DESTINATION</div>`;
  content += `<select class="field-input" id="dispatchSupplier" onchange="onDispatchSupplierSelect()" style="font-size:13px"><option value="">-- Select or fill in below --</option>${suppOptions}</select>`;
  content += `</div>`;

  content += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">`;
  content += `<div><div class="field-label">DESTINATION TYPE</div>`;
  content += `<select class="field-input" id="dispatchDestType" style="font-size:13px">`;
  content += `<option value="">Select...</option>`;
  content += `<option value="galvaniser">Galvaniser</option>`;
  content += `<option value="painter">Painter</option>`;
  content += `<option value="powder_coater">Powder Coater</option>`;
  content += `<option value="site">Site (Final Delivery)</option>`;
  content += `<option value="other">Other</option>`;
  content += `</select></div>`;
  content += `<div><div class="field-label">DESTINATION NAME</div>`;
  content += `<input type="text" class="field-input" id="dispatchDestName" placeholder="e.g. ABC Galvanising Ltd" style="font-size:13px"></div>`;
  content += `</div>`;

  content += `<div style="margin-bottom:10px"><div class="field-label">ADDRESS (optional)</div>`;
  content += `<input type="text" class="field-input" id="dispatchAddress" placeholder="Delivery address" style="font-size:13px"></div>`;

  content += `<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">`;
  content += `<div><div class="field-label">SITE CONTACT *</div>`;
  content += `<input type="text" class="field-input" id="dispatchContact" placeholder="Contact name" style="font-size:13px"></div>`;
  content += `<div><div class="field-label">PHONE NUMBER *</div>`;
  content += `<input type="text" class="field-input" id="dispatchPhone" placeholder="Phone number" style="font-size:13px"></div>`;
  content += `</div>`;

  content += `<div style="margin-bottom:10px"><div class="field-label">COLLECTION DATE</div>`;
  content += `<input type="date" class="field-input" id="dispatchCollDate" value="${new Date().toISOString().split('T')[0]}" style="font-size:13px"></div>`;
  content += `</div>`;

  content += `</div>`;

  document.getElementById('confirmTitle').innerHTML = '&#128230; Create Delivery Note';
  document.getElementById('confirmMsg').innerHTML = content;
  const modalEl = document.getElementById('confirmModal').querySelector('.modal');
  if (modalEl) modalEl.style.width = '620px';
  const okBtn = document.getElementById('confirmOk');
  okBtn.textContent = 'Generate & Save';
  okBtn.onclick = () => confirmDispatchDn();
  document.getElementById('confirmModal').classList.add('active');
}

function dispatchToggleItem(itemId, checked) {
  if (checked) _dispatchSelectedIds.add(itemId);
  else _dispatchSelectedIds.delete(itemId);
  updateDispatchSummary();
}

function dispatchToggleAll(checked) {
  const checkboxes = document.querySelectorAll('[data-dispatch-id]');
  checkboxes.forEach(cb => {
    if (!cb.disabled) {
      cb.checked = checked;
      if (checked) _dispatchSelectedIds.add(cb.dataset.dispatchId);
      else _dispatchSelectedIds.delete(cb.dataset.dispatchId);
    }
  });
  updateDispatchSummary();
}

function dispatchSelectGroup(group) {
  const bomJob = getBomDataForJob(currentProject?.id, currentJob?.id);
  const allItems = (bomJob.materialLists || []).flatMap(ml => ml.items || []);

  _dispatchSelectedIds.clear();
  if (group !== 'none') {
    for (const item of allItems) {
      const match =
        (group === 'all' && (item.status === 'fabricated' || (item.status === 'not_started' && !item.fabricated) || item.status === 'returned' || item.status === 'dispatched')) ||
        (group === 'fabricated' && item.status === 'fabricated') ||
        (group === 'non-fab' && item.status === 'not_started' && !item.fabricated) ||
        (group === 'returned' && item.status === 'returned');
      if (match) _dispatchSelectedIds.add(item.id);
    }
  }

  // Update checkboxes in DOM
  const checkboxes = document.querySelectorAll('[data-dispatch-id]');
  checkboxes.forEach(cb => {
    if (!cb.disabled) cb.checked = _dispatchSelectedIds.has(cb.dataset.dispatchId);
  });
  const selectAll = document.getElementById('dispatchSelectAll');
  if (selectAll) selectAll.checked = group === 'all';
  updateDispatchSummary();
}

function updateDispatchSummary() {
  const el = document.getElementById('dispatchSummary');
  if (!el) return;
  if (_dispatchSelectedIds.size === 0) { el.textContent = 'Select items above'; return; }

  const bomJob = getBomDataForJob(currentProject?.id, currentJob?.id);
  const allItems = (bomJob.materialLists || []).flatMap(ml => ml.items || []);
  const selected = allItems.filter(i => _dispatchSelectedIds.has(i.id));
  const totalWeight = selected.reduce((s, i) => s + (i.totalWeight || i.weightPerUnit || 0), 0);
  const coatings = [...new Set(selected.map(i => i.coating).filter(Boolean))];

  let text = `${selected.length} item${selected.length > 1 ? 's' : ''} selected`;
  text += ` \u00B7 ${totalWeight.toLocaleString('en-GB')} kg`;
  if (coatings.length) text += ` \u00B7 ${coatings.join(', ')}`;
  el.innerHTML = `<span style="color:var(--text);font-weight:600">${text}</span>`;
}

function onDispatchSupplierSelect() {
  const suppId = document.getElementById('dispatchSupplier')?.value;
  if (!suppId) return;
  const supplier = (window._dispatchSuppliers || []).find(s => String(s.id) === suppId);
  if (!supplier) return;
  // Map service types to destination type
  const svcNames = (supplier.services || []).map(sv => sv.service_name.toLowerCase());
  let destType = '';
  if (svcNames.some(s => s.includes('galvan'))) destType = 'galvaniser';
  else if (svcNames.some(s => s.includes('paint'))) destType = 'painter';
  else if (svcNames.some(s => s.includes('powder'))) destType = 'powder_coater';
  else if (svcNames.some(s => s.includes('site'))) destType = 'site';
  else if (svcNames.length) destType = 'other';
  document.getElementById('dispatchDestType').value = destType;
  document.getElementById('dispatchDestName').value = supplier.supplier_name || '';
  const addrParts = [supplier.address_line1, supplier.address_line2, supplier.city, supplier.county, supplier.postcode].filter(Boolean);
  document.getElementById('dispatchAddress').value = addrParts.join(', ');
  document.getElementById('dispatchContact').value = supplier.contact_name || '';
  document.getElementById('dispatchPhone').value = supplier.telephone || '';
}

async function confirmDispatchDn() {
  if (_dispatchSelectedIds.size === 0) { toast('Select items first', 'error'); return; }

  const destType = document.getElementById('dispatchDestType').value;
  const destName = document.getElementById('dispatchDestName').value.trim();
  const address = document.getElementById('dispatchAddress').value.trim();
  const siteContact = document.getElementById('dispatchContact').value.trim();
  const phone = document.getElementById('dispatchPhone').value.trim();
  const collectionDate = document.getElementById('dispatchCollDate')?.value || '';

  if (!destType) { toast('Select a destination type', 'error'); return; }
  if (!destName) { toast('Enter a destination name', 'error'); return; }
  if (!siteContact) { toast('Site contact is required', 'error'); return; }
  if (!phone) { toast('Phone number is required', 'error'); return; }

  const bomJob2 = ensureBomDataForJob(currentProject.id, currentJob.id);
  const allItems = (bomJob2.materialLists || []).flatMap(ml => ml.items || []);
  const selected = allItems.filter(i => _dispatchSelectedIds.has(i.id));
  if (!selected.length) { toast('No items selected', 'error'); return; }

  // Generate DN number
  if (!bomJob2.deliveryNotes) bomJob2.deliveryNotes = [];
  const dnNumber = `DN-${String(bomJob2.deliveryNotes.length + 1).padStart(3, '0')}`;

  const dn = {
    id: 'dn-' + Date.now(),
    number: dnNumber,
    destination: destType,
    destinationName: destName,
    address,
    siteContact,
    phone,
    collectionDate,
    deliveryDate: '',
    createdAt: new Date().toISOString(),
    createdBy: isDraftsman ? 'Draftsman' : 'Workshop',
    itemIds: selected.map(i => i.id),
    totalWeight: selected.reduce((s, i) => s + (i.totalWeight || i.weightPerUnit || 0), 0),
    deliveredBy: '',
    deliveredAt: null,
    receivedBy: '',
    receivedAt: null
  };

  bomJob2.deliveryNotes.push(dn);

  // Update item statuses
  for (const item of selected) {
    item.status = destType === 'site' ? 'delivered_to_site' : 'dispatched';
    if (!item.deliveryHistory) item.deliveryHistory = [];
    item.deliveryHistory.push({
      deliveryNoteId: dn.id,
      deliveryNoteNumber: dnNumber,
      destination: destType,
      destinationName: destName,
      createdAt: dn.createdAt,
      createdBy: dn.createdBy
    });
  }

  try {
    await saveBomData(currentProject.id);

    // Upload PDF copy to SharePoint: 07 - Deliveries / [Job Folder] / [ProjectId] - DN-NNNN.pdf
    try {
      const saved = await saveDeliveryNotePDFToSharePoint(dn, bomJob2, currentProject, currentJob);
      dn.fileId = saved.fileId;
      dn.driveId = saved.driveId;
      dn.webUrl = saved.webUrl;
      dn.fileName = saved.fileName;
      dn.savedAt = new Date().toISOString();
      await saveBomData(currentProject.id);
    } catch (pdfErr) {
      console.error('DN PDF save to SharePoint failed:', pdfErr);
      toast(`DN created but PDF save failed: ${pdfErr.message}`, 'warning');
    }

    _dispatchSelectedIds.clear();
    closeModal();
    toast(`${dnNumber} created \u2014 ${selected.length} items to ${destName}`, 'success');
    renderBOM();
    renderSite();
  } catch (e) {
    toast('Save failed: ' + e.message, 'error');
  }
}

// ═══════════════════════════════════════════
// SHARED: FILE ROW RENDERER
// ═══════════════════════════════════════════
function renderFileRow(file, context, showDelete) {
  if (showDelete === undefined) showDelete = isDraftsman && currentJob?.status !== 'closed';
  const dateStr = file.uploadedAt ? new Date(file.uploadedAt).toLocaleDateString('en-GB') : '';
  return `
    <div class="file-row">
      <div class="file-row-icon">&#128196;</div>
      <div class="file-row-name">${file.name || file.fileName}</div>
      <div class="file-row-date">${dateStr}</div>
      <div class="file-row-actions">
        ${file.webUrl ? `<a href="${file.webUrl}" target="_blank" class="btn btn-ghost" style="padding:4px 10px;font-size:11px;text-decoration:none">&#128065; View</a>` : ''}
        <button class="btn btn-ghost" style="padding:4px 10px;font-size:11px" onclick="printFile('${file.fileId}','${file.driveId || ''}')">&#128438; Print</button>
        ${showDelete ? `<button class="btn" style="padding:4px 10px;font-size:11px;background:rgba(255,68,68,.1);border:1px solid rgba(255,68,68,.3);color:var(--red)" onclick="confirmDeleteFile('${context}','${file.id}')">&#128465;</button>` : ''}
      </div>
    </div>
  `;
}

// ═══════════════════════════════════════════
// SHARED: NOTES SECTION RENDERER
// ═══════════════════════════════════════════
function renderNotesSection(notes, context) {
  notes = notes || [];
  const draftsmanNotes = notes.filter(n => n.type === 'draftsman');
  const workshopNotes = notes.filter(n => n.type === 'workshop');
  const employees = (state.timesheetData.employees || []).filter(e => e.active !== false);

  let html = '<div class="notes-section" style="margin-top:12px">';

  // Draftsman notes
  html += '<div>';
  html += '<div class="notes-col-title draftsman">&#9998; Draftsman Notes</div>';
  if (draftsmanNotes.length) {
    html += draftsmanNotes.map(n => `
      <div class="note-item draftsman-note">
        <div class="note-author draftsman-note">${n.author} <span class="note-time">${new Date(n.timestamp).toLocaleDateString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</span></div>
        <div class="note-text">${n.text}</div>
      </div>`).join('');
  } else {
    html += '<div style="color:var(--subtle);font-size:12px;padding:8px 0">No draftsman notes</div>';
  }
  if (isDraftsman) {
    html += `<div class="add-note-row" style="margin-top:8px">
      <input type="text" class="field-input" id="dn-${context}" placeholder="Add draftsman note..." style="font-size:12px;padding:7px 10px">
      <button class="btn btn-primary" style="padding:7px 12px;font-size:12px;white-space:nowrap" onclick="addElementNote('${context}','draftsman')">Add</button>
    </div>`;
  }
  html += '</div>';

  // Workshop notes
  html += '<div>';
  html += '<div class="notes-col-title workshop">&#128296; Workshop Notes</div>';
  if (workshopNotes.length) {
    html += workshopNotes.map(n => `
      <div class="note-item workshop-note">
        <div class="note-author workshop-note">${n.author} <span class="note-time">${new Date(n.timestamp).toLocaleDateString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</span></div>
        <div class="note-text">${n.text}</div>
      </div>`).join('');
  } else {
    html += '<div style="color:var(--subtle);font-size:12px;padding:8px 0">No workshop notes</div>';
  }
  html += `<div class="add-note-row" style="margin-top:8px">
    <input type="text" class="field-input" id="wn-${context}" placeholder="Add workshop note..." style="font-size:12px;padding:7px 10px">
    <select class="field-input" id="wna-${context}" style="font-size:12px;padding:7px 10px;max-width:130px">
      <option value="">Your name...</option>
      ${employees.map(e => `<option value="${e.name}">${e.name}</option>`).join('')}
    </select>
    <button class="btn btn-success" style="padding:7px 12px;font-size:12px;white-space:nowrap" onclick="addElementNote('${context}','workshop')">Add</button>
  </div>`;
  html += '</div>';

  html += '</div>';
  return html;
}

// ═══════════════════════════════════════════
// ADD NOTES (Element-level)
// ═══════════════════════════════════════════
async function addElementNote(context, type) {
  if (!currentJob || !currentProject) return;
  const inputEl = document.getElementById(`${type === 'draftsman' ? 'dn' : 'wn'}-${context}`);
  const text = inputEl?.value?.trim();
  if (!text) { toast('Please type a note', 'error'); return; }

  let author = '';
  if (type === 'draftsman') {
    author = 'Draftsman';
  } else {
    const authorEl = document.getElementById(`wna-${context}`);
    author = authorEl?.value;
    if (!author) { toast('Please select your name', 'error'); return; }
  }

  const note = {
    id: Date.now().toString(),
    type,
    author,
    text,
    timestamp: new Date().toISOString()
  };

  // Find the right notes array based on context
  const notesArr = getNotesArray(context);
  if (!notesArr) { toast('Error: could not find notes location', 'error'); return; }
  notesArr.push(note);

  try {
    await saveDrawingsData();
    inputEl.value = '';
    toast('Note added', 'success');
    renderAllElements();
  } catch (e) { toast('Save failed: ' + e.message, 'error'); }
}

function getNotesArray(context) {
  if (!currentJob) return null;
  if (context === 'bom') return currentJob.bom?.notes;
  if (context === 'approval') return currentJob.approval?.notes;
  if (context === 'parts-sections') return currentJob.parts?.sections?.notes;
  if (context === 'parts-plates') return currentJob.parts?.plates?.notes;
  if (context === 'site') return currentJob.site?.notes;
  // Assembly task notes
  if (context.startsWith('assembly-')) {
    const taskId = context.replace('assembly-', '');
    const task = currentJob.assembly?.tasks?.find(t => t.id === taskId);
    return task?.notes;
  }
  return null;
}

// ═══════════════════════════════════════════
// UPLOAD FILE MODAL (shared across all elements)
// ═══════════════════════════════════════════
function openUploadFileModal(element, subElement) {
  if (!currentJob || !currentProject) return;
  _uploadFiles = [];
  _uploadContext = {
    element,
    subElement: subElement || null,
    jobId: currentJob.id,
    projectId: currentProject.id
  };

  const modal = document.getElementById('uploadFileModal');
  document.getElementById('uploadFileName').value = '';
  document.getElementById('uploadFileZoneText').textContent = 'Click or drag files here';
  document.getElementById('uploadFileList').innerHTML = '';
  document.getElementById('uploadFileProgress').style.display = 'none';
  document.getElementById('uploadFileBtn').disabled = false;
  document.getElementById('uploadFileInput').value = '';

  // Title & context
  let title = 'Upload File';
  let ctx = `${currentJob.name}`;
  if (element === 'bom') { title = 'Upload BOM File'; }
  else if (element === 'approval') {
    title = subElement === 'CO' ? 'Upload Approved Drawing (CO)' : 'Upload for Approval (PO)';
  }
  else if (element === 'parts') {
    title = subElement === 'sections' ? 'Upload Sections File' : 'Upload Plates File';
  }
  else if (element === 'assembly') { title = 'Upload Assembly File'; }
  else if (element === 'site') { title = 'Upload Site Installation File'; }

  document.getElementById('uploadFileTitle').textContent = title;
  document.getElementById('uploadFileContext').textContent = ctx;

  // Show/hide approval section
  document.getElementById('uploadApprovalSection').style.display =
    (element === 'approval') ? 'block' : 'none';

  modal.classList.add('active');
}

function closeUploadFileModal() {
  document.getElementById('uploadFileModal').classList.remove('active');
  _uploadFiles = [];
  _uploadContext = null;
}

function onUploadFilesSelected() {
  const input = document.getElementById('uploadFileInput');
  _uploadFiles = Array.from(input.files);
  updateUploadFileListUI();
}

function updateUploadFileListUI() {
  const container = document.getElementById('uploadFileList');
  const nameInput = document.getElementById('uploadFileName');

  if (_uploadFiles.length === 0) {
    container.innerHTML = '';
    document.getElementById('uploadFileZoneText').textContent = 'Click or drag files here';
    return;
  }

  if (_uploadFiles.length === 1) {
    document.getElementById('uploadFileZoneText').textContent = `&#128196; ${_uploadFiles[0].name} (${(_uploadFiles[0].size/1024).toFixed(0)}KB)`;
    if (!nameInput.value) {
      nameInput.value = _uploadFiles[0].name.replace(/\.[^.]+$/, '');
    }
  } else {
    document.getElementById('uploadFileZoneText').textContent = `${_uploadFiles.length} files selected`;
  }

  container.innerHTML = _uploadFiles.map((f, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:6px;margin-bottom:4px">
      <span style="flex:1">&#128196; ${f.name} <span style="color:var(--subtle)">(${(f.size/1024).toFixed(0)}KB)</span></span>
      <button class="btn btn-ghost" style="padding:2px 8px;font-size:10px;color:var(--red)" onclick="removeUploadFile(${i})">&#10005;</button>
    </div>
  `).join('');
}

function removeUploadFile(index) {
  _uploadFiles.splice(index, 1);
  updateUploadFileListUI();
}

function updateApprovalChips() {
  document.querySelectorAll('#uploadApprovalSection .toggle-chip').forEach(chip => {
    chip.classList.toggle('active', chip.querySelector('input').checked);
  });
}

async function confirmUploadFile() {
  if (!_uploadFiles.length) { toast('Please select a file', 'error'); return; }
  if (!_uploadContext) return;

  // Pre-check token before starting upload to avoid mid-upload redirect
  const preToken = AUTH.getStoredToken();
  if (!preToken) {
    toast('Session expired — please log in again. Your draftsman session will be preserved.', 'error');
    return;
  }

  const { element, subElement, jobId, projectId } = _uploadContext;
  const projData = drawingsData.projects[projectId];
  const job = projData?.jobs?.find(j => j.id === jobId);
  if (!job) { toast('Job not found', 'error'); return; }

  document.getElementById('uploadFileProgress').style.display = 'block';
  document.getElementById('uploadFileBtn').disabled = true;

  try {
    const token = await getToken();
    // Determine the SharePoint target folder path
    let targetFolderId = job.spFolderId;
    const driveId = job.spDriveId || BAMA_DRIVE_ID;

    document.getElementById('uploadFileProgressBar').style.width = '15%';
    document.getElementById('uploadFileProgressText').textContent = 'Finding target folder...';

    // Navigate to the right subfolder
    if (element === 'bom') {
      const folder = await getOrCreateSubfolder(targetFolderId, ELEMENT_FOLDERS.bom, driveId);
      targetFolderId = folder.id;
    } else if (element === 'approval') {
      const approvalFolder = await getOrCreateSubfolder(targetFolderId, ELEMENT_FOLDERS.approval, driveId);
      // Determine PO/CO number
      const revisions = job.approval?.revisions || [];
      let folderName;
      if (subElement === 'CO') {
        const coCount = revisions.filter(r => r.type === 'CO').length;
        folderName = `CO${coCount + 1}`;
      } else {
        const poCount = revisions.filter(r => r.type === 'PO').length;
        folderName = `PO${poCount + 1}`;
      }
      const revFolder = await createFolderInDrive(approvalFolder.id, folderName, driveId);
      targetFolderId = revFolder.id;
    } else if (element === 'parts') {
      const partsFolder = await getOrCreateSubfolder(targetFolderId, ELEMENT_FOLDERS.parts, driveId);
      const subName = subElement === 'sections' ? PARTS_SUBFOLDERS[0] : PARTS_SUBFOLDERS[1];
      const subFolder = await getOrCreateSubfolder(partsFolder.id, subName, driveId);
      targetFolderId = subFolder.id;
    } else if (element === 'assembly') {
      const asmFolder = await getOrCreateSubfolder(targetFolderId, ELEMENT_FOLDERS.assembly, driveId);
      // subElement is taskId — find or create task folder
      const task = job.assembly?.tasks?.find(t => t.id === subElement);
      if (task) {
        const taskFolderName = `${String(task.number).padStart(2,'0')} - ${task.name}`;
        const taskFolder = await getOrCreateSubfolder(asmFolder.id, taskFolderName, driveId);
        targetFolderId = taskFolder.id;
      } else {
        targetFolderId = asmFolder.id;
      }
    } else if (element === 'site') {
      const folder = await getOrCreateSubfolder(targetFolderId, ELEMENT_FOLDERS.site, driveId);
      targetFolderId = folder.id;
    }

    // Upload files
    const uploadedFiles = [];
    for (let i = 0; i < _uploadFiles.length; i++) {
      const file = _uploadFiles[i];
      const pct = 20 + Math.round((i / _uploadFiles.length) * 65);
      document.getElementById('uploadFileProgressBar').style.width = `${pct}%`;
      document.getElementById('uploadFileProgressText').textContent = `Uploading ${i + 1} of ${_uploadFiles.length}...`;

      const arrayBuffer = await file.arrayBuffer();
      const uploaded = await uploadFileToFolder(targetFolderId, file.name, arrayBuffer, file.type, driveId);
      uploadedFiles.push({
        id: Date.now().toString() + '-' + i,
        name: document.getElementById('uploadFileName').value.trim() || file.name.replace(/\.[^.]+$/, ''),
        fileName: file.name,
        fileId: uploaded.id,
        driveId: uploaded.parentReference?.driveId || driveId,
        webUrl: uploaded.webUrl,
        uploadedAt: new Date().toISOString()
      });
    }

    document.getElementById('uploadFileProgressBar').style.width = '90%';
    document.getElementById('uploadFileProgressText').textContent = 'Saving data...';

    // Save to drawingsData
    if (element === 'bom') {
      if (!job.bom) job.bom = { files: [], notes: [] };
      job.bom.files.push(...uploadedFiles);
    } else if (element === 'approval') {
      if (!job.approval) job.approval = { revisions: [], notes: [] };
      const revisions = job.approval.revisions;
      const type = subElement || 'PO';
      const num = revisions.filter(r => r.type === type).length + 1;
      const approvalStatus = document.querySelector('input[name="approvalStatus"]:checked')?.value || 'sent';
      revisions.push({
        id: Date.now().toString(),
        type,
        number: num,
        status: type === 'CO' ? 'approved' : approvalStatus,
        files: uploadedFiles,
        uploadedAt: new Date().toISOString()
      });
    } else if (element === 'parts') {
      if (!job.parts) job.parts = { sections: { files: [], notes: [] }, plates: { files: [], notes: [] } };
      const target = subElement === 'sections' ? job.parts.sections : job.parts.plates;
      if (!target.files) target.files = [];
      target.files.push(...uploadedFiles);
    } else if (element === 'assembly') {
      const task = job.assembly?.tasks?.find(t => t.id === subElement);
      if (task) {
        if (!task.files) task.files = [];
        task.files.push(...uploadedFiles);
      }
    } else if (element === 'site') {
      if (!job.site) job.site = { files: [], notes: [] };
      job.site.files.push(...uploadedFiles);
    }

    await saveDrawingsData();

    document.getElementById('uploadFileProgressBar').style.width = '100%';
    document.getElementById('uploadFileProgressText').textContent = 'Done!';

    setTimeout(() => {
      closeUploadFileModal();
      toast(`${uploadedFiles.length} file${uploadedFiles.length>1?'s':''} uploaded`, 'success');
      renderAllElements();
    }, 400);

  } catch (e) {
    console.error('Upload error:', e);
    toast(`Upload failed: ${e.message}`, 'error');
    document.getElementById('uploadFileProgress').style.display = 'none';
  } finally {
    document.getElementById('uploadFileBtn').disabled = false;
  }
}

// ═══════════════════════════════════════════
// DELETE FILE
// ═══════════════════════════════════════════
function confirmDeleteFile(context, fileId) {
  if (!currentJob || !currentProject) return;
  const filesArr = getFilesArray(context);
  const file = filesArr?.find(f => f.id === fileId);
  if (!file) return;

  showConfirm('Delete File', `Delete "${file.name || file.fileName}"? This cannot be undone.`, async () => {
    try {
      setLoading(true);
      // Delete from SharePoint
      if (file.fileId) {
        await deleteFileFromDrive(file.fileId, file.driveId);
      }
      // Remove from data
      const idx = filesArr.indexOf(file);
      if (idx >= 0) filesArr.splice(idx, 1);
      await saveDrawingsData();
      toast('File deleted', 'success');
      renderAllElements();
    } catch (e) { toast('Delete failed: ' + e.message, 'error'); }
    finally { setLoading(false); }
  });
}

function getFilesArray(context) {
  if (!currentJob) return null;
  if (context === 'bom') return currentJob.bom?.files;
  if (context === 'parts-sections') return currentJob.parts?.sections?.files;
  if (context === 'parts-plates') return currentJob.parts?.plates?.files;
  if (context === 'site') return currentJob.site?.files;
  if (context.startsWith('assembly-')) {
    const taskId = context.replace('assembly-', '');
    const task = currentJob.assembly?.tasks?.find(t => t.id === taskId);
    return task?.files;
  }
  // Approval files are inside revisions, handled separately
  return null;
}

// ═══════════════════════════════════════════
// PRINT FILE
// ═══════════════════════════════════════════
async function printFile(fileId, driveId) {
  if (!fileId) { toast('No file to print', 'error'); return; }
  try {
    setLoading(true);
    const token = await getToken();
    const drive = driveId || BAMA_DRIVE_ID;
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${drive}/items/${fileId}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error('File not found');
    const meta = await res.json();
    const downloadUrl = meta['@microsoft.graph.downloadUrl'];
    if (downloadUrl) {
      const pdfRes = await fetch(downloadUrl);
      const blob = await pdfRes.blob();
      const blobUrl = URL.createObjectURL(blob);
      const printWin = window.open(blobUrl);
      if (printWin) {
        printWin.onload = () => { printWin.print(); };
      }
    } else if (meta.webUrl) {
      window.open(meta.webUrl, '_blank');
    }
  } catch (e) {
    toast('Print failed: ' + e.message, 'error');
  } finally {
    setLoading(false);
  }
}

// ═══════════════════════════════════════════
// ASSEMBLY: CREATE TASK
// ═══════════════════════════════════════════
function openCreateTaskModal() {
  if (!isDraftsman || !currentJob || !currentProject) return;
  document.getElementById('createTaskContext').textContent = `Job: ${currentJob.name}`;
  document.getElementById('createTaskName').value = '';
  document.getElementById('taskFileZoneText').textContent = 'Click or drag files here';
  document.getElementById('taskFileList').innerHTML = '';
  document.getElementById('createTaskProgress').style.display = 'none';
  document.getElementById('createTaskBtn').disabled = false;
  document.getElementById('taskFileInput').value = '';
  _taskFiles = [];
  // Reset finishing chips
  document.querySelector('input[name="newTaskFinishing"][value="none"]').checked = true;
  updateNewTaskFinishingChips();
  document.getElementById('createTaskModal').classList.add('active');
  setTimeout(() => document.getElementById('createTaskName').focus(), 100);
}

function closeCreateTaskModal() {
  document.getElementById('createTaskModal').classList.remove('active');
  _taskFiles = [];
}

function onTaskFilesSelected() {
  _taskFiles = Array.from(document.getElementById('taskFileInput').files);
  if (_taskFiles.length === 1) {
    document.getElementById('taskFileZoneText').textContent = `&#128196; ${_taskFiles[0].name}`;
  } else if (_taskFiles.length > 1) {
    document.getElementById('taskFileZoneText').textContent = `${_taskFiles.length} files selected`;
  }
  document.getElementById('taskFileList').innerHTML = _taskFiles.map((f, i) => `
    <div style="display:flex;align-items:center;gap:8px;padding:6px 8px;font-size:12px;background:var(--surface);border:1px solid var(--border);border-radius:6px;margin-bottom:4px">
      <span style="flex:1">&#128196; ${f.name}</span>
    </div>
  `).join('');
}

function updateNewTaskFinishingChips() {
  document.querySelectorAll('#createTaskModal .toggle-chip').forEach(chip => {
    chip.classList.toggle('active', chip.querySelector('input')?.checked);
  });
}

async function createAssemblyTask() {
  const taskName = document.getElementById('createTaskName').value.trim();
  if (!taskName) { toast('Please enter a task name', 'error'); return; }

  const finishing = document.querySelector('input[name="newTaskFinishing"]:checked')?.value || 'none';
  const projectId = currentProject.id;
  const job = currentJob;

  if (!job.assembly) job.assembly = { tasks: [] };
  const tasks = job.assembly.tasks;
  const taskNumber = tasks.length + 1;
  const taskFolderName = `${String(taskNumber).padStart(2,'0')} - ${taskName}`;

  document.getElementById('createTaskProgress').style.display = 'block';
  document.getElementById('createTaskBtn').disabled = true;
  document.getElementById('createTaskProgressBar').style.width = '20%';
  document.getElementById('createTaskProgressText').textContent = 'Creating task folder...';

  try {
    const driveId = job.spDriveId || BAMA_DRIVE_ID;
    // Create folder inside 04 - Assembly
    const asmFolder = await getOrCreateSubfolder(job.spFolderId, ELEMENT_FOLDERS.assembly, driveId);
    const taskFolder = await createFolderInDrive(asmFolder.id, taskFolderName, driveId);

    // Upload files if any
    const uploadedFiles = [];
    if (_taskFiles.length > 0) {
      for (let i = 0; i < _taskFiles.length; i++) {
        const pct = 30 + Math.round((i / _taskFiles.length) * 50);
        document.getElementById('createTaskProgressBar').style.width = `${pct}%`;
        document.getElementById('createTaskProgressText').textContent = `Uploading ${i + 1} of ${_taskFiles.length}...`;
        const file = _taskFiles[i];
        const arrayBuffer = await file.arrayBuffer();
        const uploaded = await uploadFileToFolder(taskFolder.id, file.name, arrayBuffer, file.type, driveId);
        uploadedFiles.push({
          id: Date.now().toString() + '-' + i,
          name: file.name.replace(/\.[^.]+$/, ''),
          fileName: file.name,
          fileId: uploaded.id,
          driveId: uploaded.parentReference?.driveId || driveId,
          webUrl: uploaded.webUrl,
          uploadedAt: new Date().toISOString()
        });
      }
    }

    document.getElementById('createTaskProgressBar').style.width = '90%';
    document.getElementById('createTaskProgressText').textContent = 'Saving...';

    const newTask = {
      id: Date.now().toString(),
      number: taskNumber,
      name: taskName,
      folderName: taskFolderName,
      spFolderId: taskFolder?.id,
      finishing,
      status: 'open',
      createdAt: new Date().toISOString(),
      files: uploadedFiles,
      notes: []
    };

    tasks.push(newTask);
    await saveDrawingsData();

    document.getElementById('createTaskProgressBar').style.width = '100%';
    setTimeout(() => {
      closeCreateTaskModal();
      toast(`Task "${taskName}" created`, 'success');
      renderAssembly();
    }, 400);

  } catch (e) {
    console.error('Create task error:', e);
    toast(`Failed: ${e.message}`, 'error');
    document.getElementById('createTaskProgress').style.display = 'none';
  } finally {
    document.getElementById('createTaskBtn').disabled = false;
  }
}

// ═══════════════════════════════════════════
// ASSEMBLY: COMPLETE TASK
// ═══════════════════════════════════════════
function openCompleteTaskModal(taskId) {
  const task = currentJob?.assembly?.tasks?.find(t => t.id === taskId);
  if (!task) return;
  _pendingCompleteTask = task;

  const isPainting = task.finishing === 'painting';
  const finishLabel = task.finishing === 'galvanising' ? 'Galvanising' : task.finishing === 'ppc' ? 'PPC (Powder Coat)' : task.finishing === 'painting' ? 'Painting' : '';

  document.getElementById('completeTaskIcon').textContent = isPainting ? '🎨' : '✅';
  document.getElementById('completeTaskTitle').textContent = `Complete "${task.name}"?`;
  document.getElementById('completeTaskMessage').textContent = finishLabel
    ? `This task requires ${finishLabel}. ${isPainting ? 'Confirm painting is done before completing.' : `Draftsman will be notified to organise ${finishLabel.toLowerCase()}.`}`
    : 'Mark this assembly task as complete.';

  // Painting check
  document.getElementById('paintingCheckSection').style.display = isPainting ? 'block' : 'none';
  const paintIcon = document.getElementById('paintingCheckIcon');
  paintIcon.textContent = '';
  paintIcon.style.background = 'var(--card)';
  paintIcon.style.borderColor = 'var(--border)';

  // Person select
  const sel = document.getElementById('completeTaskPerson');
  sel.innerHTML = '<option value="">Select your name...</option>';
  (state.timesheetData.employees || []).filter(e => e.active !== false).forEach(e => {
    sel.innerHTML += `<option value="${e.name}">${e.name}</option>`;
  });
  sel.onchange = checkCompleteTaskReady;

  // Reset confirm button
  const btn = document.getElementById('completeTaskConfirmBtn');
  btn.disabled = true; btn.style.opacity = '.4'; btn.style.cursor = 'not-allowed';

  document.getElementById('completeTaskModal').classList.add('active');
}

function closeCompleteTaskModal() {
  document.getElementById('completeTaskModal').classList.remove('active');
  _pendingCompleteTask = null;
}

function togglePaintingCheck() {
  const icon = document.getElementById('paintingCheckIcon');
  const isChecked = icon.textContent === '✓';
  if (isChecked) {
    icon.textContent = ''; icon.style.background = 'var(--card)'; icon.style.borderColor = 'var(--border)';
  } else {
    icon.textContent = '✓'; icon.style.background = 'var(--green)'; icon.style.borderColor = 'var(--green)'; icon.style.color = '#fff';
  }
  checkCompleteTaskReady();
}

function checkCompleteTaskReady() {
  const person = document.getElementById('completeTaskPerson').value;
  const isPainting = _pendingCompleteTask?.finishing === 'painting';
  const paintingOk = !isPainting || document.getElementById('paintingCheckIcon').textContent === '✓';
  const ready = !!person && paintingOk;
  const btn = document.getElementById('completeTaskConfirmBtn');
  btn.disabled = !ready; btn.style.opacity = ready ? '1' : '.4'; btn.style.cursor = ready ? 'pointer' : 'not-allowed';
}

async function confirmCompleteTask() {
  if (!_pendingCompleteTask || !currentJob || !currentProject) return;
  const task = _pendingCompleteTask;
  const person = document.getElementById('completeTaskPerson').value;

  task.status = 'complete';
  task.completedAt = new Date().toISOString();
  task.completedBy = person;

  // Add completion note
  if (!task.notes) task.notes = [];
  const finishLabel = task.finishing === 'galvanising' ? 'galvanising' : task.finishing === 'ppc' ? 'PPC' : task.finishing === 'painting' ? 'painting (on site)' : '';
  task.notes.push({
    id: Date.now().toString(), type: 'workshop', author: person,
    text: `✅ Task completed${finishLabel ? ` — ready for ${finishLabel}` : ''}`,
    timestamp: new Date().toISOString()
  });

  try {
    setLoading(true);
    await saveDrawingsData();
    closeCompleteTaskModal();
    toast(`Task "${task.name}" completed`, 'success');
    renderAssembly();

    // Email notifications
    await sendTaskCompletionEmail(task);
  } catch (e) { toast('Save failed: ' + e.message, 'error'); }
  finally { setLoading(false); }
}

async function sendTaskCompletionEmail(task) {
  const settings = state.timesheetData.settings || {};
  const draftsmanEmail = settings.draftsmanEmail || 'daniel@bamafabrication.co.uk';
  const taskEmailList = settings.taskCompletionEmails || '';
  const recipients = [draftsmanEmail];
  if (taskEmailList) {
    taskEmailList.split(',').map(e => e.trim()).filter(Boolean).forEach(e => {
      if (!recipients.includes(e)) recipients.push(e);
    });
  }

  const finishLabel = task.finishing === 'galvanising' ? 'Galvanising' : task.finishing === 'ppc' ? 'PPC (Powder Coat)' : task.finishing === 'painting' ? 'Painting (on site)' : 'No finishing';
  const proj = currentProject;

  try {
    const token = await getToken();
    await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: {
        subject: `Task Completed — ${task.name} (${proj?.id} / ${currentJob?.name})`,
        body: { contentType: 'HTML', content: `
          <h2 style="color:#ff6b00;font-family:sans-serif">BAMA FABRICATION</h2>
          <h3 style="font-family:sans-serif">Assembly Task Completed</h3>
          <table style="font-family:sans-serif;font-size:13px">
            <tr><td style="padding:6px 16px 6px 0;color:#888">Task</td><td><b>${task.name}</b></td></tr>
            <tr><td style="padding:6px 16px 6px 0;color:#888">Project</td><td>${proj?.id} — ${proj?.name}</td></tr>
            <tr><td style="padding:6px 16px 6px 0;color:#888">Job</td><td>${currentJob?.name}</td></tr>
            <tr><td style="padding:6px 16px 6px 0;color:#888">Finishing</td><td><b>${finishLabel}</b></td></tr>
            <tr><td style="padding:6px 16px 6px 0;color:#888">Completed by</td><td>${task.completedBy}</td></tr>
            <tr><td style="padding:6px 16px 6px 0;color:#888">Date/Time</td><td>${new Date().toLocaleString('en-GB')}</td></tr>
          </table>
          ${task.finishing && task.finishing !== 'none' ? `<p style="margin-top:16px;font-family:sans-serif;font-size:13px;padding:12px;border-radius:8px;background:#f0f0f0"><b>Action required:</b> Please organise ${finishLabel.toLowerCase()} for this task.</p>` : ''}
          <p style="font-family:sans-serif;font-size:11px;color:#aaa;margin-top:12px"><a href="https://proud-dune-0dee63110.2.azurestaticapps.net" style="color:#ff6b00">Open BAMA Workshop</a></p>
        `},
        toRecipients: recipients.map(e => ({ emailAddress: { address: e } }))
      }, saveToSentItems: false })
    });
  } catch (e) { console.warn('Task email failed:', e.message); }
}

// ═══════════════════════════════════════════
// SITE INSTALLATION: CLOSE JOB
// ═══════════════════════════════════════════
function openCloseJobModal() {
  if (!currentJob || !currentProject) return;
  _pendingCloseJob = currentJob;
  document.getElementById('closeJobMessage').textContent = `This will mark site installation as complete and close the job "${currentJob.name}". Notifications will be sent.`;

  const sel = document.getElementById('closeJobPerson');
  sel.innerHTML = '<option value="">Select your name...</option>';
  (state.timesheetData.employees || []).filter(e => e.active !== false).forEach(e => {
    sel.innerHTML += `<option value="${e.name}">${e.name}</option>`;
  });
  sel.onchange = () => {
    const ready = !!sel.value;
    const btn = document.getElementById('closeJobConfirmBtn');
    btn.disabled = !ready; btn.style.opacity = ready ? '1' : '.4'; btn.style.cursor = ready ? 'pointer' : 'not-allowed';
  };

  const btn = document.getElementById('closeJobConfirmBtn');
  btn.disabled = true; btn.style.opacity = '.4'; btn.style.cursor = 'not-allowed';

  document.getElementById('closeJobModal').classList.add('active');
}

function closeCloseJobModal() {
  document.getElementById('closeJobModal').classList.remove('active');
  _pendingCloseJob = null;
}

async function confirmCloseJob() {
  if (!_pendingCloseJob || !currentJob || !currentProject) return;
  const person = document.getElementById('closeJobPerson').value;
  if (!person) return;

  // Check all BOM items are delivered to site
  const bomJob = getBomDataForJob(currentProject.id, currentJob.id);
  const allItems = (bomJob.materialLists || []).flatMap(ml => ml.items || []);
  if (allItems.length > 0) {
    const notOnSite = allItems.filter(i => i.status !== 'delivered_to_site' && i.status !== 'complete');
    if (notOnSite.length > 0) {
      const fabPending = notOnSite.filter(i => i.fabricated && i.status === 'not_started').length;
      const dispPending = notOnSite.filter(i => i.status === 'dispatched' || i.status === 'returned').length;
      const readyPending = notOnSite.filter(i => !i.fabricated && i.status === 'not_started').length;
      let detail = `${notOnSite.length} item${notOnSite.length > 1 ? 's' : ''} not yet on site:`;
      if (fabPending) detail += `\n• ${fabPending} awaiting fabrication`;
      if (readyPending) detail += `\n• ${readyPending} non-fab items not dispatched`;
      if (dispPending) detail += `\n• ${dispPending} dispatched but not returned to site`;
      toast(detail, 'error');
      return;
    }
  }

  const job = _pendingCloseJob;
  job.site.completedAt = new Date().toISOString();
  job.site.completedBy = person;
  job.status = 'closed';
  job.closedAt = new Date().toISOString();
  job.closedBy = person;

  // Add completion note
  if (!job.site.notes) job.site.notes = [];
  job.site.notes.push({
    id: Date.now().toString(), type: 'workshop', author: person,
    text: `🏁 Site installation complete. Job closed.`,
    timestamp: new Date().toISOString()
  });

  try {
    setLoading(true);
    await saveDrawingsData();
    closeCloseJobModal();
    toast(`Job "${job.name}" closed`, 'success');

    // Re-render
    renderAllElements();
    openJobDetail(currentProject.id, job.id);

    // Send emails
    await sendJobClosedEmail(job, person);
  } catch (e) { toast('Save failed: ' + e.message, 'error'); }
  finally { setLoading(false); }
}

async function sendJobClosedEmail(job, person) {
  const settings = state.timesheetData.settings || {};
  const draftsmanEmail = settings.draftsmanEmail || 'daniel@bamafabrication.co.uk';
  const siteEmailList = settings.siteCompletionEmails || '';
  const recipients = [draftsmanEmail];
  if (siteEmailList) {
    siteEmailList.split(',').map(e => e.trim()).filter(Boolean).forEach(e => {
      if (!recipients.includes(e)) recipients.push(e);
    });
  }
  // Always include daniel
  if (!recipients.includes('daniel@bamafabrication.co.uk')) recipients.push('daniel@bamafabrication.co.uk');

  const proj = currentProject;
  try {
    const token = await getToken();
    await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: {
        subject: `Job Closed — ${job.name} (${proj?.id})`,
        body: { contentType: 'HTML', content: `
          <h2 style="color:#ff6b00;font-family:sans-serif">BAMA FABRICATION</h2>
          <h3 style="font-family:sans-serif">Job Completed & Closed</h3>
          <table style="font-family:sans-serif;font-size:13px">
            <tr><td style="padding:6px 16px 6px 0;color:#888">Job</td><td><b>${job.name}</b></td></tr>
            <tr><td style="padding:6px 16px 6px 0;color:#888">Project</td><td>${proj?.id} — ${proj?.name}</td></tr>
            <tr><td style="padding:6px 16px 6px 0;color:#888">Closed by</td><td>${person}</td></tr>
            <tr><td style="padding:6px 16px 6px 0;color:#888">Date/Time</td><td>${new Date().toLocaleString('en-GB')}</td></tr>
          </table>
          <p style="margin-top:16px;font-family:sans-serif;font-size:13px;padding:12px;border-radius:8px;background:#e8fae8;color:#166534">
            🏁 Site installation is complete. This job has been closed.
          </p>
          <p style="font-family:sans-serif;font-size:11px;color:#aaa;margin-top:12px"><a href="https://proud-dune-0dee63110.2.azurestaticapps.net" style="color:#ff6b00">Open BAMA Workshop</a></p>
        `},
        toRecipients: recipients.map(e => ({ emailAddress: { address: e } }))
      }, saveToSentItems: false })
    });
  } catch (e) { console.warn('Job closed email failed:', e.message); }
}

// ═══════════════════════════════════════════
// DRAFTSMAN LOGIN / LOGOUT (Per-User)
// ═══════════════════════════════════════════
function openDraftsmanLogin() {
  _pendingDraftsmanUser = null;
  const grid = document.getElementById('draftsmanEmpGrid');
  if (!grid) return;

  const empList = (state.timesheetData.employees || []).filter(e => e.active !== false);
  if (!empList.length) {
    grid.innerHTML = '<div class="empty-state" style="padding:20px">No employees set up yet.</div>';
  } else {
    grid.innerHTML = empList.map(emp => {
      const ini = (emp.name || '').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
      const col = empColor(emp.name);
      return `
        <div class="emp-btn" onclick="selectDraftsmanUser('${emp.name.replace(/'/g, "\\'")}')" style="padding:18px 12px 14px">
          <div class="emp-avatar" style="width:42px;height:42px;font-size:17px;background:linear-gradient(135deg,${col},#3e1a00)">${ini}</div>
          <div class="emp-name" style="font-size:12px">${emp.name}</div>
        </div>
      `;
    }).join('');
  }

  document.getElementById('draftsmanLoginModal').classList.add('active');
}

function closeDraftsmanLogin() {
  document.getElementById('draftsmanLoginModal').classList.remove('active');
}

function selectDraftsmanUser(name) {
  const emp = (state.timesheetData.employees || []).find(e => e.name === name);
  if (!emp) return;

  if (!emp.hasPin) {
    toast('No PIN set for this user. Set one in Manager → Staff first.', 'error');
    return;
  }

  _pendingDraftsmanUser = name;
  closeDraftsmanLogin();

  const ini = name.split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
  const col = empColor(name);

  const avatar = document.getElementById('draftPinAvatar');
  if (avatar) {
    avatar.innerHTML = ini;
    avatar.style.background = `linear-gradient(135deg,${col},#3e1a00)`;
  }
  const nameEl = document.getElementById('draftPinName');
  if (nameEl) nameEl.textContent = name;

  document.getElementById('draftsmanPinInput').value = '';
  document.getElementById('draftsmanPinError').textContent = '';
  document.getElementById('draftsmanPinModal').classList.add('active');
  setTimeout(() => document.getElementById('draftsmanPinInput').focus(), 100);
}

function closeDraftsmanPinModal() {
  document.getElementById('draftsmanPinModal').classList.remove('active');
}

async function checkDraftsmanPin() {
  const pin = document.getElementById('draftsmanPinInput').value;
  const emp = (state.timesheetData.employees || []).find(e => e.name === _pendingDraftsmanUser);

  if (!emp || !emp.hasPin) {
    document.getElementById('draftsmanPinError').textContent = 'No PIN set for this user';
    return;
  }

  let result;
  try {
    result = await api.post('/api/auth/verify-pin', { employee_id: emp.id, pin });
  } catch (err) {
    document.getElementById('draftsmanPinError').textContent = 'Verification failed — try again';
    return;
  }

  if (!result || !result.valid) {
    document.getElementById('draftsmanPinError').textContent = (result && result.reason) || 'Incorrect PIN';
    document.getElementById('draftsmanPinInput').value = '';
    return;
  }

  // PIN correct — check draftsman permission
  const perms = getUserPermissions(_pendingDraftsmanUser);
  if (!perms || !perms.draftsmanMode) {
    document.getElementById('draftsmanPinError').textContent = 'You do not have draftsman access. Contact an admin.';
    document.getElementById('draftsmanPinInput').value = '';
    return;
  }

  // Authorised — enter draftsman mode
  isDraftsman = true;
  closeDraftsmanPinModal();
  toast(`Draftsman mode active — ${_pendingDraftsmanUser}`, 'success');
  _pendingDraftsmanUser = null;

  // Update UI
  const badge = document.getElementById('draftsmanBadge');
  const loginBtn = document.getElementById('draftsmanLoginBtn');
  if (badge) badge.style.display = 'flex';
  if (loginBtn) loginBtn.style.display = 'none';

  // Re-render current view
  if (currentJob) {
    document.getElementById('jobDraftsmanBar').style.display = 'flex';
    renderAllElements();
  } else if (currentProject) {
    document.getElementById('draftsmanBar').style.display = 'flex';
    renderJobsList(currentProject.id);
  } else {
    renderProjectTiles();
  }
}

function logoutDraftsman() {
  isDraftsman = false;
  const badge = document.getElementById('draftsmanBadge');
  const loginBtn = document.getElementById('draftsmanLoginBtn');
  if (badge) badge.style.display = 'none';
  if (loginBtn) loginBtn.style.display = '';

  const bar = document.getElementById('draftsmanBar');
  if (bar) bar.style.display = 'none';
  const jobBar = document.getElementById('jobDraftsmanBar');
  if (jobBar) jobBar.style.display = 'none';

  toast('Draftsman mode exited', 'info');

  // Re-render to hide edit buttons
  if (currentJob) {
    renderAllElements();
  } else if (currentProject) {
    renderJobsList(currentProject.id);
  }
}

// ═══════════════════════════════════════════
// USER ACCESS TAB
// ═══════════════════════════════════════════
function renderUserAccessTab() {
  // Load global admin email
  const adminInput = document.getElementById('globalAdminEmail');
  if (adminInput) adminInput.value = userAccessData.globalAdminEmail || '';

  // Render employee permission cards
  const container = document.getElementById('userAccessList');
  if (!container) return;

  const employees = (state.timesheetData.employees || []).filter(e => e.active !== false);
  if (!employees.length) {
    container.innerHTML = '<div class="empty-state" style="padding:30px">No employees to show.</div>';
    return;
  }

  container.innerHTML = employees.map(emp => {
    const ini = (emp.name || '').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    const col = empColor(emp.name);
    const perms = getUserPermissions(emp.name) || {};
    const enabledCount = Object.values(perms).filter(v => v === true).length;
    const safeName = emp.name.replace(/'/g, "\\'");

    return `
      <div class="ua-card" id="uaCard-${emp.id}">
        <div class="ua-card-header" onclick="toggleUACard('${emp.id}')">
          <div class="emp-avatar" style="width:38px;height:38px;font-size:16px;flex-shrink:0;background:linear-gradient(135deg,${col},#3e1a00)">${ini}</div>
          <div style="flex:1;min-width:0">
            <div style="font-weight:600;font-size:14px">${emp.name}</div>
            <div style="font-size:11px;color:var(--muted)">${enabledCount > 0 ? enabledCount + ' permission' + (enabledCount > 1 ? 's' : '') + ' enabled' : 'No permissions'}</div>
          </div>
          <div style="font-size:11px;color:var(--subtle)">&#9660;</div>
        </div>
        <div class="ua-card-body" id="uaBody-${emp.id}" style="display:none">
          ${PERMISSION_DEFS.map(p => {
            const checked = perms[p.key] === true;
            return `
              <div class="ua-perm-row">
                <div>
                  <div class="ua-perm-label">${p.label}</div>
                  <div class="ua-perm-desc">${p.desc}</div>
                </div>
                <label class="perm-switch">
                  <input type="checkbox" ${checked ? 'checked' : ''}
                    onchange="toggleUserPermission('${safeName}', '${p.key}', this.checked)">
                  <span class="slider"></span>
                </label>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }).join('');

  // Render access requests
  renderAccessRequests();
}

function toggleUACard(empId) {
  const body = document.getElementById(`uaBody-${empId}`);
  const card = document.getElementById(`uaCard-${empId}`);
  if (!body || !card) return;

  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  card.classList.toggle('expanded', !isOpen);
}

async function toggleUserPermission(empName, permKey, enabled) {
  // Find employee_id
  const emp = (state.timesheetData.employees || []).find(e => e.name === empName);
  if (!emp) { toast('Employee not found', 'error'); return; }

  // Update local state
  if (!userAccessData.users[empName]) {
    userAccessData.users[empName] = {
      employee_id: emp.id,
      permissions: {
        byProject: false, byEmployee: false, clockingInOut: false,
        payroll: false, archive: false, staff: false, holidays: false,
        reports: false, settings: false, userAccess: false, draftsmanMode: false,
        tenders: false, editQuotes: false, viewQuotes: false,
        editProjects: false, viewProjects: false
      }
    };
  }
  userAccessData.users[empName].permissions[permKey] = enabled;

  try {
    await api.put(`/api/user-access/${emp.id}`, { [permKey]: enabled });
    toast(`${empName}: ${permKey} ${enabled ? 'enabled' : 'disabled'} ✓`, 'success');
  } catch (e) {
    toast('Failed to save permission', 'error');
    console.error('Permission save error:', e);
  }
}

async function saveGlobalAdminEmail() {
  const input = document.getElementById('globalAdminEmail');
  if (!input) return;
  const email = input.value.trim();

  if (email && !email.includes('@')) {
    toast('Please enter a valid email address', 'error');
    return;
  }

  userAccessData.globalAdminEmail = email;
  try {
    await api.put('/api/settings', { globalAdminEmail: email });
    toast('Global admin email saved ✓', 'success');
  } catch { toast('Save failed', 'error'); }
}

function renderAccessRequests() {
  const card = document.getElementById('accessRequestsCard');
  const list = document.getElementById('accessRequestsList');
  if (!card || !list) return;

  const requests = userAccessData.accessRequests || [];
  if (!requests.length) {
    card.style.display = 'none';
    return;
  }

  card.style.display = 'block';
  list.innerHTML = requests.map((req, i) => `
    <div style="background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:14px 16px;margin-bottom:8px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <span style="font-weight:600;font-size:14px">${req.employeeName || 'Unknown'}</span>
        <span style="font-size:11px;color:var(--subtle);font-family:var(--font-mono)">${req.date || ''}</span>
      </div>
      <div style="font-size:13px;color:var(--muted);margin-bottom:8px">${req.reason || 'No reason given'}</div>
      <button class="tiny-btn" style="background:var(--surface);color:var(--muted);border:1px solid var(--border);font-size:11px;padding:4px 10px"
        onclick="dismissAccessRequest(${i})">Dismiss</button>
    </div>
  `).join('');
}

async function dismissAccessRequest(index) {
  const req = userAccessData.accessRequests[index];
  if (!req || !req.id) {
    userAccessData.accessRequests.splice(index, 1);
    renderAccessRequests();
    return;
  }
  try {
    await api.put(`/api/access-requests/${req.id}`, { status: 'dismissed' });
    userAccessData.accessRequests.splice(index, 1);
    renderAccessRequests();
    toast('Request dismissed', 'info');
  } catch { toast('Save failed', 'error'); }
}

// ═══════════════════════════════════════════
// REQUEST ACCESS (from Access Denied screen)
// ═══════════════════════════════════════════
function openRequestAccessModal() {
  const textarea = document.getElementById('accessRequestReason');
  if (textarea) textarea.value = '';
  document.getElementById('requestAccessModal').classList.add('active');
}

function closeRequestAccessModal() {
  document.getElementById('requestAccessModal').classList.remove('active');
}

async function submitAccessRequest() {
  const reason = (document.getElementById('accessRequestReason')?.value || '').trim();
  if (!reason) {
    toast('Please provide a reason for your request', 'error');
    return;
  }

  const empName = currentManagerUser || _pendingManagerUser || 'Unknown';
  const adminEmail = userAccessData.globalAdminEmail;

  // Save request via API
  try {
    const result = await api.post('/api/access-requests', {
      employee_name: empName,
      reason: reason
    });
    if (!userAccessData.accessRequests) userAccessData.accessRequests = [];
    userAccessData.accessRequests.push({
      id: result.id,
      employeeName: empName,
      reason: reason,
      date: new Date().toISOString().slice(0, 16).replace('T', ' ')
    });
  } catch (e) {
    console.warn('Failed to save access request:', e.message);
  }

  // Send email if admin email is configured
  if (adminEmail) {
    try {
      const token = await getToken();
      const emailBody = {
        message: {
          subject: `BAMA ERP — Access Request from ${empName}`,
          body: {
            contentType: 'HTML',
            content: `
              <h2 style="color:#ff6b00;font-family:sans-serif">BAMA FABRICATION — Access Request</h2>
              <p style="font-family:sans-serif;font-size:14px"><b>Employee:</b> ${empName}</p>
              <p style="font-family:sans-serif;font-size:14px"><b>Reason:</b></p>
              <div style="background:#f5f5f5;padding:16px;border-radius:8px;font-family:sans-serif;font-size:14px;margin:12px 0">${reason}</div>
              <p style="font-family:sans-serif;font-size:13px;color:#888">
                To grant access, go to Office → User Access tab and enable the relevant permissions for this user.
              </p>
              <p style="margin-top:20px;font-family:sans-serif;font-size:11px;color:#aaa">
                Generated by BAMA Workshop ERP — ${new Date().toLocaleString('en-GB')}
              </p>
            `
          },
          toRecipients: [{ emailAddress: { address: adminEmail } }]
        },
        saveToSentItems: true
      };

      const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(emailBody)
      });

      if (res.ok || res.status === 202) {
        toast('Access request sent ✓', 'success');
      } else {
        console.error('Email error:', await res.text());
        toast('Request logged but email failed', 'info');
      }
    } catch (e) {
      console.error('Email send error:', e);
      toast('Request logged but email failed', 'info');
    }
  } else {
    toast('Request logged (no admin email configured)', 'info');
  }

  closeRequestAccessModal();
}

// ═══════════════════════════════════════════
// CONFIRM MODAL HELPER
// ═══════════════════════════════════════════
function showConfirm(title, message, onConfirm) {
  const modal = document.getElementById('confirmModal');
  const titleEl = document.getElementById('confirmTitle');
  const msgEl = document.getElementById('confirmMsg');
  const btnEl = document.getElementById('confirmOk');
  if (titleEl) titleEl.textContent = title;
  if (msgEl) msgEl.textContent = message;
  if (btnEl) {
    const newBtn = btnEl.cloneNode(true);
    newBtn.onclick = () => { closeModal(); onConfirm(); };
    btnEl.parentNode.replaceChild(newBtn, btnEl);
  }
  modal.classList.add('active');
}

// Promise-returning confirm with HTML message support and customisable
// button labels. Resolves true on confirm, false on cancel/dismiss.
// Usage: const ok = await showConfirmAsync('Title', '<p>HTML body</p>', { okLabel: 'Generate' });
function showConfirmAsync(title, htmlMessage, options = {}) {
  return new Promise(resolve => {
    const modal = document.getElementById('confirmModal');
    if (!modal) { resolve(false); return; }
    const titleEl = document.getElementById('confirmTitle');
    const msgEl = document.getElementById('confirmMsg');
    const btnEl = document.getElementById('confirmOk');
    const cancelBtn = modal.querySelector('.modal-actions .btn-ghost');

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.innerHTML = htmlMessage;

    let settled = false;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      closeModal();
      resolve(value);
    };

    if (btnEl) {
      const newBtn = btnEl.cloneNode(true);
      if (options.okLabel) newBtn.textContent = options.okLabel;
      if (options.danger) {
        newBtn.classList.remove('btn-primary');
        newBtn.classList.add('btn-danger');
      }
      newBtn.onclick = () => {
        // onConfirmSync runs inside the user-gesture click stack, before
        // the promise resolves. Useful for window.open() which would
        // otherwise be blocked by popup blockers if it ran after an await.
        // The return value is passed through as the second value, so the
        // caller can do: const { ok, data } = await showConfirmAsync(...)
        let syncResult;
        if (typeof options.onConfirmSync === 'function') {
          try { syncResult = options.onConfirmSync(); }
          catch (e) { console.error('onConfirmSync threw:', e); }
        }
        finish(options.onConfirmSync ? { ok: true, data: syncResult } : true);
      };
      btnEl.parentNode.replaceChild(newBtn, btnEl);
    }
    if (cancelBtn) {
      const newCancel = cancelBtn.cloneNode(true);
      if (options.cancelLabel) newCancel.textContent = options.cancelLabel;
      newCancel.onclick = () => finish(options.onConfirmSync ? { ok: false, data: null } : false);
      cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
    }

    modal.classList.add('active');
  });
}

function closeModal() {
  document.getElementById('confirmModal').classList.remove('active');
  const modalEl = document.getElementById('confirmModal').querySelector('.modal');
  if (modalEl) modalEl.style.width = '';
}


// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
// ═══════════════════════════════════════════
// ═══════════════════════════════════════════
// TEMPLATES MODULE
// ═══════════════════════════════════════════

// ── Template editor state ──
let tplCurrent = 'global';
let tplDraft = null;
let tplDirty = false;
let _logoFileToUpload = null;
let _logoDataUriCache = null;

// ── Defaults — match existing hardcoded output so byte-identical before any edits ──
const TEMPLATE_DEFAULTS = {
  global: {
    companyName: 'BAMA FABRICATION',
    address: '11 Enterprise Way, Enterprise Park, Yaxley, Peterborough, Cambridgeshire PE7 3WY',
    phone: '01733 855212',
    email: 'info@bamafabrication.co.uk',
    vatNumber: '',
    logoUrl: '',
    logoItemId: ''
  },
  payroll: {
    title: 'Payroll Summary Report',
    accentColor: '#ff6b00',
    showLogo: true,
    showCompanyDetails: true,
    footerText: 'Generated by BAMA Workshop Timesheet',
    payRulesText: 'Pay rules: Standard rate for first 40hrs. Overtime \u00d71.5 for hours over 40. Sunday \u00d72 only if Saturday also worked.',
    emailSubject: 'BAMA Payroll Report \u2014 Week {weekRange}',
    emailBody: ''
  },
  attendance: {
    title: 'Workshop Report',
    accentColor: '#ff6b00',
    showLogo: true,
    showCompanyDetails: true,
    footerText: 'Generated by BAMA Workshop ERP'
  },
  deliveryNote: {
    title: 'DELIVERY NOTE',
    accentColor: '#D0021B',
    showLogo: true,
    showCompanyDetails: true,
    showSignatureBlock: true,
    termsText: ''
  }
};

// ── Small HTML-escape helper (no equivalent in shared.js yet) ──
function escapeHtml(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Read a template setting with fallback to defaults ──
function tplGet(key, field) {
  const tpls = (state.timesheetData.settings && state.timesheetData.settings.templates) || {};
  const block = tpls[key] || {};
  if (block[field] !== undefined && block[field] !== null && block[field] !== '') return block[field];
  return TEMPLATE_DEFAULTS[key] ? TEMPLATE_DEFAULTS[key][field] : '';
}

// ── Deep clone current templates settings for draft editing ──
function tplCloneSettings() {
  const saved = (state.timesheetData.settings && state.timesheetData.settings.templates) || {};
  const out = {};
  for (const k of Object.keys(TEMPLATE_DEFAULTS)) {
    out[k] = Object.assign({}, TEMPLATE_DEFAULTS[k], saved[k] || {});
  }
  return out;
}

// ── Fetch logo from SharePoint and cache as data URI ──
// Required because print windows can't share auth tokens; data URI embeds directly.
async function loadLogoDataUri(force) {
  if (_logoDataUriCache && !force) return _logoDataUriCache;
  const itemId = tplGet('global', 'logoItemId');
  if (!itemId) return '';
  try {
    const token = await getToken();
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${BAMA_DRIVE_ID}/items/${itemId}/content`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (!res.ok) { console.warn('Logo fetch failed:', res.status); return ''; }
    const blob = await res.blob();
    _logoDataUriCache = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => resolve('');
      reader.readAsDataURL(blob);
    });
    return _logoDataUriCache;
  } catch (e) {
    console.warn('Logo load error:', e.message);
    return '';
  }
}

// ── Templates page init ──
function initTemplatesPage() {
  const authed = sessionStorage.getItem('bama_mgr_authed');
  if (!authed) {
    showScreen('screenTemplatesAuth');
    return;
  }
  const userLabel = document.getElementById('tplUserLabel');
  if (userLabel) userLabel.textContent = authed;

  tplDraft = tplCloneSettings();
  tplDirty = false;

  loadLogoDataUri().then(() => {
    showScreen('screenTemplates');
    selectTemplate('global');
  });
}

// ── Sidebar template selection ──
function selectTemplate(key) {
  if (tplDirty) {
    if (!confirm('You have unsaved changes. Discard and switch template?')) return;
    tplDraft = tplCloneSettings();
    tplDirty = false;
    updateDirtyIndicator();
  }
  tplCurrent = key;
  document.querySelectorAll('.tpl-item').forEach(el => {
    el.classList.toggle('active', el.getAttribute('data-template') === key);
  });
  renderTemplateEditor(key);
  refreshTemplatePreview();
}

// ── Render the form for the current template ──
function renderTemplateEditor(key) {
  const editor = document.getElementById('tplEditor');
  if (!editor) return;
  const d = tplDraft[key] || {};

  const field = (name, label, type, hint) => {
    const val = d[name] != null ? d[name] : '';
    if (type === 'textarea') {
      return `<div class="tpl-field"><label>${label}${hint ? ' <span class="hint">'+hint+'</span>' : ''}</label>
        <textarea data-field="${name}" oninput="onTemplateFieldInput(event)">${escapeHtml(val)}</textarea></div>`;
    }
    if (type === 'color') {
      return `<div class="tpl-field"><label>${label}${hint ? ' <span class="hint">'+hint+'</span>' : ''}</label>
        <div class="color-row">
          <input type="color" data-field="${name}" value="${escapeHtml(val || '#ff6b00')}" oninput="onTemplateFieldInput(event)">
          <span>${escapeHtml(val || '#ff6b00')}</span>
        </div></div>`;
    }
    if (type === 'checkbox') {
      return `<div class="tpl-field"><div class="checkbox-row">
        <input type="checkbox" data-field="${name}" ${d[name] ? 'checked' : ''} onchange="onTemplateFieldInput(event)" id="tpl_${name}">
        <label for="tpl_${name}">${label}${hint ? ' <span class="hint">'+hint+'</span>' : ''}</label>
      </div></div>`;
    }
    return `<div class="tpl-field"><label>${label}${hint ? ' <span class="hint">'+hint+'</span>' : ''}</label>
      <input type="${type||'text'}" data-field="${name}" value="${escapeHtml(val)}" oninput="onTemplateFieldInput(event)"></div>`;
  };

  let html = '';
  if (key === 'global') {
    html = `
      <h2>Company Details</h2>
      <div class="tpl-desc">Shared across every template. Changes here propagate to payroll, attendance reports, and delivery notes.</div>
      <div class="tpl-section">
        <div class="tpl-section-title">Logo</div>
        <div class="tpl-logo-preview" id="tplLogoDisplay">
          ${_logoDataUriCache
            ? `<img src="${_logoDataUriCache}" alt="Current logo">`
            : `<div class="logo-empty">No logo uploaded yet</div>`}
          <button class="btn btn-ghost" style="margin-left:auto;padding:6px 12px;font-size:12px" onclick="openLogoUploadModal()">${_logoDataUriCache ? 'Replace' : 'Upload'} logo</button>
          ${_logoDataUriCache ? '<button class="btn btn-ghost" style="padding:6px 12px;font-size:12px" onclick="removeLogo()">Remove</button>' : ''}
        </div>
      </div>
      <div class="tpl-section">
        <div class="tpl-section-title">Company</div>
        ${field('companyName', 'Company name', 'text')}
        ${field('address', 'Address', 'textarea', 'multi-line, shown on headers')}
        ${field('phone', 'Phone', 'text')}
        ${field('email', 'Email', 'email')}
        ${field('vatNumber', 'VAT number', 'text', 'optional')}
      </div>`;
  } else if (key === 'payroll') {
    html = `
      <h2>Payroll Summary</h2>
      <div class="tpl-desc">Weekly payroll PDF generated from the Payroll tab.</div>
      <div class="tpl-section">
        <div class="tpl-section-title">Header</div>
        ${field('title', 'Document title', 'text')}
        ${field('accentColor', 'Accent colour', 'color', 'used for totals and title')}
        ${field('showLogo', 'Show company logo', 'checkbox')}
        ${field('showCompanyDetails', 'Show company address &amp; contact', 'checkbox')}
      </div>
      <div class="tpl-section">
        <div class="tpl-section-title">Footer</div>
        ${field('footerText', 'Footer text', 'textarea')}
        ${field('payRulesText', 'Pay rules note', 'textarea', 'displayed below footer')}
      </div>
      <div class="tpl-section">
        <div class="tpl-section-title">Email to Payroll</div>
        ${field('emailSubject', 'Email subject', 'text', 'use {weekRange} placeholder for the date range')}
        ${field('emailBody', 'Email body', 'textarea', 'opens in Outlook when you click Email to Payroll. Placeholders: {weekRange}, {url}, {instructions}, {totalPay}, {totalEmployees}. If {url} is omitted, the file link is appended automatically.')}
      </div>`;
  } else if (key === 'attendance') {
    html = `
      <h2>Attendance Report</h2>
      <div class="tpl-desc">Workshop KPI and absence report from the Reports tab.</div>
      <div class="tpl-section">
        <div class="tpl-section-title">Header</div>
        ${field('title', 'Document title', 'text')}
        ${field('accentColor', 'Accent colour', 'color')}
        ${field('showLogo', 'Show company logo', 'checkbox')}
        ${field('showCompanyDetails', 'Show company address &amp; contact', 'checkbox')}
      </div>
      <div class="tpl-section">
        <div class="tpl-section-title">Footer</div>
        ${field('footerText', 'Footer text', 'textarea')}
      </div>`;
  } else if (key === 'deliveryNote') {
    html = `
      <h2>Delivery Note</h2>
      <div class="tpl-desc">Saved to <code>07 - Deliveries/</code> on SharePoint when generated.</div>
      <div class="tpl-section">
        <div class="tpl-section-title">Header</div>
        ${field('title', 'Document title', 'text')}
        ${field('accentColor', 'Accent colour', 'color', 'used for title &amp; company name')}
        ${field('showLogo', 'Show company logo', 'checkbox')}
        ${field('showCompanyDetails', 'Show company address &amp; contact', 'checkbox')}
      </div>
      <div class="tpl-section">
        <div class="tpl-section-title">Footer</div>
        ${field('showSignatureBlock', 'Show signature block (Delivered by / Received by)', 'checkbox')}
        ${field('termsText', 'Terms / notes', 'textarea', 'optional &mdash; e.g. returns policy')}
      </div>`;
  }
  editor.innerHTML = html;
}

// ── Live-update field handler ──
function onTemplateFieldInput(ev) {
  const el = ev.target;
  const name = el.getAttribute('data-field');
  if (!name) return;
  let val;
  if (el.type === 'checkbox') val = el.checked;
  else val = el.value;
  if (!tplDraft[tplCurrent]) tplDraft[tplCurrent] = {};
  tplDraft[tplCurrent][name] = val;
  tplDirty = true;
  updateDirtyIndicator();
  if (el.type === 'color') {
    const span = el.parentElement.querySelector('span');
    if (span) span.textContent = val;
  }
  clearTimeout(window._tplPreviewTimer);
  window._tplPreviewTimer = setTimeout(refreshTemplatePreview, 150);
}

function updateDirtyIndicator() {
  const flag = document.getElementById('tplDirtyFlag');
  if (flag) flag.style.display = tplDirty ? '' : 'none';
}

// ── Save draft via /api/settings ──
async function saveTemplateSettings() {
  const btn = document.getElementById('tplSaveBtn');
  btn.disabled = true;
  btn.textContent = 'Saving\u2026';
  try {
    await api.put('/api/settings', { templates: tplDraft });
    if (!state.timesheetData.settings) state.timesheetData.settings = {};
    state.timesheetData.settings.templates = JSON.parse(JSON.stringify(tplDraft));
    tplDirty = false;
    updateDirtyIndicator();
    toast('Templates saved', 'success');
  } catch (e) {
    toast('Save failed: ' + e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save changes';
  }
}

function discardTemplateChanges() {
  if (!tplDirty) return;
  if (!confirm('Discard all unsaved changes?')) return;
  tplDraft = tplCloneSettings();
  tplDirty = false;
  updateDirtyIndicator();
  renderTemplateEditor(tplCurrent);
  refreshTemplatePreview();
}

// ── Live preview (right pane iframe) ──
function refreshTemplatePreview() {
  const iframe = document.getElementById('tplPreviewFrame');
  const label = document.getElementById('tplPreviewLabel');
  if (!iframe) return;

  let html = '';
  if (tplCurrent === 'global' || tplCurrent === 'payroll') {
    html = buildPayrollHTML(getMockPayrollData(), tplDraft);
    if (label) label.textContent = 'Payroll Summary \u2014 sample data';
  } else if (tplCurrent === 'attendance') {
    html = buildAttendanceHTML(getMockAttendanceData(), tplDraft);
    if (label) label.textContent = 'Attendance Report \u2014 sample data';
  } else if (tplCurrent === 'deliveryNote') {
    html = buildDeliveryNoteHTMLCore(getMockDeliveryNote(), getMockBomJob(), getMockProject(), getMockJob(), tplDraft);
    if (label) label.textContent = 'Delivery Note \u2014 sample data';
  }
  iframe.srcdoc = html;
}

// ── Mock data for preview ──
function getMockPayrollData() {
  return {
    weekStr: '12 Aug \u2013 18 Aug 2024',
    results: [
      { employeeName: 'John Smith', rate: 18.50, totalHours: 42.5, basicHours: 40, basicPay: 740.00,
        overtimeHours: 2.5, overtimePay: 69.38, doubleHours: 0, doublePay: 0,
        holidayHours: 0, holidayPay: 0, bankHolidayHours: 0, bankHolidayPay: 0,
        totalPay: 809.38, doubleTimeApplies: false },
      { employeeName: 'Sarah Jones', rate: 22.00, totalHours: 48, basicHours: 40, basicPay: 880.00,
        overtimeHours: 6, overtimePay: 198.00, doubleHours: 2, doublePay: 88.00,
        holidayHours: 0, holidayPay: 0, bankHolidayHours: 0, bankHolidayPay: 0,
        totalPay: 1166.00, doubleTimeApplies: true },
      { employeeName: 'Tom Wilson', rate: 16.00, totalHours: 40, basicHours: 32, basicPay: 512.00,
        overtimeHours: 0, overtimePay: 0, doubleHours: 0, doublePay: 0,
        holidayHours: 8, holidayPay: 128.00, bankHolidayHours: 0, bankHolidayPay: 0,
        totalPay: 640.00, doubleTimeApplies: false }
    ],
    totals: { basic: 2132.00, ot: 267.38, dt: 88.00, hol: 128.00, grand: 2615.38 },
    comments: [
      { comment: 'Sarah worked Sat & Sun call-out — double time approved.', created_by: 'office', created_at: '2024-08-19T08:14:00Z' },
      { comment: 'Tom\u2019s missing Wed afternoon clock-out has been added manually (16:30).', created_by: 'office', created_at: '2024-08-19T08:18:00Z' }
    ]
  };
}
function getMockAttendanceData() {
  return {
    periodLabel: 'This Week',
    from: '12/08/2024', to: '18/08/2024',
    filterLabel: ' \u2014 All Employees',
    general: { totalClocked: 187.5, totalProject: 142.0, totalWGD: 32.5, totalUnproductive: 13.0, utilisation: 85 },
    data: {
      attendanceRate: 96, totalSickDays: 1, totalLate: 2, totalHolidayDays: 3,
      totalHolidayBalance: 18, avgShiftLength: '8.2h', expectedStart: '07:30',
      lateList: [
        { name: 'Tom Wilson', date: '13/08/2024', clockIn: '07:42', minsLate: 12 },
        { name: 'John Smith', date: '15/08/2024', clockIn: '07:38', minsLate: 8 }
      ],
      absenceList: [
        { name: 'Sarah Jones', dateFrom: '14/08/2024', dateTo: '14/08/2024', days: 1, reason: 'Doctor appointment' }
      ]
    }
  };
}
function getMockDeliveryNote() {
  return {
    number: 'DN-001', createdAt: new Date().toISOString(),
    destinationName: 'Site A \u2014 Main Building', address: 'Unit 4, Industrial Park, Peterborough PE1 5XY',
    siteContact: 'Mike Johnson', phone: '07123 456789', deliveryDate: new Date().toISOString(),
    itemIds: ['i1','i2','i3']
  };
}
function getMockBomJob() {
  return { materialLists: [{ items: [
    { id: 'i1', mark: 'B1', quantity: 4, description: '203\u00d7203 UC46 \u00d7 3500mm', coating: 'Galv', totalWeight: 644 },
    { id: 'i2', mark: 'C1', quantity: 2, description: '152\u00d789 PFC \u00d7 2800mm', coating: 'Primed', totalWeight: 95 },
    { id: 'i3', mark: 'P1', quantity: 12, description: '200\u00d7200\u00d710mm Base Plate', coating: 'Galv', totalWeight: 76 }
  ]}]};
}
function getMockProject() { return { id: '24-156', name: 'Peterborough Office Expansion' }; }
function getMockJob() { return { name: 'Main Frame' }; }

// ═══════════════════════════════════════════
// LOGO UPLOAD
// ═══════════════════════════════════════════
function openLogoUploadModal() {
  document.getElementById('logoFileInput').value = '';
  document.getElementById('logoUploadPreview').style.display = 'none';
  document.getElementById('logoUploadError').style.display = 'none';
  document.getElementById('logoUploadProgress').style.display = 'none';
  document.getElementById('logoUploadConfirmBtn').disabled = true;
  _logoFileToUpload = null;
  document.getElementById('logoUploadModal').classList.add('active');
}

function closeLogoUploadModal() {
  document.getElementById('logoUploadModal').classList.remove('active');
  _logoFileToUpload = null;
}

function handleLogoFileSelected(ev) {
  const file = ev.target.files[0];
  const errEl = document.getElementById('logoUploadError');
  const btn = document.getElementById('logoUploadConfirmBtn');
  errEl.style.display = 'none';
  btn.disabled = true;
  if (!file) return;

  const isPng = file.type === 'image/png' || /\.png$/i.test(file.name);
  if (!isPng) {
    errEl.textContent = 'PNG files only. Please convert your logo to PNG first.';
    errEl.style.display = '';
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    errEl.textContent = `File too large (${(file.size/1024/1024).toFixed(1)} MB). Max 2 MB.`;
    errEl.style.display = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = () => {
    const img = new Image();
    img.onload = () => {
      if (img.width > 1000 || img.height > 1000) {
        errEl.textContent = `Too big (${img.width}\u00d7${img.height}). Max 1000\u00d71000 px.`;
        errEl.style.display = '';
        return;
      }
      _logoFileToUpload = file;
      document.getElementById('logoUploadImg').src = reader.result;
      document.getElementById('logoUploadMeta').textContent = `${file.name} \u00b7 ${img.width}\u00d7${img.height} \u00b7 ${(file.size/1024).toFixed(0)} KB`;
      document.getElementById('logoUploadPreview').style.display = '';
      btn.disabled = false;
    };
    img.onerror = () => {
      errEl.textContent = 'Could not read image.';
      errEl.style.display = '';
    };
    img.src = reader.result;
  };
  reader.readAsDataURL(file);
}

async function uploadLogoToSharePoint() {
  if (!_logoFileToUpload) return;
  const btn = document.getElementById('logoUploadConfirmBtn');
  const progress = document.getElementById('logoUploadProgress');
  const errEl = document.getElementById('logoUploadError');
  btn.disabled = true;
  progress.style.display = '';
  errEl.style.display = 'none';

  try {
    const uploaded = await uploadFileToFolder(
      CONFIG.timesheetFolderItemId,
      'bama-logo.png',
      _logoFileToUpload,
      'image/png'
    );
    if (!tplDraft.global) tplDraft.global = {};
    tplDraft.global.logoItemId = uploaded.id;
    tplDraft.global.logoUrl = uploaded.webUrl || '';

    // Save immediately so logo persists even if user discards other draft changes
    const mergedSettings = (state.timesheetData.settings && state.timesheetData.settings.templates) || {};
    const newSettings = Object.assign({}, mergedSettings);
    newSettings.global = Object.assign({}, newSettings.global || {}, {
      logoItemId: uploaded.id, logoUrl: uploaded.webUrl || ''
    });
    await api.put('/api/settings', { templates: newSettings });
    if (!state.timesheetData.settings) state.timesheetData.settings = {};
    state.timesheetData.settings.templates = newSettings;

    _logoDataUriCache = null;
    await loadLogoDataUri(true);

    toast('Logo uploaded', 'success');
    closeLogoUploadModal();
    renderTemplateEditor(tplCurrent);
    refreshTemplatePreview();
  } catch (e) {
    console.error('Logo upload failed:', e);
    errEl.textContent = 'Upload failed: ' + e.message;
    errEl.style.display = '';
    progress.style.display = 'none';
    btn.disabled = false;
  }
}

async function removeLogo() {
  if (!confirm('Remove the company logo? Templates will render without it.')) return;
  try {
    const mergedSettings = (state.timesheetData.settings && state.timesheetData.settings.templates) || {};
    const newSettings = Object.assign({}, mergedSettings);
    newSettings.global = Object.assign({}, newSettings.global || {}, { logoItemId: '', logoUrl: '' });
    await api.put('/api/settings', { templates: newSettings });
    state.timesheetData.settings.templates = newSettings;
    if (tplDraft.global) { tplDraft.global.logoItemId = ''; tplDraft.global.logoUrl = ''; }
    _logoDataUriCache = null;
    toast('Logo removed', 'success');
    renderTemplateEditor(tplCurrent);
    refreshTemplatePreview();
  } catch (e) {
    toast('Remove failed: ' + e.message, 'error');
  }
}

// ═══════════════════════════════════════════
// CORE HTML BUILDERS
// Used by both the real PDF generators AND the live preview.
// Each takes (data, settingsOverride?) — when override is absent, reads from state.
// ═══════════════════════════════════════════

function _pickTplSettings(override) {
  if (override) return override;
  return tplCloneSettings();
}

function buildPayrollHTML(data, settingsOverride) {
  const s = _pickTplSettings(settingsOverride);
  const g = s.global || TEMPLATE_DEFAULTS.global;
  const t = s.payroll || TEMPLATE_DEFAULTS.payroll;
  const logo = _logoDataUriCache || '';
  const showLogo = t.showLogo !== false && logo;
  const showCo = t.showCompanyDetails !== false;
  const accent = t.accentColor || TEMPLATE_DEFAULTS.payroll.accentColor;

  const rowsHtml = data.results.map(r => {
    const holHrs = (r.holidayHours || 0) + (r.bankHolidayHours || 0);
    const holPay = (r.holidayPay   || 0) + (r.bankHolidayPay   || 0);
    return `
    <tr>
      <td class="name">${escapeHtml(r.employeeName)}${r.doubleTimeApplies ? '<span class="badge">SAT+SUN</span>' : ''}</td>
      <td class="mono">\u00a3${r.rate.toFixed(2)}/hr</td>
      <td class="mono"><b>${r.totalHours.toFixed(2)}h</b></td>
      <td class="mono">${r.basicHours}h &nbsp; \u00a3${r.basicPay.toFixed(2)}</td>
      <td class="mono ot">${r.overtimeHours > 0 ? r.overtimeHours+'h &nbsp; \u00a3'+r.overtimePay.toFixed(2) : '\u2014'}</td>
      <td class="mono dt">${r.doubleHours > 0 ? r.doubleHours+'h &nbsp; \u00a3'+r.doublePay.toFixed(2) : '\u2014'}</td>
      <td class="mono hol">${holHrs > 0 ? holHrs+'h &nbsp; \u00a3'+holPay.toFixed(2) : '\u2014'}</td>
      <td class="mono total-pay">\u00a3${r.totalPay.toFixed(2)}</td>
    </tr>`;
  }).join('');

  const comments = Array.isArray(data.comments) ? data.comments : [];
  const fmtCommentDate = iso => {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch (e) { return ''; }
  };
  const instructionsHtml = comments.length ? `
      <div class="instructions-title">Payroll Instructions</div>
      ${comments.map(c => `
        <div class="instruction">
          <div class="instruction-text">${escapeHtml(c.comment || '')}</div>
          <div class="instruction-meta">${escapeHtml(c.created_by || '')}${c.created_at ? ' \u00b7 ' + escapeHtml(fmtCommentDate(c.created_at)) : ''}${c.updated_at && c.updated_by ? ' (edited by ' + escapeHtml(c.updated_by) + ' \u00b7 ' + escapeHtml(fmtCommentDate(c.updated_at)) + ')' : ''}</div>
        </div>`).join('')}
    ` : '';

  return `<!DOCTYPE html><html><head>
    <title>${escapeHtml(g.companyName)} Payroll \u2013 ${escapeHtml(data.weekStr)}</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&family=DM+Mono&display=swap');
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: 'DM Sans', sans-serif; padding: 32px; color: #111; background: #fff; }
      .header-row { display:flex; align-items:flex-start; justify-content:space-between; margin-bottom: 8px; gap: 20px; }
      .header-left { flex: 1; }
      .header-logo { max-width: 130px; max-height: 70px; object-fit: contain; }
      h1 { font-size: 28px; font-weight: 700; letter-spacing: 2px; color: ${accent}; margin-bottom: 4px; }
      .subtitle { font-size: 13px; color: #888; margin-bottom: 8px; }
      .company-meta { font-size: 10px; color: #999; margin-top: 4px; line-height: 1.5; }
      .week { font-size: 15px; font-weight: 600; margin: 16px 0 24px; color: #333; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
      th { font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; color: #888;
        padding: 8px 12px; text-align: left; border-bottom: 2px solid #eee; }
      td { padding: 12px 12px; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
      .mono { font-family: 'DM Mono', monospace; }
      .name { font-weight: 600; }
      .total-pay { font-weight: 700; font-size: 15px; color: ${accent}; }
      .ot { color: #f59e0b; } .dt { color: #ef4444; } .hol { color: #6366f1; }
      tfoot td { font-weight: 700; border-top: 2px solid #ddd; border-bottom: none; background: #fafafa; }
      .grand { font-size: 17px; color: ${accent}; }
      .badge { display:inline-block; padding:1px 6px; border-radius:3px; font-size:10px; background:#d1fae5; color:#065f46; margin-left:6px; font-family:sans-serif; }
      .instructions-title { font-size: 12px; text-transform: uppercase; letter-spacing: 1.5px; color: #888;
        margin: 24px 0 10px; border-bottom: 1px solid #eee; padding-bottom: 6px; }
      .instruction { border-left: 3px solid ${accent}; background: #fafafa; padding: 10px 14px;
        margin-bottom: 8px; border-radius: 0 6px 6px 0; page-break-inside: avoid; }
      .instruction-text { font-size: 13px; color: #222; white-space: pre-wrap; line-height: 1.5; }
      .instruction-meta { font-size: 10px; color: #999; margin-top: 6px; }
      .footer { margin-top: 32px; font-size: 11px; color: #aaa; border-top: 1px solid #eee; padding-top: 12px; white-space: pre-line; }
      @media print { body { padding: 16px; } button { display: none; } }
    </style></head>
    <body>
      <div class="header-row">
        <div class="header-left">
          <h1>${escapeHtml(g.companyName)}</h1>
          <div class="subtitle">${escapeHtml(t.title)}</div>
          ${showCo ? `<div class="company-meta">${escapeHtml(g.address).replace(/\n/g,'<br>')}${g.phone ? ' &nbsp;\u00b7&nbsp; Tel: '+escapeHtml(g.phone) : ''}${g.email ? ' &nbsp;\u00b7&nbsp; '+escapeHtml(g.email) : ''}${g.vatNumber ? '<br>VAT: '+escapeHtml(g.vatNumber) : ''}</div>` : ''}
        </div>
        ${showLogo ? `<img src="${logo}" class="header-logo" alt="">` : ''}
      </div>
      <div class="week">Week: ${escapeHtml(data.weekStr)}</div>
      <table>
        <thead><tr>
          <th>Employee</th><th>Rate</th><th>Total Hrs</th><th>Basic (\u226440h)</th>
          <th>O/T \u00d71.5</th><th>Dbl Time \u00d72</th><th>Holiday</th><th>Total Pay</th>
        </tr></thead>
        <tbody>${rowsHtml}</tbody>
        <tfoot><tr>
          <td colspan="3">TOTALS</td>
          <td class="mono">\u00a3${data.totals.basic.toFixed(2)}</td>
          <td class="mono ot">\u00a3${data.totals.ot.toFixed(2)}</td>
          <td class="mono dt">\u00a3${data.totals.dt.toFixed(2)}</td>
          <td class="mono hol">\u00a3${(data.totals.hol || 0).toFixed(2)}</td>
          <td class="mono grand">\u00a3${data.totals.grand.toFixed(2)}</td>
        </tr></tfoot>
      </table>
      ${instructionsHtml}
      <div class="footer">${escapeHtml(t.footerText)} &nbsp;|&nbsp; ${new Date().toLocaleString('en-GB')}${t.payRulesText ? '\n'+escapeHtml(t.payRulesText) : ''}</div>
    </body></html>`;
}

function buildAttendanceHTML(d, settingsOverride) {
  const s = _pickTplSettings(settingsOverride);
  const g = s.global || TEMPLATE_DEFAULTS.global;
  const t = s.attendance || TEMPLATE_DEFAULTS.attendance;
  const logo = _logoDataUriCache || '';
  const showLogo = t.showLogo !== false && logo;
  const showCo = t.showCompanyDetails !== false;
  const accent = t.accentColor || TEMPLATE_DEFAULTS.attendance.accentColor;

  const lateRows = [...d.data.lateList].sort((a,b) => b.minsLate - a.minsLate).map(l => {
    const minsStr = l.minsLate >= 60 ? `${Math.floor(l.minsLate/60)}h ${l.minsLate%60}m` : `${l.minsLate}m`;
    return `<tr><td>${escapeHtml(l.name)}</td><td>${escapeHtml(l.date)}</td><td>${escapeHtml(l.clockIn)}</td><td class="late">+${minsStr}</td></tr>`;
  }).join('');
  const absRows = d.data.absenceList.map(a => {
    const range = a.dateFrom === a.dateTo ? a.dateFrom : `${a.dateFrom} \u2013 ${a.dateTo}`;
    return `<tr><td>${escapeHtml(a.name)}</td><td>${range}</td><td class="sick">${a.days} day${a.days!==1?'s':''}</td><td>${escapeHtml(a.reason||'\u2014')}</td></tr>`;
  }).join('');

  return `<!DOCTYPE html><html><head>
    <title>${escapeHtml(g.companyName)} Report \u2013 ${escapeHtml(d.periodLabel)}</title>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&family=DM+Mono&display=swap');
      * { box-sizing:border-box; margin:0; padding:0; }
      body { font-family:'DM Sans',sans-serif; padding:32px; color:#111; background:#fff; }
      .header-row { display:flex; align-items:flex-start; justify-content:space-between; gap:20px; }
      .header-logo { max-width: 130px; max-height: 70px; object-fit: contain; }
      h1 { font-size:28px; font-weight:700; letter-spacing:2px; color:${accent}; margin-bottom:4px; }
      .subtitle { font-size:13px; color:#888; margin-bottom:4px; }
      .company-meta { font-size:10px; color:#999; margin-top:4px; line-height:1.5; }
      .period { font-size:15px; font-weight:600; margin:16px 0 24px; color:#333; }
      .section-title { font-size:12px; text-transform:uppercase; letter-spacing:1.5px; color:#888; margin:24px 0 10px; border-bottom:1px solid #eee; padding-bottom:6px; }
      .kpi-row { display:flex; gap:14px; margin-bottom:16px; flex-wrap:wrap; }
      .kpi { border:1.5px solid #eee; border-radius:10px; padding:12px 16px; min-width:120px; }
      .kpi-label { font-size:9px; text-transform:uppercase; letter-spacing:1px; color:#888; margin-bottom:3px; }
      .kpi-value { font-size:22px; font-weight:700; font-family:'DM Mono',monospace; }
      .green { color:#16a34a; } .red { color:#ef4444; } .amber { color:#f59e0b; } .purple { color:#6366f1; } .orange { color:${accent}; }
      h2 { font-size:16px; font-weight:600; margin:20px 0 10px; }
      table { width:100%; border-collapse:collapse; margin-bottom:16px; }
      th { font-size:10px; letter-spacing:1.5px; text-transform:uppercase; color:#888; padding:8px 12px; text-align:left; border-bottom:2px solid #eee; }
      td { padding:10px 12px; border-bottom:1px solid #f0f0f0; font-size:13px; }
      .late { color:#f59e0b; font-weight:600; }
      .sick { color:#ef4444; font-weight:600; }
      .empty { color:#aaa; font-size:13px; text-align:center; padding:20px; }
      .footer { margin-top:32px; font-size:11px; color:#aaa; border-top:1px solid #eee; padding-top:12px; white-space:pre-line; }
      @media print { body { padding:16px; } button { display:none; } }
    </style></head><body>
    <div class="header-row">
      <div>
        <h1>${escapeHtml(g.companyName)}</h1>
        <div class="subtitle">${escapeHtml(t.title)}${escapeHtml(d.filterLabel)}</div>
        ${showCo ? `<div class="company-meta">${escapeHtml(g.address).replace(/\n/g,'<br>')}${g.phone ? ' &nbsp;\u00b7&nbsp; Tel: '+escapeHtml(g.phone) : ''}${g.email ? ' &nbsp;\u00b7&nbsp; '+escapeHtml(g.email) : ''}</div>` : ''}
      </div>
      ${showLogo ? `<img src="${logo}" class="header-logo" alt="">` : ''}
    </div>
    <div class="period">${escapeHtml(d.periodLabel)}: ${escapeHtml(d.from)} \u2013 ${escapeHtml(d.to)}</div>

    <div class="section-title">Hours &amp; Utilisation</div>
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-label">Total Hours</div><div class="kpi-value orange">${d.general.totalClocked.toFixed(1)}h</div></div>
      <div class="kpi"><div class="kpi-label">Project Hours</div><div class="kpi-value green">${d.general.totalProject.toFixed(1)}h</div></div>
      <div class="kpi"><div class="kpi-label">Workshop General</div><div class="kpi-value purple">${d.general.totalWGD.toFixed(1)}h</div></div>
      <div class="kpi"><div class="kpi-label">Unproductive</div><div class="kpi-value red">${d.general.totalUnproductive.toFixed(1)}h</div></div>
      <div class="kpi"><div class="kpi-label">Utilisation</div><div class="kpi-value ${d.general.utilisation >= 80 ? 'green' : d.general.utilisation >= 60 ? 'amber' : 'red'}">${d.general.utilisation}%</div></div>
    </div>

    <div class="section-title">Attendance</div>
    <div class="kpi-row">
      <div class="kpi"><div class="kpi-label">Attendance Rate</div><div class="kpi-value ${d.data.attendanceRate >= 95 ? 'green' : d.data.attendanceRate >= 85 ? 'amber' : 'red'}">${d.data.attendanceRate}%</div></div>
      <div class="kpi"><div class="kpi-label">Days Absent (Sick)</div><div class="kpi-value ${d.data.totalSickDays > 0 ? 'red' : 'green'}">${d.data.totalSickDays}</div></div>
      <div class="kpi"><div class="kpi-label">Late Arrivals</div><div class="kpi-value ${d.data.totalLate > 0 ? 'amber' : 'green'}">${d.data.totalLate}</div></div>
      <div class="kpi"><div class="kpi-label">Holidays Taken</div><div class="kpi-value purple">${d.data.totalHolidayDays}</div></div>
      <div class="kpi"><div class="kpi-label">Holiday Balance</div><div class="kpi-value ${d.data.totalHolidayBalance > 0 ? 'green' : 'red'}">${d.data.totalHolidayBalance}</div></div>
      <div class="kpi"><div class="kpi-label">Avg Shift Length</div><div class="kpi-value orange">${d.data.avgShiftLength}</div></div>
    </div>

    <h2>Late Arrivals</h2>
    ${d.data.lateList.length ? `<table><thead><tr><th>Employee</th><th>Date</th><th>Clock In</th><th>Late By</th></tr></thead><tbody>${lateRows}</tbody></table>` : '<div class="empty">No late arrivals in this period</div>'}

    <h2>Absences (Sick Leave)</h2>
    ${d.data.absenceList.length ? `<table><thead><tr><th>Employee</th><th>Dates</th><th>Duration</th><th>Reason</th></tr></thead><tbody>${absRows}</tbody></table>` : '<div class="empty">No sick leave recorded in this period</div>'}

    <div class="footer">${escapeHtml(t.footerText)} &nbsp;|&nbsp; ${new Date().toLocaleString('en-GB')} &nbsp;|&nbsp; Expected start: ${escapeHtml(d.data.expectedStart)}</div>
  </body></html>`;
}

function buildDeliveryNoteHTMLCore(dn, bomJob, proj, job, settingsOverride) {
  const s = _pickTplSettings(settingsOverride);
  const g = s.global || TEMPLATE_DEFAULTS.global;
  const t = s.deliveryNote || TEMPLATE_DEFAULTS.deliveryNote;
  const logo = _logoDataUriCache || '';
  const showLogo = t.showLogo !== false && logo;
  const showCo = t.showCompanyDetails !== false;
  const accent = t.accentColor || TEMPLATE_DEFAULTS.deliveryNote.accentColor;

  const allItems = (bomJob.materialLists || []).flatMap(ml => ml.items || []);
  const dnItems = dn.itemIds.map(id => allItems.find(i => i.id === id)).filter(Boolean);
  const date = new Date(dn.createdAt).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' });

  let html = `<!DOCTYPE html><html><head><meta charset="UTF-8">
<title>${escapeHtml(dn.number)} - Delivery Note</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: Arial, sans-serif; font-size: 12px; padding: 20px; color: #222; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 20px; padding-bottom: 16px; border-bottom: 2px solid #222; gap: 20px; }
  .company { font-size: 22px; font-weight: 700; color: ${accent}; letter-spacing: 1px; }
  .company-sub { font-size: 9px; color: #666; margin-top: 4px; line-height: 1.4; white-space: pre-line; }
  .header-logo { max-width: 110px; max-height: 60px; object-fit: contain; margin-right: 12px; }
  .header-left { display: flex; align-items: flex-start; flex: 1; }
  .header-right { text-align: right; }
  .dn-title { font-size: 20px; font-weight: 700; font-style: italic; color: ${accent}; margin-bottom: 8px; }
  .meta-grid { display: grid; grid-template-columns: auto 1fr; gap: 4px 12px; font-size: 11px; text-align: left; }
  .meta-label { font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin: 16px 0; }
  th { background: #f5f5f5; border: 1px solid #ccc; padding: 6px 8px; text-align: left; font-size: 11px; font-weight: 600; }
  td { border: 1px solid #ccc; padding: 5px 8px; font-size: 11px; }
  .sign-section { margin-top: 30px; display: grid; grid-template-columns: 1fr 1fr; gap: 24px; }
  .sign-box { border: 1px solid #ccc; padding: 12px; min-height: 60px; }
  .sign-label { font-weight: 600; font-size: 10px; margin-bottom: 20px; }
  .total-row td { font-weight: 700; background: #f9f9f9; }
  .terms { margin-top: 20px; font-size: 10px; color: #666; padding-top: 10px; border-top: 1px solid #eee; white-space: pre-line; }
  @media print { body { padding: 10px; } }
</style></head><body>
<div class="header">
  <div class="header-left">
    ${showLogo ? `<img src="${logo}" class="header-logo" alt="">` : ''}
    <div>
      <div class="company">${escapeHtml(g.companyName)}</div>
      ${showCo ? `<div class="company-sub">${escapeHtml(g.address)}${g.phone ? '\nTel: '+escapeHtml(g.phone) : ''}${g.email ? ' \u00b7 '+escapeHtml(g.email) : ''}${g.vatNumber ? '\nVAT: '+escapeHtml(g.vatNumber) : ''}</div>` : ''}
    </div>
  </div>
  <div class="header-right">
    <div class="dn-title">${escapeHtml(t.title)}</div>
    <div class="meta-grid">
      <span class="meta-label">DN Number:</span><span>${escapeHtml(dn.number)}</span>
      <span class="meta-label">Date:</span><span>${date}</span>
      <span class="meta-label">Project:</span><span>${escapeHtml(proj.name || '')}</span>
      <span class="meta-label">Job No:</span><span>${escapeHtml(proj.id || '')}</span>
      ${job && job.name ? `<span class="meta-label">Job:</span><span>${escapeHtml(job.name)}</span>` : ''}
      <span class="meta-label">Destination:</span><span>${escapeHtml(dn.destinationName || dn.destination || '')}</span>
      ${dn.address ? `<span class="meta-label">Address:</span><span>${escapeHtml(dn.address)}</span>` : ''}
      ${dn.siteContact ? `<span class="meta-label">Site Contact:</span><span>${escapeHtml(dn.siteContact)}</span>` : ''}
      ${dn.phone ? `<span class="meta-label">Phone:</span><span>${escapeHtml(dn.phone)}</span>` : ''}
      ${dn.collectionDate ? `<span class="meta-label">Collection Date:</span><span>${new Date(dn.collectionDate).toLocaleDateString('en-GB')}</span>` : ''}
      ${dn.deliveryDate ? `<span class="meta-label">Delivery Date:</span><span>${new Date(dn.deliveryDate).toLocaleDateString('en-GB')}</span>` : ''}
    </div>
  </div>
</div>
<table>
<thead><tr><th>Mark</th><th>Qty</th><th>Description / Size</th><th>Coating</th><th>Weight (kg)</th></tr></thead>
<tbody>`;

  let totalWt = 0;
  for (const item of dnItems) {
    const wt = item.totalWeight || item.weightPerUnit || 0;
    totalWt += wt;
    html += `<tr>
      <td style="font-weight:600">${escapeHtml(item.mark || '')}</td>
      <td>${item.quantity || ''}</td>
      <td>${escapeHtml(item.description || item.size || '')}</td>
      <td>${escapeHtml(item.coating || '')}</td>
      <td style="text-align:right">${wt ? wt.toLocaleString('en-GB') : ''}</td>
    </tr>`;
  }
  html += `<tr class="total-row">
    <td colspan="4" style="text-align:right">Total Weight:</td>
    <td style="text-align:right">${totalWt.toLocaleString('en-GB')} kg</td>
  </tr></tbody></table>`;

  if (t.showSignatureBlock !== false) {
    html += `<div class="sign-section">
      <div class="sign-box">
        <div class="sign-label">Delivered By:</div>
        <div style="border-bottom:1px solid #999;margin-top:24px;padding-bottom:4px"></div>
        <div style="font-size:10px;color:#666;margin-top:4px">Date Delivered:</div>
      </div>
      <div class="sign-box">
        <div class="sign-label">Received By:</div>
        <div style="border-bottom:1px solid #999;margin-top:24px;padding-bottom:4px"></div>
        <div style="font-size:10px;color:#666;margin-top:4px">Date Received:</div>
      </div>
    </div>`;
  }
  if (t.termsText) {
    html += `<div class="terms">${escapeHtml(t.termsText)}</div>`;
  }
  html += `</body></html>`;
  return html;
}

// ═══════════════════════════════════════════
// TENDERS & CLIENTS
// ═══════════════════════════════════════════
let tendersData = [];
let clientsData = [];
let currentTender = null;
let _clientSearchTimeout = null;

// ── SharePoint config for Quotation folder ──
const QUOTATION_FOLDER_PATH = 'Quotation'; // root-level in the BAMA drive

async function initTendersPage() {
  // Check if already logged in from office/manager
  const authed = sessionStorage.getItem('bama_mgr_authed');
  if (authed) {
    currentManagerUser = authed;
    const perms = getUserPermissions(currentManagerUser);
    if (perms && perms.tenders) {
      document.getElementById('screenTenderSelect').style.display = 'none';
      document.getElementById('tenderLayout').style.display = 'flex';
      loadTendersData();
      return;
    }
  }
  // Show employee selection grid
  renderTenderEmployeeGrid();
}

// Removed applyTenderTabPermissions — tenders page only shows Tenders + Clients tabs now

async function loadTendersData() {
  try {
    const [tenders, clients] = await Promise.all([
      api.get('/api/tenders'),
      api.get('/api/clients')
    ]);
    tendersData = tenders || [];
    clientsData = clients || [];
    renderTenderList();
    renderClientList();
    updateTenderSidebarCrossNav();

    // Backfill ClientContacts from existing tenders (one-time per session)
    backfillContactsFromTenders();
  } catch (err) {
    console.error('Failed to load tenders data:', err);
    toast('Failed to load tenders data', 'error');
  }
}

async function backfillContactsFromTenders() {
  // Build a unique set of (client_id, name, email, phone) tuples from tenders,
  // splitting comma-separated values, then post each one to /api/client-contacts
  // which auto-dedupes against existing entries.
  const seen = new Set();
  const toPost = [];

  const splitDedupe = v => v ? [...new Set(String(v).split(',').map(s => s.trim()).filter(Boolean))] : [];

  for (const t of tendersData) {
    if (!t.client_id) continue;
    const names = splitDedupe(t.contact_name);
    const emails = splitDedupe(t.contact_email);
    const phones = splitDedupe(t.contact_phone);
    const n = Math.max(names.length, emails.length, phones.length);

    for (let i = 0; i < n; i++) {
      const name = names[i] || '';
      const email = emails[i] || '';
      const phone = phones[i] || '';
      if (!name && !email && !phone) continue;

      const key = `${t.client_id}|${name.toLowerCase()}|${email.toLowerCase()}|${phone}`;
      if (seen.has(key)) continue;
      seen.add(key);

      toPost.push({
        client_id: t.client_id,
        contact_name: name || null,
        contact_email: email || null,
        contact_phone: phone || null
      });
    }
  }

  // Fire all backfill posts in parallel (the API handles dedup)
  await Promise.allSettled(toPost.map(payload =>
    api.post('/api/client-contacts', payload).catch(() => null)
  ));
}

function renderTenderEmployeeGrid() {
  const grid = document.getElementById('tenderEmployeeGrid');
  if (!grid) return;

  // Only show office staff (same as office login)
  const empList = (state.timesheetData.employees || []).filter(e => e.active !== false && (e.staffType || 'workshop') === 'office');

  if (!empList.length) {
    grid.innerHTML = '<div class="empty-state" style="padding:30px"><div style="font-size:28px;margin-bottom:10px">&#128101;</div><div>No office staff set up yet.</div><div style="margin-top:8px;font-size:12px;color:var(--subtle)">Go to Manager → Staff to add office employees.</div></div>';
    return;
  }

  grid.innerHTML = empList.map(emp => {
    const ini = (emp.name || '').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    const col = empColor(emp.name);
    return `
      <div class="emp-btn" onclick="selectTenderEmployee('${emp.name.replace(/'/g, "\\\\'")}')" style="padding:22px 14px 16px">
        <div class="emp-avatar" style="width:48px;height:48px;font-size:19px;background:linear-gradient(135deg,${col},#3e1a00)">${ini}</div>
        <div class="emp-name" style="font-size:13px">${emp.name}</div>
        <div style="font-size:10px;color:var(--subtle);margin-top:3px">${emp.hasPin ? '&#128274; PIN set' : '&#128275; No PIN'}</div>
      </div>
    `;
  }).join('');
}

let _pendingTenderUser = null;

function selectTenderEmployee(name) {
  const emp = (state.timesheetData.employees || []).find(e => e.name === name);
  if (!emp) return;

  if (!emp.hasPin) {
    toast('No PIN set for this user. Set one in Staff management first.', 'error');
    return;
  }

  _pendingTenderUser = { name, empId: emp.id };
  document.getElementById('tenderPinUser').textContent = name;
  document.getElementById('tenderPinInput').value = '';
  document.getElementById('tenderPinError').textContent = '';
  document.getElementById('tenderPinModal').classList.add('active');
  setTimeout(() => document.getElementById('tenderPinInput').focus(), 200);
}

async function verifyTenderPin() {
  if (!_pendingTenderUser) return;
  const pin = document.getElementById('tenderPinInput').value;
  if (!pin) return;

  try {
    const result = await api.post('/api/auth/verify-pin', {
      employee_id: _pendingTenderUser.empId,
      pin
    });

    if (!result || !result.valid) {
      document.getElementById('tenderPinError').textContent = (result && result.reason) || 'Incorrect PIN';
      document.getElementById('tenderPinInput').value = '';
      return;
    }

    // PIN correct — check permissions
    currentManagerUser = _pendingTenderUser.name;
    sessionStorage.setItem('bama_mgr_authed', currentManagerUser);
    document.getElementById('tenderPinModal').classList.remove('active');

    const perms = getUserPermissions(currentManagerUser);
    if (!perms || !perms.tenders) {
      toast('You don\'t have permission to access Tenders. Contact your admin.', 'error');
      currentManagerUser = null;
      sessionStorage.removeItem('bama_mgr_authed');
      return;
    }

    // Show main layout, hide login screen
    document.getElementById('screenTenderSelect').style.display = 'none';
    document.getElementById('tenderLayout').style.display = 'flex';
    loadTendersData();

  } catch (err) {
    document.getElementById('tenderPinError').textContent = 'PIN verification failed';
    document.getElementById('tenderPinInput').value = '';
  }
}

// ── Cross-page navigation (Tenders ↔ Quotations) ──
function navToQuotes() {
  const perms = getUserPermissions(currentManagerUser) || {};
  if (!perms.viewQuotes && !perms.editQuotes) {
    toast('You don\'t have permission to access Quotations', 'error');
    return;
  }
  window.location.href = 'quotes.html';
}

function navToTenders() {
  const perms = getUserPermissions(currentManagerUser) || {};
  if (!perms.tenders) {
    toast('You don\'t have permission to access Tenders', 'error');
    return;
  }
  window.location.href = 'tenders.html';
}

function navToBabcock() {
  const perms = getUserPermissions(currentManagerUser) || {};
  if (!perms.tenders) {
    toast('You don\'t have permission to access Babcock Quotes', 'error');
    return;
  }
  window.location.href = 'babcock.html';
}

function updateTenderSidebarCrossNav() {
  const perms = getUserPermissions(currentManagerUser) || {};
  const qBtn = document.getElementById('sidebarBtnQuotations');
  if (qBtn) {
    const hasAccess = !!(perms.viewQuotes || perms.editQuotes);
    qBtn.disabled = !hasAccess;
    qBtn.style.opacity = hasAccess ? '' : '0.35';
    qBtn.style.cursor = hasAccess ? '' : 'not-allowed';
    qBtn.title = hasAccess ? '' : 'You don\'t have permission to access Quotations';
  }
  // Babcock uses same tenders permission — always enabled if on tenders page
}

function updateQuotesSidebarCrossNav() {
  const perms = getUserPermissions(currentManagerUser) || {};
  const tBtn = document.getElementById('sidebarBtnTenders');
  if (tBtn) {
    tBtn.disabled = !perms.tenders;
    tBtn.style.opacity = perms.tenders ? '' : '0.35';
    tBtn.style.cursor = perms.tenders ? '' : 'not-allowed';
    tBtn.title = perms.tenders ? '' : 'You don\'t have permission to access Tenders';
  }
  const bBtn = document.getElementById('sidebarBtnBabcockQuotes');
  if (bBtn) {
    bBtn.disabled = !perms.tenders;
    bBtn.style.opacity = perms.tenders ? '' : '0.35';
    bBtn.style.cursor = perms.tenders ? '' : 'not-allowed';
  }
}

// ── Tab switching ──
function switchTenderTab(tab) {
  // Permission gate
  const perms = getUserPermissions(currentManagerUser) || {};
  if (tab === 'tenders' && !perms.tenders) { toast('No permission to view Tenders', 'error'); return; }

  document.querySelectorAll('#tenderLayout .tab-content').forEach(el => {
    el.classList.remove('active');
    el.style.display = 'none';
  });
  const target = document.getElementById(`tab-${tab}`);
  if (target) { target.classList.add('active'); target.style.display = ''; }

  document.querySelectorAll('#tenderSidebar .sidebar-nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });

  const titles = { tenders: 'TENDERS', clients: 'CLIENT DATABASE' };
  const titleEl = document.getElementById('tenderPageTitle');
  if (titleEl) titleEl.textContent = titles[tab] || 'TENDERS';

  // Hide "+ New Tender" button when not on tenders tab
  const newBtn = document.getElementById('btnNewTender');
  if (newBtn) newBtn.style.display = (tab === 'tenders' && perms.tenders) ? '' : 'none';

  if (tab === 'clients') renderClientList();
}

// ── Render Tender List ──
function renderTenderList() {
  const container = document.getElementById('tenderListContainer');
  if (!container) return;

  const search = (document.getElementById('tenderSearch')?.value || '').toLowerCase();
  const statusFilter = document.getElementById('tenderStatusFilter')?.value || '';

  let list = tendersData.filter(t => {
    if (statusFilter && t.status !== statusFilter) return false;
    if (search) {
      const hay = `${t.reference} ${t.project_name} ${t.company_name} ${t.contact_name || ''}`.toLowerCase();
      if (!hay.includes(search)) return false;
    }
    return true;
  });

  if (!list.length) {
    container.innerHTML = '<div class="empty-state" style="padding:24px"><div class="icon">📋</div>No tenders found</div>';
    return;
  }

  container.innerHTML = list.map(t => `
    <div class="tender-row" onclick="openTenderDetail(${t.id})">
      <div style="font-family:var(--font-mono);font-weight:600;font-size:14px;min-width:80px;color:var(--accent)">${t.reference}</div>
      <div style="flex:1">
        <div style="font-weight:500">${t.project_name}</div>
        <div style="font-size:12px;color:var(--muted)">${t.company_name}${t.contact_name ? ' · ' + String(t.contact_name).split(',')[0].trim() : ''}</div>
      </div>
      ${renderDeadlineBadge(t.deadline_date, t.status)}
      <span class="tag tag-${t.status === 'tender' ? 'pending' : t.status === 'quote' ? 'approved' : t.status === 'won' ? 'approved' : t.status === 'lost' ? 'rejected' : 'pending'}">${t.status}</span>
      <div style="font-size:11px;color:var(--subtle);min-width:75px;text-align:right">${fmtDateStr(t.created_at?.split('T')[0] || '')}</div>
    </div>
  `).join('');
}

// Returns a styled deadline badge based on how close/past the deadline is
function renderDeadlineBadge(deadlineDate, status) {
  if (!deadlineDate) return '<div style="min-width:90px"></div>';
  const dateStr = String(deadlineDate).split('T')[0];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const dl = new Date(dateStr + 'T00:00:00');
  const diffDays = Math.round((dl - today) / 86400000);

  // Don't highlight if status is finalised (won, lost, cancelled)
  const isFinalised = ['won', 'lost', 'cancelled'].includes(status);

  let bg = 'transparent';
  let color = 'var(--muted)';
  let border = '1px solid var(--border)';
  let label = fmtDateStr(dateStr);

  if (!isFinalised) {
    if (diffDays < 0) {
      // Overdue — red
      bg = 'rgba(220,38,38,.12)';
      color = '#fca5a5';
      border = '1px solid rgba(220,38,38,.4)';
      label = `${fmtDateStr(dateStr)} (${Math.abs(diffDays)}d overdue)`;
    } else if (diffDays === 0) {
      bg = 'rgba(220,38,38,.12)';
      color = '#fca5a5';
      border = '1px solid rgba(220,38,38,.4)';
      label = `${fmtDateStr(dateStr)} (today)`;
    } else if (diffDays <= 3) {
      // Within 3 days — yellow/amber
      bg = 'rgba(234,179,8,.12)';
      color = '#fde047';
      border = '1px solid rgba(234,179,8,.4)';
      label = `${fmtDateStr(dateStr)} (${diffDays}d left)`;
    }
  }

  return `<div style="font-size:11px;font-weight:600;padding:4px 10px;border-radius:6px;background:${bg};color:${color};border:${border};min-width:90px;text-align:center;white-space:nowrap" title="Deadline: ${dateStr}">${label}</div>`;
}

// ── Render Quote List (status=quote/won/lost) ──
function renderQuoteList() {
  const container = document.getElementById('quoteListContainer');
  if (!container) return;

  const search = (document.getElementById('quoteSearch')?.value || '').toLowerCase();
  const statusFilter = document.getElementById('quoteStatusFilter')?.value || '';
  let list = tendersData.filter(t => ['quote', 'won', 'lost', 'too_late', 'not_interested'].includes(t.status));

  if (statusFilter) list = list.filter(t => t.status === statusFilter);

  if (search) {
    list = list.filter(t => {
      const hay = `${t.reference} ${t.project_name} ${t.company_name}`.toLowerCase();
      return hay.includes(search);
    });
  }

  if (!list.length) {
    container.innerHTML = '<div class="empty-state" style="padding:24px"><div class="icon">📊</div>No quotes yet</div>';
    return;
  }

  const onClickFn = CURRENT_PAGE === 'quotes' ? 'openQuoteDetail' : 'openTenderDetail';

  const statusMeta = {
    quote:          { label: 'Quote',          cls: 'tag-approved' },
    won:            { label: 'Won',            cls: 'tag-approved' },
    lost:           { label: 'Lost',           cls: 'tag-rejected' },
    too_late:       { label: 'Too Late',       cls: 'tag-rejected' },
    not_interested: { label: 'Not Interested', cls: 'tag-pending'  }
  };

  const rows = list.map(t => {
    const meta = statusMeta[t.status] || { label: t.status, cls: 'tag-pending' };
    const value = t.quote_value != null ? `£${parseFloat(t.quote_value).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
    const sentDate = t.sent_date ? fmtDateStr(String(t.sent_date).split('T')[0]) : '—';
    const chasingDate = t.chasing_date ? fmtDateStr(String(t.chasing_date).split('T')[0]) : '—';

    // Chasing date highlight — amber if within 3 days, red if past
    let chasingStyle = 'color:var(--muted)';
    if (t.chasing_date && !['won','lost','too_late','not_interested'].includes(t.status)) {
      const today = new Date(); today.setHours(0,0,0,0);
      const cd = new Date(String(t.chasing_date).split('T')[0] + 'T00:00:00');
      const diff = Math.round((cd - today) / 86400000);
      if (diff < 0) chasingStyle = 'color:var(--red);font-weight:600';
      else if (diff <= 3) chasingStyle = 'color:var(--amber);font-weight:600';
    }

    return `
      <div class="quote-row" onclick="${onClickFn}(${t.id})">
        <div class="quote-col-ref">${t.reference}</div>
        <div class="quote-col-project">
          <div style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(t.project_name)}</div>
          <div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(t.company_name)}</div>
        </div>
        <div class="quote-col-value" style="font-family:var(--font-mono);font-size:13px">${value}</div>
        <div class="quote-col-date" style="color:var(--muted);font-size:12px">${sentDate}</div>
        <div class="quote-col-date" style="font-size:12px;${chasingStyle}">${chasingDate}</div>
        <div class="quote-col-status"><span class="tag ${meta.cls}">${meta.label}</span></div>
      </div>`;
  }).join('');

  container.innerHTML = rows;
}

// ── Render Client List ──
function renderClientList() {
  const container = document.getElementById('clientListContainer');
  if (!container) return;

  const search = (document.getElementById('clientSearch')?.value || '').toLowerCase();
  let list = clientsData.filter(c => c.is_active !== false && c.is_active !== 0);

  if (search) {
    list = list.filter(c => {
      const hay = `${c.company_name} ${c.contact_name || ''} ${c.contact_email || ''}`.toLowerCase();
      return hay.includes(search);
    });
  }

  if (!list.length) {
    container.innerHTML = '<div class="empty-state" style="padding:24px"><div class="icon">🏢</div>No clients found</div>';
    return;
  }

  container.innerHTML = list.map(c => `
    <div class="client-collapsible" data-client-id="${c.id}" style="border-bottom:1px solid var(--border)">
      <div class="client-header" onclick="toggleClientCollapse(${c.id})" style="display:flex;align-items:center;gap:12px;padding:14px 16px;cursor:pointer;transition:background .15s">
        <div style="flex:1">
          <div style="font-weight:600">${escapeHtml(c.company_name)}</div>
          <div style="font-size:12px;color:var(--muted)">${escapeHtml([c.address_line1, c.city, c.postcode].filter(Boolean).join(', '))}</div>
        </div>
        <button class="tiny-btn" onclick="event.stopPropagation();openClientDetail(${c.id})" style="padding:4px 12px;font-size:11px;background:var(--surface2);color:var(--muted);border:1px solid var(--border)" title="Open full client page">↗ Open</button>
        <button class="tiny-btn" onclick="event.stopPropagation();openEditClientModal(${c.id})" style="padding:4px 10px;font-size:11px;background:var(--surface2);color:var(--muted);border:1px solid var(--border)" title="Edit client">✏️</button>
        <div class="client-chevron" id="chevron-${c.id}" style="font-size:22px;color:var(--accent);transition:transform .2s;width:28px;text-align:center">▾</div>
      </div>
      <div class="client-body" id="client-body-${c.id}" style="display:none;padding:0 16px 16px 16px;background:rgba(0,0,0,.15)">
        <div id="client-contacts-${c.id}" style="margin-top:8px">
          <div style="font-size:12px;color:var(--subtle);padding:8px">Loading contacts...</div>
        </div>
      </div>
    </div>
  `).join('');
}

async function toggleClientCollapse(clientId) {
  const body = document.getElementById(`client-body-${clientId}`);
  const chevron = document.getElementById(`chevron-${clientId}`);
  if (!body || !chevron) return;

  if (body.style.display === 'none') {
    body.style.display = '';
    chevron.style.transform = 'rotate(180deg)';
    // Load contacts inline
    await renderInlineClientContacts(clientId);
  } else {
    body.style.display = 'none';
    chevron.style.transform = '';
  }
}

async function renderInlineClientContacts(clientId) {
  const container = document.getElementById(`client-contacts-${clientId}`);
  if (!container) return;

  try {
    const contacts = await api.get(`/api/client-contacts?client_id=${clientId}`);

    if (!contacts || !contacts.length) {
      container.innerHTML = `
        <div style="font-size:13px;color:var(--subtle);padding:16px;text-align:center">
          No contacts yet for this client.
          <button class="tiny-btn" onclick="quickAddContactToClient(${clientId})" style="padding:4px 12px;font-size:11px;margin-left:8px;background:var(--accent);color:#fff;border:none">+ Add Contact</button>
        </div>
      `;
      return;
    }

    container.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="font-size:11px;color:var(--accent2);font-weight:600;text-transform:uppercase;letter-spacing:.5px">Contacts (${contacts.length})</div>
        <button class="tiny-btn" onclick="quickAddContactToClient(${clientId})" style="padding:3px 10px;font-size:11px;background:var(--surface2);color:var(--muted);border:1px solid var(--border)">+ Add</button>
      </div>
      ${contacts.map((c, i) => `
        <div style="padding:10px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-bottom:6px;display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">
              <div style="font-weight:600;font-size:13px">${escapeHtml(c.contact_name || '—')}</div>
              ${c.role ? `<div style="font-size:11px;color:var(--accent2);background:rgba(255,107,0,.08);padding:2px 8px;border-radius:4px">${escapeHtml(c.role)}</div>` : ''}
            </div>
            <div style="display:grid;grid-template-columns:auto 1fr;gap:3px 12px;font-size:12px;margin-top:4px">
              ${c.contact_email ? `<div style="color:var(--subtle);font-weight:600">Email</div><div><a href="mailto:${escapeHtml(c.contact_email)}" style="color:var(--accent2);text-decoration:none">${escapeHtml(c.contact_email)}</a></div>` : ''}
              ${c.contact_phone ? `<div style="color:var(--subtle);font-weight:600">Phone</div><div><a href="tel:${escapeHtml(c.contact_phone)}" style="color:var(--accent2);text-decoration:none">${escapeHtml(c.contact_phone)}</a></div>` : ''}
            </div>
            ${c.notes ? `<div style="font-size:12px;color:var(--muted);margin-top:6px;font-style:italic">${escapeHtml(c.notes)}</div>` : ''}
          </div>
          <button class="tiny-btn" onclick="quickEditContact(${clientId}, ${c.id})" style="padding:4px 10px;font-size:11px;background:var(--surface2);color:var(--muted);border:1px solid var(--border)" title="Edit">✏️</button>
        </div>
      `).join('')}
    `;
  } catch (err) {
    container.innerHTML = '<div style="font-size:12px;color:var(--red);padding:8px">Failed to load contacts</div>';
  }
}

// Quick add/edit contact helpers — set up the modal then it'll refresh inline contacts when saved
async function quickAddContactToClient(clientId) {
  // Set currentClient to this client so the modal works
  let client = clientsData.find(c => String(c.id) === String(clientId));
  if (!client) return;
  currentClient = client;
  // Pre-load contacts cache so submitContactModal's loadClientContacts works,
  // but also override to refresh the inline list
  currentClientContacts = [];
  openAddContactModal();
  // Override the close behaviour to refresh inline list too
  _contactModalRefreshFn = () => renderInlineClientContacts(clientId);
}

async function quickEditContact(clientId, contactId) {
  let client = clientsData.find(c => String(c.id) === String(clientId));
  if (!client) return;
  currentClient = client;
  // Need to load contacts first so openEditContactModal can find it
  try {
    currentClientContacts = await api.get(`/api/client-contacts?client_id=${clientId}`) || [];
  } catch (e) { currentClientContacts = []; }
  openEditContactModal(contactId);
  _contactModalRefreshFn = () => renderInlineClientContacts(clientId);
}

let _contactModalRefreshFn = null;

// ── Client Autocomplete ──
function onClientSearch(value) {
  clearTimeout(_clientSearchTimeout);
  const dropdown = document.getElementById('ntClientSuggestions');

  if (!value || value.length < 2) {
    dropdown.style.display = 'none';
    document.getElementById('ntClientId').value = '';
    return;
  }

  _clientSearchTimeout = setTimeout(() => {
    const matches = clientsData.filter(c =>
      c.company_name.toLowerCase().includes(value.toLowerCase())
    );

    if (!matches.length) {
      dropdown.style.display = 'none';
      document.getElementById('ntClientId').value = '';
      return;
    }

    dropdown.innerHTML = matches.map(c => `
      <div class="autocomplete-item" onclick="selectClient(${c.id})">
        <div class="ac-company">${c.company_name}</div>
        <div class="ac-contact">${c.contact_name || ''} ${c.contact_email ? '· ' + c.contact_email : ''}</div>
      </div>
    `).join('');
    dropdown.style.display = '';
  }, 200);
}

function selectClient(clientId) {
  const client = clientsData.find(c => c.id === clientId);
  if (!client) return;

  document.getElementById('ntClientId').value = client.id;
  document.getElementById('ntCompanyName').value = client.company_name;
  document.getElementById('ntAddress1').value = client.address_line1 || '';
  document.getElementById('ntAddress2').value = client.address_line2 || '';
  document.getElementById('ntCity').value = client.city || '';
  document.getElementById('ntCounty').value = client.county || '';
  document.getElementById('ntPostcode').value = client.postcode || '';
  // Contact fields left blank — they vary per project/location
  document.getElementById('ntContactName').value = '';
  document.getElementById('ntContactEmail').value = '';
  document.getElementById('ntContactPhone').value = '';
  document.getElementById('ntClientSuggestions').style.display = 'none';
}

// ── New Tender Modal ──
async function openNewTenderModal() {
  // Clear form
  ['ntClientId','ntCompanyName','ntAddress1','ntAddress2','ntCity','ntCounty',
   'ntPostcode','ntContactName','ntContactEmail','ntContactPhone',
   'ntProjectName','ntComments'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('ntClientSuggestions').style.display = 'none';

  // Set deadline to today as default
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  document.getElementById('ntDeadline').value = todayStr;

  // Generate next reference by scanning SharePoint + database
  try {
    const ref = await getNextTenderReference();
    document.getElementById('ntReference').textContent = ref;
  } catch (e) {
    console.error('Reference generation failed:', e);
    document.getElementById('ntReference').textContent = '—';
  }

  document.getElementById('newTenderModal').classList.add('active');
}

async function getNextTenderReference() {
  const now = new Date();
  const yy = String(now.getFullYear()).slice(-2); // "26"
  const fullYear = '20' + yy;
  const yearNum = parseInt(fullYear);
  const yearPrefix = String(yearNum - 2023).padStart(2, '0'); // 2026→03, 2027→04
  const yearFolderName = `${yearPrefix} - ${fullYear}`; // "03 - 2026"
  const prefix = `Q${yy}`; // "Q26"

  let highestNum = 0;

  // 1. Check SharePoint — scan the year folder for existing quote folders
  try {
    const token = await getToken();
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${BAMA_DRIVE_ID}/root:/${QUOTATION_FOLDER_PATH}/${yearFolderName}:/children?$select=name&$top=999`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (res.ok) {
      const data = await res.json();
      (data.value || []).forEach(item => {
        // Match folders like Q260426, "Q260426 - Client Name" etc
        const match = item.name.match(new RegExp(`^${prefix}(\\d+)`));
        if (match) {
          const num = parseInt(match[1], 10);
          if (num > highestNum) highestNum = num;
        }
      });
    }
  } catch (e) {
    console.warn('SharePoint scan failed, falling back to DB only:', e);
  }

  // 2. Also check database for any that might not have SP folders yet
  try {
    const dbData = await api.get(`/api/tender-next-ref?year=${yy}`);
    // dbData.count is the DB count + 1, so the highest DB number is count - 1
    const dbHighest = (dbData.count || 1) - 1;
    if (dbHighest > highestNum) highestNum = dbHighest;
  } catch (e) {
    console.warn('DB reference check failed:', e);
  }

  const nextNum = highestNum + 1;
  return `${prefix}${String(nextNum).padStart(2, '0')}`;
}

function closeNewTenderModal() {
  document.getElementById('newTenderModal').classList.remove('active');
}

async function submitNewTender() {
  const companyName = document.getElementById('ntCompanyName').value.trim();
  const projectName = document.getElementById('ntProjectName').value.trim();
  const deadline = document.getElementById('ntDeadline').value;
  const reference = document.getElementById('ntReference').textContent;

  if (!companyName) { toast('Company name is required', 'error'); return; }
  if (!projectName) { toast('Project name is required', 'error'); return; }
  if (!deadline) { toast('Deadline date is required', 'error'); return; }
  if (!reference || reference === '—') { toast('Reference could not be generated', 'error'); return; }

  try {
    // Step 1: Create or find the client
    let clientId = document.getElementById('ntClientId').value;

    if (!clientId) {
      // New client — create it
      const newClient = await api.post('/api/clients', {
        company_name: companyName,
        address_line1: document.getElementById('ntAddress1').value.trim() || null,
        address_line2: document.getElementById('ntAddress2').value.trim() || null,
        city: document.getElementById('ntCity').value.trim() || null,
        county: document.getElementById('ntCounty').value.trim() || null,
        postcode: document.getElementById('ntPostcode').value.trim() || null,
        contact_name: document.getElementById('ntContactName').value.trim() || null,
        contact_email: document.getElementById('ntContactEmail').value.trim() || null,
        contact_phone: document.getElementById('ntContactPhone').value.trim() || null
      });
      clientId = newClient.id;
      clientsData.push(newClient);
    }

    // Step 2: Create SharePoint folders
    const token = await getToken();
    const fullYear = '20' + reference.slice(1, 3); // Q260402 → 2026
    const yearNum = parseInt(fullYear);
    const yearPrefix = String(yearNum - 2023).padStart(2, '0'); // 2026→03, 2027→04
    const yearFolderName = `${yearPrefix} - ${fullYear}`; // "03 - 2026"

    // Find or create the year folder under Quotation
    const quotationFolder = await getOrCreateFolderByPath(QUOTATION_FOLDER_PATH, token);
    const yearFolder = await createFolderInDrive(quotationFolder.id, yearFolderName);
    const quoteFolder = await createFolderInDrive(yearFolder.id, reference);
    const tenderSubFolder = await createFolderInDrive(quoteFolder.id, '00 - Tender');

    // Step 3: Create the tender record
    const tender = await api.post('/api/tenders', {
      reference,
      client_id: parseInt(clientId),
      project_name: projectName,
      comments: document.getElementById('ntComments').value.trim() || null,
      sharepoint_folder_id: quoteFolder.id,
      sharepoint_tender_folder_id: tenderSubFolder.id,
      created_by: currentManagerUser || AUTH.getUserName() || 'unknown',
      contact_name: document.getElementById('ntContactName').value.trim() || null,
      contact_email: document.getElementById('ntContactEmail').value.trim() || null,
      contact_phone: document.getElementById('ntContactPhone').value.trim() || null,
      deadline_date: deadline
    });

    tender.company_name = companyName;
    tender.contact_name = document.getElementById('ntContactName').value.trim() || null;
    tender.contact_email = document.getElementById('ntContactEmail').value.trim() || null;
    tender.contact_phone = document.getElementById('ntContactPhone').value.trim() || null;
    tender.deadline_date = deadline;
    tendersData.unshift(tender);

    // Auto-save contact to client database (deduped by name + email match)
    if (tender.contact_name || tender.contact_email || tender.contact_phone) {
      try {
        await api.post('/api/client-contacts', {
          client_id: parseInt(clientId),
          contact_name: tender.contact_name,
          contact_email: tender.contact_email,
          contact_phone: tender.contact_phone
        });
      } catch (e) {
        console.warn('Failed to save contact to client database:', e);
      }
    }

    closeNewTenderModal();
    renderTenderList();

    // Go straight to detail view with success message
    toast(`Tender ${reference} created ✓ — Upload your documents below`, 'success');
    currentTender = tender;

    // Show detail view directly
    document.querySelectorAll('#tenderLayout .tab-content').forEach(el => {
      el.classList.remove('active');
      el.style.display = 'none';
    });
    const detailEl = document.getElementById('tab-tenderDetail');
    detailEl.style.display = '';
    detailEl.classList.add('active');

    // Populate detail
    document.getElementById('detailReference').textContent = tender.reference;
    document.getElementById('detailProjectName').textContent = tender.project_name;

    const badge = document.getElementById('detailStatusBadge');
    badge.textContent = tender.status;
    badge.className = 'tag tag-pending';

    // Show deadline
    const deadlineEl = document.getElementById('detailDeadline');
    if (deadlineEl) {
      if (tender.deadline_date) {
        deadlineEl.innerHTML = `<span style="font-size:12px;color:var(--subtle);margin-right:8px">DEADLINE</span>${renderDeadlineBadge(tender.deadline_date, tender.status)}`;
      } else {
        deadlineEl.innerHTML = '';
      }
    }

    const clientInfo = document.getElementById('detailClientInfo');
    const addrLine = [document.getElementById('ntAddress1').value, document.getElementById('ntAddress2').value, document.getElementById('ntCity').value, document.getElementById('ntCounty').value, document.getElementById('ntPostcode').value].filter(v => v && v.trim()).join(', ');
    const splitDedupe2 = v => v ? [...new Set(String(v).split(',').map(s => s.trim()).filter(Boolean))] : [];
    const ns = splitDedupe2(tender.contact_name);
    const es = splitDedupe2(tender.contact_email);
    const ps = splitDedupe2(tender.contact_phone);
    const nc = Math.max(ns.length, es.length, ps.length);
    let cHtml = '';
    for (let i = 0; i < nc; i++) {
      const lbl = nc > 1 ? `Contact ${i + 1}` : 'Contact';
      cHtml += `
        <div style="margin-top:${i > 0 ? '10px' : '0'};padding-top:${i > 0 ? '10px' : '0'};${i > 0 ? 'border-top:1px solid var(--border);' : ''}">
          <div style="font-size:11px;color:var(--accent2);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">${lbl}</div>
          <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 16px;font-size:13px">
            ${ns[i] ? `<div style="color:var(--subtle);font-weight:600">Name</div><div>${escapeHtml(ns[i])}</div>` : ''}
            ${es[i] ? `<div style="color:var(--subtle);font-weight:600">Email</div><div><a href="mailto:${escapeHtml(es[i])}" style="color:var(--accent2);text-decoration:none">${escapeHtml(es[i])}</a></div>` : ''}
            ${ps[i] ? `<div style="color:var(--subtle);font-weight:600">Phone</div><div><a href="tel:${escapeHtml(ps[i])}" style="color:var(--accent2);text-decoration:none">${escapeHtml(ps[i])}</a></div>` : ''}
          </div>
        </div>
      `;
    }
    clientInfo.innerHTML = `
      <div style="font-weight:600;font-size:15px;color:var(--text);margin-bottom:6px">${escapeHtml(companyName)}</div>
      ${addrLine ? `<div style="margin-bottom:14px;color:var(--muted)">${escapeHtml(addrLine)}</div>` : ''}
      ${cHtml || '<div style="font-size:12px;color:var(--subtle)">No contact details</div>'}
    `;

    document.getElementById('convertToQuoteSection').style.display = '';
    document.getElementById('quoteFolderFiles').innerHTML = '<div style="font-size:12px;color:var(--subtle);padding:8px">No files uploaded yet</div>';
    document.getElementById('tenderPackFiles').innerHTML = '<div style="font-size:12px;color:var(--subtle);padding:8px">No files uploaded yet</div>';

    // Load comments (will show the initial comment if entered)
    loadTenderComments();

  } catch (err) {
    toast('Failed to create tender: ' + err.message, 'error');
  }
}

// Helper to find a folder by path from drive root
async function getOrCreateFolderByPath(path, token) {
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${BAMA_DRIVE_ID}/root:/${encodeURIComponent(path)}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  if (res.ok) return await res.json();
  // Doesn't exist — create from root
  const rootRes = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${BAMA_DRIVE_ID}/root`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  const root = await rootRes.json();
  return await createFolderInDrive(root.id, path);
}

// ── Tender Detail ──
async function openTenderDetail(id) {
  let tender = tendersData.find(t => String(t.id) === String(id));
  if (!tender) { toast('Tender not found', 'error'); return; }

  // Always fetch full data from API to ensure we have everything
  try {
    const full = await api.get(`/api/tenders/${id}`);
    Object.assign(tender, full);
  } catch (e) {
    console.warn('Could not fetch full tender data:', e);
  }

  currentTender = tender;

  // Hide other tabs, show detail
  document.querySelectorAll('#tenderLayout .tab-content').forEach(el => {
    el.classList.remove('active');
    el.style.display = 'none';
  });
  const detailEl = document.getElementById('tab-tenderDetail');
  detailEl.style.display = '';
  detailEl.classList.add('active');

  // Populate detail
  document.getElementById('detailReference').textContent = tender.reference;
  document.getElementById('detailProjectName').textContent = tender.project_name;

  const badge = document.getElementById('detailStatusBadge');
  badge.textContent = tender.status;
  badge.className = `tag tag-${tender.status === 'tender' ? 'pending' : tender.status === 'quote' ? 'approved' : tender.status === 'won' ? 'approved' : tender.status === 'lost' ? 'rejected' : 'pending'}`;

  // Deadline
  const deadlineEl = document.getElementById('detailDeadline');
  if (deadlineEl) {
    if (tender.deadline_date) {
      deadlineEl.innerHTML = `<span style="font-size:12px;color:var(--subtle);margin-right:8px">DEADLINE</span>${renderDeadlineBadge(tender.deadline_date, tender.status)}`;
    } else {
      deadlineEl.innerHTML = '';
    }
  }

  // Client info — split comma-separated contact fields into Contact 1, 2, 3
  const clientInfo = document.getElementById('detailClientInfo');
  const addressLine = [tender.address_line1, tender.address_line2, tender.city, tender.county, tender.postcode].filter(Boolean).join(', ');

  // Split + dedupe each contact field
  const splitDedupe = v => v ? [...new Set(String(v).split(',').map(s => s.trim()).filter(Boolean))] : [];
  const names = splitDedupe(tender.contact_name);
  const emails = splitDedupe(tender.contact_email);
  const phones = splitDedupe(tender.contact_phone);
  const numContacts = Math.max(names.length, emails.length, phones.length);

  let contactsHtml = '';
  for (let i = 0; i < numContacts; i++) {
    const name = names[i] || '';
    const email = emails[i] || '';
    const phone = phones[i] || '';
    if (!name && !email && !phone) continue;
    const label = numContacts > 1 ? `Contact ${i + 1}` : 'Contact';
    contactsHtml += `
      <div style="margin-top:${i > 0 ? '10px' : '0'};padding-top:${i > 0 ? '10px' : '0'};${i > 0 ? 'border-top:1px solid var(--border);' : ''}">
        <div style="font-size:11px;color:var(--accent2);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">${label}</div>
        <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 16px;font-size:13px">
          ${name ? `<div style="color:var(--subtle);font-weight:600">Name</div><div>${escapeHtml(name)}</div>` : ''}
          ${email ? `<div style="color:var(--subtle);font-weight:600">Email</div><div><a href="mailto:${escapeHtml(email)}" style="color:var(--accent2);text-decoration:none">${escapeHtml(email)}</a></div>` : ''}
          ${phone ? `<div style="color:var(--subtle);font-weight:600">Phone</div><div><a href="tel:${escapeHtml(phone)}" style="color:var(--accent2);text-decoration:none">${escapeHtml(phone)}</a></div>` : ''}
        </div>
      </div>
    `;
  }

  clientInfo.innerHTML = `
    <div style="font-weight:600;font-size:15px;color:var(--text);margin-bottom:6px">${tender.company_name || '—'}</div>
    ${addressLine ? `<div style="margin-bottom:14px;color:var(--muted)">${escapeHtml(addressLine)}</div>` : ''}
    ${contactsHtml || '<div style="font-size:12px;color:var(--subtle)">No contact details</div>'}
  `;

  // Show/hide convert button
  document.getElementById('convertToQuoteSection').style.display = tender.status === 'tender' ? '' : 'none';

  // Load files from SharePoint
  loadTenderFiles();

  // Load comments
  loadTenderComments();
}

function closeTenderDetail() {
  currentTender = null;
  document.getElementById('tab-tenderDetail').style.display = 'none';
  // Show the previously active tab
  const activeTab = document.querySelector('#tenderSidebar .sidebar-nav-item.active');
  const tab = activeTab?.dataset.tab || 'tenders';
  switchTenderTab(tab);
}

// ── Load files from SharePoint folders ──
async function loadTenderFiles() {
  if (!currentTender) return;
  const token = await getToken();

  // Load quote folder files
  const qContainer = document.getElementById('quoteFolderFiles');
  const tContainer = document.getElementById('tenderPackFiles');

  for (const [folderId, container, label] of [
    [currentTender.sharepoint_folder_id, qContainer, 'quote'],
    [currentTender.sharepoint_tender_folder_id, tContainer, 'tender']
  ]) {
    if (!folderId || !container) { if (container) container.innerHTML = ''; continue; }
    try {
      const res = await fetch(
        `https://graph.microsoft.com/v1.0/drives/${BAMA_DRIVE_ID}/items/${folderId}/children`,
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const data = await res.json();
      const files = (data.value || []).filter(f => !f.folder || f.folder.childCount !== undefined);

      if (!files.length) {
        container.innerHTML = '<div style="font-size:12px;color:var(--subtle);padding:8px">No files uploaded yet</div>';
        continue;
      }

      container.innerHTML = files.map(f => {
        const isFolder = !!f.folder;
        const icon = isFolder ? '📁' : '📄';
        const size = isFolder ? `${f.folder.childCount} items` : formatFileSize(f.size || 0);
        return `<div class="file-chip">
          <span>${icon}</span>
          <a href="${f.webUrl}" target="_blank" style="color:var(--text);text-decoration:none">${f.name}</a>
          <span style="color:var(--subtle);font-size:11px">${size}</span>
        </div>`;
      }).join('');
    } catch (e) {
      container.innerHTML = '<div style="font-size:12px;color:var(--red);padding:8px">Failed to load files</div>';
    }
  }
}

function formatFileSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// ── Tender Comments ──
async function loadTenderComments() {
  if (!currentTender) return;
  const container = document.getElementById('detailCommentsList');
  if (!container) return;

  try {
    const comments = await api.get(`/api/tender-comments?tender_id=${currentTender.id}`);

    // Show original comment as the first item if it exists
    const items = [];
    if (currentTender.comments && currentTender.comments.trim()) {
      items.push({
        id: 'initial',
        comment: currentTender.comments,
        created_by: currentTender.created_by || '—',
        created_at: currentTender.created_at,
        isInitial: true
      });
    }
    items.push(...(comments || []));

    if (!items.length) {
      container.innerHTML = '<div style="font-size:12px;color:var(--subtle);padding:8px 0">No comments yet</div>';
      return;
    }

    container.innerHTML = items.map(c => {
      const date = c.created_at ? new Date(c.created_at) : null;
      const dateStr = date ? `${date.toLocaleDateString('en-GB')} ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : '';
      const deleteBtn = c.isInitial ? '' : `<button class="tiny-btn" onclick="deleteTenderComment(${c.id})" style="padding:2px 6px;font-size:10px;background:transparent;color:var(--subtle);border:none;cursor:pointer" title="Delete">✕</button>`;
      return `
        <div style="padding:10px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <div style="font-size:12px;color:var(--accent2);font-weight:600">${c.created_by || '—'}${c.isInitial ? ' <span style="color:var(--subtle);font-weight:400">(initial)</span>' : ''}</div>
            <div style="display:flex;gap:8px;align-items:center">
              <div style="font-size:11px;color:var(--subtle)">${dateStr}</div>
              ${deleteBtn}
            </div>
          </div>
          <div style="font-size:13px;color:var(--text);white-space:pre-wrap">${escapeHtml(c.comment)}</div>
        </div>
      `;
    }).join('');
  } catch (err) {
    container.innerHTML = '<div style="font-size:12px;color:var(--red);padding:8px">Failed to load comments</div>';
  }
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

async function addTenderComment() {
  if (!currentTender) return;
  const input = document.getElementById('newCommentInput');
  const text = (input.value || '').trim();
  if (!text) { toast('Please enter a comment', 'error'); return; }

  try {
    await api.post('/api/tender-comments', {
      tender_id: currentTender.id,
      comment: text,
      created_by: currentManagerUser || AUTH.getUserName() || 'unknown'
    });
    input.value = '';
    toast('Comment added ✓', 'success');
    loadTenderComments();
  } catch (err) {
    toast('Failed to add comment: ' + err.message, 'error');
  }
}

async function deleteTenderComment(id) {
  if (!confirm('Delete this comment?')) return;
  try {
    await api.delete(`/api/tender-comments/${id}`);
    toast('Comment deleted', 'success');
    loadTenderComments();
  } catch (err) {
    toast('Failed to delete: ' + err.message, 'error');
  }
}

// ── File Upload ──
function handleTenderUpload(event, target) {
  const items = event.dataTransfer?.items;
  if (items) {
    // Handle dropped items (could be folders via webkitGetAsEntry)
    const files = [];
    const entries = [];
    for (let i = 0; i < items.length; i++) {
      const entry = items[i].webkitGetAsEntry?.();
      if (entry) entries.push(entry);
      else if (items[i].kind === 'file') files.push(items[i].getAsFile());
    }
    if (entries.length) {
      readAllEntries(entries).then(allFiles => uploadTenderFiles(allFiles, target));
    } else {
      uploadTenderFiles(files, target);
    }
  } else {
    const files = Array.from(event.dataTransfer?.files || []);
    uploadTenderFiles(files, target);
  }
}

function handleTenderFileSelect(fileList, target) {
  uploadTenderFiles(Array.from(fileList), target);
}

// Recursively read directory entries from drag-drop
async function readAllEntries(entries) {
  const files = [];
  async function processEntry(entry, path) {
    if (entry.isFile) {
      const file = await new Promise(resolve => entry.file(resolve));
      // Preserve relative path for folder uploads
      Object.defineProperty(file, '_relativePath', { value: path + file.name });
      files.push(file);
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const subEntries = await new Promise(resolve => reader.readEntries(resolve));
      for (const sub of subEntries) {
        await processEntry(sub, path + entry.name + '/');
      }
    }
  }
  for (const entry of entries) {
    await processEntry(entry, '');
  }
  return files;
}

async function uploadTenderFiles(files, target) {
  if (!files.length || !currentTender) return;

  const folderId = target === 'tender'
    ? currentTender.sharepoint_tender_folder_id
    : currentTender.sharepoint_folder_id;

  if (!folderId) { toast('SharePoint folder not set', 'error'); return; }

  const modal = document.getElementById('uploadProgressModal');
  modal.classList.add('active');
  const bar = document.getElementById('uploadProgressBar');
  const text = document.getElementById('uploadProgressText');
  const token = await getToken();

  let uploaded = 0;
  const total = files.length;

  for (const file of files) {
    const relativePath = file._relativePath || file.webkitRelativePath || file.name;
    text.textContent = `Uploading ${uploaded + 1}/${total}: ${file.name}`;
    bar.style.width = `${(uploaded / total) * 100}%`;

    try {
      // If the file has a path with folders, create them first
      const parts = relativePath.split('/');
      let parentId = folderId;

      if (parts.length > 1) {
        // Create subdirectories
        for (let i = 0; i < parts.length - 1; i++) {
          const subFolder = await getOrCreateSubfolder(parentId, parts[i]);
          parentId = subFolder.id;
        }
      }

      const fileName = parts[parts.length - 1];
      await uploadFileToFolder(parentId, fileName, file, file.type || 'application/octet-stream');
      uploaded++;
    } catch (err) {
      console.error(`Upload failed for ${file.name}:`, err);
      toast(`Failed to upload ${file.name}`, 'error');
    }
  }

  bar.style.width = '100%';
  text.textContent = `${uploaded}/${total} files uploaded ✓`;

  setTimeout(() => {
    modal.classList.remove('active');
    bar.style.width = '0%';
    loadTenderFiles(); // Refresh file list
    toast(`${uploaded} file${uploaded !== 1 ? 's' : ''} uploaded ✓`, 'success');
  }, 1000);
}

// ── Convert to Quote ──
async function convertToQuote() {
  if (!currentTender) return;

  const settings = state.timesheetData.settings || {};
  const handlerName = settings.quoteHandlerName || '';
  const handlerEmail = settings.quoteHandlerEmail || '';

  if (!handlerName && !handlerEmail) {
    toast('No Quote Handler configured. Go to Manager > Settings to set one.', 'error');
    return;
  }

  if (!confirm(`Convert ${currentTender.reference} to a Quote?\n\nThis will notify ${handlerName || handlerEmail} and create a task for them.`)) return;

  try {
    // Update status
    const updated = await api.put(`/api/tenders/${currentTender.id}`, {
      status: 'quote',
      converted_by: currentManagerUser || AUTH.getUserName() || 'unknown'
    });

    Object.assign(currentTender, updated);

    // Create office task for quote handler
    const task = {
      id: 'task_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      title: `Quote: ${currentTender.reference} — ${currentTender.project_name}`,
      description: `Tender ${currentTender.reference} (${currentTender.company_name}) has been converted to a Quote. Please review and prepare the quotation.`,
      assignedTo: handlerName,
      assignedBy: currentManagerUser || AUTH.getUserName() || 'System',
      dueDate: null,
      priority: 'high',
      status: 'open',
      createdAt: new Date().toISOString()
    };

    officeTasksData.tasks = officeTasksData.tasks || [];
    officeTasksData.tasks.push(task);
    await saveOfficeTasksData();

    // Send email notification
    if (handlerEmail) {
      try {
        const token = await getToken();
        await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: {
              subject: `New Quote Assigned: ${currentTender.reference} — ${currentTender.project_name}`,
              body: {
                contentType: 'HTML',
                content: `<p>Hi ${handlerName || 'there'},</p>
                  <p>Tender <strong>${currentTender.reference}</strong> has been converted to a Quote and assigned to you.</p>
                  <p><strong>Client:</strong> ${currentTender.company_name}<br>
                  <strong>Project:</strong> ${currentTender.project_name}<br>
                  <strong>Converted by:</strong> ${currentManagerUser || AUTH.getUserName() || 'unknown'}</p>
                  <p>Please log in to the BAMA ERP to review and prepare the quotation.</p>`
              },
              toRecipients: [{ emailAddress: { address: handlerEmail } }]
            }
          })
        });
      } catch (mailErr) {
        console.warn('Email notification failed:', mailErr);
        toast('Status updated but email notification failed', 'info');
      }
    }

    // Update UI
    const idx = tendersData.findIndex(t => t.id === currentTender.id);
    if (idx >= 0) tendersData[idx] = currentTender;

    toast(`${currentTender.reference} converted to Quote ✓`, 'success');
    openTenderDetail(currentTender.id); // Refresh the detail view

  } catch (err) {
    toast('Failed to convert: ' + err.message, 'error');
  }
}

// ── Edit Tender Modal ──
function openEditTenderModal() {
  if (!currentTender) return;
  document.getElementById('etTenderId').value = currentTender.id;
  document.getElementById('etProjectName').value = currentTender.project_name || '';
  // Date input expects YYYY-MM-DD format
  let deadlineStr = '';
  if (currentTender.deadline_date) {
    deadlineStr = String(currentTender.deadline_date).split('T')[0];
  }
  document.getElementById('etDeadline').value = deadlineStr;

  // Only show status dropdown for tender/cancelled statuses
  const statusContainer = document.getElementById('etStatus').parentElement;
  const isEditableStatus = ['tender', 'cancelled'].includes(currentTender.status);
  statusContainer.style.display = isEditableStatus ? '' : 'none';
  if (isEditableStatus) {
    document.getElementById('etStatus').value = currentTender.status || 'tender';
  }

  document.getElementById('editTenderModal').classList.add('active');
}

function closeEditTenderModal() {
  document.getElementById('editTenderModal').classList.remove('active');
}

async function submitEditTender() {
  const id = document.getElementById('etTenderId').value;
  const projectName = document.getElementById('etProjectName').value.trim();
  const deadline = document.getElementById('etDeadline').value;

  if (!projectName) { toast('Project name is required', 'error'); return; }

  // Only include status in payload if it was shown (tender/cancelled only)
  const statusContainer = document.getElementById('etStatus').parentElement;
  const payload = {
    project_name: projectName,
    deadline_date: deadline || null
  };
  if (statusContainer.style.display !== 'none') {
    payload.status = document.getElementById('etStatus').value;
  }

  try {
    const updated = await api.put(`/api/tenders/${id}`, payload);

    const idx = tendersData.findIndex(t => String(t.id) === String(id));
    if (idx >= 0) Object.assign(tendersData[idx], updated);
    if (currentTender && String(currentTender.id) === String(id)) Object.assign(currentTender, updated);

    closeEditTenderModal();
    toast('Tender updated ✓', 'success');
    openTenderDetail(parseInt(id));
    renderTenderList();
  } catch (err) {
    toast('Failed to update: ' + err.message, 'error');
  }
}

// ── New Client Modal ──
function openNewClientModal() {
  ['ncCompanyName','ncAddress1','ncAddress2','ncCity','ncCounty','ncPostcode',
   'ncContactName','ncContactEmail','ncContactPhone'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('newClientModal').classList.add('active');
}

function closeNewClientModal() {
  document.getElementById('newClientModal').classList.remove('active');
}

async function submitNewClient() {
  const companyName = document.getElementById('ncCompanyName').value.trim();
  if (!companyName) { toast('Company name is required', 'error'); return; }

  try {
    const client = await api.post('/api/clients', {
      company_name: companyName,
      address_line1: document.getElementById('ncAddress1').value.trim() || null,
      address_line2: document.getElementById('ncAddress2').value.trim() || null,
      city: document.getElementById('ncCity').value.trim() || null,
      county: document.getElementById('ncCounty').value.trim() || null,
      postcode: document.getElementById('ncPostcode').value.trim() || null,
      contact_name: document.getElementById('ncContactName').value.trim() || null,
      contact_email: document.getElementById('ncContactEmail').value.trim() || null,
      contact_phone: document.getElementById('ncContactPhone').value.trim() || null
    });

    clientsData.push(client);
    closeNewClientModal();
    toast(`Client "${companyName}" created ✓`, 'success');
    renderClientList();
  } catch (err) {
    toast('Failed to create client: ' + err.message, 'error');
  }
}

// ── Edit Client ──
function openEditClientModal(id) {
  const client = clientsData.find(c => c.id === id);
  if (!client) { toast('Client not found', 'error'); return; }

  document.getElementById('ecClientId').value = client.id;
  document.getElementById('ecCompanyName').value = client.company_name || '';
  document.getElementById('ecAddress1').value = client.address_line1 || '';
  document.getElementById('ecAddress2').value = client.address_line2 || '';
  document.getElementById('ecCity').value = client.city || '';
  document.getElementById('ecCounty').value = client.county || '';
  document.getElementById('ecPostcode').value = client.postcode || '';
  document.getElementById('ecContactName').value = client.contact_name || '';
  document.getElementById('ecContactEmail').value = client.contact_email || '';
  document.getElementById('ecContactPhone').value = client.contact_phone || '';
  document.getElementById('editClientModal').classList.add('active');
}

function closeEditClientModal() {
  document.getElementById('editClientModal').classList.remove('active');
}

async function submitEditClient() {
  const id = document.getElementById('ecClientId').value;
  const companyName = document.getElementById('ecCompanyName').value.trim();
  if (!companyName) { toast('Company name is required', 'error'); return; }

  try {
    const updated = await api.put(`/api/clients/${id}`, {
      company_name: companyName,
      address_line1: document.getElementById('ecAddress1').value.trim() || null,
      address_line2: document.getElementById('ecAddress2').value.trim() || null,
      city: document.getElementById('ecCity').value.trim() || null,
      county: document.getElementById('ecCounty').value.trim() || null,
      postcode: document.getElementById('ecPostcode').value.trim() || null,
      contact_name: document.getElementById('ecContactName').value.trim() || null,
      contact_email: document.getElementById('ecContactEmail').value.trim() || null,
      contact_phone: document.getElementById('ecContactPhone').value.trim() || null
    });

    const idx = clientsData.findIndex(c => String(c.id) === String(id));
    if (idx >= 0) Object.assign(clientsData[idx], updated);

    closeEditClientModal();
    toast('Client updated ✓', 'success');
    renderClientList();
    // If client detail is open for this client, refresh it
    if (currentClient && String(currentClient.id) === String(id)) {
      openClientDetail(id);
    }
  } catch (err) {
    toast('Failed to update client: ' + err.message, 'error');
  }
}

// ═══════════════════════════════════════════
// CLIENT DETAIL VIEW
// ═══════════════════════════════════════════
let currentClient = null;
let currentClientContacts = [];

async function openClientDetail(id) {
  let client = clientsData.find(c => String(c.id) === String(id));
  if (!client) { toast('Client not found', 'error'); return; }

  // Fetch fresh data
  try {
    const full = await api.get(`/api/clients/${id}`);
    Object.assign(client, full);
  } catch (e) { console.warn('Could not refresh client:', e); }

  currentClient = client;

  // Page-aware: tenders.html uses #tenderLayout, quotes.html uses #quotesLayout
  const layoutSelector = CURRENT_PAGE === 'quotes' ? '#quotesLayout' : '#tenderLayout';
  document.querySelectorAll(`${layoutSelector} .tab-content`).forEach(el => {
    el.classList.remove('active');
    el.style.display = 'none';
  });
  const detailEl = document.getElementById('tab-clientDetail');
  detailEl.style.display = '';
  detailEl.classList.add('active');

  // Populate
  document.getElementById('clientDetailName').textContent = client.company_name;
  const addrLine = [client.address_line1, client.address_line2, client.city, client.county, client.postcode].filter(Boolean).join(', ');
  document.getElementById('clientDetailAddress').textContent = addrLine || '—';

  // Load contacts and tenders for this client
  loadClientContacts(id);
  renderClientTendersList(id);
}

function closeClientDetail() {
  currentClient = null;
  document.getElementById('tab-clientDetail').style.display = 'none';
  document.getElementById('tab-clientDetail').classList.remove('active');
  if (CURRENT_PAGE === 'quotes') {
    switchQuotesTab('clients');
  } else {
    switchTenderTab('clients');
  }
}

function openEditClientFromDetail() {
  if (!currentClient) return;
  openEditClientModal(currentClient.id);
}

async function loadClientContacts(clientId) {
  const container = document.getElementById('clientContactsList');
  if (!container) return;

  try {
    const contacts = await api.get(`/api/client-contacts?client_id=${clientId}`);
    currentClientContacts = contacts || [];

    if (!currentClientContacts.length) {
      container.innerHTML = '<div class="empty-state" style="padding:20px"><div style="font-size:24px;margin-bottom:6px">👥</div>No contacts yet — add the first one above</div>';
      return;
    }

    container.innerHTML = currentClientContacts.map(c => `
      <div style="padding:12px 14px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;gap:10px;align-items:baseline;flex-wrap:wrap">
            <div style="font-weight:600;font-size:14px">${escapeHtml(c.contact_name || '—')}</div>
            ${c.role ? `<div style="font-size:11px;color:var(--accent2);background:rgba(255,107,0,.08);padding:2px 8px;border-radius:4px">${escapeHtml(c.role)}</div>` : ''}
          </div>
          <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 12px;font-size:12px;margin-top:6px">
            ${c.contact_email ? `<div style="color:var(--subtle);font-weight:600">Email</div><div><a href="mailto:${escapeHtml(c.contact_email)}" style="color:var(--accent2);text-decoration:none">${escapeHtml(c.contact_email)}</a></div>` : ''}
            ${c.contact_phone ? `<div style="color:var(--subtle);font-weight:600">Phone</div><div><a href="tel:${escapeHtml(c.contact_phone)}" style="color:var(--accent2);text-decoration:none">${escapeHtml(c.contact_phone)}</a></div>` : ''}
          </div>
          ${c.notes ? `<div style="font-size:12px;color:var(--muted);margin-top:6px;font-style:italic">${escapeHtml(c.notes)}</div>` : ''}
        </div>
        <button class="tiny-btn" onclick="openEditContactModal(${c.id})" style="padding:4px 10px;font-size:11px;background:var(--surface2);color:var(--muted);border:1px solid var(--border)" title="Edit">✏️</button>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = '<div style="font-size:12px;color:var(--red);padding:8px">Failed to load contacts</div>';
  }
}

function renderClientTendersList(clientId) {
  const container = document.getElementById('clientTendersList');
  if (!container) return;

  const list = tendersData.filter(t => String(t.client_id) === String(clientId));
  if (!list.length) {
    container.innerHTML = '<div class="empty-state" style="padding:20px"><div style="font-size:24px;margin-bottom:6px">📋</div>No tenders yet for this client</div>';
    return;
  }

  container.innerHTML = list.map(t => `
    <div class="tender-row" onclick="openTenderDetail(${t.id})">
      <div style="font-family:var(--font-mono);font-weight:600;font-size:14px;min-width:80px;color:var(--accent)">${t.reference}</div>
      <div style="flex:1">
        <div style="font-weight:500">${t.project_name}</div>
        <div style="font-size:12px;color:var(--muted)">${t.contact_name ? String(t.contact_name).split(',')[0].trim() : '—'}</div>
      </div>
      ${renderDeadlineBadge(t.deadline_date, t.status)}
      <span class="tag tag-${t.status === 'tender' ? 'pending' : t.status === 'quote' ? 'approved' : t.status === 'won' ? 'approved' : t.status === 'lost' ? 'rejected' : 'pending'}">${t.status}</span>
      <div style="font-size:11px;color:var(--subtle);min-width:75px;text-align:right">${fmtDateStr((t.created_at || '').split('T')[0])}</div>
    </div>
  `).join('');
}

// ── Add/Edit Contact Modal ──
function openAddContactModal() {
  if (!currentClient) return;
  document.getElementById('contactModalTitle').textContent = '👤 Add Contact';
  document.getElementById('ctcId').value = '';
  document.getElementById('ctcClientId').value = currentClient.id;
  document.getElementById('ctcName').value = '';
  document.getElementById('ctcRole').value = '';
  document.getElementById('ctcEmail').value = '';
  document.getElementById('ctcPhone').value = '';
  document.getElementById('ctcNotes').value = '';
  document.getElementById('ctcDeleteBtn').style.display = 'none';
  document.getElementById('contactModal').classList.add('active');
}

function openEditContactModal(id) {
  const contact = currentClientContacts.find(c => c.id === id);
  if (!contact) return;
  document.getElementById('contactModalTitle').textContent = '✏️ Edit Contact';
  document.getElementById('ctcId').value = contact.id;
  document.getElementById('ctcClientId').value = contact.client_id;
  document.getElementById('ctcName').value = contact.contact_name || '';
  document.getElementById('ctcRole').value = contact.role || '';
  document.getElementById('ctcEmail').value = contact.contact_email || '';
  document.getElementById('ctcPhone').value = contact.contact_phone || '';
  document.getElementById('ctcNotes').value = contact.notes || '';
  document.getElementById('ctcDeleteBtn').style.display = '';
  document.getElementById('contactModal').classList.add('active');
}

function closeContactModal() {
  document.getElementById('contactModal').classList.remove('active');
}

async function submitContactModal() {
  const id = document.getElementById('ctcId').value;
  const clientId = document.getElementById('ctcClientId').value;
  const payload = {
    contact_name: document.getElementById('ctcName').value.trim() || null,
    contact_email: document.getElementById('ctcEmail').value.trim() || null,
    contact_phone: document.getElementById('ctcPhone').value.trim() || null,
    role: document.getElementById('ctcRole').value.trim() || null,
    notes: document.getElementById('ctcNotes').value.trim() || null
  };

  if (!payload.contact_name && !payload.contact_email && !payload.contact_phone) {
    toast('Please enter at least a name, email, or phone', 'error');
    return;
  }

  try {
    if (id) {
      await api.put(`/api/client-contacts/${id}`, payload);
      toast('Contact updated ✓', 'success');
    } else {
      await api.post('/api/client-contacts', { client_id: parseInt(clientId), ...payload });
      toast('Contact added ✓', 'success');
    }
    closeContactModal();
    loadClientContacts(clientId);
    if (_contactModalRefreshFn) { _contactModalRefreshFn(); _contactModalRefreshFn = null; }
  } catch (err) {
    toast('Failed: ' + err.message, 'error');
  }
}

async function deleteContactFromModal() {
  const id = document.getElementById('ctcId').value;
  const clientId = document.getElementById('ctcClientId').value;
  if (!id) return;
  if (!confirm('Delete this contact?')) return;

  try {
    await api.delete(`/api/client-contacts/${id}`);
    closeContactModal();
    toast('Contact deleted', 'success');
    loadClientContacts(clientId);
    if (_contactModalRefreshFn) { _contactModalRefreshFn(); _contactModalRefreshFn = null; }
  } catch (err) {
    toast('Failed to delete: ' + err.message, 'error');
  }
}

// ═══════════════════════════════════════════
// QUOTES PAGE (separate from tenders, financial-sensitive)
// ═══════════════════════════════════════════
let _pendingQuotesUser = null;

async function initQuotesPage() {
  // Check if already logged in from office/manager
  const authed = sessionStorage.getItem('bama_mgr_authed');
  if (authed) {
    currentManagerUser = authed;
    const perms = getUserPermissions(currentManagerUser);
    if (perms && (perms.viewQuotes || perms.editQuotes)) {
      document.getElementById('screenQuotesSelect').style.display = 'none';
      document.getElementById('quotesLayout').style.display = 'flex';
      loadQuotesData();
      return;
    }
  }
  renderQuotesEmployeeGrid();
}

function renderQuotesEmployeeGrid() {
  const grid = document.getElementById('quotesEmployeeGrid');
  if (!grid) return;
  const empList = (state.timesheetData.employees || []).filter(e => e.active !== false && (e.staffType || 'workshop') === 'office');
  if (!empList.length) {
    grid.innerHTML = '<div class="empty-state" style="padding:30px"><div style="font-size:28px;margin-bottom:10px">&#128101;</div><div>No office staff set up yet.</div></div>';
    return;
  }
  grid.innerHTML = empList.map(emp => {
    const ini = (emp.name || '').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    const col = empColor(emp.name);
    return `
      <div class="emp-btn" onclick="selectQuotesEmployee('${emp.name.replace(/'/g, "\\\\'")}')" style="padding:22px 14px 16px">
        <div class="emp-avatar" style="width:48px;height:48px;font-size:19px;background:linear-gradient(135deg,${col},#3e1a00)">${ini}</div>
        <div class="emp-name" style="font-size:13px">${emp.name}</div>
        <div style="font-size:10px;color:var(--subtle);margin-top:3px">${emp.hasPin ? '&#128274; PIN set' : '&#128275; No PIN'}</div>
      </div>
    `;
  }).join('');
}

function selectQuotesEmployee(name) {
  const emp = (state.timesheetData.employees || []).find(e => e.name === name);
  if (!emp) return;
  if (!emp.hasPin) { toast('No PIN set for this user. Set one in Staff management first.', 'error'); return; }
  _pendingQuotesUser = { name, empId: emp.id };
  document.getElementById('quotesPinUser').textContent = name;
  document.getElementById('quotesPinInput').value = '';
  document.getElementById('quotesPinError').textContent = '';
  document.getElementById('quotesPinModal').classList.add('active');
  setTimeout(() => document.getElementById('quotesPinInput').focus(), 200);
}

async function verifyQuotesPin() {
  if (!_pendingQuotesUser) return;
  const pin = document.getElementById('quotesPinInput').value;
  if (!pin) return;

  try {
    const result = await api.post('/api/auth/verify-pin', {
      employee_id: _pendingQuotesUser.empId,
      pin
    });
    if (!result || !result.valid) {
      document.getElementById('quotesPinError').textContent = (result && result.reason) || 'Incorrect PIN';
      document.getElementById('quotesPinInput').value = '';
      return;
    }

    currentManagerUser = _pendingQuotesUser.name;
    sessionStorage.setItem('bama_mgr_authed', currentManagerUser);
    document.getElementById('quotesPinModal').classList.remove('active');

    const perms = getUserPermissions(currentManagerUser);
    if (!perms || !(perms.viewQuotes || perms.editQuotes)) {
      toast('You don\'t have permission to access Quotes. Contact your admin.', 'error');
      currentManagerUser = null;
      sessionStorage.removeItem('bama_mgr_authed');
      return;
    }

    document.getElementById('screenQuotesSelect').style.display = 'none';
    document.getElementById('quotesLayout').style.display = 'flex';
    loadQuotesData();
  } catch (err) {
    document.getElementById('quotesPinError').textContent = 'PIN verification failed';
    document.getElementById('quotesPinInput').value = '';
  }
}

async function loadQuotesData() {
  try {
    const [tenders, clients] = await Promise.all([
      api.get('/api/tenders'),
      api.get('/api/clients')
    ]);
    tendersData = tenders || [];
    clientsData = clients || [];
    renderQuoteList();
    renderClientList();
    updateQuotesSidebarCrossNav();
  } catch (err) {
    console.error('Failed to load quotes data:', err);
    toast('Failed to load data', 'error');
  }
}

function switchQuotesTab(tab) {
  const perms = getUserPermissions(currentManagerUser) || {};
  if (tab === 'quotes' && !(perms.viewQuotes || perms.editQuotes)) { toast('No permission to view Quotes', 'error'); return; }

  document.querySelectorAll('#quotesLayout .tab-content').forEach(el => {
    el.classList.remove('active');
    el.style.display = 'none';
  });
  const target = document.getElementById(`tab-${tab}`);
  if (target) { target.classList.add('active'); target.style.display = ''; }

  document.querySelectorAll('#quotesSidebar .sidebar-nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tab);
  });

  const titles = { quotes: 'QUOTES', clients: 'CLIENT DATABASE' };
  const titleEl = document.getElementById('quotesPageTitle');
  if (titleEl) titleEl.textContent = titles[tab] || 'QUOTES';

  if (tab === 'clients') renderClientList();
  if (tab === 'quotes') renderQuoteList();
}

// Quote detail — placeholder for now (just shows reference, project, client, deadline)
let _quoteDetailDirty = false;

function markQuoteDirty() {
  if (_quoteDetailDirty) return;
  _quoteDetailDirty = true;
  const saveBtn = document.getElementById('qdSaveBtn');
  const discardBtn = document.getElementById('qdDiscardBtn');
  if (saveBtn) saveBtn.style.display = '';
  if (discardBtn) discardBtn.style.display = '';
}

function _populateQuoteDetailFields(tender) {
  document.getElementById('quoteDetailReference').textContent = tender.reference || '—';

  const pn = document.getElementById('qd-projectName');
  if (pn) pn.value = tender.project_name || '';

  const st = document.getElementById('qd-status');
  if (st) st.value = tender.status || 'quote';

  const dl = document.getElementById('qd-deadline');
  if (dl) dl.value = tender.deadline_date ? String(tender.deadline_date).split('T')[0] : '';

  const val = document.getElementById('qd-value');
  if (val) val.value = tender.quote_value != null ? parseFloat(tender.quote_value) : '';

  const sd = document.getElementById('qd-sentDate');
  if (sd) sd.value = tender.sent_date ? String(tender.sent_date).split('T')[0] : '';

  const cd = document.getElementById('qd-chasingDate');
  if (cd) cd.value = tender.chasing_date ? String(tender.chasing_date).split('T')[0] : '';

  // Client info
  const clientInfo = document.getElementById('quoteDetailClientInfo');
  if (clientInfo) {
    const addressLine = [tender.address_line1, tender.address_line2, tender.city, tender.county, tender.postcode].filter(Boolean).join(', ');
    const splitDedupe = v => v ? [...new Set(String(v).split(',').map(s => s.trim()).filter(Boolean))] : [];
    const names = splitDedupe(tender.contact_name);
    const emails = splitDedupe(tender.contact_email);
    const phones = splitDedupe(tender.contact_phone);
    const numContacts = Math.max(names.length, emails.length, phones.length);
    let contactsHtml = '';
    for (let i = 0; i < numContacts; i++) {
      const lbl = numContacts > 1 ? `Contact ${i + 1}` : 'Contact';
      contactsHtml += `
        <div style="margin-top:${i > 0 ? '10px' : '0'};padding-top:${i > 0 ? '10px' : '0'};${i > 0 ? 'border-top:1px solid var(--border);' : ''}">
          <div style="font-size:11px;color:var(--accent2);font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">${lbl}</div>
          <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 16px;font-size:13px">
            ${names[i] ? `<div style="color:var(--subtle);font-weight:600">Name</div><div>${escapeHtml(names[i])}</div>` : ''}
            ${emails[i] ? `<div style="color:var(--subtle);font-weight:600">Email</div><div><a href="mailto:${escapeHtml(emails[i])}" style="color:var(--accent2);text-decoration:none">${escapeHtml(emails[i])}</a></div>` : ''}
            ${phones[i] ? `<div style="color:var(--subtle);font-weight:600">Phone</div><div><a href="tel:${escapeHtml(phones[i])}" style="color:var(--accent2);text-decoration:none">${escapeHtml(phones[i])}</a></div>` : ''}
          </div>
        </div>`;
    }
    clientInfo.innerHTML = `
      <div style="font-weight:600;font-size:15px;color:var(--text);margin-bottom:6px">${escapeHtml(tender.company_name || '—')}</div>
      ${addressLine ? `<div style="margin-bottom:14px;color:var(--muted)">${escapeHtml(addressLine)}</div>` : ''}
      ${contactsHtml || '<div style="font-size:12px;color:var(--subtle)">No contact details</div>'}`;
  }
}

async function openQuoteDetail(id) {
  let tender = tendersData.find(t => String(t.id) === String(id));
  if (!tender) { toast('Quote not found', 'error'); return; }

  try {
    const full = await api.get(`/api/tenders/${id}`);
    Object.assign(tender, full);
  } catch (e) { console.warn('Could not refresh quote:', e); }

  currentTender = tender;
  _quoteDetailDirty = false;

  document.querySelectorAll('#quotesLayout .tab-content').forEach(el => {
    el.classList.remove('active'); el.style.display = 'none';
  });
  const detailEl = document.getElementById('tab-quoteDetail');
  detailEl.style.display = ''; detailEl.classList.add('active');

  const saveBtn = document.getElementById('qdSaveBtn');
  const discardBtn = document.getElementById('qdDiscardBtn');
  if (saveBtn) saveBtn.style.display = 'none';
  if (discardBtn) discardBtn.style.display = 'none';

  _populateQuoteDetailFields(tender);
  loadQuoteComments();
  loadTenderFiles();
  // Line items editor — Session 2 of the financial dashboard build.
  loadQuoteLineItems(tender.id).catch(e => console.warn('line items load failed', e));
}

async function saveQuoteChanges() {
  if (!currentTender) return;

  const newStatus = document.getElementById('qd-status')?.value || currentTender.status;
  const oldStatus = currentTender.status;
  const transitioningToWon = oldStatus !== 'won' && newStatus === 'won';

  const body = {
    project_name: document.getElementById('qd-projectName')?.value.trim() || currentTender.project_name,
    status:       newStatus,
    deadline_date: document.getElementById('qd-deadline')?.value || null,
    quote_value:  document.getElementById('qd-value')?.value !== '' ? parseFloat(document.getElementById('qd-value').value) : null,
    sent_date:    document.getElementById('qd-sentDate')?.value || null,
    chasing_date: document.getElementById('qd-chasingDate')?.value || null
  };

  // If transitioning to Won, confirm before kicking off conversion
  if (transitioningToWon) {
    const projectNumber = (currentTender.reference || '').replace(/^Q/i, 'C');
    const ok = await showConfirmAsync(
      'Mark quote as WON?',
      `This will:<br><br>` +
      `&nbsp;&nbsp;• Save the quote with status <strong>Won</strong><br>` +
      `&nbsp;&nbsp;• Create a new Project (<strong>${escapeHtml(projectNumber)}</strong>)<br>` +
      `&nbsp;&nbsp;• Create the SharePoint folder structure under Projects/<br>` +
      `&nbsp;&nbsp;• Copy the contents of the quote folder into "03 - Quote"<br><br>` +
      `Continue?`,
      { okLabel: 'Mark as Won' }
    );
    if (!ok) return;
  }

  try {
    await api.put(`/api/tenders/${currentTender.id}`, body);
    Object.assign(currentTender, body);
    // Sync back into tendersData list
    const idx = tendersData.findIndex(t => String(t.id) === String(currentTender.id));
    if (idx !== -1) Object.assign(tendersData[idx], body);

    // Persist any pending edits to the line items table in a single bulk PUT.
    // Fire-and-await — if the user changed nothing in line items this is a no-op.
    try { await saveQuoteLineItems(); }
    catch (lineErr) { console.warn('line items save failed:', lineErr); toast('Line items did not save: ' + lineErr.message, 'error'); }

    _quoteDetailDirty = false;
    document.getElementById('qdSaveBtn').style.display = 'none';
    document.getElementById('qdDiscardBtn').style.display = 'none';
    toast('Quote saved ✓', 'success');

    // Trigger project conversion AFTER the status save succeeded
    if (transitioningToWon) {
      toast('Creating project — this may take a few seconds…', 'info');
      try {
        const project = await convertQuoteToProject(currentTender);
        toast(`Project ${project.project_number} created ✓`, 'success');
      } catch (convErr) {
        console.error('Quote-to-project conversion failed:', convErr);
        toast('Quote saved as Won, but project creation failed: ' + convErr.message, 'error');
      }
    }
  } catch (err) {
    toast('Save failed: ' + err.message, 'error');
  }
}

function discardQuoteChanges() {
  if (!currentTender) return;
  _populateQuoteDetailFields(currentTender);
  _quoteDetailDirty = false;
  document.getElementById('qdSaveBtn').style.display = 'none';
  document.getElementById('qdDiscardBtn').style.display = 'none';
}

async function loadQuoteComments() {
  if (!currentTender) return;
  const container = document.getElementById('quoteDetailCommentsList');
  if (!container) return;

  try {
    const comments = await api.get(`/api/tender-comments?tender_id=${currentTender.id}`);
    const items = [];
    if (currentTender.comments?.trim()) {
      items.push({ id: 'initial', comment: currentTender.comments, created_by: currentTender.created_by || '—', created_at: currentTender.created_at, isInitial: true });
    }
    items.push(...(comments || []));

    if (!items.length) {
      container.innerHTML = '<div style="font-size:12px;color:var(--subtle);padding:8px 0">No comments yet</div>';
      return;
    }

    container.innerHTML = items.map(c => {
      const date = c.created_at ? new Date(c.created_at) : null;
      const dateStr = date ? `${date.toLocaleDateString('en-GB')} ${date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}` : '';
      const deleteBtn = c.isInitial ? '' : `<button class="tiny-btn" onclick="deleteQuoteComment(${c.id})" style="padding:2px 6px;font-size:10px;background:transparent;color:var(--subtle);border:none;cursor:pointer" title="Delete">✕</button>`;
      return `
        <div style="padding:10px 12px;background:var(--surface);border:1px solid var(--border);border-radius:8px;margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <div style="font-size:12px;color:var(--accent2);font-weight:600">${escapeHtml(c.created_by || '—')}${c.isInitial ? ' <span style="color:var(--subtle);font-weight:400">(initial)</span>' : ''}</div>
            <div style="display:flex;gap:8px;align-items:center">
              <div style="font-size:11px;color:var(--subtle)">${dateStr}</div>
              ${deleteBtn}
            </div>
          </div>
          <div style="font-size:13px;color:var(--text);white-space:pre-wrap">${escapeHtml(c.comment)}</div>
        </div>`;
    }).join('');
  } catch (err) {
    container.innerHTML = '<div style="font-size:12px;color:var(--red);padding:8px">Failed to load comments</div>';
  }
}

async function addQuoteComment() {
  if (!currentTender) return;
  const input = document.getElementById('quoteCommentInput');
  const text = (input?.value || '').trim();
  if (!text) { toast('Please enter a comment', 'error'); return; }

  try {
    await api.post('/api/tender-comments', {
      tender_id: currentTender.id,
      comment: text,
      created_by: currentManagerUser || 'unknown'
    });
    input.value = '';
    toast('Comment added ✓', 'success');
    loadQuoteComments();
  } catch (err) {
    toast('Failed to add comment: ' + err.message, 'error');
  }
}

async function deleteQuoteComment(id) {
  if (!confirm('Delete this comment?')) return;
  try {
    await api.delete(`/api/tender-comments/${id}`);
    toast('Comment deleted', 'success');
    loadQuoteComments();
  } catch (err) {
    toast('Failed to delete: ' + err.message, 'error');
  }
}

// ═══════════════════════════════════════════
// PROJECT TRACKER (Won quotes → Projects)
// ═══════════════════════════════════════════
// Note: a separate `currentProject` variable already exists higher up for the
// drawings/jobs page (projects.html). This module uses `currentProjectRecord`
// to avoid the name collision.

let projectsData = [];
let currentProjectRecord = null;
let _projectDetailDirty = false;

const PROJECTS_FOLDER_PATH = 'Projects'; // root-level in the BAMA drive

// Default subfolder structure for every new project
const PROJECT_SUBFOLDERS = [
  '00 - RAMS',
  '01 - Order',
  '02 - Drawings',
  '03 - Quote',
  '04 - Built Ins',
  '05 - Conversations',
  '06 - Survey',
  '07 - Deliveries',
  '08 - Application for payment'
];

// Strip filesystem-illegal chars and clean up whitespace.
// SharePoint also dislikes trailing dots/spaces and certain leading chars.
function sanitiseFolderSegment(s) {
  return String(s || '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/^[.\s]+|[.\s]+$/g, '')
    .trim();
}

// ── Quote → Project conversion ──
// Triggered when a quote's status changes to 'won'.
// Creates the SharePoint project folder structure, copies the quote folder into 03 - Quote,
// and inserts the Projects DB row.
async function convertQuoteToProject(tender) {
  if (!tender) throw new Error('No tender supplied');
  if (!/^Q/i.test(tender.reference)) throw new Error('Quote reference must start with Q');

  // Derive project number: Q260502 → C260502
  const projectNumber = tender.reference.replace(/^Q/i, 'C');

  // Check if project already exists for this quote (idempotent — don't double-create)
  try {
    const existing = await api.get(`/api/projects-by-quote/${tender.id}`);
    if (existing && existing.id) {
      console.warn('Project already exists for this quote:', existing.project_number);
      return existing;
    }
  } catch (e) {
    // 404 or empty is fine — proceed to create
  }

  // Build folder name: "C260502 - Client - Project Name"
  const clientPart = sanitiseFolderSegment(tender.company_name);
  const projectPart = sanitiseFolderSegment(tender.project_name);
  const folderName = [projectNumber, clientPart, projectPart].filter(Boolean).join(' - ');

  // 1. Create SharePoint folders. Projects sit directly under the Projects/ root —
  // no year folder layer (unlike Quotation/, which is grouped per year).
  const token = await getToken();
  const projectsRoot = await getOrCreateFolderByPath(PROJECTS_FOLDER_PATH, token);
  const projectFolder = await createFolderInDrive(projectsRoot.id, folderName);

  // Create the standard subfolders inside the project folder
  const subfolderMap = {};
  for (const sub of PROJECT_SUBFOLDERS) {
    const sf = await createFolderInDrive(projectFolder.id, sub);
    subfolderMap[sub] = sf;
  }

  // 2. Copy quote folder contents into 03 - Quote
  if (tender.sharepoint_folder_id && subfolderMap['03 - Quote']) {
    try {
      await copyFolderContents(tender.sharepoint_folder_id, subfolderMap['03 - Quote'].id, token);
    } catch (e) {
      console.warn('Could not copy quote contents into 03 - Quote — folder created but copy failed:', e);
      // Non-fatal: continue with project creation
    }
  }

  // 3. Create the Projects DB row
  const projectRow = await api.post('/api/projects', {
    project_number: projectNumber,
    project_name: tender.project_name,
    client_id: tender.client_id || null,
    status: 'In Progress',
    source_quote_id: tender.id,
    quote_value: tender.quote_value != null ? parseFloat(tender.quote_value) : null,
    deadline_date: tender.deadline_date ? String(tender.deadline_date).split('T')[0] : null,
    comments: tender.comments || null,
    sharepoint_folder_id: projectFolder.id,
    sharepoint_quote_folder_id: tender.sharepoint_folder_id || null,
    created_by: currentManagerUser || (typeof AUTH !== 'undefined' && AUTH.getUserName?.()) || 'unknown'
  });

  // Cache locally so the project list updates without a refresh
  projectsData.unshift(projectRow);

  // 4. Wire up the multi-quote link table — the originating quote is primary.
  //    Independently of whether the user later adds more quotes, this row
  //    means the project's Contract Value tile can read from ProjectQuotes
  //    instead of legacy Projects.source_quote_id.
  try {
    await api.post('/api/project-quotes', {
      project_id: projectRow.id,
      tender_id: tender.id,
      is_primary: true,
      added_by: currentManagerUser || 'system'
    });
  } catch (e) {
    // Non-fatal — the project still exists, the user can attach manually later.
    console.warn('ProjectQuotes link insert failed (non-fatal):', e);
  }

  // 5. Seed the 9 default line items if the source quote doesn't have any yet.
  //    Idempotent — the seed endpoint returns existing rows if already populated.
  try {
    await api.post(`/api/quote-line-items/seed/${tender.id}`, {});
  } catch (e) {
    console.warn('Quote line item seed failed (non-fatal):', e);
  }

  return projectRow;
}

// Copy children of one drive item into another using Graph /copy.
// Note: Graph /copy is async — it returns 202 with a Location header to a monitor URL.
// We don't poll; we trigger and move on. Copies happen server-side on SharePoint.
async function copyFolderContents(sourceFolderId, targetFolderId, token) {
  const t = token || await getToken();
  const listRes = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${BAMA_DRIVE_ID}/items/${sourceFolderId}/children?$top=999`,
    { headers: { 'Authorization': `Bearer ${t}` } }
  );
  if (!listRes.ok) throw new Error(`List children failed: ${listRes.status}`);
  const listData = await listRes.json();
  const items = listData.value || [];

  for (const item of items) {
    try {
      const copyRes = await fetch(
        `https://graph.microsoft.com/v1.0/drives/${BAMA_DRIVE_ID}/items/${item.id}/copy`,
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${t}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            parentReference: { driveId: BAMA_DRIVE_ID, id: targetFolderId },
            name: item.name
          })
        }
      );
      // 202 is the expected async-accepted response. Other 2xx also OK.
      if (!copyRes.ok && copyRes.status !== 202) {
        console.warn(`Copy ${item.name} returned ${copyRes.status}`);
      }
    } catch (e) {
      console.warn(`Failed to copy ${item.name}:`, e.message);
    }
  }
}

// ── Project list page ──
async function loadProjectsData() {
  try {
    const list = await api.get('/api/projects');
    projectsData = Array.isArray(list) ? list : [];
  } catch (e) {
    console.warn('Failed to load projects:', e);
    projectsData = [];
  }
}

function renderProjectTrackerList() {
  const container = document.getElementById('projectTrackerListContainer');
  if (!container) return;

  const search = (document.getElementById('projectSearch')?.value || '').toLowerCase();
  const statusFilter = document.getElementById('projectStatusFilter')?.value || '';

  let list = [...projectsData];
  if (statusFilter) list = list.filter(p => p.status === statusFilter);
  if (search) {
    list = list.filter(p => {
      const hay = `${p.project_number} ${p.project_name} ${p.company_name || ''} ${p.source_quote_reference || ''}`.toLowerCase();
      return hay.includes(search);
    });
  }

  if (!list.length) {
    container.innerHTML = '<div class="empty-state" style="padding:24px"><div class="icon">🏗️</div>No projects yet</div>';
    return;
  }

  const statusMeta = {
    'In Progress': { cls: 'tag-approved' },
    'On Hold':     { cls: 'tag-pending'  },
    'Complete':    { cls: 'tag-approved' },
    'Archived':    { cls: 'tag-pending'  },
    'Cancelled':   { cls: 'tag-rejected' }
  };

  container.innerHTML = list.map(p => {
    const meta = statusMeta[p.status] || { cls: 'tag-pending' };
    const deadline = p.deadline_date ? fmtDateStr(String(p.deadline_date).split('T')[0]) : '—';
    const quoteRef = p.source_quote_reference || '—';
    return `
      <div class="quote-row" onclick="openProjectDetail(${p.id})">
        <div class="quote-col-ref">${escapeHtml(p.project_number)}</div>
        <div class="quote-col-project">
          <div style="font-weight:500;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(p.project_name)}</div>
          <div style="font-size:11px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(p.company_name || '—')}</div>
        </div>
        <div class="quote-col-date" style="color:var(--muted);font-size:12px">${deadline}</div>
        <div class="quote-col-date" style="color:var(--muted);font-size:12px;font-family:var(--font-mono)">${escapeHtml(quoteRef)}</div>
        <div class="quote-col-status"><span class="tag ${meta.cls}">${escapeHtml(p.status)}</span></div>
      </div>`;
  }).join('');
}

// ── Project detail page ──
async function openProjectDetail(id) {
  let project = projectsData.find(p => String(p.id) === String(id));
  if (!project) { toast('Project not found', 'error'); return; }

  try {
    const full = await api.get(`/api/projects/${id}`);
    Object.assign(project, full);
  } catch (e) { console.warn('Could not refresh project:', e); }

  currentProjectRecord = project;
  _projectDetailDirty = false;

  document.querySelectorAll('#projectTrackerLayout .tab-content').forEach(el => {
    el.classList.remove('active'); el.style.display = 'none';
  });
  const detailEl = document.getElementById('tab-projectDetail');
  if (detailEl) { detailEl.style.display = ''; detailEl.classList.add('active'); }

  const saveBtn = document.getElementById('pdSaveBtn');
  const discardBtn = document.getElementById('pdDiscardBtn');
  if (saveBtn) saveBtn.style.display = 'none';
  if (discardBtn) discardBtn.style.display = 'none';

  _populateProjectDetailFields(project);
}

function _populateProjectDetailFields(project) {
  const setVal = (id, v) => { const el = document.getElementById(id); if (el) el.value = v ?? ''; };
  const setText = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v ?? '—'; };

  setText('projectDetailNumber', project.project_number);
  setVal('pd-projectName', project.project_name || '');
  setVal('pd-status', project.status || 'In Progress');
  setVal('pd-deadline', project.deadline_date ? String(project.deadline_date).split('T')[0] : '');
  setVal('pd-startDate', project.start_date ? String(project.start_date).split('T')[0] : '');
  setVal('pd-completionDate', project.completion_date ? String(project.completion_date).split('T')[0] : '');
  setVal('pd-comments', project.comments || '');

  // Source quote backlink
  const quoteLink = document.getElementById('projectDetailQuoteLink');
  if (quoteLink) {
    if (project.source_quote_reference) {
      quoteLink.innerHTML = `<a href="quotes.html" style="color:var(--accent2);text-decoration:none">${escapeHtml(project.source_quote_reference)} ↗</a>`;
    } else {
      quoteLink.textContent = '—';
    }
  }

  // Client info
  const clientInfo = document.getElementById('projectDetailClientInfo');
  if (clientInfo) {
    const addressLine = [project.address_line1, project.address_line2, project.city, project.county, project.postcode].filter(Boolean).join(', ');
    clientInfo.innerHTML = `
      <div style="font-weight:600;font-size:15px;color:var(--text);margin-bottom:6px">${escapeHtml(project.company_name || '—')}</div>
      ${addressLine ? `<div style="margin-bottom:8px;color:var(--muted)">${escapeHtml(addressLine)}</div>` : ''}
      ${project.contact_name ? `<div style="font-size:13px"><span style="color:var(--subtle);font-weight:600">Contact:</span> ${escapeHtml(project.contact_name)}</div>` : ''}
      ${project.contact_email ? `<div style="font-size:13px"><span style="color:var(--subtle);font-weight:600">Email:</span> <a href="mailto:${escapeHtml(project.contact_email)}" style="color:var(--accent2);text-decoration:none">${escapeHtml(project.contact_email)}</a></div>` : ''}
      ${project.contact_phone ? `<div style="font-size:13px"><span style="color:var(--subtle);font-weight:600">Phone:</span> ${escapeHtml(project.contact_phone)}</div>` : ''}`;
  }

  // SharePoint folder link
  const folderLink = document.getElementById('projectDetailFolderLink');
  if (folderLink) {
    if (project.sharepoint_folder_id) {
      folderLink.innerHTML = `<button class="btn btn-ghost" onclick="openProjectFolder()" style="font-size:12px">📁 Open in SharePoint ↗</button>`;
    } else {
      folderLink.innerHTML = '<span style="font-size:12px;color:var(--subtle)">No folder linked</span>';
    }
  }

  // ── Site Address (toggle defaults to "same as client") ──
  // mssql returns BIT as boolean; older rows may be null (treat as 1).
  const sameAsClient = (project.site_same_as_client === false || project.site_same_as_client === 0)
    ? false : true;
  const sameToggle = document.getElementById('pd-siteSameAsClient');
  if (sameToggle) sameToggle.checked = sameAsClient;
  setVal('pd-siteAddressLine1', project.site_address_line1 || '');
  setVal('pd-siteAddressLine2', project.site_address_line2 || '');
  setVal('pd-siteCity',         project.site_city || '');
  setVal('pd-siteCounty',       project.site_county || '');
  setVal('pd-sitePostcode',     project.site_postcode || '');
  setVal('pd-siteContactName',  project.site_contact_name || '');
  setVal('pd-siteContactEmail', project.site_contact_email || '');
  setVal('pd-siteContactPhone', project.site_contact_phone || '');
  _refreshSiteSection(project);

  // ── Additional contacts and comments — fetched async ──
  loadProjectContacts(project.id).catch(e => console.warn('contacts load failed', e));
  loadProjectComments(project.id).catch(e => console.warn('comments load failed', e));

  // ── Financial dashboard — attached quotes + line items + progress ──
  loadProjectFinancials(project.id).catch(e => console.warn('financials load failed', e));
}

// Build the "summary" text shown above the site fields when they're hidden.
function _siteAddressSummary(project) {
  if (!project) return 'Same as client address';
  const sameAsClient = (project.site_same_as_client === false || project.site_same_as_client === 0)
    ? false : true;
  if (sameAsClient) return 'Same as client address';
  const parts = [
    project.site_address_line1, project.site_address_line2,
    project.site_city, project.site_county, project.site_postcode
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : 'Different from client — no address entered yet';
}

// Show/hide the site fields panel based on the toggle state. Also updates summary.
function _refreshSiteSection(project) {
  const sameToggle = document.getElementById('pd-siteSameAsClient');
  const fieldsBlock = document.getElementById('pd-siteFields');
  const summary = document.getElementById('pd-siteSummary');
  if (!sameToggle || !fieldsBlock) return;
  fieldsBlock.style.display = sameToggle.checked ? 'none' : '';
  if (summary) summary.textContent = _siteAddressSummary(project || currentProjectRecord || {});
}

// Toggle handler — flips visibility, marks dirty, refreshes summary.
function onSiteSameToggle() {
  markProjectDirty();
  // Build a mock object reflecting the current toggle so the summary is fresh.
  const sameToggle = document.getElementById('pd-siteSameAsClient');
  const mock = Object.assign({}, currentProjectRecord || {}, {
    site_same_as_client: sameToggle ? sameToggle.checked : true,
    site_address_line1: document.getElementById('pd-siteAddressLine1')?.value,
    site_address_line2: document.getElementById('pd-siteAddressLine2')?.value,
    site_city:          document.getElementById('pd-siteCity')?.value,
    site_county:        document.getElementById('pd-siteCounty')?.value,
    site_postcode:      document.getElementById('pd-sitePostcode')?.value
  });
  _refreshSiteSection(mock);
}

async function openProjectFolder() {
  if (!currentProjectRecord || !currentProjectRecord.sharepoint_folder_id) return;
  try {
    const token = await getToken();
    const res = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${BAMA_DRIVE_ID}/items/${currentProjectRecord.sharepoint_folder_id}`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (!res.ok) throw new Error(`Lookup failed: ${res.status}`);
    const data = await res.json();
    if (data.webUrl) window.open(data.webUrl, '_blank');
  } catch (e) {
    toast('Could not open folder: ' + e.message, 'error');
  }
}

function markProjectDirty() {
  _projectDetailDirty = true;
  const sb = document.getElementById('pdSaveBtn');
  const db = document.getElementById('pdDiscardBtn');
  if (sb) sb.style.display = '';
  if (db) db.style.display = '';
}

async function saveProjectChanges() {
  if (!currentProjectRecord) return;
  const sameToggle = document.getElementById('pd-siteSameAsClient');
  const siteSame = sameToggle ? sameToggle.checked : true;

  const body = {
    project_name:    document.getElementById('pd-projectName')?.value.trim() || currentProjectRecord.project_name,
    status:          document.getElementById('pd-status')?.value || currentProjectRecord.status,
    deadline_date:   document.getElementById('pd-deadline')?.value || null,
    start_date:      document.getElementById('pd-startDate')?.value || null,
    completion_date: document.getElementById('pd-completionDate')?.value || null,
    comments:        document.getElementById('pd-comments')?.value.trim() || null,

    // Site address — when toggle is ON ("same as client") we still send the
    // toggle so it persists, but null out the site fields to avoid stale data.
    site_same_as_client: siteSame,
    site_address_line1: siteSame ? null : (document.getElementById('pd-siteAddressLine1')?.value.trim() || null),
    site_address_line2: siteSame ? null : (document.getElementById('pd-siteAddressLine2')?.value.trim() || null),
    site_city:          siteSame ? null : (document.getElementById('pd-siteCity')?.value.trim() || null),
    site_county:        siteSame ? null : (document.getElementById('pd-siteCounty')?.value.trim() || null),
    site_postcode:      siteSame ? null : (document.getElementById('pd-sitePostcode')?.value.trim() || null),
    site_contact_name:  siteSame ? null : (document.getElementById('pd-siteContactName')?.value.trim() || null),
    site_contact_email: siteSame ? null : (document.getElementById('pd-siteContactEmail')?.value.trim() || null),
    site_contact_phone: siteSame ? null : (document.getElementById('pd-siteContactPhone')?.value.trim() || null)
  };

  try {
    await api.put(`/api/projects/${currentProjectRecord.id}`, body);
    Object.assign(currentProjectRecord, body);
    const idx = projectsData.findIndex(p => String(p.id) === String(currentProjectRecord.id));
    if (idx !== -1) Object.assign(projectsData[idx], body);

    _projectDetailDirty = false;
    document.getElementById('pdSaveBtn').style.display = 'none';
    document.getElementById('pdDiscardBtn').style.display = 'none';
    _refreshSiteSection(currentProjectRecord);
    toast('Project saved ✓', 'success');
  } catch (err) {
    toast('Save failed: ' + err.message, 'error');
  }
}

function discardProjectChanges() {
  if (!currentProjectRecord) return;
  _populateProjectDetailFields(currentProjectRecord);
  _projectDetailDirty = false;
  document.getElementById('pdSaveBtn').style.display = 'none';
  document.getElementById('pdDiscardBtn').style.display = 'none';
}

async function closeProjectDetail() {
  if (_projectDetailDirty) {
    const ok = await showConfirmAsync(
      'Discard unsaved changes?',
      'You have unsaved changes on this project. Closing now will lose them.',
      { okLabel: 'Discard', danger: true }
    );
    if (!ok) return;
  }
  currentProjectRecord = null;
  _projectDetailDirty = false;
  document.querySelectorAll('#projectTrackerLayout .tab-content').forEach(el => {
    el.classList.remove('active'); el.style.display = 'none';
  });
  const listTab = document.getElementById('tab-projectTrackerList');
  if (listTab) { listTab.style.display = ''; listTab.classList.add('active'); }
}

// ─────────────────────────────────────────────────────────────────────────────
// Project Contacts (additional people on a project — site foremen, QSs, etc.)
// Mirrors the tender contactModal CRUD pattern.
// ─────────────────────────────────────────────────────────────────────────────
let _projectContactsCache = [];

async function loadProjectContacts(projectId) {
  if (!projectId) return;
  try {
    const rows = await api.get(`/api/project-contacts?project_id=${projectId}`);
    _projectContactsCache = Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.warn('loadProjectContacts failed:', e);
    _projectContactsCache = [];
  }
  renderProjectContacts();
}

function renderProjectContacts() {
  const list = document.getElementById('projectContactsList');
  if (!list) return;
  if (!_projectContactsCache.length) {
    list.innerHTML = '<div style="color:var(--subtle);padding:8px 0">No additional contacts yet.</div>';
    return;
  }
  list.innerHTML = _projectContactsCache.map(c => {
    const head = [c.contact_name, c.role].filter(Boolean).join(' · ');
    const emailLink = c.contact_email
      ? `<a href="mailto:${escapeHtml(c.contact_email)}" style="color:var(--accent2);text-decoration:none">${escapeHtml(c.contact_email)}</a>`
      : '';
    const bits = [emailLink, c.contact_phone ? escapeHtml(c.contact_phone) : ''].filter(Boolean).join(' · ');
    return `
      <div style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="flex:1;min-width:0">
          <div style="font-weight:600;color:var(--text)">${escapeHtml(head || '(unnamed)')}</div>
          ${bits ? `<div style="font-size:12px;color:var(--muted);margin-top:2px">${bits}</div>` : ''}
          ${c.notes ? `<div style="font-size:12px;color:var(--subtle);margin-top:4px;white-space:pre-wrap">${escapeHtml(c.notes)}</div>` : ''}
        </div>
        <button class="btn btn-ghost" style="font-size:11px;padding:4px 10px" onclick="openEditProjectContact(${c.id})">Edit</button>
      </div>
    `;
  }).join('');
}

function openAddProjectContact() {
  if (!currentProjectRecord) return;
  document.getElementById('projectContactModalTitle').textContent = '👤 Add Contact';
  document.getElementById('pcId').value = '';
  document.getElementById('pcProjectId').value = currentProjectRecord.id;
  document.getElementById('pcName').value = '';
  document.getElementById('pcRole').value = '';
  document.getElementById('pcEmail').value = '';
  document.getElementById('pcPhone').value = '';
  document.getElementById('pcNotes').value = '';
  document.getElementById('pcDeleteBtn').style.display = 'none';
  document.getElementById('projectContactModal').classList.add('active');
  setTimeout(() => document.getElementById('pcName')?.focus(), 50);
}

function openEditProjectContact(id) {
  const c = _projectContactsCache.find(x => String(x.id) === String(id));
  if (!c) return;
  document.getElementById('projectContactModalTitle').textContent = '👤 Edit Contact';
  document.getElementById('pcId').value = c.id;
  document.getElementById('pcProjectId').value = c.project_id;
  document.getElementById('pcName').value  = c.contact_name  || '';
  document.getElementById('pcRole').value  = c.role          || '';
  document.getElementById('pcEmail').value = c.contact_email || '';
  document.getElementById('pcPhone').value = c.contact_phone || '';
  document.getElementById('pcNotes').value = c.notes         || '';
  document.getElementById('pcDeleteBtn').style.display = '';
  document.getElementById('projectContactModal').classList.add('active');
  setTimeout(() => document.getElementById('pcName')?.focus(), 50);
}

function closeProjectContactModal() {
  document.getElementById('projectContactModal').classList.remove('active');
}

async function submitProjectContactModal() {
  const id        = document.getElementById('pcId').value;
  const projectId = parseInt(document.getElementById('pcProjectId').value);
  const body = {
    contact_name:  document.getElementById('pcName').value.trim()  || null,
    contact_email: document.getElementById('pcEmail').value.trim() || null,
    contact_phone: document.getElementById('pcPhone').value.trim() || null,
    role:          document.getElementById('pcRole').value.trim()  || null,
    notes:         document.getElementById('pcNotes').value.trim() || null
  };
  if (!body.contact_name && !body.contact_email && !body.contact_phone) {
    toast('Enter at least a name, email, or phone', 'error');
    return;
  }

  try {
    if (id) {
      await api.put(`/api/project-contacts/${id}`, body);
    } else {
      body.project_id = projectId;
      await api.post('/api/project-contacts', body);
    }
    closeProjectContactModal();
    await loadProjectContacts(projectId || currentProjectRecord?.id);
    toast(id ? 'Contact updated ✓' : 'Contact added ✓', 'success');
  } catch (err) {
    toast('Save failed: ' + err.message, 'error');
  }
}

async function deleteProjectContactFromModal() {
  const id        = document.getElementById('pcId').value;
  const projectId = parseInt(document.getElementById('pcProjectId').value);
  if (!id) return;
  const confirmed = await showConfirmAsync(
    'Delete contact?',
    'This contact will be removed from the project. The client record is unaffected.',
    { okLabel: 'Delete', danger: true }
  );
  if (!confirmed) return;
  try {
    await api.delete(`/api/project-contacts/${id}`);
    closeProjectContactModal();
    await loadProjectContacts(projectId || currentProjectRecord?.id);
    toast('Contact deleted ✓', 'success');
  } catch (err) {
    toast('Delete failed: ' + err.message, 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Project Comments (threaded, append-only log). Mirrors tender comments UI.
// ─────────────────────────────────────────────────────────────────────────────
let _projectCommentsCache = [];

async function loadProjectComments(projectId) {
  if (!projectId) return;
  try {
    const rows = await api.get(`/api/project-comments?project_id=${projectId}`);
    _projectCommentsCache = Array.isArray(rows) ? rows : [];
  } catch (e) {
    console.warn('loadProjectComments failed:', e);
    _projectCommentsCache = [];
  }
  renderProjectComments();
}

function renderProjectComments() {
  const list = document.getElementById('projectCommentsList');
  if (!list) return;
  if (!_projectCommentsCache.length) {
    list.innerHTML = '<div style="color:var(--subtle);padding:8px 0">No comments yet.</div>';
    return;
  }
  const me = currentManagerUser || '';
  list.innerHTML = _projectCommentsCache.map(c => {
    const when = c.created_at ? new Date(c.created_at).toLocaleString('en-GB', {
      day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
    }) : '';
    const author = c.created_by || 'Unknown';
    const canDelete = me && (author === me);
    return `
      <div style="padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
          <div style="font-weight:600;font-size:12px;color:var(--text)">${escapeHtml(author)}</div>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="font-size:11px;color:var(--subtle)">${escapeHtml(when)}</div>
            ${canDelete ? `<button class="btn btn-ghost" style="font-size:11px;padding:2px 8px" onclick="deleteProjectComment(${c.id})">Delete</button>` : ''}
          </div>
        </div>
        <div style="white-space:pre-wrap;font-size:13px;color:var(--muted)">${escapeHtml(c.comment || '')}</div>
      </div>
    `;
  }).join('');
}

async function addProjectComment() {
  if (!currentProjectRecord) return;
  const ta = document.getElementById('pd-newComment');
  if (!ta) return;
  const text = ta.value.trim();
  if (!text) { toast('Type a comment first', 'error'); return; }
  try {
    await api.post('/api/project-comments', {
      project_id: currentProjectRecord.id,
      comment: text,
      created_by: currentManagerUser || null
    });
    ta.value = '';
    await loadProjectComments(currentProjectRecord.id);
  } catch (err) {
    toast('Could not post comment: ' + err.message, 'error');
  }
}

async function deleteProjectComment(id) {
  const ok = await showConfirmAsync(
    'Delete this comment?',
    'This will remove the comment from the project log. Comments cannot be edited, only re-added.',
    { okLabel: 'Delete', danger: true }
  );
  if (!ok) return;
  try {
    await api.delete(`/api/project-comments/${id}`);
    if (currentProjectRecord) await loadProjectComments(currentProjectRecord.id);
  } catch (err) {
    toast('Delete failed: ' + err.message, 'error');
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Project Financial Dashboard (Session 3 of the Issue 6 build)
// Loads attached quotes, their line items, and per-line progress; renders the
// 3 tiles (Contract / Labour / Running) plus a per-quote table.
// ─────────────────────────────────────────────────────────────────────────────

// Cache shape:
//   _projectFinancials = {
//     quotes:   [ { project_id, tender_id, is_primary, reference, ..., _lineItems: [...] }, ... ],
//     progress: { [quote_line_item_id]: percent_complete }
//   }
let _projectFinancials = { quotes: [], progress: {} };

async function loadProjectFinancials(projectId) {
  if (!projectId) return;

  // Reset UI to loading.
  const container = document.getElementById('ptQuotesContainer');
  if (container) container.innerHTML = '<div style="padding:14px;text-align:center;color:var(--subtle);font-size:12px">Loading…</div>';

  let quotes = [];
  let progress = [];
  try {
    [quotes, progress] = await Promise.all([
      api.get(`/api/project-quotes?project_id=${projectId}`),
      api.get(`/api/project-line-progress?project_id=${projectId}`)
    ]);
  } catch (e) {
    console.warn('financials fetch failed:', e);
    if (container) container.innerHTML = '<div style="padding:14px;color:var(--subtle);font-size:12px">Could not load financials.</div>';
    return;
  }

  // For each attached quote, fetch (and seed if needed) its line items.
  const withLines = await Promise.all((quotes || []).map(async q => {
    let lines = [];
    try {
      lines = await api.get(`/api/quote-line-items?tender_id=${q.tender_id}`);
      if (!Array.isArray(lines) || lines.length === 0) {
        lines = await api.post(`/api/quote-line-items/seed/${q.tender_id}`, {});
      }
    } catch (e) {
      console.warn(`line items fetch failed for tender ${q.tender_id}:`, e);
    }
    return Object.assign({}, q, { _lineItems: (lines || []).slice().sort((a, b) => a.line_no - b.line_no) });
  }));

  // Index progress by quote_line_item_id.
  const progressMap = {};
  for (const p of (progress || [])) {
    progressMap[p.quote_line_item_id] = parseFloat(p.percent_complete) || 0;
  }

  _projectFinancials = { quotes: withLines, progress: progressMap };
  renderProjectFinancialDashboard();
}

// Sum (qty × unit_price) across all line items of all quotes; optional filter.
function _sumLineItems(filterFn) {
  let total = 0;
  for (const q of _projectFinancials.quotes) {
    for (const li of (q._lineItems || [])) {
      if (filterFn && !filterFn(li, q)) continue;
      const qty   = parseFloat(li.quantity)   || 0;
      const price = parseFloat(li.unit_price) || 0;
      total += qty * price;
    }
  }
  return total;
}

// Weighted progress: progress * line value, divided by total line value.
// Lines with zero value contribute nothing — the user can still set their
// % but it doesn't move the headline number, which is what we want.
function _weightedProjectProgress() {
  let weightedSum = 0, totalWeight = 0;
  for (const q of _projectFinancials.quotes) {
    for (const li of (q._lineItems || [])) {
      const qty   = parseFloat(li.quantity)   || 0;
      const price = parseFloat(li.unit_price) || 0;
      const value = qty * price;
      const pct   = _projectFinancials.progress[li.id] || 0;
      weightedSum += value * pct;
      totalWeight += value;
    }
  }
  return totalWeight > 0 ? (weightedSum / totalWeight) : 0;
}

function renderProjectFinancialDashboard() {
  const fmt = n => '£' + (n || 0).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Tiles
  const contract = _sumLineItems();
  const labour   = _sumLineItems(li => !!li.is_labour);
  const setText = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  setText('ptTileContractValue', fmt(contract));
  setText('ptTileLabourValue',   fmt(labour));
  setText('ptTileRunningValue',  '—');

  const meta = `${_projectFinancials.quotes.length} ${_projectFinancials.quotes.length === 1 ? 'quote' : 'quotes'} attached`;
  setText('ptTileContractMeta', meta);
  const progressPct = _weightedProjectProgress();
  setText('ptTileLabourMeta', `${progressPct.toFixed(0)}% project progress (value-weighted)`);

  // Per-quote tables
  const container = document.getElementById('ptQuotesContainer');
  if (!container) return;
  if (!_projectFinancials.quotes.length) {
    container.innerHTML = `
      <div style="padding:18px;text-align:center;color:var(--subtle);font-size:13px">
        No quotes attached. Use <strong>+ Add Quote</strong> to attach won quotes
        and feed the financial tiles.
      </div>`;
    return;
  }

  container.innerHTML = _projectFinancials.quotes.map(q => {
    const scope = (q.quote_comments || '').trim();
    const lines = q._lineItems || [];
    const linesHtml = lines.map(li => {
      const qty   = parseFloat(li.quantity)   || 0;
      const price = parseFloat(li.unit_price) || 0;
      const excl  = qty * price;
      const pct   = _projectFinancials.progress[li.id] || 0;
      const earned = excl * (pct / 100);
      const labelTag = li.is_labour
        ? '<span style="font-size:10px;color:var(--accent2);margin-left:6px">LABOUR</span>'
        : '';
      return `
        <div class="pt-line-grid pt-line-row${li.is_labour ? ' pt-line-labour' : ''}" data-line-id="${li.id}">
          <div class="pt-num">${li.line_no}</div>
          <div>${escapeHtml(li.description || '')}${labelTag}</div>
          <div class="pt-amount">${qty.toFixed(2)}</div>
          <div class="pt-amount">£${price.toFixed(2)}</div>
          <div class="pt-amount">£${excl.toFixed(2)}</div>
          <div style="display:flex;align-items:center;gap:8px">
            <div class="pt-progress-bar" style="flex:1"><div class="pt-progress-fill" style="width:${pct}%"></div></div>
            <input type="number" class="pt-progress-input" min="0" max="100" step="1" value="${pct}" onchange="onProjectLineProgressChange(${li.id}, this.value)" title="${escapeHtml('£' + earned.toFixed(2) + ' earned')}">
          </div>
          <div style="text-align:right;color:var(--subtle);font-family:var(--font-mono)">${pct.toFixed(0)}%</div>
        </div>
      `;
    }).join('');

    const exclTotal = lines.reduce((sum, li) => sum + ((parseFloat(li.quantity) || 0) * (parseFloat(li.unit_price) || 0)), 0);
    const labourTotal = lines.filter(li => li.is_labour).reduce((sum, li) => sum + ((parseFloat(li.quantity) || 0) * (parseFloat(li.unit_price) || 0)), 0);

    return `
      <div class="pt-quote-block" data-tender-id="${q.tender_id}">
        <div class="pt-quote-block-head">
          <div>
            <span class="pt-quote-ref">${escapeHtml(q.reference || 'Q?')}</span>
            ${q.is_primary ? '<span style="font-size:10px;color:var(--accent);margin-left:8px;letter-spacing:.5px">PRIMARY</span>' : ''}
            <span style="font-size:12px;color:var(--muted);margin-left:8px">${escapeHtml(q.quote_project_name || '')}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:11px;color:var(--subtle)">Excl. £${exclTotal.toFixed(2)} • Labour £${labourTotal.toFixed(2)}</span>
            ${q.is_primary
              ? ''
              : `<button class="btn btn-ghost" style="font-size:11px;padding:4px 10px" onclick="detachProjectQuote(${q.tender_id})">Detach</button>`}
          </div>
        </div>
        ${scope ? `<div class="pt-quote-scope">${escapeHtml(scope)}</div>` : ''}
        <div class="pt-line-grid pt-line-header">
          <div>#</div><div>Line</div>
          <div style="text-align:right">Qty</div>
          <div style="text-align:right">Unit</div>
          <div style="text-align:right">Excl.</div>
          <div>Progress</div>
          <div style="text-align:right">%</div>
        </div>
        ${linesHtml || '<div style="padding:12px;color:var(--subtle);font-size:12px">No line items captured for this quote.</div>'}
      </div>
    `;
  }).join('');
}

// Throttled saver — when the user fiddles with a progress slider quickly we
// don't want to hammer the API on every keystroke.
const _progressSaveTimers = {};
async function onProjectLineProgressChange(quoteLineItemId, value) {
  if (!currentProjectRecord) return;
  const pct = Math.max(0, Math.min(100, parseFloat(value) || 0));
  _projectFinancials.progress[quoteLineItemId] = pct;

  // Cheap re-render of the affected row's bar + tiles only.
  const row = document.querySelector(`#ptQuotesContainer .pt-line-row[data-line-id="${quoteLineItemId}"]`);
  if (row) {
    const fill = row.querySelector('.pt-progress-fill');
    if (fill) fill.style.width = pct + '%';
    const numCell = row.children[6];
    if (numCell) numCell.textContent = pct.toFixed(0) + '%';
  }
  // Update the labour tile's secondary text (project progress).
  const projPct = _weightedProjectProgress();
  const meta = document.getElementById('ptTileLabourMeta');
  if (meta) meta.textContent = `${projPct.toFixed(0)}% project progress (value-weighted)`;

  // Debounce the network write — 600ms after the last change.
  clearTimeout(_progressSaveTimers[quoteLineItemId]);
  _progressSaveTimers[quoteLineItemId] = setTimeout(async () => {
    try {
      await api.put('/api/project-line-progress', {
        project_id: currentProjectRecord.id,
        quote_line_item_id: quoteLineItemId,
        percent_complete: pct,
        last_updated_by: currentManagerUser || null
      });
    } catch (err) {
      toast('Could not save progress: ' + err.message, 'error');
    }
  }, 600);
}

async function detachProjectQuote(tenderId) {
  if (!currentProjectRecord) return;
  const q = _projectFinancials.quotes.find(x => x.tender_id === tenderId);
  if (q && q.is_primary) { toast('Cannot detach the primary quote', 'error'); return; }
  const ok = await showConfirmAsync(
    'Detach this quote?',
    `Quote <strong>${escapeHtml(q?.reference || '')}</strong> will be removed from this project. Its line items remain on the quote — only the link is removed. Per-line progress on this project will be orphaned.`,
    { okLabel: 'Detach', danger: true }
  );
  if (!ok) return;
  try {
    await api.delete(`/api/project-quotes/${currentProjectRecord.id}/${tenderId}`);
    await loadProjectFinancials(currentProjectRecord.id);
    toast('Quote detached', 'success');
  } catch (err) {
    toast('Detach failed: ' + err.message, 'error');
  }
}

// ── Attach Quote modal ──
let _attachQuoteCandidates = [];

async function openAttachQuoteModal() {
  if (!currentProjectRecord) return;
  document.getElementById('aqSearch').value = '';
  document.getElementById('aqList').innerHTML = '<div style="padding:14px;text-align:center;color:var(--subtle);font-size:12px">Loading…</div>';
  document.getElementById('attachQuoteModal').classList.add('active');

  // Pull won quotes that aren't already attached.
  let allWon = [];
  try {
    allWon = await api.get('/api/tenders?status=won');
  } catch (e) {
    document.getElementById('aqList').innerHTML = '<div style="padding:14px;color:var(--subtle);font-size:12px">Could not load quotes.</div>';
    return;
  }
  const attachedIds = new Set(_projectFinancials.quotes.map(q => q.tender_id));
  _attachQuoteCandidates = (allWon || []).filter(t => !attachedIds.has(t.id));
  renderAttachQuoteList();
}

function renderAttachQuoteList() {
  const term = (document.getElementById('aqSearch')?.value || '').toLowerCase().trim();
  const filtered = _attachQuoteCandidates.filter(t => {
    if (!term) return true;
    const hay = `${t.reference || ''} ${t.project_name || ''} ${t.company_name || ''}`.toLowerCase();
    return hay.includes(term);
  });
  const list = document.getElementById('aqList');
  if (!list) return;
  if (!filtered.length) {
    list.innerHTML = '<div style="padding:14px;text-align:center;color:var(--subtle);font-size:12px">No matching won quotes available to attach.</div>';
    return;
  }
  list.innerHTML = filtered.map(t => `
    <div class="aq-row" onclick="confirmAttachQuote(${t.id})">
      <div><span class="aq-ref">${escapeHtml(t.reference || '')}</span> <span style="color:var(--text);font-size:13px">${escapeHtml(t.project_name || '')}</span></div>
      <div class="aq-meta">${escapeHtml(t.company_name || '')} • Value £${(parseFloat(t.value) || 0).toFixed(2)}</div>
    </div>
  `).join('');
}
function filterAttachQuoteList() { renderAttachQuoteList(); }
function closeAttachQuoteModal() { document.getElementById('attachQuoteModal').classList.remove('active'); }

async function confirmAttachQuote(tenderId) {
  if (!currentProjectRecord) return;
  try {
    await api.post('/api/project-quotes', {
      project_id: currentProjectRecord.id,
      tender_id: tenderId,
      is_primary: false,
      added_by: currentManagerUser || null
    });
    closeAttachQuoteModal();
    await loadProjectFinancials(currentProjectRecord.id);
    toast('Quote attached ✓', 'success');
  } catch (err) {
    toast('Attach failed: ' + err.message, 'error');
  }
}

// ═══════════════════════════════════════════
// CREATE NEW PROJECT (manual, no source quote)
// ═══════════════════════════════════════════
// Mints the next available C-reference, creates the SharePoint folder
// structure (same 9 subfolders as the Won-quote path), creates or finds
// the client, and writes the Project row. Mirrors convertQuoteToProject
// but starts from form input instead of a tender. source_quote_id is left
// null and ProjectQuotes is not seeded — a quote can be attached later
// via the "+ Add Quote" button on the project detail page.

let _npClientSearchTimeout = null;

async function getNextProjectNumber() {
  const yy = String(new Date().getFullYear()).slice(-2); // "26"
  const prefix = `C${yy}`;
  let highest = 0;

  // Scan loaded projectsData (covers both manual and quote-derived projects).
  // Quote-derived projects come in as e.g. C260502 (from Q260502); manual
  // projects mint sequentially from the same pool, so we scan all C{yy}*.
  const re = new RegExp(`^${prefix}(\\d+)$`);
  (projectsData || []).forEach(p => {
    const m = String(p.project_number || '').match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n > highest) highest = n;
    }
  });

  return `${prefix}${String(highest + 1).padStart(2, '0')}`;
}

async function openCreateProjectModal() {
  const perms = getUserPermissions(currentManagerUser);
  if (!perms || !perms.editProjects) {
    toast("You don't have permission to create projects", 'error');
    return;
  }

  // Make sure clients are loaded for autocomplete (project-tracker page
  // doesn't load them by default — only tenders/quotes pages do).
  if (!clientsData.length) {
    try {
      const clients = await api.get('/api/clients');
      clientsData = clients || [];
    } catch (e) {
      console.warn('Failed to load clients for autocomplete:', e);
    }
  }

  // Reset all form fields
  ['npClientId','npCompanyName','npAddress1','npAddress2','npCity','npCounty','npPostcode',
   'npContactName','npContactEmail','npContactPhone',
   'npProjectName','npQuoteValue','npComments','npDeadline',
   'npSiteAddressLine1','npSiteAddressLine2','npSiteCity','npSiteCounty','npSitePostcode',
   'npSiteContactName','npSiteContactEmail','npSiteContactPhone'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  // Default site-same toggle to ON, hide site fields
  const siteSame = document.getElementById('npSiteSameAsClient');
  if (siteSame) siteSame.checked = true;
  const siteFields = document.getElementById('npSiteFields');
  if (siteFields) siteFields.style.display = 'none';

  // Default start date to today (matches new-tender default behaviour)
  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
  const startEl = document.getElementById('npStartDate');
  if (startEl) startEl.value = todayStr;

  document.getElementById('npClientSuggestions').style.display = 'none';

  // Generate next project number (default — user can override for legacy/existing projects)
  const npRefEl = document.getElementById('npProjectNumber');
  try {
    const ref = await getNextProjectNumber();
    npRefEl.value = ref;
  } catch (e) {
    console.error('Project number generation failed:', e);
    npRefEl.value = '';
  }
  onNpProjectNumberChange(); // seed the hint text

  document.getElementById('newProjectModal').classList.add('active');
}

function closeCreateProjectModal() {
  document.getElementById('newProjectModal').classList.remove('active');
}

// Auto-uppercase + drive the hint that tells the user whether SharePoint
// folders will be created. S-prefix = legacy/existing project (folders
// already live somewhere in the SharePoint tree, so we skip creation).
// Anything else (default C-prefix or a custom value) = brand new project,
// folder structure gets created automatically.
function onNpProjectNumberChange() {
  const el = document.getElementById('npProjectNumber');
  if (!el) return;

  // Uppercase as the user types, preserving cursor position
  const upper = el.value.toUpperCase();
  if (upper !== el.value) {
    const pos = el.selectionStart;
    el.value = upper;
    try { el.setSelectionRange(pos, pos); } catch (_) {}
  }

  const hint = document.getElementById('npProjectNumberHint');
  if (!hint) return;
  const val = el.value.trim();

  if (!val) {
    hint.innerHTML = '<span style="color:var(--red)">A project number is required.</span>';
  } else if (/^S/.test(val)) {
    hint.innerHTML = '<span style="color:var(--accent2)"><strong>Existing project</strong> — SharePoint folders will <strong>not</strong> be created. The folder is assumed to already exist in the legacy tree.</span>';
  } else {
    hint.innerHTML = '<span style="color:var(--muted)">New project — the standard SharePoint folder structure will be created automatically.</span>';
  }
}

function onNpClientSearch(value) {
  clearTimeout(_npClientSearchTimeout);
  const dropdown = document.getElementById('npClientSuggestions');

  if (!value || value.length < 2) {
    dropdown.style.display = 'none';
    document.getElementById('npClientId').value = '';
    return;
  }

  _npClientSearchTimeout = setTimeout(() => {
    const matches = clientsData.filter(c =>
      c.company_name && c.company_name.toLowerCase().includes(value.toLowerCase())
    );

    if (!matches.length) {
      dropdown.style.display = 'none';
      document.getElementById('npClientId').value = '';
      return;
    }

    dropdown.innerHTML = matches.map(c => `
      <div class="autocomplete-item" onclick="selectNpClient(${c.id})">
        <div class="ac-company">${escapeHtml(c.company_name)}</div>
        <div class="ac-contact">${escapeHtml(c.contact_name || '')} ${c.contact_email ? '· ' + escapeHtml(c.contact_email) : ''}</div>
      </div>
    `).join('');
    dropdown.style.display = '';
  }, 200);
}

function selectNpClient(clientId) {
  const client = clientsData.find(c => c.id === clientId);
  if (!client) return;

  document.getElementById('npClientId').value = client.id;
  document.getElementById('npCompanyName').value = client.company_name;
  document.getElementById('npAddress1').value = client.address_line1 || '';
  document.getElementById('npAddress2').value = client.address_line2 || '';
  document.getElementById('npCity').value = client.city || '';
  document.getElementById('npCounty').value = client.county || '';
  document.getElementById('npPostcode').value = client.postcode || '';
  // Contact fields left blank — they vary per project/site
  document.getElementById('npContactName').value = '';
  document.getElementById('npContactEmail').value = '';
  document.getElementById('npContactPhone').value = '';
  document.getElementById('npClientSuggestions').style.display = 'none';
}

function onNpSiteSameToggle() {
  const same = document.getElementById('npSiteSameAsClient').checked;
  document.getElementById('npSiteFields').style.display = same ? 'none' : '';
}

async function submitCreateProject() {
  const projectNumber = document.getElementById('npProjectNumber').textContent.trim();
  const companyName   = document.getElementById('npCompanyName').value.trim();
  const projectName   = document.getElementById('npProjectName').value.trim();

  if (!projectNumber || projectNumber === '—') { toast('Project number could not be generated', 'error'); return; }
  if (!companyName) { toast('Client / company name is required', 'error'); return; }
  if (!projectName) { toast('Project name is required', 'error'); return; }

  const submitBtn = document.getElementById('npSubmitBtn');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = 'Creating…'; }

  try {
    // Step 1: Create or find client
    let clientId = document.getElementById('npClientId').value;
    let clientRecord = null;

    if (!clientId) {
      // New client — create it
      clientRecord = await api.post('/api/clients', {
        company_name:  companyName,
        address_line1: document.getElementById('npAddress1').value.trim() || null,
        address_line2: document.getElementById('npAddress2').value.trim() || null,
        city:          document.getElementById('npCity').value.trim() || null,
        county:        document.getElementById('npCounty').value.trim() || null,
        postcode:      document.getElementById('npPostcode').value.trim() || null,
        contact_name:  document.getElementById('npContactName').value.trim() || null,
        contact_email: document.getElementById('npContactEmail').value.trim() || null,
        contact_phone: document.getElementById('npContactPhone').value.trim() || null
      });
      clientId = clientRecord.id;
      clientsData.push(clientRecord);
    } else {
      clientRecord = clientsData.find(c => String(c.id) === String(clientId)) || null;
    }

    // Step 2: Create SharePoint folder structure — but ONLY for new projects.
    // S-prefix means the project already lives in the legacy folder tree, so
    // we skip creation and leave sharepoint_folder_id NULL. The project detail
    // page handles a missing folder ID gracefully (the "Open SharePoint" link
    // just won't appear).
    let projectFolderId = null;
    const isExistingLegacyProject = /^S/i.test(projectNumber);

    if (!isExistingLegacyProject) {
      try {
        const token = await getToken();
        const projectsRoot = await getOrCreateFolderByPath(PROJECTS_FOLDER_PATH, token);
        const clientPart  = sanitiseFolderSegment(companyName);
        const projectPart = sanitiseFolderSegment(projectName);
        const folderName  = [projectNumber, clientPart, projectPart].filter(Boolean).join(' - ');
        const projectFolder = await createFolderInDrive(projectsRoot.id, folderName);
        projectFolderId = projectFolder.id;

        // Standard 9 subfolders
        for (const sub of PROJECT_SUBFOLDERS) {
          try {
            await createFolderInDrive(projectFolder.id, sub);
          } catch (e) {
            console.warn(`Subfolder "${sub}" creation failed:`, e);
          }
        }
      } catch (e) {
        console.warn('SharePoint folder creation failed (non-fatal):', e);
        toast('Project created, but SharePoint folders could not be created — check your access', 'warning');
      }
    }

    // Step 3: Build site address payload (PUT it after the create to set
    // the site_* columns — the POST handler doesn't accept them, but PUT does).
    const siteSame = document.getElementById('npSiteSameAsClient').checked;
    const sitePayload = siteSame
      ? {
          site_same_as_client: 1,
          site_address_line1: null, site_address_line2: null,
          site_city: null, site_county: null, site_postcode: null,
          site_contact_name: null, site_contact_email: null, site_contact_phone: null
        }
      : {
          site_same_as_client: 0,
          site_address_line1: document.getElementById('npSiteAddressLine1').value.trim() || null,
          site_address_line2: document.getElementById('npSiteAddressLine2').value.trim() || null,
          site_city:          document.getElementById('npSiteCity').value.trim() || null,
          site_county:        document.getElementById('npSiteCounty').value.trim() || null,
          site_postcode:      document.getElementById('npSitePostcode').value.trim() || null,
          site_contact_name:  document.getElementById('npSiteContactName').value.trim() || null,
          site_contact_email: document.getElementById('npSiteContactEmail').value.trim() || null,
          site_contact_phone: document.getElementById('npSiteContactPhone').value.trim() || null
        };

    // Step 4: Create the Projects DB row
    const quoteValueRaw = document.getElementById('npQuoteValue').value.trim();
    const deadline      = document.getElementById('npDeadline').value;
    const startDate     = document.getElementById('npStartDate').value;

    const created = await api.post('/api/projects', {
      project_number: projectNumber,
      project_name:   projectName,
      client_id:      parseInt(clientId),
      status:         'In Progress',
      source_quote_id: null,
      quote_value:    quoteValueRaw ? parseFloat(quoteValueRaw) : null,
      deadline_date:  deadline || null,
      start_date:     startDate || null,
      comments:       document.getElementById('npComments').value.trim() || null,
      sharepoint_folder_id: projectFolderId,
      sharepoint_quote_folder_id: null,
      created_by:     currentManagerUser || (typeof AUTH !== 'undefined' && AUTH.getUserName?.()) || 'unknown'
    });

    // Step 5: PUT the site address fields. The PUT handler returns the row
    // joined with client data (company_name etc), so we use its response.
    let project = created;
    try {
      const updated = await api.put(`/api/projects/${created.id}`, sitePayload);
      if (updated && updated.id) project = updated;
    } catch (e) {
      console.warn('Site address update failed:', e);
      // Non-fatal — the project exists, the user can edit site fields on the detail page.
    }

    // Step 6: Auto-save contact to ClientContacts (deduped server-side by name+email).
    //   Mirrors the behaviour of the new-tender flow.
    const contactName  = document.getElementById('npContactName').value.trim();
    const contactEmail = document.getElementById('npContactEmail').value.trim();
    const contactPhone = document.getElementById('npContactPhone').value.trim();
    if (contactName || contactEmail || contactPhone) {
      try {
        await api.post('/api/client-contacts', {
          client_id:     parseInt(clientId),
          contact_name:  contactName  || null,
          contact_email: contactEmail || null,
          contact_phone: contactPhone || null
        });
      } catch (e) {
        console.warn('Failed to save contact to client database:', e);
      }
    }

    // Step 7: Patch local state and refresh UI. Make sure company_name is
    // populated so the list row renders correctly without a full refetch.
    if (!project.company_name) project.company_name = companyName;
    projectsData.unshift(project);

    closeCreateProjectModal();
    renderProjectTrackerList();
    if (isExistingLegacyProject) {
      toast(`Existing project ${projectNumber} added ✓`, 'success');
    } else {
      toast(`Project ${projectNumber} created ✓`, 'success');
    }

    // Jump straight to the new project's detail view.
    setTimeout(() => openProjectDetail(project.id), 100);
  } catch (err) {
    console.error('Failed to create project:', err);
    toast('Failed to create project: ' + (err.message || 'unknown error'), 'error');
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = 'Create Project'; }
  }
}

// ── Project Tracker page init ──
async function initProjectTrackerPage() {
  // Re-use the manager PIN gate pattern. The page will require viewProjects permission.
  const authed = sessionStorage.getItem('bama_mgr_authed');
  if (authed) {
    currentManagerUser = authed;
    const perms = getUserPermissions(currentManagerUser);
    if (perms && (perms.viewProjects || perms.editProjects)) {
      document.getElementById('screenProjectTrackerSelect').style.display = 'none';
      document.getElementById('projectTrackerLayout').style.display = 'flex';
      await loadProjectsData();
      renderProjectTrackerList();
      return;
    }
  }
  // Otherwise show login screen
  renderProjectTrackerEmployeeGrid();
}

function renderProjectTrackerEmployeeGrid() {
  const grid = document.getElementById('projectTrackerEmployeeGrid');
  if (!grid) return;

  // Mirror the tender/quotes pattern: office staff only.
  const empList = (state.timesheetData.employees || []).filter(e => e.active !== false && (e.staffType || 'workshop') === 'office');

  if (!empList.length) {
    grid.innerHTML = '<div class="empty-state" style="padding:30px"><div style="font-size:28px;margin-bottom:10px">&#128101;</div><div>No office staff set up yet.</div><div style="margin-top:8px;font-size:12px;color:var(--subtle)">Go to Manager → Staff to add office employees.</div></div>';
    return;
  }

  grid.innerHTML = empList.map(emp => {
    const ini = (emp.name || '').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    const col = empColor(emp.name);
    return `
      <div class="emp-btn" onclick="selectProjectTrackerUser('${emp.name.replace(/'/g, "\\\\'")}')" style="padding:22px 14px 16px">
        <div class="emp-avatar" style="width:48px;height:48px;font-size:19px;background:linear-gradient(135deg,${col},#3e1a00)">${ini}</div>
        <div class="emp-name" style="font-size:13px">${emp.name}</div>
        <div style="font-size:10px;color:var(--subtle);margin-top:3px">${emp.hasPin ? '&#128274; PIN set' : '&#128275; No PIN'}</div>
      </div>
    `;
  }).join('');
}

function selectProjectTrackerUser(name) {
  _pendingManagerUser = name;
  document.getElementById('projectTrackerPinUser').textContent = name;
  document.getElementById('projectTrackerPinInput').value = '';
  document.getElementById('projectTrackerPinError').textContent = '';
  document.getElementById('projectTrackerPinModal').classList.add('active');
  setTimeout(() => document.getElementById('projectTrackerPinInput')?.focus(), 50);
}

async function verifyProjectTrackerPin() {
  const name = _pendingManagerUser;
  const pin = document.getElementById('projectTrackerPinInput').value.trim();
  const errEl = document.getElementById('projectTrackerPinError');
  errEl.textContent = '';
  if (!pin) { errEl.textContent = 'Enter your PIN'; return; }

  try {
    const employee = (state.timesheetData?.employees || []).find(e => e.name === name);
    if (!employee) { errEl.textContent = 'Employee not found'; return; }
    if (String(employee.pin) !== pin) { errEl.textContent = 'Incorrect PIN'; return; }

    const perms = getUserPermissions(name);
    if (!perms || (!perms.viewProjects && !perms.editProjects)) {
      errEl.textContent = 'You don\'t have permission to view projects';
      return;
    }

    currentManagerUser = name;
    sessionStorage.setItem('bama_mgr_authed', name);
    document.getElementById('projectTrackerPinModal').classList.remove('active');
    document.getElementById('screenProjectTrackerSelect').style.display = 'none';
    document.getElementById('projectTrackerLayout').style.display = 'flex';

    await loadProjectsData();
    renderProjectTrackerList();
  } catch (err) {
    errEl.textContent = 'PIN verification failed';
  }
}

function switchProjectTrackerTab(tab) {
  document.querySelectorAll('#projectTrackerLayout .sidebar-nav-item').forEach(b => b.classList.remove('active'));
  document.querySelector(`#projectTrackerLayout .sidebar-nav-item[data-tab="${tab}"]`)?.classList.add('active');

  document.querySelectorAll('#projectTrackerLayout .tab-content').forEach(el => {
    el.classList.remove('active'); el.style.display = 'none';
  });
  const target = document.getElementById(`tab-${tab}`);
  if (target) { target.style.display = ''; target.classList.add('active'); }

  if (tab === 'projectTrackerList') renderProjectTrackerList();
}

// Cross-page navigation helpers
function navFromProjectTrackerToTenders() { window.location.href = 'tenders.html'; }
function navFromProjectTrackerToQuotes()  { window.location.href = 'quotes.html'; }

// ═══════════════════════════════════════════
// BABCOCK QUOTES PAGE
// ═══════════════════════════════════════════

let _babcockWorkbook = null;    // parsed XLSX workbook
let _babcockOriginalFile = null; // raw File object — needed to upload to SharePoint
let _babcockRawData = null;     // array of line items extracted from Quote tab
let _babcockHeader = null;      // header metadata extracted from Quote tab
let _pendingBabcockUser = null;
let _babcockQuotes = [];        // tracker list (loaded from API)
let _babcockLastGenerated = null; // cached payload for "Save to Tracker"
let _babcockNextRefCache = null;  // cached suggested next reference

async function initBabcockPage() {
  const authed = sessionStorage.getItem('bama_mgr_authed');
  if (authed) {
    currentManagerUser = authed;
    const perms = getUserPermissions(currentManagerUser);
    if (perms && perms.tenders) {
      document.getElementById('screenBabcockSelect').style.display = 'none';
      document.getElementById('babcockLayout').style.display = 'flex';
      loadBabcockTracker();
      return;
    }
  }
  renderBabcockEmployeeGrid();
}

function renderBabcockEmployeeGrid() {
  const grid = document.getElementById('babcockEmployeeGrid');
  if (!grid) return;
  const empList = (state.timesheetData.employees || []).filter(e => e.active !== false && (e.staffType || 'workshop') === 'office');
  if (!empList.length) {
    grid.innerHTML = '<div class="empty-state" style="padding:30px"><div style="font-size:28px;margin-bottom:10px">&#128101;</div><div>No office staff set up yet.</div></div>';
    return;
  }
  grid.innerHTML = empList.map(emp => {
    const ini = (emp.name || '').split(' ').map(n => n[0]).join('').slice(0, 2).toUpperCase();
    const col = empColor(emp.name);
    return `
      <div class="emp-btn" onclick="selectBabcockEmployee('${emp.name.replace(/'/g, "\\\\'")}')">
        <div class="emp-avatar" style="width:48px;height:48px;font-size:19px;background:linear-gradient(135deg,${col},#3e1a00)">${ini}</div>
        <div class="emp-name" style="font-size:13px">${emp.name}</div>
        <div style="font-size:10px;color:var(--subtle);margin-top:3px">${emp.hasPin ? '&#128274; PIN set' : '&#128275; No PIN'}</div>
      </div>`;
  }).join('');
}

function selectBabcockEmployee(name) {
  const emp = (state.timesheetData.employees || []).find(e => e.name === name);
  if (!emp) return;
  if (!emp.hasPin) { toast('No PIN set for this user.', 'error'); return; }
  _pendingBabcockUser = { name, empId: emp.id };
  document.getElementById('babcockPinUser').textContent = name;
  document.getElementById('babcockPinInput').value = '';
  document.getElementById('babcockPinError').textContent = '';
  document.getElementById('babcockPinModal').classList.add('active');
  setTimeout(() => document.getElementById('babcockPinInput').focus(), 200);
}

async function verifyBabcockPin() {
  if (!_pendingBabcockUser) return;
  const pin = document.getElementById('babcockPinInput').value;
  if (!pin) return;
  try {
    const result = await api.post('/api/auth/verify-pin', { employee_id: _pendingBabcockUser.empId, pin });
    if (!result || !result.valid) {
      document.getElementById('babcockPinError').textContent = (result && result.reason) || 'Incorrect PIN';
      document.getElementById('babcockPinInput').value = '';
      return;
    }
    currentManagerUser = _pendingBabcockUser.name;
    sessionStorage.setItem('bama_mgr_authed', currentManagerUser);
    document.getElementById('babcockPinModal').classList.remove('active');
    const perms = getUserPermissions(currentManagerUser);
    if (!perms || !perms.tenders) {
      toast('You don\'t have permission to access Babcock Quotes.', 'error');
      currentManagerUser = null;
      sessionStorage.removeItem('bama_mgr_authed');
      return;
    }
    document.getElementById('screenBabcockSelect').style.display = 'none';
    document.getElementById('babcockLayout').style.display = 'flex';
    loadBabcockTracker();
  } catch (err) {
    document.getElementById('babcockPinError').textContent = 'PIN verification failed';
    document.getElementById('babcockPinInput').value = '';
  }
}

// ── File handling ──
function handleBabcockDrop(event) {
  const file = event.dataTransfer?.files?.[0];
  if (file) handleBabcockFileSelect(file);
}

function handleBabcockFileSelect(file) {
  if (!file) return;
  const ext = file.name.split('.').pop().toLowerCase();
  if (!['xlsx', 'xls'].includes(ext)) {
    toast('Please upload an .xlsx or .xls file', 'error');
    return;
  }

  // Show file info
  document.getElementById('babcockFileInfo').style.display = '';
  document.getElementById('babcockFileName').textContent = file.name;
  document.getElementById('babcockFileSize').textContent = formatFileSize(file.size);
  _babcockOriginalFile = file;

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      _babcockWorkbook = XLSX.read(e.target.result, { type: 'array' });
      const parsed = parseBabcockQuoteTab(_babcockWorkbook);
      _babcockHeader = parsed.header;
      _babcockRawData = parsed.lineItems;

      if (!_babcockRawData.length) {
        toast('No line items found on the "Quote" tab. Check the template format.', 'error');
        return;
      }

      populateBabcockValidationFields(_babcockHeader);
      const markup = parseFloat(document.getElementById('babcockMarkup').value) || 10;
      renderBabcockPreviewTable(markup);
      updateBabcockMarkedUpTotal(markup);
      document.getElementById('babcockRowCount').textContent = `${_babcockRawData.length} line item${_babcockRawData.length === 1 ? '' : 's'}`;
      document.getElementById('babcockValidateCard').style.display = '';
      document.getElementById('babcockValidateCard').scrollIntoView({ behavior: 'smooth', block: 'start' });

      toast(`Loaded ${file.name} — ${_babcockRawData.length} line items extracted`, 'success');
    } catch (err) {
      console.error('Babcock parse failed:', err);
      toast('Failed to read spreadsheet: ' + err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function clearBabcockFile() {
  _babcockWorkbook = null;
  _babcockOriginalFile = null;
  _babcockRawData = null;
  _babcockHeader = null;
  _babcockLastGenerated = null;
  document.getElementById('babcockFileInput').value = '';
  document.getElementById('babcockFileInfo').style.display = 'none';
  document.getElementById('babcockValidateCard').style.display = 'none';
  // Reset markup to default
  const m = document.getElementById('babcockMarkup');
  if (m) m.value = 10;
}

// ── Parse the BAMA South West Babcock template's "Quote" tab ───────
// The template is rigid: sheet name "Quote", header row at row 14
// (Item | Description | Unit Price | Quantity | Amount), data from row 15
// onwards until an empty Description. Header metadata sits in rows 1-9
// with labels in column D (or A) and values one column to the right.
//
// Throws on missing sheet. Returns { header, lineItems } where any
// missing/blank header field is left as ''.
function parseBabcockQuoteTab(wb) {
  const sheet = wb.Sheets['Quote'];
  if (!sheet) throw new Error('Sheet "Quote" not found — is this the correct template?');

  // Pull as a 2D array — easiest for fixed-position parsing
  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

  const cell = (r, c) => {
    const row = rows[r];
    if (!row) return '';
    const v = row[c];
    return v === undefined || v === null ? '' : v;
  };

  // Row indices are 0-based here; the spreadsheet rows are 1-based.
  // Cells are 0-based by column letter (A=0, B=1, C=2, D=3, E=4).
  const header = {
    quotationDate:    cell(1, 4), // E2 — value next to D2 "Date"
    quoteRef:         cell(2, 4), // E3 — Quotation no.
    customerId:       cell(3, 4), // E4 — Customer ID
    workOrderNo:      cell(4, 4), // E5 — Work Order no.
    validUntil:       cell(5, 4), // E6 — Quotation valid until
    preparedBy:       cell(6, 4), // E7 — Prepared by
    quoteFor:         cell(4, 1), // B5 — value next to A5 "Quotation For"
    area:             cell(5, 1), // B6 — value next to A6 "Area"
    address:          cell(6, 1), // B7 — value next to A7 "Address"
    // Comments / Special Instructions live in merged cells A10:E10, A11:E11, A12:E12.
    // SheetJS unmerges into the top-left cell, so reading A10/A11/A12 (col 0) is correct.
    comments:         [cell(9, 0), cell(10, 0), cell(11, 0)]
                        .map(s => String(s || '').trim()).filter(Boolean).join('\n')
  };

  // Normalise dates — Excel may give a JS Date object, a number (serial), or a string.
  header.quotationDate = excelToISODate(header.quotationDate);
  header.validUntil    = excelToISODate(header.validUntil);

  // Trim string fields
  for (const k of ['quoteRef', 'customerId', 'workOrderNo', 'preparedBy', 'quoteFor', 'area', 'address']) {
    header[k] = String(header[k] || '').trim();
  }

  // Line items: row 14 (index 13) is the header; data starts at row 15 (index 14).
  // Read until we hit a row with no description AND no item number — supports
  // templates that have been extended past the original 14-row capacity.
  const lineItems = [];
  for (let r = 14; r < rows.length; r++) {
    const itemNum    = cell(r, 0);
    const description = String(cell(r, 1) || '').trim();
    const unitPrice  = cell(r, 2);
    const quantity   = cell(r, 3);
    const amount     = cell(r, 4);

    // Stop when we hit the TOTAL row or the VAT-exclusive note (description column has the note text).
    if (description === 'All quotes are VAT exclusive' || description === 'TOTAL') break;
    if (cell(r, 3) === 'TOTAL' || cell(r, 4) === 'TOTAL') break;

    // Skip rows where description is empty AND no numeric data — these are blank template rows.
    if (!description && unitPrice === '' && quantity === '' && amount === '') continue;
    // Skip rows with only an item number (e.g. blank line slots 11-14 in the default template)
    if (!description) continue;

    const qtyNum = quantity === '' ? null : Number(quantity);
    const upNum  = unitPrice === '' ? null : Number(unitPrice);
    const amtNum = amount === '' ? null : Number(amount);

    lineItems.push({
      itemNum:     itemNum === '' ? null : itemNum,
      description,
      unitPrice:   isFinite(upNum) ? upNum : null,
      quantity:    isFinite(qtyNum) ? qtyNum : null,
      amount:      isFinite(amtNum) ? amtNum : ((isFinite(upNum) && isFinite(qtyNum)) ? upNum * qtyNum : null)
    });
  }

  return { header, lineItems };
}

// Excel cell value → ISO date string ('YYYY-MM-DD'), or '' if not a date.
// Handles JS Date objects, Excel serial numbers, and ISO/UK-formatted strings.
function excelToISODate(v) {
  if (!v && v !== 0) return '';
  if (v instanceof Date) {
    return v.toISOString().split('T')[0];
  }
  if (typeof v === 'number' && isFinite(v)) {
    // Excel serial: days since 1899-12-30 (which corrects for the 1900 leap-year bug)
    const ms = (v - 25569) * 86400 * 1000;
    const d = new Date(ms);
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
  }
  const s = String(v).trim();
  // Already ISO?
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  // UK format dd/mm/yyyy
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = (parseInt(y) > 50 ? '19' : '20') + y;
    return `${y}-${mo.padStart(2,'0')}-${d.padStart(2,'0')}`;
  }
  return '';
}

// Push parsed header values into the Validate card form. Pre-fills the
// "Quotation number" hint with the next available B#### so Lee can see
// what the system would auto-allocate (he can override by typing a value).
function populateBabcockValidationFields(header) {
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };

  // NOTE: header.quoteRef is intentionally ignored. The Bama SW template
  // carries its own internal QP###### reference in cell E3, but Babcock
  // quotes use the BAMA B#### sequence (B0092 onwards). The system always
  // allocates the next free B#### — the user can override only if they
  // really need to (e.g. backfilling a pre-existing manual quote).
  set('bvQuoteRef',    '');
  set('bvQuoteDate',   header.quotationDate || todayStr());
  set('bvValidUntil',  header.validUntil || '');
  set('bvCustomerId',  header.customerId || '');
  set('bvWorkOrderNo', header.workOrderNo || '');
  set('bvPreparedBy',  header.preparedBy || currentManagerUser || '');
  set('bvQuoteFor',    header.quoteFor || '');
  set('bvArea',        header.area || '');
  set('bvAddress',     header.address || '');
  set('bvComments',    header.comments || '');

  // Fetch + display the next available B#### ref. We pre-fill the input
  // (rather than just the placeholder) so the user can see what they're
  // about to allocate. They can still type over it if needed.
  const refEl = document.getElementById('bvQuoteRef');
  if (refEl) {
    refEl.value = '';
    refEl.placeholder = 'Loading next ref…';
    api.get('/api/babcock-quote-next-ref').then(r => {
      if (r && r.reference) {
        _babcockNextRefCache = r.reference;
        refEl.value = r.reference;
        refEl.placeholder = `Auto: ${r.reference}`;
      } else {
        refEl.placeholder = 'Auto-allocated on save';
      }
    }).catch(() => {
      refEl.placeholder = 'Auto-allocated on save';
    });
  }
}

function updateBabcockMarkedUpTotal(markup) {
  if (!_babcockRawData) return;
  const factor = 1 + (markup / 100);
  const total = _babcockRawData.reduce((s, r) => {
    const lineTotal = r.amount !== null ? r.amount
                     : (r.unitPrice !== null && r.quantity !== null ? r.unitPrice * r.quantity : 0);
    return s + (lineTotal * factor);
  }, 0);
  const el = document.getElementById('babcockMarkedUpTotal');
  if (el) el.textContent = `£${total.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function renderBabcockPreviewTable(markup) {
  if (!_babcockRawData) return;
  const factor = 1 + (markup / 100);

  const fmtGBP = v => typeof v === 'number' ? `£${v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';

  document.getElementById('babcockPreviewHead').innerHTML = `<tr>
    <th style="width:40px">#</th>
    <th style="min-width:240px">Description</th>
    <th style="text-align:right">Unit Price</th>
    <th style="text-align:right">Qty</th>
    <th style="text-align:right">Amount</th>
    <th style="text-align:right;color:var(--green)">+${markup}% → Our Price</th>
  </tr>`;

  document.getElementById('babcockPreviewBody').innerHTML = _babcockRawData.map((r, i) => {
    const amount   = r.amount !== null ? r.amount
                    : (r.unitPrice !== null && r.quantity !== null ? r.unitPrice * r.quantity : null);
    const ourPrice = amount !== null ? amount * factor : null;
    return `<tr>
      <td style="color:var(--subtle);font-family:var(--font-mono)">${r.itemNum ?? (i + 1)}</td>
      <td title="${escapeHtml(String(r.description))}">${escapeHtml(String(r.description))}</td>
      <td class="num-cell">${r.unitPrice !== null ? fmtGBP(r.unitPrice) : '—'}</td>
      <td class="num-cell">${r.quantity !== null ? r.quantity : '—'}</td>
      <td class="num-cell">${amount !== null ? fmtGBP(amount) : '—'}</td>
      <td class="markup-cell">${ourPrice !== null ? fmtGBP(ourPrice) : '—'}</td>
    </tr>`;
  }).join('');
}

// ── Generate PDF + upload both files to SharePoint + save DB row ───
// Single button, single user gesture. Flow:
//   1. Validate at least one line item exists
//   2. Open render popup synchronously (popup blockers reject post-await)
//   3. Build PDF in popup via html2pdf
//   4. Upload original .xlsx to "...Bama South West Quotes/Quotes received/"
//   5. Upload generated .pdf to "...Bama South West Quotes/"
//   6. POST to /api/babcock-quotes with all metadata + file links
async function generateAndSaveBabcockQuote() {
  if (!_babcockRawData || !_babcockRawData.length) {
    toast('Upload a quote template first', 'error');
    return;
  }
  if (!_babcockOriginalFile) {
    toast('Original file not in memory — please re-upload', 'error');
    return;
  }

  // Gather form values up-front so we can validate before doing anything else.
  const markup = parseFloat(document.getElementById('babcockMarkup').value) || 10;
  const factor = 1 + (markup / 100);

  const formData = {
    quoteRef:     (document.getElementById('bvQuoteRef').value || '').trim(),
    quoteDate:    document.getElementById('bvQuoteDate').value || todayStr(),
    validUntil:   document.getElementById('bvValidUntil').value || '',
    customerId:   (document.getElementById('bvCustomerId').value || '').trim(),
    workOrderNo:  (document.getElementById('bvWorkOrderNo').value || '').trim(),
    preparedBy:   (document.getElementById('bvPreparedBy').value || '').trim(),
    quoteFor:     (document.getElementById('bvQuoteFor').value || '').trim(),
    area:         (document.getElementById('bvArea').value || '').trim(),
    address:      (document.getElementById('bvAddress').value || '').trim(),
    comments:     (document.getElementById('bvComments').value || '').trim()
  };

  // ── Required-field check ───────────────────────────────────────
  // These six fields are needed for a properly formatted quote that
  // Babcock will accept. Comments / Area / Address are optional.
  // If any are missing we show a confirm modal listing them — the user
  // can either "Generate anyway" or "Go back" to fill them in.
  const requiredFields = [
    { key: 'quoteDate',    label: 'Quotation Date' },
    { key: 'validUntil',   label: 'Valid Until' },
    { key: 'customerId',   label: 'Customer ID' },
    { key: 'workOrderNo',  label: 'Work Order Number' },
    { key: 'preparedBy',   label: 'Prepared By' },
    { key: 'quoteFor',     label: 'Quotation For' }
  ];
  const missing = requiredFields.filter(f => !formData[f.key]).map(f => f.label);
  if (missing.length) {
    const list = missing.map(m => `<li style="margin:4px 0">${escapeHtml(m)}</li>`).join('');
    const proceed = await showConfirmAsync(
      '⚠️ Missing Information',
      `<p style="margin:0 0 10px">The following required field${missing.length === 1 ? ' is' : 's are'} missing:</p>
       <ul style="margin:0 0 10px;padding-left:20px;color:var(--red)">${list}</ul>
       <p style="margin:0;font-size:13px;color:var(--muted)">Do you want to generate the quote anyway?</p>`,
      { okLabel: 'Generate Anyway', cancelLabel: 'Go Back & Fix' }
    );
    if (!proceed) {
      // Focus the first missing input so the user lands on it
      const firstMissingKey = requiredFields.find(f => !formData[f.key]).key;
      const idMap = {
        quoteDate: 'bvQuoteDate', validUntil: 'bvValidUntil', customerId: 'bvCustomerId',
        workOrderNo: 'bvWorkOrderNo', preparedBy: 'bvPreparedBy', quoteFor: 'bvQuoteFor'
      };
      const el = document.getElementById(idMap[firstMissingKey]);
      if (el) { el.focus(); el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
      return;
    }
  }

  const btn = document.getElementById('babcockGenerateBtn');
  if (btn) { btn.disabled = true; btn.textContent = 'Generating…'; }

  // If user didn't override, use the cached suggestion; if that's missing, server will allocate.
  if (!formData.quoteRef && _babcockNextRefCache) formData.quoteRef = _babcockNextRefCache;

  // Build marked-up line items + grand total
  let grandTotal = 0;
  const markedLines = _babcockRawData.map((r, i) => {
    const amount   = r.amount !== null ? r.amount
                    : (r.unitPrice !== null && r.quantity !== null ? r.unitPrice * r.quantity : 0);
    const ourPrice = amount * factor;
    grandTotal += ourPrice;
    return {
      itemNum:    r.itemNum ?? (i + 1),
      description: r.description,
      unitPrice:  r.unitPrice !== null ? r.unitPrice * factor : null,
      quantity:   r.quantity,
      amount:     ourPrice
    };
  });

  // jsPDF renders directly in the page — no popup window needed.
  // (Earlier html2canvas-based renderer needed an isolated popup for
  // a clean DOM, which is what the popup logic here was for.)

  setLoading(true);

  try {
    // Pre-load the BAMA logo as a data URI for embedding in the PDF
    await loadLogoDataUri();

    // Render PDF (returns a Blob)
    const pdfBlob = await renderBabcockQuotePDF({
      ...formData,
      markup,
      grandTotal,
      lineItems: markedLines
    });

    // STEP 4 — upload both files to SharePoint
    toast('Uploading files to SharePoint…', 'info');
    const folders = await findOrCreateBabcockFolders();
    const safeRef = (formData.quoteRef || 'BAMA-quote').replace(/[/\\]/g, '_');
    const dateForName = (formData.quoteDate || todayStr()).replace(/-/g, '');
    const originalFileName = `${safeRef} - ${_babcockOriginalFile.name}`;
    const pdfFileName = `${safeRef} - ${(formData.quoteFor || 'Quote').replace(/[/\\]/g, '_')} - ${dateForName}.pdf`;

    const originalUploaded = await uploadFileToFolder(
      folders.received.id,
      originalFileName,
      await _babcockOriginalFile.arrayBuffer(),
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );

    const pdfUploaded = await uploadFileToFolder(
      folders.parent.id,
      pdfFileName,
      pdfBlob,
      'application/pdf'
    );

    // STEP 5 — save DB row
    toast('Saving to tracker…', 'info');
    const payload = {
      quote_ref:          formData.quoteRef || undefined, // server allocates if empty
      date_sent:          formData.quoteDate,
      total_value:        +grandTotal.toFixed(2),
      markup_pct:         markup,
      line_items:         markedLines,
      source_filename:    _babcockOriginalFile.name,
      created_by:         currentManagerUser || null,
      quotation_date:     formData.quoteDate || null,
      customer_id:        formData.customerId || null,
      work_order_no:      formData.workOrderNo || null,
      valid_until:        formData.validUntil || null,
      prepared_by:        formData.preparedBy || null,
      quote_for_area:     [formData.quoteFor, formData.area].filter(Boolean).join(' — ') || null,
      quote_for_address:  formData.address || null,
      comments:           formData.comments || null,
      original_file_id:   originalUploaded.id,
      original_file_url:  originalUploaded.webUrl,
      generated_file_id:  pdfUploaded.id,
      generated_file_url: pdfUploaded.webUrl,
      // Preserve the source spreadsheet's own reference (QP######)
      // for traceability — does not appear on the customer PDF.
      original_quote_ref: (_babcockHeader && _babcockHeader.quoteRef) || null
    };

    const saved = await api.post('/api/babcock-quotes', payload);

    setLoading(false);
    toast(`Quote ${saved.quote_ref} saved ✓`, 'success');

    // Reset and return to tracker
    clearBabcockFile();
    showBabcockTracker();
  } catch (err) {
    setLoading(false);
    console.error('Babcock generate/save failed:', err);
    toast('Failed: ' + (err.message || 'unknown error'), 'error');
    if (btn) { btn.disabled = false; btn.textContent = '⚙️ Generate & Save'; }
  }
}

// ── Find/create the SharePoint folder structure for Babcock quotes ─
// Original uploads → "Quotation/00 - Babcock 2026/Bama South West Quotes/Quotes received"
// Generated PDFs   → "Quotation/00 - Babcock 2026/Bama South West Quotes"
// Returns { parent, received } as Graph item objects with .id and .webUrl
async function findOrCreateBabcockFolders() {
  const token = await getToken();
  const basePath = 'Quotation/00 - Babcock 2026/Bama South West Quotes';
  const lookup = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${BAMA_DRIVE_ID}/root:/${encodeURIComponent(basePath)}`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  if (!lookup.ok) {
    throw new Error(`Cannot find SharePoint folder "${basePath}" (status ${lookup.status})`);
  }
  const parent = await lookup.json();
  const received = await getOrCreateSubfolder(parent.id, 'Quotes received', BAMA_DRIVE_ID);
  if (!received) throw new Error('Could not find or create "Quotes received" subfolder');
  return { parent, received };
}

// ── Build the quote PDF using jsPDF (native text — selectable!) ───
// Previously used html2pdf.js (html2canvas + jsPDF) which rasterised
// the entire document to a JPEG before embedding — meaning text wasn't
// selectable, copyable, or searchable. We now draw directly with jsPDF
// vector + text primitives so the resulting PDF has selectable text,
// is much smaller, and prints crisp at any zoom level.
//
// `popupWin` is an opaque opt-in: if a popup is provided we close it
// once rendering is done (used to keep popup-blocker behaviour stable
// for the moment, but the popup is no longer required for rendering).
async function renderBabcockQuotePDF(data, popupWin) {
  // Close the unused popup — we render inline now.
  try { if (popupWin && !popupWin.closed) popupWin.close(); } catch (e) {}

  // Wait for the BAMA logo data URI to be ready (loadLogoDataUri was
  // called in the parent function before this).
  const logo = _logoDataUriCache || '';

  // Resolve jsPDF constructor. Tried in order:
  //   1. window.jspdf.jsPDF — the standalone UMD jspdf script tag we
  //      include in babcock.html (canonical global).
  //   2. window.jsPDF        — older standalone builds.
  //   3. html2pdf bundle internal — html2pdf.bundle.min.js bundles jsPDF
  //      but exposes it inconsistently across versions; this is a best-
  //      effort fallback so the page still works if the standalone tag
  //      ever drops out.
  //   4. Dynamic load of the standalone UMD as a last resort.
  function resolveJsPDF() {
    if (typeof window.jspdf !== 'undefined' && typeof window.jspdf.jsPDF === 'function') {
      return window.jspdf.jsPDF;
    }
    if (typeof window.jsPDF === 'function') {
      return window.jsPDF;
    }
    if (typeof window.html2pdf !== 'undefined') {
      try {
        // Some bundle versions hang jsPDF off the html2pdf factory function.
        if (typeof window.html2pdf.jsPDF === 'function') return window.html2pdf.jsPDF;
      } catch (e) { /* */ }
    }
    return null;
  }

  let JsPDFCtor = resolveJsPDF();
  if (!JsPDFCtor) {
    // Last-resort dynamic load of the standalone UMD build.
    await new Promise((resolve, reject) => {
      const existing = document.querySelector('script[data-jspdf-loaded]');
      if (existing) {
        // Already-injected tag may still be loading — poll briefly.
        let tries = 0;
        const tick = () => {
          if (resolveJsPDF()) return resolve();
          if (++tries > 50) return reject(new Error('jsPDF load timed out'));
          setTimeout(tick, 100);
        };
        tick();
        return;
      }
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.dataset.jspdfLoaded = '1';
      s.onload = resolve;
      s.onerror = () => reject(new Error('Failed to load jsPDF from CDN'));
      document.head.appendChild(s);
    });
    JsPDFCtor = resolveJsPDF();
  }

  if (!JsPDFCtor) {
    throw new Error('PDF library failed to load — check your internet connection and try again');
  }

  const blob = await drawBabcockQuotePDF(JsPDFCtor, data, logo);
  return blob;
}

// Native jsPDF rendering. Returns a Blob.
async function drawBabcockQuotePDF(jsPDF, d, logoDataUri) {
  const fmtNum = v => typeof v === 'number'
    ? v.toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : '';
  const fmtDate = s => {
    if (!s) return '';
    const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return s;
    return `${m[3]}/${m[2]}/${m[1]}`;
  };

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  // Set PDF metadata (shows up in viewer "Properties")
  try {
    doc.setProperties({
      title: `BAMA Quotation ${d.quoteRef || ''}`.trim(),
      subject: `Quotation${d.quoteFor ? ' for ' + d.quoteFor : ''}`,
      author: 'BAMA Fabrication',
      creator: 'BAMA Fabrication ERP'
    });
  } catch (e) { /* setProperties not critical */ }

  const pageW = 210;          // A4 width mm
  const pageH = 297;          // A4 height mm
  const marginL = 14;
  const marginR = 14;
  const marginB = 14;
  const usableW = pageW - marginL - marginR;

  // Brand colours
  const RED = [208, 2, 27];          // #D0021B
  const NAVY = [31, 53, 82];          // #1F3552
  const TEXT = [34, 34, 34];          // #222
  const MUTED = [85, 85, 85];         // #555
  const RULE = [212, 212, 212];       // #d4d4d4
  const HEADRULE = [68, 68, 68];      // #444

  // Helper: set fill / draw / text colour with a 3-tuple
  const setText  = (rgb) => doc.setTextColor(rgb[0], rgb[1], rgb[2]);
  const setFill  = (rgb) => doc.setFillColor(rgb[0], rgb[1], rgb[2]);
  const setDraw  = (rgb) => doc.setDrawColor(rgb[0], rgb[1], rgb[2]);

  // ── Top header: logo left, "Quotation" right ──────────
  let y = marginL; // we'll reuse y as cursor

  // Logo (best-effort — if data URI missing, fall back to red text)
  if (logoDataUri) {
    try {
      // Approximate sizing — keeps logo within ~75x32mm box
      doc.addImage(logoDataUri, 'PNG', marginL, y, 75, 32, undefined, 'FAST');
    } catch (e) {
      // fallback to text
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(22);
      setText(RED);
      doc.text('BAMA FABRICATION', marginL, y + 12);
    }
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    setText(RED);
    doc.text('BAMA FABRICATION', marginL, y + 12);
  }

  // "Quotation" wordmark — light, large, right-aligned
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(34);
  setText([43, 43, 43]);
  doc.text('Quotation', pageW - marginR, y + 16, { align: 'right' });

  y = marginL + 36;  // step past header block

  // ── Body header: left = company / quote-for, right = meta table ──
  const leftColW = usableW * 0.6;
  const rightColX = marginL + leftColW + 4;
  const rightColW = usableW - leftColW - 4;

  let leftY = y;
  let rightY = y;

  // LEFT: Company Address
  setText(TEXT);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text('Company Address', marginL, leftY);
  leftY += 4.5;
  setText(TEXT);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text('11 Enterprise Way. Enterprise Park, Yaxley,', marginL + 4, leftY);
  leftY += 4;
  doc.text('PE7 3WY, Peterborough', marginL + 4, leftY);
  leftY += 4;
  doc.text('01733 855212', marginL + 4, leftY);
  leftY += 7;

  // LEFT: Quotation For (only if any of the three values exist)
  if (d.quoteFor || d.area || d.address) {
    setText(TEXT);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text('Quotation For', marginL, leftY);
    leftY += 4.5;
    setText(TEXT);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    if (d.quoteFor) { doc.text(String(d.quoteFor), marginL + 4, leftY); leftY += 4; }
    if (d.area)     { doc.text(String(d.area),     marginL + 4, leftY); leftY += 4; }
    if (d.address) {
      // Wrap long addresses
      const wrapped = doc.splitTextToSize(String(d.address), leftColW - 4);
      wrapped.forEach(line => { doc.text(line, marginL + 4, leftY); leftY += 4; });
    }
    leftY += 3;
  }

  // RIGHT: meta table — labels right-aligned, values in black
  const metaRows = [
    { label: 'Date',                    value: fmtDate(d.quoteDate) },
    { label: 'Quotation #',             value: d.quoteRef || '' },
    { label: 'Customer ID',             value: d.customerId || '' },
    { label: 'Work Order',              value: d.workOrderNo || '', gapAfter: true },
    { label: 'Quotation valid until:',  value: fmtDate(d.validUntil) },
    { label: 'Prepared by:',            value: d.preparedBy || '' }
  ];
  doc.setFontSize(10);
  const labelColX = rightColX;
  const labelColW = rightColW * 0.55;
  const valueColX = rightColX + labelColW + 2;
  for (const row of metaRows) {
    setText(TEXT);
    doc.setFont('helvetica', 'bold');
    doc.text(row.label, labelColX + labelColW, rightY, { align: 'right' });
    setText(TEXT);
    doc.setFont('helvetica', 'normal');
    doc.text(String(row.value || ''), valueColX, rightY);
    rightY += row.gapAfter ? 7.5 : 4.5;
  }

  // Move main y past whichever side is taller
  y = Math.max(leftY, rightY) + 4;

  // ── Comments block (only if non-empty) ──────────────────
  // Fix #5: skip the section entirely when there are no special notes.
  if (d.comments && String(d.comments).trim()) {
    setText(TEXT);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10.5);
    doc.text('Comments or Special Instructions', marginL, y);
    y += 4.5;
    setText(TEXT);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10);
    const wrapped = doc.splitTextToSize(String(d.comments).trim(), usableW - 4);
    wrapped.forEach(line => {
      // Page-break check
      if (y > pageH - marginB - 20) { doc.addPage(); y = marginL; }
      doc.text(line, marginL + 4, y);
      y += 4.2;
    });
    y += 4;
  }

  // ── Line items table ──────────────────────────────────────
  // Columns: # | Description | Unit Price | Qty | Amount
  const colItem  = { x: marginL,           w: 14, align: 'center' };
  const colAmt   = { w: 28, align: 'right' };
  const colQty   = { w: 18, align: 'center' };
  const colPrice = { w: 26, align: 'right' };
  // Description = whatever's left
  const colDesc  = { w: usableW - colItem.w - colPrice.w - colQty.w - colAmt.w, align: 'left' };
  colDesc.x  = colItem.x + colItem.w;
  colPrice.x = colDesc.x + colDesc.w;
  colQty.x   = colPrice.x + colPrice.w;
  colAmt.x   = colQty.x + colQty.w;

  // Header row
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  setText(TEXT);
  doc.text('Item',        colItem.x + colItem.w / 2,   y, { align: 'center' });
  doc.text('Description', colDesc.x + 1,                y);
  doc.text('Unit Price',  colPrice.x + colPrice.w - 1,  y, { align: 'right' });
  doc.text('Quantity',    colQty.x + colQty.w / 2,      y, { align: 'center' });
  doc.text('Amount',      colAmt.x + colAmt.w - 1,      y, { align: 'right' });
  y += 1.5;
  setDraw(HEADRULE);
  doc.setLineWidth(0.4);
  doc.line(marginL, y, pageW - marginR, y);
  y += 3;

  // Body rows
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  setDraw(RULE);
  doc.setLineWidth(0.15);
  for (let i = 0; i < d.lineItems.length; i++) {
    const l = d.lineItems[i];
    const desc = String(l.description || '');
    // Wrap description so long lines don't overflow
    const descLines = doc.splitTextToSize(desc, colDesc.w - 2);
    const rowH = Math.max(5, descLines.length * 4.2 + 1);

    // Page break if needed (leave room for footer below)
    if (y + rowH > pageH - marginB - 30) {
      doc.addPage();
      y = marginL + 6;
    }

    // # column
    setText(MUTED);
    doc.text(String(l.itemNum ?? (i + 1)), colItem.x + colItem.w / 2, y + 3.5, { align: 'center' });

    // Description column
    setText(TEXT);
    let descY = y + 3.5;
    for (const line of descLines) {
      doc.text(line, colDesc.x + 1, descY);
      descY += 4.2;
    }

    // Unit price
    if (l.unitPrice !== null && l.unitPrice !== undefined) {
      doc.text(fmtNum(l.unitPrice), colPrice.x + colPrice.w - 1, y + 3.5, { align: 'right' });
    }

    // Quantity
    if (l.quantity !== null && l.quantity !== undefined && l.quantity !== '') {
      doc.text(String(l.quantity), colQty.x + colQty.w / 2, y + 3.5, { align: 'center' });
    }

    // Amount
    doc.text(fmtNum(l.amount), colAmt.x + colAmt.w - 1, y + 3.5, { align: 'right' });

    // Row separator
    setDraw(RULE);
    doc.setLineWidth(0.15);
    doc.line(marginL, y + rowH, pageW - marginR, y + rowH);
    y += rowH;
  }

  y += 6;

  // Page-break for footer if needed
  if (y > pageH - marginB - 28) {
    doc.addPage();
    y = marginL + 6;
  }

  // ── Footer: VAT note left, TOTAL pill right ────────────────
  setText(TEXT);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text('All quotes are VAT exclusive', marginL, y + 5);

  // TOTAL label + navy pill
  doc.setFontSize(12);
  doc.text('TOTAL', pageW - marginR - 38, y + 5, { align: 'right' });

  const pillX = pageW - marginR - 35;
  const pillY = y;
  const pillW = 35;
  const pillH = 9;
  setFill(NAVY);
  doc.rect(pillX, pillY, pillW, pillH, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  setText([255, 255, 255]);
  doc.text(fmtNum(d.grandTotal), pillX + pillW - 3, pillY + 6.2, { align: 'right' });

  y += pillH + 6;

  // Bottom contact line
  setText([68, 68, 68]);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  if (y > pageH - marginB - 12) { doc.addPage(); y = marginL + 6; }
  doc.text('If you have any further questions, please contact: info@bamafabrication.co.uk', marginL, y);
  y += 4;
  doc.text('Thank you for your business', marginL, y);

  // Output as Blob
  const blob = doc.output('blob');
  return blob;
}


// ── Tracker view switching ──
function showBabcockTracker() {
  document.getElementById('babcockTrackerView').style.display = '';
  document.getElementById('babcockGeneratorView').style.display = 'none';
  const btn = document.getElementById('babcockNewQuoteBtn');
  if (btn) btn.style.display = '';
  loadBabcockTracker();
}

function showBabcockGenerator() {
  document.getElementById('babcockTrackerView').style.display = 'none';
  document.getElementById('babcockGeneratorView').style.display = '';
  const btn = document.getElementById('babcockNewQuoteBtn');
  if (btn) btn.style.display = 'none';
  // Start from a clean slate every time the generator is opened
  clearBabcockFile();
  _babcockLastGenerated = null;
}

// ── Load tracker list from API ──
async function loadBabcockTracker() {
  const tbody = document.getElementById('babcockTrackerBody');
  if (!tbody) return;
  try {
    const list = await api.get('/api/babcock-quotes');
    _babcockQuotes = Array.isArray(list) ? list : [];
    renderBabcockTracker();
  } catch (err) {
    console.warn('Babcock tracker load failed:', err);
    tbody.innerHTML = `<tr><td colspan="6" style="padding:30px;text-align:center;color:var(--red)">
      Failed to load quotes. ${escapeHtml(err.message || '')}
    </td></tr>`;
  }
}

// ── Render tracker table (filters + search) ──
function renderBabcockTracker() {
  const tbody = document.getElementById('babcockTrackerBody');
  const countEl = document.getElementById('babcockTrackerCount');
  if (!tbody) return;

  const search = (document.getElementById('babcockTrackerSearch')?.value || '').toLowerCase();
  const statusFilter = document.getElementById('babcockTrackerStatusFilter')?.value || '';

  const list = _babcockQuotes.filter(q => {
    if (statusFilter && q.status !== statusFilter) return false;
    if (search && !(q.quote_ref || '').toLowerCase().includes(search)) return false;
    return true;
  });

  if (countEl) countEl.textContent = `${list.length} quote${list.length === 1 ? '' : 's'}`;

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="7" style="padding:40px;text-align:center;color:var(--muted)">
      <div style="font-size:32px;margin-bottom:8px">📋</div>
      No quotes yet. Click <b>+ New Quote</b> to create one.
    </td></tr>`;
    return;
  }

  const fmtGBP = v => (v === null || v === undefined || v === '') ? '—'
    : `£${Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = v => {
    if (!v) return '—';
    const s = String(v).split('T')[0];
    return fmtDateStr(s);
  };

  tbody.innerHTML = list.map(q => {
    const next = babcockNextStatus(q.status);
    const statusBadge = `<span class="status-badge status-${babcockStatusClass(q.status)}">${escapeHtml(q.status || 'Quote Sent')}</span>`;
    const nextBtn = next
      ? `<button class="btn btn-primary" style="padding:5px 12px;font-size:11px;font-weight:600;letter-spacing:.3px"
              onclick="event.stopPropagation();advanceBabcockQuoteStatus(${q.id})">→ ${escapeHtml(next)}</button>`
      : `<span style="font-size:11px;color:var(--green);font-weight:600">✓ Complete</span>`;
    const revTag = (q.revision && q.revision > 0)
      ? ` <span style="font-size:10px;font-family:var(--font-mono);color:var(--accent);background:rgba(255,107,0,.1);padding:1px 5px;border-radius:3px;font-weight:600;vertical-align:middle">rev${q.revision}</span>`
      : '';

    return `
    <tr class="clickable-row" onclick="viewBabcockQuoteDetail(${q.id})">
      <td class="ref-cell">${escapeHtml(q.quote_ref || '')}${revTag}</td>
      <td>${fmtDate(q.date_sent || q.created_at)}</td>
      <td class="num-cell">${fmtGBP(q.total_value)}</td>
      <td>${statusBadge}</td>
      <td>${nextBtn}</td>
      <td style="font-size:12px;color:var(--muted)">${fmtDate(q.updated_at)}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="row-action" title="Edit" onclick="event.stopPropagation();editBabcockQuote(${q.id})">✏️</button>
        <button class="row-action" title="Delete" onclick="event.stopPropagation();deleteBabcockQuote(${q.id}, '${escapeHtml(q.quote_ref || '')}')">🗑</button>
      </td>
    </tr>`;
  }).join('');
}

// Map a status to the next status in the workflow.
// Returns null if there is no next action (Paid is terminal).
function babcockNextStatus(current) {
  const flow = {
    'Quote Sent':        'PO Received',
    'PO Received':       'Invoice Generated',
    'Invoice Generated': 'Paid',
    'Paid':              null
  };
  return flow[current || 'Quote Sent'];
}

// CSS class suffix for the status badge colour.
function babcockStatusClass(status) {
  return ({
    'Quote Sent':        'sent',
    'PO Received':       'po',
    'Invoice Generated': 'invoiced',
    'Paid':              'paid'
  })[status || 'Quote Sent'] || 'sent';
}

// Advance a quote to the next status in the workflow (one-click button).
async function advanceBabcockQuoteStatus(id) {
  const q = _babcockQuotes.find(x => x.id === id);
  if (!q) return;
  const next = babcockNextStatus(q.status);
  if (!next) return;

  // Special case: moving to "PO Received" needs the customer's PO
  // number. Prompt for it inside the confirm modal — required, can't
  // proceed without one. Stored on the row for later invoice generation.
  let extraFields = {};
  if (next === 'PO Received') {
    let poNumber = '';
    while (true) {
      // Kick off the modal first; on the next tick, focus the input
      // and select any existing text. We don't await yet so this runs
      // before the user can interact.
      setTimeout(() => {
        const inp = document.getElementById('advancePoInput');
        if (inp) { inp.focus(); inp.select(); }
      }, 50);

      const result = await showConfirmAsync(
        '📨 PO Received',
        `<p style="margin:0 0 10px">Enter the Purchase Order number received from the customer for <b>${escapeHtml(q.quote_ref || '')}</b>:</p>
         <input type="text" id="advancePoInput" class="field-input" autocomplete="off"
                value="${escapeHtml(poNumber)}"
                onkeydown="if(event.key==='Enter'){event.preventDefault();document.getElementById('confirmOk')?.click();}"
                style="width:100%;font-size:14px;padding:10px;font-family:var(--font-mono);letter-spacing:.5px"
                placeholder="e.g. PO-12345">
         <div style="font-size:11px;color:var(--subtle);margin-top:6px">This will be stored on the quote and used when generating the invoice.</div>`,
        {
          okLabel: 'Confirm PO',
          cancelLabel: 'Cancel',
          onConfirmSync: () => ({
            poNumber: (document.getElementById('advancePoInput')?.value || '').trim()
          })
        }
      );
      // Cancel pressed → abort the whole advance
      if (!result || !result.ok) return;
      poNumber = result.data?.poNumber || '';
      if (poNumber) break;
      // Empty PO — toast and re-prompt with focus
      toast('PO number is required', 'error');
    }
    extraFields.po_number = poNumber;
  }

  try {
    const updated = await api.put(`/api/babcock-quotes/${id}`,
      { status: next, ...extraFields });
    const idx = _babcockQuotes.findIndex(x => x.id === id);
    if (idx !== -1) _babcockQuotes[idx] = { ..._babcockQuotes[idx], ...updated };
    const poSuffix = extraFields.po_number ? ` (PO ${extraFields.po_number})` : '';
    toast(`${updated.quote_ref} → ${next}${poSuffix}`, 'success');
    renderBabcockTracker();
  } catch (err) {
    toast('Status update failed: ' + (err.message || 'unknown error'), 'error');
    loadBabcockTracker();
  }
}

// Legacy: kept for backward compat in case any code still calls it.
async function updateBabcockQuoteStatus(id, newStatus) {
  try {
    const updated = await api.put(`/api/babcock-quotes/${id}`, { status: newStatus });
    const idx = _babcockQuotes.findIndex(q => q.id === id);
    if (idx !== -1) _babcockQuotes[idx] = { ..._babcockQuotes[idx], ...updated };
    toast(`${updated.quote_ref} → ${newStatus}`, 'success');
    renderBabcockTracker();
  } catch (err) {
    toast('Status update failed: ' + (err.message || 'unknown error'), 'error');
    loadBabcockTracker(); // resync on failure
  }
}

// ── View detail modal (read-only, opens on row click) ──
// We already have the row in _babcockQuotes from the list endpoint, but
// fetch the full record to get line_items (which the list endpoint
// doesn't return) so the user can see the breakdown.
let _babcockDetailQuoteId = null;
async function viewBabcockQuoteDetail(id) {
  const summary = _babcockQuotes.find(q => q.id === id);
  if (!summary) {
    toast('Quote not found', 'error');
    return;
  }
  _babcockDetailQuoteId = id;
  const body = document.getElementById('bdBody');
  const revLabel = (summary.revision && summary.revision > 0) ? ` <span style="font-size:13px;color:var(--accent);font-family:var(--font-mono);font-weight:600;letter-spacing:.5px">rev${summary.revision}</span>` : '';
  document.getElementById('bdRef').innerHTML = (summary.quote_ref ? escapeHtml(summary.quote_ref) : `Quote #${id}`) + revLabel;
  body.innerHTML = '<div style="text-align:center;padding:30px;color:var(--muted)"><div class="spinner" style="margin:0 auto 10px"></div>Loading…</div>';
  document.getElementById('babcockDetailModal').classList.add('active');

  // Show/hide file links from the summary right away
  const pdfBtn = document.getElementById('bdOpenPdfBtn');
  const srcBtn = document.getElementById('bdOpenSourceBtn');
  if (pdfBtn) pdfBtn.style.display = summary.generated_file_url ? '' : 'none';
  if (srcBtn) srcBtn.style.display = summary.original_file_url ? '' : 'none';

  let full = summary;
  try {
    full = await api.get(`/api/babcock-quotes/${id}`);
  } catch (err) {
    console.warn('Detail fetch failed, falling back to summary:', err);
  }

  body.innerHTML = renderBabcockDetailBody(full);
}

function renderBabcockDetailBody(q) {
  const fmtGBP = v => (v === null || v === undefined || v === '') ? '—'
    : `£${Number(v).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDate = v => {
    if (!v) return '—';
    const s = String(v).split('T')[0];
    return fmtDateStr(s);
  };
  const escOrDash = v => (v === null || v === undefined || v === '') ? '—' : escapeHtml(String(v));

  const lineItems = Array.isArray(q.line_items) ? q.line_items
                  : (typeof q.line_items === 'string' && q.line_items
                      ? (() => { try { return JSON.parse(q.line_items); } catch { return []; } })()
                      : []);

  const fieldRow = (label, value) => `
    <div style="display:grid;grid-template-columns:160px 1fr;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
      <div style="font-size:11px;color:var(--muted);font-weight:600;letter-spacing:.5px;text-transform:uppercase;align-self:center">${label}</div>
      <div style="font-size:13px;color:var(--text)">${value}</div>
    </div>`;

  const lineItemsHtml = lineItems.length
    ? `<table style="width:100%;border-collapse:collapse;margin-top:6px;font-size:12px">
         <thead>
           <tr style="background:var(--surface);color:var(--muted);font-size:10px;letter-spacing:.5px;text-transform:uppercase">
             <th style="padding:8px;text-align:left;width:36px">#</th>
             <th style="padding:8px;text-align:left">Description</th>
             <th style="padding:8px;text-align:right;width:80px">Unit £</th>
             <th style="padding:8px;text-align:right;width:50px">Qty</th>
             <th style="padding:8px;text-align:right;width:90px">Amount</th>
           </tr>
         </thead>
         <tbody>${lineItems.map((l, i) => `
           <tr style="border-bottom:1px solid var(--border)">
             <td style="padding:6px 8px;color:var(--subtle)">${escapeHtml(String(l.itemNum ?? (i + 1)))}</td>
             <td style="padding:6px 8px">${escapeHtml(String(l.description || ''))}</td>
             <td style="padding:6px 8px;text-align:right;font-family:var(--font-mono);color:var(--accent2)">${l.unitPrice !== null && l.unitPrice !== undefined ? fmtGBP(l.unitPrice) : '—'}</td>
             <td style="padding:6px 8px;text-align:right;font-family:var(--font-mono)">${l.quantity ?? '—'}</td>
             <td style="padding:6px 8px;text-align:right;font-family:var(--font-mono);color:var(--green)">${l.amount !== null && l.amount !== undefined ? fmtGBP(l.amount) : '—'}</td>
           </tr>`).join('')}
         </tbody>
       </table>`
    : '<div style="font-size:12px;color:var(--muted);font-style:italic;padding:10px 0">No line items recorded.</div>';

  const statusBadge = `<span class="status-badge status-${babcockStatusClass(q.status)}">${escapeHtml(q.status || 'Quote Sent')}</span>`;
  const totalBig = `<span style="font-family:var(--font-mono);font-size:18px;color:var(--green);font-weight:700">${fmtGBP(q.total_value)}</span>`;

  return `
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:8px">
      <div>${fieldRow('Status', statusBadge)}</div>
      <div>${fieldRow('Total Value', totalBig)}</div>
    </div>

    <div style="font-size:11px;color:var(--muted);font-weight:600;letter-spacing:.5px;text-transform:uppercase;margin:14px 0 4px">Quote Information</div>
    ${fieldRow('Quote Ref', escOrDash(q.quote_ref))}
    ${fieldRow('Original Ref', escOrDash(q.original_quote_ref))}
    ${fieldRow('Date Sent', fmtDate(q.date_sent))}
    ${fieldRow('Valid Until', fmtDate(q.valid_until))}
    ${fieldRow('Customer ID', escOrDash(q.customer_id))}
    ${fieldRow('Work Order No.', escOrDash(q.work_order_no))}
    ${fieldRow('PO Number', q.po_number ? `<span style="font-family:var(--font-mono);color:var(--accent2)">${escapeHtml(q.po_number)}</span>` : '—')}
    ${fieldRow('Prepared By', escOrDash(q.prepared_by))}
    ${fieldRow('Quotation For', escOrDash(q.quote_for_area))}
    ${fieldRow('Address', escOrDash(q.quote_for_address))}
    ${fieldRow('Markup %', q.markup_pct !== null && q.markup_pct !== undefined ? `${q.markup_pct}%` : '—')}
    ${q.comments ? fieldRow('Comments', `<div style="white-space:pre-wrap">${escapeHtml(q.comments)}</div>`) : ''}

    <div style="font-size:11px;color:var(--muted);font-weight:600;letter-spacing:.5px;text-transform:uppercase;margin:18px 0 4px">Line Items</div>
    ${lineItemsHtml}

    <div style="font-size:11px;color:var(--muted);font-weight:600;letter-spacing:.5px;text-transform:uppercase;margin:18px 0 4px">Audit</div>
    ${fieldRow('Revision', q.revision && q.revision > 0 ? `rev${q.revision}` : 'Original (rev0)')}
    ${fieldRow('Created By', escOrDash(q.created_by))}
    ${fieldRow('Created At', fmtDate(q.created_at))}
    ${fieldRow('Last Updated', fmtDate(q.updated_at))}
    ${fieldRow('Source File', escOrDash(q.source_filename))}
  `;
}

function closeBabcockDetailModal() {
  document.getElementById('babcockDetailModal').classList.remove('active');
  _babcockDetailQuoteId = null;
}

function openBabcockDetailPdf() {
  const id = _babcockDetailQuoteId;
  const q = id && _babcockQuotes.find(x => x.id === id);
  if (q && q.generated_file_url) window.open(q.generated_file_url, '_blank', 'noopener');
}
function openBabcockDetailSource() {
  const id = _babcockDetailQuoteId;
  const q = id && _babcockQuotes.find(x => x.id === id);
  if (q && q.original_file_url) window.open(q.original_file_url, '_blank', 'noopener');
}
function editBabcockQuoteFromDetail() {
  const id = _babcockDetailQuoteId;
  closeBabcockDetailModal();
  if (id) editBabcockQuote(id);
}

// ── Edit modal (opens from pencil icon or detail-modal Edit button) ──
let _babcockEditingRecord = null; // full record loaded into edit modal
async function editBabcockQuote(id) {
  let q;
  try {
    q = await api.get(`/api/babcock-quotes/${id}`);
  } catch (err) {
    toast('Failed to load quote: ' + (err.message || 'unknown error'), 'error');
    return;
  }
  if (!q) return;

  _babcockEditingRecord = q;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.value = val ?? ''; };
  const dateOnly = v => v ? String(v).split('T')[0] : '';

  document.getElementById('beQuoteId').value    = q.id;
  document.getElementById('beRefHeader').textContent = q.quote_ref || `#${q.id}`;
  set('beQuoteRef',    q.quote_ref);
  set('beStatus',      q.status || 'Quote Sent');
  set('beDateSent',    dateOnly(q.date_sent));
  set('beValidUntil',  dateOnly(q.valid_until));
  set('beCustomerId',  q.customer_id);
  set('beWorkOrderNo', q.work_order_no);
  set('bePreparedBy',  q.prepared_by);
  set('beQuoteForArea', q.quote_for_area);
  set('beAddress',     q.quote_for_address);
  set('beTotalValue',  q.total_value);
  set('beMarkupPct',   q.markup_pct);
  set('beOriginalQuoteRef', q.original_quote_ref);
  set('bePoNumber',    q.po_number);
  set('beComments',    q.comments);

  document.getElementById('babcockEditModal').classList.add('active');
}

function closeBabcockEditModal() {
  document.getElementById('babcockEditModal').classList.remove('active');
  _babcockEditingRecord = null;
}

// Fields whose change requires regenerating the customer-facing PDF.
// Status-only changes are allowed to slip through with just a DB write.
const _BABCOCK_PDF_FIELDS = [
  'quote_ref', 'date_sent', 'valid_until', 'customer_id',
  'work_order_no', 'prepared_by', 'quote_for_area',
  'quote_for_address', 'comments', 'total_value', 'markup_pct'
];

async function submitBabcockEdit() {
  const id = parseInt(document.getElementById('beQuoteId').value, 10);
  if (!id) return;

  const val = elId => (document.getElementById(elId)?.value || '').trim();
  const dateVal = elId => document.getElementById(elId)?.value || null;
  const numVal = elId => {
    const v = document.getElementById(elId)?.value;
    if (v === '' || v === null || v === undefined) return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  };

  const newRef = val('beQuoteRef');
  if (!newRef) {
    toast('Quote reference is required', 'error');
    document.getElementById('beQuoteRef').focus();
    return;
  }

  const payload = {
    quote_ref:         newRef,
    status:            val('beStatus') || 'Quote Sent',
    date_sent:         dateVal('beDateSent'),
    valid_until:       dateVal('beValidUntil'),
    customer_id:       val('beCustomerId') || null,
    work_order_no:     val('beWorkOrderNo') || null,
    prepared_by:       val('bePreparedBy') || null,
    quote_for_area:    val('beQuoteForArea') || null,
    quote_for_address: val('beAddress') || null,
    total_value:       numVal('beTotalValue'),
    markup_pct:        numVal('beMarkupPct'),
    po_number:         val('bePoNumber') || null,
    comments:          val('beComments') || null
  };

  // Diff PDF-affecting fields against the originally-loaded record to
  // decide whether the customer PDF needs regenerating.
  const orig = _babcockEditingRecord || {};
  const norm = v => {
    if (v === null || v === undefined || v === '') return '';
    if (typeof v === 'number') return String(v);
    // Trim time component from datetime strings for comparison
    return String(v).split('T')[0].trim();
  };
  const pdfChanged = _BABCOCK_PDF_FIELDS.some(k => norm(payload[k]) !== norm(orig[k]));

  // ── Path A: no PDF-affecting changes — straight DB save ──
  if (!pdfChanged) {
    try {
      const updated = await api.put(`/api/babcock-quotes/${id}`, payload);
      const idx = _babcockQuotes.findIndex(q => q.id === id);
      if (idx !== -1) _babcockQuotes[idx] = { ..._babcockQuotes[idx], ...updated };
      renderBabcockTracker();
      closeBabcockEditModal();
      toast(`${updated.quote_ref} updated`, 'success');
    } catch (err) {
      toast('Save failed: ' + (err.message || 'unknown error'), 'error');
    }
    return;
  }

  // ── Path B: PDF must be regenerated ──
  const nextRev = (parseInt(orig.revision, 10) || 0) + 1;
  const proceed = await showConfirmAsync(
    '🔄 Regenerate PDF?',
    `<p style="margin:0 0 8px">Saving will regenerate the customer-facing PDF.</p>
     <p style="margin:0;font-size:13px;color:var(--muted)">A new file
     will be uploaded as <b style="color:var(--accent);font-family:var(--font-mono)">- rev${nextRev}.pdf</b>
     in SharePoint, and the tracker will point to the new revision.
     The original .xlsx${(orig.revision || 0) > 0 ? ` and earlier revisions` : ''} stay in place.</p>`,
    { okLabel: 'Save & Regenerate', cancelLabel: 'Cancel' }
  );
  if (!proceed) return;

  // Disable the save button and show progress
  const saveBtn = document.querySelector('#babcockEditModal .btn-primary');
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Regenerating…'; }

  try {
    setLoading(true);

    // Pre-load logo and rebuild the line-item array. Line items are
    // stored already marked-up; we use them as-is (markup % only
    // affects the label in the PDF, not the per-line numbers).
    await loadLogoDataUri();
    const lineItems = Array.isArray(orig.line_items) ? orig.line_items
                    : (typeof orig.line_items === 'string' && orig.line_items
                        ? (() => { try { return JSON.parse(orig.line_items); } catch { return []; } })()
                        : []);

    // The grand total comes from payload.total_value (user-editable);
    // if it's null/missing, fall back to summing line items so we never
    // produce a quote with a blank total.
    let grandTotal = payload.total_value;
    if (grandTotal === null || grandTotal === undefined || !isFinite(grandTotal)) {
      grandTotal = lineItems.reduce((s, l) => s + (Number(l.amount) || 0), 0);
    }

    const pdfBlob = await renderBabcockQuotePDF({
      quoteRef:    payload.quote_ref,
      quoteDate:   payload.date_sent,
      validUntil:  payload.valid_until,
      customerId:  payload.customer_id,
      workOrderNo: payload.work_order_no,
      preparedBy:  payload.prepared_by,
      quoteFor:    payload.quote_for_area,
      area:        '', // already merged into quote_for_area for this code path
      address:     payload.quote_for_address,
      comments:    payload.comments,
      markup:      payload.markup_pct ?? orig.markup_pct ?? 10,
      grandTotal,
      lineItems
    });

    // Upload the new PDF revision to SharePoint
    toast('Uploading revised PDF…', 'info');
    const folders = await findOrCreateBabcockFolders();
    const safeRef = (payload.quote_ref || 'BAMA-quote').replace(/[/\\]/g, '_');
    const dateForName = (payload.date_sent || todayStr()).replace(/-/g, '');
    const safeCustomer = (payload.quote_for_area || 'Quote').replace(/[/\\]/g, '_');
    const pdfFileName = `${safeRef} - ${safeCustomer} - ${dateForName} - rev${nextRev}.pdf`;

    const pdfUploaded = await uploadFileToFolder(
      folders.parent.id,
      pdfFileName,
      pdfBlob,
      'application/pdf'
    );

    // Save row with new file pointers + bumped revision
    payload.generated_file_id  = pdfUploaded.id;
    payload.generated_file_url = pdfUploaded.webUrl;
    payload.revision           = nextRev;

    const updated = await api.put(`/api/babcock-quotes/${id}`, payload);
    const idx = _babcockQuotes.findIndex(q => q.id === id);
    if (idx !== -1) _babcockQuotes[idx] = { ..._babcockQuotes[idx], ...updated };

    setLoading(false);
    renderBabcockTracker();
    closeBabcockEditModal();
    toast(`${updated.quote_ref} updated — rev${nextRev} saved ✓`, 'success');
  } catch (err) {
    setLoading(false);
    console.error('Babcock edit/regen failed:', err);
    toast('Save failed: ' + (err.message || 'unknown error'), 'error');
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save Changes'; }
  }
}

// ── Delete from tracker ──
// Default behaviour: removes the DB record only. Offers an option to
// also delete the SharePoint files (original .xlsx + generated PDF) so
// the user can fully clean up a mistakenly-created quote without going
// to SharePoint manually.
async function deleteBabcockQuote(id, ref) {
  const q = _babcockQuotes.find(x => x.id === id);
  const hasFiles = !!(q && (q.original_file_id || q.generated_file_id));

  // Use a checkbox inside the confirm modal so the user can choose.
  const checkboxHtml = hasFiles
    ? `<label style="display:flex;align-items:center;gap:8px;padding:10px 12px;background:var(--surface);border-radius:6px;margin-top:10px;cursor:pointer">
         <input type="checkbox" id="bdelDeleteFiles" style="margin:0">
         <span style="font-size:13px;color:var(--text)">Also delete the SharePoint files (.xlsx + PDF)</span>
       </label>
       <div style="font-size:11px;color:var(--subtle);margin-top:6px">If unchecked, only the tracker record is removed — SharePoint files stay.</div>`
    : `<div style="font-size:12px;color:var(--muted);margin-top:8px;font-style:italic">No SharePoint files linked to this record.</div>`;

  // Capture the checkbox state synchronously inside the click handler
  // (the modal is destroyed by the time the promise resolves).
  const result = await showConfirmAsync(
    '🗑 Delete Quote',
    `<p style="margin:0">Delete <b>${escapeHtml(ref || `quote #${id}`)}</b>? This cannot be undone.</p>${checkboxHtml}`,
    {
      okLabel: 'Delete',
      cancelLabel: 'Cancel',
      danger: true,
      onConfirmSync: () => ({
        deleteFiles: hasFiles && !!document.getElementById('bdelDeleteFiles')?.checked
      })
    }
  );

  if (!result || !result.ok) return;
  const { deleteFiles } = result.data || {};

  try {
    // Optionally delete SharePoint files first. Failures here are
    // non-fatal — we still delete the DB record so the user isn't left
    // with a half-cleaned-up state.
    if (deleteFiles && q) {
      const sharepointFails = [];
      try {
        if (q.original_file_id) await deleteSharepointFile(q.original_file_id);
      } catch (err) {
        console.warn('Failed to delete original .xlsx:', err);
        sharepointFails.push('original .xlsx');
      }
      try {
        if (q.generated_file_id) await deleteSharepointFile(q.generated_file_id);
      } catch (err) {
        console.warn('Failed to delete generated PDF:', err);
        sharepointFails.push('generated PDF');
      }
      if (sharepointFails.length) {
        toast(`Could not delete: ${sharepointFails.join(', ')} — record will still be removed`, 'warn');
      }
    }

    await api.delete(`/api/babcock-quotes/${id}`);
    _babcockQuotes = _babcockQuotes.filter(q => q.id !== id);
    renderBabcockTracker();
    toast(`Deleted ${ref}${deleteFiles ? ' (with files)' : ''}`, 'success');
  } catch (err) {
    toast('Delete failed: ' + (err.message || 'unknown error'), 'error');
  }
}

// Delete a single SharePoint file by Graph item id.
async function deleteSharepointFile(itemId) {
  if (!itemId) return;
  const token = await getToken();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${BAMA_DRIVE_ID}/items/${encodeURIComponent(itemId)}`,
    { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } }
  );
  // 204 = deleted, 404 = already gone (treat as success)
  if (!res.ok && res.status !== 404) {
    throw new Error(`SharePoint delete failed (${res.status})`);
  }
}

// ── Recalculate preview + marked-up total when markup changes ──
function onBabcockMarkupChange() {
  if (!_babcockRawData) return;
  const markup = parseFloat(document.getElementById('babcockMarkup').value) || 10;
  renderBabcockPreviewTable(markup);
  updateBabcockMarkedUpTotal(markup);
}

function closeQuoteDetail() {
  currentTender = null;
  _quoteLineItemsCache = [];
  document.getElementById('tab-quoteDetail').style.display = 'none';
  document.getElementById('tab-quoteDetail').classList.remove('active');
  switchQuotesTab('quotes');
}

// ─────────────────────────────────────────────────────────────────────────────
// Quote Line Items — the 9 fixed categories editor on quote detail.
// Loads on demand, edits in-memory, bulk-saves on the parent quote save.
// ─────────────────────────────────────────────────────────────────────────────
let _quoteLineItemsCache = [];

async function loadQuoteLineItems(tenderId) {
  if (!tenderId) return;
  let rows = [];
  try {
    rows = await api.get(`/api/quote-line-items?tender_id=${tenderId}`);
  } catch (e) {
    console.warn('Could not fetch line items:', e);
    rows = [];
  }
  // Auto-seed if the quote has no line items yet — covers any quote (won or
  // not) opened after the migration. Only seed once.
  if (!Array.isArray(rows) || rows.length === 0) {
    try {
      rows = await api.post(`/api/quote-line-items/seed/${tenderId}`, {});
    } catch (e) {
      console.warn('Could not seed line items:', e);
      rows = [];
    }
  }
  _quoteLineItemsCache = (rows || []).slice().sort((a, b) => a.line_no - b.line_no);
  renderQuoteLineItems();
}

function renderQuoteLineItems() {
  const wrap = document.getElementById('qliRows');
  if (!wrap) return;
  if (!_quoteLineItemsCache.length) {
    wrap.innerHTML = '<div style="padding:14px;text-align:center;color:var(--subtle);font-size:12px">No line items.</div>';
    _refreshQuoteLineItemTotals();
    return;
  }
  wrap.innerHTML = _quoteLineItemsCache.map((li, idx) => {
    const qty   = parseFloat(li.quantity)   || 0;
    const price = parseFloat(li.unit_price) || 0;
    const rate  = parseFloat(li.vat_rate)   || 0;
    const excl  = qty * price;
    const vatOn = !!li.vat_applies && (li.vat_applies !== 0);
    const vat   = vatOn ? (excl * (rate / 100)) : 0;
    const total = excl + vat;
    return `
      <div class="qli-row qli-grid" data-idx="${idx}" data-id="${li.id}">
        <div class="qli-num">${li.line_no}</div>
        <div>
          <input type="text" data-field="description" value="${escapeHtml(li.description || '')}" oninput="onQuoteLineItemEdit(${idx}, 'description', this.value)">
        </div>
        <div><input type="number" data-field="quantity" min="0" step="0.01" value="${qty}" oninput="onQuoteLineItemEdit(${idx}, 'quantity', this.value)"></div>
        <div><input type="number" data-field="unit_price" min="0" step="0.01" value="${price.toFixed(2)}" oninput="onQuoteLineItemEdit(${idx}, 'unit_price', this.value)"></div>
        <div style="text-align:center"><input type="checkbox" data-field="is_labour" ${li.is_labour ? 'checked' : ''} onchange="onQuoteLineItemEdit(${idx}, 'is_labour', this.checked ? 1 : 0)"></div>
        <div style="text-align:center"><input type="checkbox" data-field="vat_applies" ${vatOn ? 'checked' : ''} onchange="onQuoteLineItemEdit(${idx}, 'vat_applies', this.checked ? 1 : 0)"></div>
        <div><input type="number" data-field="vat_rate" min="0" max="100" step="0.5" value="${rate}" oninput="onQuoteLineItemEdit(${idx}, 'vat_rate', this.value)" ${vatOn ? '' : 'disabled style="opacity:.4"'}></div>
        <div class="qli-derived" data-derived="excl">£${excl.toFixed(2)}</div>
        <div class="qli-derived" data-derived="vat">£${vat.toFixed(2)}</div>
        <div class="qli-derived" data-derived="total">£${total.toFixed(2)}</div>
      </div>
    `;
  }).join('');
  _refreshQuoteLineItemTotals();
}

// In-place edit handler — updates the cache and just re-derives the affected
// row, then refreshes totals. Avoids re-rendering the whole grid (which would
// blur the input the user is currently typing in).
function onQuoteLineItemEdit(idx, field, value) {
  const item = _quoteLineItemsCache[idx];
  if (!item) return;

  if (field === 'description') {
    item.description = String(value);
  } else if (field === 'is_labour' || field === 'vat_applies') {
    item[field] = value ? 1 : 0;
  } else {
    // numeric — coerce, keeping 0 valid
    const num = parseFloat(value);
    item[field] = Number.isNaN(num) ? 0 : num;
  }
  item._dirty = true;
  markQuoteDirty();

  // Re-derive numbers in the current row only.
  const row = document.querySelector(`#qliRows .qli-row[data-idx="${idx}"]`);
  if (row) {
    const qty   = parseFloat(item.quantity)   || 0;
    const price = parseFloat(item.unit_price) || 0;
    const rate  = parseFloat(item.vat_rate)   || 0;
    const vatOn = !!item.vat_applies && (item.vat_applies !== 0);
    const excl  = qty * price;
    const vat   = vatOn ? (excl * (rate / 100)) : 0;
    const total = excl + vat;
    row.querySelector('[data-derived="excl"]').textContent  = '£' + excl.toFixed(2);
    row.querySelector('[data-derived="vat"]').textContent   = '£' + vat.toFixed(2);
    row.querySelector('[data-derived="total"]').textContent = '£' + total.toFixed(2);
    // VAT% input: enable/disable based on the toggle.
    if (field === 'vat_applies') {
      const rateInp = row.querySelector('input[data-field="vat_rate"]');
      if (rateInp) {
        rateInp.disabled = !vatOn;
        rateInp.style.opacity = vatOn ? '' : '.4';
      }
    }
  }

  _refreshQuoteLineItemTotals();
}

function _refreshQuoteLineItemTotals() {
  let totalExcl = 0, totalVAT = 0, labourSubtotal = 0;
  for (const li of _quoteLineItemsCache) {
    const qty   = parseFloat(li.quantity)   || 0;
    const price = parseFloat(li.unit_price) || 0;
    const rate  = parseFloat(li.vat_rate)   || 0;
    const excl  = qty * price;
    const vatOn = !!li.vat_applies && (li.vat_applies !== 0);
    const vat   = vatOn ? (excl * (rate / 100)) : 0;
    totalExcl += excl;
    totalVAT  += vat;
    if (li.is_labour) labourSubtotal += excl;
  }
  const totalIncl = totalExcl + totalVAT;
  const set = (id, txt) => { const el = document.getElementById(id); if (el) el.textContent = txt; };
  set('qliTotalExcl', '£' + totalExcl.toFixed(2));
  set('qliTotalVAT',  '£' + totalVAT.toFixed(2));
  set('qliTotalIncl', '£' + totalIncl.toFixed(2));
  set('qliLabourSubtotal', '£' + labourSubtotal.toFixed(2));
  set('qliTotalsSummary', `Excl. £${totalExcl.toFixed(2)} • Incl. £${totalIncl.toFixed(2)}`);
}

// Bulk-save anything dirty. Called from saveQuoteChanges. No-op if nothing
// changed (the bulk endpoint short-circuits an empty items array as a
// validation error, so we just bail before calling).
async function saveQuoteLineItems() {
  const dirty = _quoteLineItemsCache.filter(li => li._dirty);
  if (!dirty.length) return;
  const items = dirty.map(li => ({
    id:           li.id,
    description:  li.description,
    quantity:     parseFloat(li.quantity)   || 0,
    unit_price:   parseFloat(li.unit_price) || 0,
    vat_applies:  li.vat_applies ? 1 : 0,
    vat_rate:     parseFloat(li.vat_rate)   || 0,
    is_labour:    li.is_labour ? 1 : 0
  }));
  await api.put('/api/quote-line-items-bulk', { items });
  // Mark clean so re-saving without further edits is a no-op.
  for (const li of dirty) delete li._dirty;
}

// PAGE DETECTION
// ═══════════════════════════════════════════
const CURRENT_PAGE = (() => {
  const path = window.location.pathname.toLowerCase();
  if (path.includes('manager')) return 'manager';
  if (path.includes('office')) return 'office';
  if (path.includes('templates')) return 'templates';
  if (path.includes('babcock')) return 'babcock';
  if (path.includes('tenders')) return 'tenders';
  if (path.includes('quotes')) return 'quotes';
  if (path.includes('project-tracker')) return 'projectTracker';
  if (path.includes('projects') || path.includes('project')) return 'projects';
  if (path.includes('hub')) return 'hub';
  return 'index'; // default kiosk
})();

// Track whether we successfully loaded data from the API
let _dataLoadedFromAPI = false;

async function init() {
  setLoading(true);

  // Handle token from Microsoft login redirect
  const justLoggedIn = AUTH.handleRedirect();
  if (justLoggedIn) console.log('Just returned from login, token stored');

  // Fire a warm-up ping immediately — no auth needed, wakes the Function App from cold start
  const warmupPromise = fetch(`${API_BASE}/api/health`).catch(() => {});

  // Load core data from SQL API with retry
  // Generous timeouts to handle Azure Function cold starts (can take 15-25s on free tier)
  const loadDataWithRetry = async () => {
    await warmupPromise; // wait for warmup to complete first
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await Promise.race([
          loadTimesheetData(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), attempt === 1 ? 30000 : 20000))
        ]);
        _dataLoadedFromAPI = true;
        return;
      } catch (e) {
        console.warn(`API data load attempt ${attempt}/3 failed:`, e.message);
        if (attempt < 3) {
          console.log(`Retrying in ${attempt}s...`);
          await new Promise(r => setTimeout(r, attempt * 1000));
        }
      }
    }
    if (!state.timesheetData.employees || state.timesheetData.employees.length === 0) {
      console.warn('No employee data loaded after 3 attempts — app will be read-only until data loads');
    }
  };
  const dataPromise = loadDataWithRetry();

  // Projects Excel only needed on kiosk and projects pages (still from SharePoint)
  const projectsPromise = (CURRENT_PAGE === 'index' || CURRENT_PAGE === 'projects')
    ? Promise.race([
        loadProjects(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 8000))
      ]).catch(e => { console.warn('Project load skipped, using fallback:', e.message); state.projects = FALLBACK_PROJECTS; })
    : Promise.resolve();

  // User access needed on manager and office pages (still from SharePoint for now)
  const userAccessPromise = (CURRENT_PAGE === 'manager' || CURRENT_PAGE === 'office' || CURRENT_PAGE === 'projects' || CURRENT_PAGE === 'projectTracker' || CURRENT_PAGE === 'tenders' || CURRENT_PAGE === 'quotes' || CURRENT_PAGE === 'babcock')
    ? Promise.race([
        loadUserAccessData(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 6000))
      ]).catch(e => { console.warn('User access load skipped:', e.message); })
    : Promise.resolve();

  // Office tasks only needed on office page (still from SharePoint for now)
  const officeTasksPromise = (CURRENT_PAGE === 'office' || CURRENT_PAGE === 'tenders' || CURRENT_PAGE === 'quotes')
    ? Promise.race([
        loadOfficeTasksData(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 6000))
      ]).catch(e => { console.warn('Office tasks load skipped:', e.message); })
    : Promise.resolve();

  // Run all loads in parallel
  await Promise.all([dataPromise, projectsPromise, userAccessPromise, officeTasksPromise]);

  setLoading(false);

  // Page-specific startup
  if (CURRENT_PAGE === 'manager') {
    showScreen('screenManagerSelect');
    renderManagerEmployeeGrid();
  } else if (CURRENT_PAGE === 'office') {
    showScreen('screenOfficeSelect');
    renderOfficeEmployeeGrid();
  } else if (CURRENT_PAGE === 'projects') {
    showScreen('screenProjects');
    renderProjectTiles();
    // Load job data then re-render tiles with job counts, and handle deep links
    loadDrawingsData().then(() => {
      renderProjectTiles();
      // Deep link: ?project=X&job=Y&element=Assembly
      const params = new URLSearchParams(window.location.search);
      const deepProject = params.get('project');
      const deepJob = params.get('job');
      const deepElement = params.get('element');
      if (deepProject && deepJob) {
        // Clear URL params so back button doesn't re-trigger
        window.history.replaceState({}, '', window.location.pathname);
        // Wait for BOM data, then navigate
        loadBomData(deepProject).then(() => {
          openJobDetail(deepProject, deepJob);
          if (deepElement) {
            setTimeout(() => {
              // Expand the target element section
              const body = document.getElementById(`element${deepElement}Body`);
              if (body && body.classList.contains('collapsed')) toggleElement(deepElement);
              // Scroll to it
              const card = document.getElementById(`element${deepElement}`);
              if (card) card.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }, 300);
          }
        }).catch(() => {});
      }
    }).catch(e => console.warn('Job data load failed:', e.message));
  } else if (CURRENT_PAGE === 'templates') {
    initTemplatesPage();
  } else if (CURRENT_PAGE === 'tenders') {
    initTendersPage();
  } else if (CURRENT_PAGE === 'quotes') {
    initQuotesPage();
  } else if (CURRENT_PAGE === 'projectTracker') {
    initProjectTrackerPage();
  } else if (CURRENT_PAGE === 'babcock') {
    initBabcockPage();
  } else if (CURRENT_PAGE === 'hub') {
    // hub has its own simple rendering
  } else {
    renderHome();
  }
}

init();
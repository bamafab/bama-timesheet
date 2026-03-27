// ═══════════════════════════════════════════
// CONFIGURATION — Edit these
// ═══════════════════════════════════════════
const CONFIG = {
  managerPin: '1234', // Change this PIN!
  driveId: 'b!CxTKk9lEwkyweUqAo3CRas-huywW4KtLqOk2tNzmx-P7CX86DNhTQo14pLuU_tZu',
  projectTrackerItemId: '012IX7LSI5MG6U55XFORBYNJORV3AQLGU7',
  timesheetFileName: 'timesheet-data.json',
  timesheetFolderItemId: '012IX7LSKBTWWE4SJNNFEJGFDOXH3M3Z5B', // 01 - Accounts/DANIEL/Project Tracker
  timesheetFolderId: null, // will store in root of drive

  employees: [], // now managed via Manager > Staff tab

  timeSlots: (() => {
    const slots = [];
    for (let h = 4; h <= 23; h++) {
      for (let m of [0, 30]) {
        const hh = String(h).padStart(2,'0');
        const mm = String(m).padStart(2,'0');
        const ampm = h < 12 ? 'AM' : 'PM';
        const h12 = h > 12 ? h - 12 : h === 0 ? 12 : h;
        slots.push({ val: `${hh}:${mm}`, label: `${h12}:${mm} ${ampm}` });
      }
    }
    return slots;
  })()
};

// ═══════════════════════════════════════════
// STATE
// ═══════════════════════════════════════════
let state = {
  projects: [],       // { id, name, status }
  timesheetData: {    // persisted to SharePoint JSON
    employees: [],    // { id, name, role, active, addedAt }
    entries: [],      // { id, employeeName, projectId, projectName, hours, date, status, submittedAt }
    clockings: [],    // { id, employeeName, date, clockIn, clockOut, breakMins }
    settings: { managerPin: '1234' }
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
// DATA LAYER — Microsoft Graph API
// ═══════════════════════════════════════════
async function loadTimesheetData() {
  const token = await getToken();
  const metaUrl = `https://graph.microsoft.com/v1.0/drives/${CONFIG.driveId}/items/${CONFIG.timesheetFolderItemId}:/${CONFIG.timesheetFileName}`;
  const metaRes = await fetch(metaUrl, { headers: { 'Authorization': `Bearer ${token}` } });

  if (metaRes.status === 404) {
    console.log('First run — no timesheet-data.json yet');
    return;
  }
  if (!metaRes.ok) throw new Error(`Metadata fetch failed: ${metaRes.status}`);

  const meta = await metaRes.json();
  state.timesheetItemId = meta.id;

  const contentRes = await fetch(
    `https://graph.microsoft.com/v1.0/drives/${CONFIG.driveId}/items/${meta.id}/content`,
    { headers: { 'Authorization': `Bearer ${token}` } }
  );
  if (!contentRes.ok) throw new Error(`Content fetch failed: ${contentRes.status}`);

  const loaded = await contentRes.json();
  state.timesheetData = {
    employees: [],
    entries: [],
    clockings: [],
    settings: { managerPin: '1234' },
    ...loaded
  };
  console.log(`Loaded: ${(state.timesheetData.employees||[]).length} employees, ${state.timesheetData.entries.length} entries`);
}

async function saveTimesheetData() {
  // SAFEGUARD 1: Never save if we didn't successfully load data first
  if (!_dataLoadedFromSharePoint) {
    console.error('BLOCKED: Cannot save — data was never loaded from SharePoint');
    toast('Save blocked — data not loaded yet. Please refresh.', 'error');
    return;
  }

  // SAFEGUARD 2: Never overwrite SharePoint with empty employees
  if (!state.timesheetData.employees || state.timesheetData.employees.length === 0) {
    console.error('BLOCKED: Attempted to save empty employees array — aborting to protect data');
    toast('Save blocked — no employee data to save', 'error');
    return;
  }

  const token = await getToken();
  const json = JSON.stringify(state.timesheetData, null, 2);
  const url = `https://graph.microsoft.com/v1.0/drives/${CONFIG.driveId}/items/${CONFIG.timesheetFolderItemId}:/${CONFIG.timesheetFileName}:/content`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: json
  });
  if (!res.ok) {
    const err = await res.text().catch(() => res.status);
    throw new Error(`Save failed (${res.status}): ${err}`);
  }
  console.log('Saved to SharePoint OK');

  // Auto-backup max once every 5 minutes
  const now = Date.now();
  if (!saveTimesheetData._lastBackup || now - saveTimesheetData._lastBackup > 5 * 60 * 1000) {
    saveTimesheetData._lastBackup = now;
    const ts = new Date().toISOString().replace(/[:.]/g,'-').slice(0,16);
    fetch(`https://graph.microsoft.com/v1.0/drives/${CONFIG.driveId}/items/012IX7LSOBE5X4IMQJT5A25KEJEMOV2OUR:/timesheet-backup-${ts}.json:/content`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: json
    }).then(() => console.log('Backup saved')).catch(e => console.warn('Backup failed (non-critical):', e.message));
  }
}

// ═══════════════════════════════════════════
// LOAD PROJECTS FROM PROJECT TRACKER
// ═══════════════════════════════════════════
async function loadProjects() {
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
      const clockedHrs = clocking ? (calcHours(clocking.clockIn, clocking.clockOut, clocking.breakMins) || 0) : 0;
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

function dateStr(d) {
  return d.toISOString().slice(0, 10);
}

function fmtDate(d) {
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function todayStr() { return dateStr(new Date()); }

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
    const clocking = state.timesheetData.clockings.find(
      c => c.employeeName === name && c.date === today && !c.clockOut
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
}

let _pendingEmployee = null;

function openEmployee(name) {
  const emp = (state.timesheetData.employees || []).find(e => e.name === name);

  // If employee has a PIN, show PIN modal first
  if (emp && emp.pin) {
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

function checkEmpPin() {
  const pin = document.getElementById('empPinInput').value;
  const emp = (state.timesheetData.employees || []).find(e => e.name === _pendingEmployee);

  if (!emp) return;

  if (pin === emp.pin) {
    closeEmpPinModal();
    openEmployeePanel(emp.name);
  } else {
    document.getElementById('empPinError').textContent = 'Incorrect PIN — try again';
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

  // Hide project time card if employee has already clocked out today
  const projectCard = document.getElementById('projectTimeCard');
  const alreadyClockedOut = state.timesheetData.clockings.find(
    c => c.employeeName === name && c.date === todayStr() && c.clockOut
  );
  if (projectCard) {
    if (alreadyClockedOut) {
      projectCard.style.display = 'none';
    } else {
      projectCard.style.display = '';
    }
  }

  // Time selects
  fillTimeSelects();

  // Render My Week
  renderMyWeek(name);

  // Render holiday balance
  renderEmpHolidayBalance(name);

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

  // Check clocked in
  const today = todayStr();
  const clocking = state.timesheetData.clockings.find(
    c => c.employeeName === name && c.date === today && !c.clockOut
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
  state.currentEntries = state.currentEntries.filter(e => e.id !== id);
  renderTodayEntries();
}

function renderTodayEntries() {
  const container = document.getElementById('todayEntries');
  const today = todayStr();

  // Submitted entries + current session entries
  const submitted = state.timesheetData.entries.filter(
    e => e.employeeName === state.currentEmployee && e.date === today && e.date === todayStr()
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

  if (direction === 'in') {
    // Capture exact current time
    const now = new Date();
    const clockIn = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    // Block if already clocked in (no clock-out yet)
    const existing = state.timesheetData.clockings.find(
      c => c.employeeName === emp && c.date === today && !c.clockOut
    );
    if (existing) {
      toast(`${emp} is already clocked in today at ${existing.clockIn}`, 'error');
      return;
    }

    // Block if already completed a full shift today (clocked in AND out)
    const completedToday = state.timesheetData.clockings.find(
      c => c.employeeName === emp && c.date === today && c.clockOut
    );
    if (completedToday) {
      toast(`${emp} has already clocked in and out today (${completedToday.clockIn} – ${completedToday.clockOut})`, 'error');
      return;
    }

    state.timesheetData.clockings.push({
      id: Date.now().toString(),
      employeeName: emp,
      date: today,
      clockIn,
      clockOut: null,
      breakMins: 0
    });

    // Check bank holiday
    if (isBankHoliday(today)) {
      toast(`⚠️ Today is a bank holiday — clocking in anyway`, 'info');
    }

    // Check if they have an approved holiday today
    const hasApprovedHoliday = (state.timesheetData.holidays || []).some(h =>
      h.employeeName === emp && h.status === 'approved' &&
      h.dateFrom <= today && h.dateTo >= today
    );
    if (hasApprovedHoliday) {
      toast(`⚠️ You have approved holiday today — clocking in anyway`, 'info');
    }

    // Update UI immediately — don't make them wait
    showClockedIn({ clockIn });
    renderHome();
    toast(`Clocked in at ${clockIn}`, 'success');

    // Save in background
    try {
      await saveTimesheetData();
    } catch (e) {
      console.error('Clock-in save error:', e);
      toast('Warning: saved locally but sync to SharePoint failed. Try again shortly.', 'error');
    }

  } else {
    // CLOCK OUT
    if (!state.timesheetData || !state.timesheetData.clockings) {
      toast('Error: timesheet data not loaded', 'error');
      return;
    }

    const clocking = state.timesheetData.clockings.find(
      c => c.employeeName === emp && c.date === today && !c.clockOut
    );
    if (!clocking) { toast('Not clocked in today — cannot clock out', 'error'); return; }

    // Break is always 30 mins (mandatory default)
    const breakEl = document.getElementById('breakDuration');
    let breakMins = breakEl ? (parseInt(breakEl.value) || 30) : 30;

    // Capture exact current time for clock out
    const now = new Date();
    const clockOut = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;

    // Check if any project hours logged today (excluding S000 and WGD auto entries)
    const allEntries = state.timesheetData.entries || [];
    const currentEntries = state.currentEntries || [];
    const todayProjectHrs = [
      ...allEntries.filter(e => e.employeeName === emp && e.date === today && e.projectId !== 'S000' && e.projectId !== 'WGD'),
      ...currentEntries.filter(e => e.projectId !== 'S000' && e.projectId !== 'WGD')
    ];
    const todayWGDHrs = [
      ...allEntries.filter(e => e.employeeName === emp && e.date === today && e.projectId === 'WGD'),
      ...currentEntries.filter(e => e.projectId === 'WGD')
    ];


    if (todayProjectHrs.length === 0 && todayWGDHrs.length === 0) {
      // No project hours — show the mandatory prompt
      _pendingClockOutData = { emp, today, clockOut, breakMins, clocking };
      const modal = document.getElementById('noProjectModal');
      if (modal) {
        modal.classList.add('active');
      } else {
        toast('Error: noProjectModal not found in page', 'error');
      }
      return;
    }

    // Has project hours — proceed directly
    await finishClockOut({ emp, today, clockOut, breakMins, clocking });
  }
  } catch (err) {
    console.error('doClock error:', err);
    toast('Clock error: ' + err.message, 'error');
  }
}

async function finishClockOut({ emp, today, clockOut, breakMins, clocking }) {
    clocking.clockOut = clockOut;
    clocking.breakMins = breakMins;

    // Calculate S000 unproductive time
    const clockIn = clocking.clockIn;
    const clockedHrs = calcHours(clockIn, clockOut, breakMins) || 0;
    const totalProjectHrs = state.timesheetData.entries
      .filter(e => e.employeeName === emp && e.date === today && e.projectId !== 'S000')
      .reduce((s, e) => s + e.hours, 0);
    const unproductiveHrs = parseFloat((clockedHrs - totalProjectHrs).toFixed(2));

    // Remove any existing S000 for today and re-add if needed
    state.timesheetData.entries = state.timesheetData.entries.filter(
      e => !(e.employeeName === emp && e.date === today && e.projectId === 'S000')
    );

    if (unproductiveHrs > 0) {
      state.timesheetData.entries.push({
        id: `s000-${today}-${emp}`,
        employeeName: emp,
        projectId: 'S000',
        projectName: 'Unproductive Time',
        hours: unproductiveHrs,
        date: today,
        status: 'approved',
        autoGenerated: true,
        submittedAt: new Date().toISOString()
      });
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

    // Save in background
    try {
      await saveTimesheetData();
    } catch (e) {
      console.error('Clock-out save error:', e);
      toast('Warning: saved locally but sync to SharePoint failed. Try again shortly.', 'error');
    }
}

async function submitDay() {
  if (!state.currentEntries.length) {
    toast('No new entries to submit', 'error'); return;
  }
  const today = todayStr();

  // Push all current entries
  state.currentEntries.forEach(e => {
    state.timesheetData.entries.push({
      id: e.id,
      employeeName: state.currentEmployee,
      projectId: e.projectId,
      projectName: e.projectName,
      hours: e.hours,
      date: today,
      status: 'pending',
      submittedAt: new Date().toISOString()
    });
  });

  try {
    setLoading(true);
    await saveTimesheetData();
    state.currentEntries = [];
    renderTodayEntries();
    toast(`Entries submitted for approval ✓`, 'success');
    setTimeout(goHome, 1500);
  } catch { toast('Submit failed — check connection', 'error'); }
  finally { setLoading(false); }
}

// ═══════════════════════════════════════════
// MANAGER VIEW
// ═══════════════════════════════════════════
function showManagerAuth() {
  if (CURRENT_PAGE !== 'manager') {
    window.location.href = 'manager.html';
    return;
  }
  showScreen('screenAuth');
  setTimeout(() => document.getElementById('pinInput').focus(), 100);
}

function checkPin() {
  const pin = document.getElementById('pinInput').value;
  const storedPin = (state.timesheetData.settings && state.timesheetData.settings.managerPin) || CONFIG.managerPin || '1234';
  if (pin === storedPin) {
    document.getElementById('pinInput').value = '';
    showScreen('screenManager');
    renderManagerView();
  } else {
    toast('Incorrect PIN', 'error');
    document.getElementById('pinInput').value = '';
  }
}

function renderManagerView() {
  const { mon, sun } = getWeekDates(state.currentWeekOffset);
  document.getElementById('weekLabel').textContent =
    `${fmtDate(mon)} – ${fmtDate(sun)}`;

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
  const totalHrs = weekEntries.reduce((s, e) => s + e.hours, 0);
  const pending = weekEntries.filter(e => e.status === 'pending').length;
  const approved = weekEntries.filter(e => e.status === 'approved').length;
  const emps = new Set(weekEntries.map(e => e.employeeName)).size;

  document.getElementById('stat-hrs').innerHTML = `${totalHrs.toFixed(1)}<span class="stat-unit">hrs</span>`;
  document.getElementById('stat-pending').textContent = pending;
  document.getElementById('stat-approved').textContent = approved;
  document.getElementById('stat-emps').textContent = emps;
  document.getElementById('pendingCount').textContent = `${pending} entr${pending === 1 ? 'y' : 'ies'} pending approval`;

  // Project table
  renderProjectTable(weekEntries);
  renderEmpSummary(weekEntries, weekClockings);
  // Clock log rendered by its own week navigator
  renderClockLogForWeek();
}

function renderProjectTable(entries) {
  const tbody = document.getElementById('projectTableBody');
  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="icon">📋</div>No entries this week</div></td></tr>';
    return;
  }

  tbody.innerHTML = entries.map(e => `
    <tr>
      <td><span class="mono" style="color:var(--accent2)">${e.projectId}</span></td>
      <td style="color:var(--muted)">${e.projectName}</td>
      <td>${e.employeeName}</td>
      <td class="mono" style="font-size:12px">${e.date}</td>
      <td class="mono"><b>${e.hours}h</b></td>
      <td><span class="tag tag-${e.status}">${e.status}</span></td>
      <td>
        ${e.status === 'pending' ? `
          <div class="approve-row">
            <button class="tiny-btn tiny-approve" onclick="setEntryStatus('${e.id}','approved')">✓ Approve</button>
            <button class="tiny-btn tiny-reject" onclick="setEntryStatus('${e.id}','rejected')">✕ Reject</button>
          </div>
        ` : `<span style="color:var(--subtle);font-size:12px">—</span>`}
      </td>
    </tr>
  `).join('');
}

function renderEmpSummary(entries, clockings) {
  const area = document.getElementById('empSummaryArea');
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
          <span style="font-size:12px;color:var(--muted);font-family:var(--font-mono)">${e.date}</span>
          <span class="proj-hrs">${e.hours}h</span>
          <span class="tag tag-${e.status}" style="margin-left:8px">${e.status}</span>
        </div>
      `).join('')}
    </div>
  `).join('');
}

function calcHours(clockIn, clockOut, breakMins) {
  if (!clockIn || !clockOut) return null;
  const [ih, im] = clockIn.split(':').map(Number);
  const [oh, om] = clockOut.split(':').map(Number);
  const diff = (oh * 60 + om) - (ih * 60 + im) - (breakMins || 0);
  return diff > 0 ? diff / 60 : 0;
}

function renderClockLog(clockings) {
  const area = document.getElementById('clockLogArea');
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

      const hrs = calcHours(c.clockIn, c.clockOut, c.breakMins) || 0;
      const isPending = c.approvalStatus === 'pending' || (!c.approvalStatus && !c.addedByManager);
      const isEdited = c.manuallyEdited;

      // Inline edit mode
      if (c._editing) {
        const times = [];
        for (let h = 5; h <= 22; h++) { times.push(`${String(h).padStart(2,'0')}:00`); times.push(`${String(h).padStart(2,'0')}:30`); }
        const inOpts = times.map(t => `<option value="${t}" ${t === c.clockIn ? 'selected' : ''}>${t}</option>`).join('');
        const outOpts = times.map(t => `<option value="${t}" ${t === (c.clockOut||'') ? 'selected' : ''}>${t}</option>`).join('');
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
      return s + (c ? calcHours(c.clockIn, c.clockOut, c.breakMins) || 0 : 0);
    }, 0);
    return `<td style="text-align:center;padding:8px 6px;font-family:var(--font-mono);font-size:12px;font-weight:600;color:var(--muted)">${total > 0 ? total.toFixed(1) + 'h' : '—'}</td>`;
  }).join('');

  const grandTotal = Object.values(empMap).reduce((s, emp) => {
    return s + Object.values(emp).reduce((ss, c) => ss + (calcHours(c.clockIn, c.clockOut, c.breakMins) || 0), 0);
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
            ${days.map(d => `<th style="text-align:center;min-width:90px">${d.label}<br><span style="font-weight:400;font-size:9px;color:var(--subtle)">${d.date.slice(5)}</span></th>`).join('')}
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
  const hrs = calcHours(inVal, outVal, breakVal);
  const totalEl = document.getElementById(`edit-total-${id}`);
  if (totalEl && hrs !== null) totalEl.textContent = hrs.toFixed(2) + 'h';
}

function editClockingInline(id) {
  const clocking = state.timesheetData.clockings.find(c => c.id === id);
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
  const clocking = state.timesheetData.clockings.find(c => c.id === id);
  if (!clocking) return;
  clocking._editing = false;
  renderManagerView();
}

async function saveClockEdit(id) {
  const clocking = state.timesheetData.clockings.find(c => c.id === id);
  if (!clocking) return;

  clocking.clockIn = document.getElementById(`edit-in-${id}`).value;
  clocking.clockOut = document.getElementById(`edit-out-${id}`).value;
  clocking.breakMins = parseInt(document.getElementById(`edit-break-${id}`).value) || 0;
  clocking.manuallyEdited = true;
  clocking.approvalStatus = 'pending'; // Mark as pending after manual edit
  clocking._editing = false;

  try {
    await saveTimesheetData();
    toast('Clocking updated — pending approval ✓', 'success');
    renderManagerView();
  } catch { toast('Save failed', 'error'); }
}

async function approveClocking(id) {
  const c = state.timesheetData.clockings.find(c => c.id === id);
  if (!c) return;
  c.approvalStatus = 'approved';
  try {
    await saveTimesheetData();
    toast('Clocking approved ✓', 'success');
    renderManagerView();
  } catch { toast('Save failed', 'error'); }
}

async function rejectClocking(id) {
  const c = state.timesheetData.clockings.find(c => c.id === id);
  if (!c) return;
  // Revert to original if available
  if (c.originalClockIn) { c.clockIn = c.originalClockIn; c.clockOut = c.originalClockOut; c.breakMins = c.originalBreakMins || 0; }
  c.approvalStatus = 'rejected';
  c.manuallyEdited = false;
  try {
    await saveTimesheetData();
    toast('Change rejected', 'success');
    renderManagerView();
  } catch { toast('Save failed', 'error'); }
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
  const emp = document.getElementById('mgrClockEmp').value;
  const date = document.getElementById('mgrClockDate').value;
  const clockIn = document.getElementById('mgrClockIn').value;
  const clockOut = document.getElementById('mgrClockOut').value;
  const breakMins = parseInt(document.getElementById('mgrClockBreak').value) || 0;

  if (!emp || !date || !clockIn || !clockOut) {
    toast('Please fill in all fields', 'error'); return;
  }

  state.timesheetData.clockings.push({
    id: Date.now().toString(),
    employeeName: emp,
    date,
    clockIn,
    clockOut,
    breakMins,
    addedByManager: true,
    manuallyEdited: true,
    approvalStatus: 'approved'
  });

  try {
    await saveTimesheetData();
    closeMgrAddClocking();
    toast(`Clocking added for ${emp} ✓`, 'success');
    renderManagerView();
  } catch { toast('Save failed', 'error'); }
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
  const weekTotalHrs = weekClockings.reduce((s, c) => s + (calcHours(c.clockIn, c.clockOut, c.breakMins) || 0), 0);
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

    // Project entries removed from My Week view per user request

    let content = '';
    if (clocking) {
      const hrs = calcHours(clocking.clockIn, clocking.clockOut, clocking.breakMins);
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
      content = `
        <div style="color:var(--subtle);font-size:11px;margin-top:8px">No clocking</div>
        ${!isToday2 ? `<button class="week-day-add" onclick="openAddClocking('${dStr}')">+ Add</button>` : ''}
      `;
    } else {
      content = `<div style="color:var(--subtle);font-size:11px;margin-top:16px">—</div>`;
    }

    const entriesHtml = ''; // Project entries not shown in My Week

    return `
      <div class="week-day ${isToday ? 'today' : ''} ${clocking ? 'has-data' : ''}">
        <div class="week-day-name">${day}</div>
        <div class="week-day-date">${d.getDate()}/${d.getMonth()+1}</div>
        ${content}
      </div>
    `;
  }).join('');
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

  state.timesheetData.clockings.push({
    id: Date.now().toString(),
    employeeName: state.currentEmployee,
    date: _addClockingDate,
    clockIn,
    clockOut,
    breakMins,
    manuallyEdited: true,
    approvalStatus: 'pending'
  });

  try {
    await saveTimesheetData();
    closeAddClockingModal();
    toast('Submitted for manager approval ✓', 'success');
    renderMyWeek(state.currentEmployee);
  } catch { toast('Save failed', 'error'); }
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

  if (!state.timesheetData.amendments) state.timesheetData.amendments = [];

  // Remove any previous rejected amendment for this clocking (allow re-submit)
  state.timesheetData.amendments = state.timesheetData.amendments.filter(
    a => !(String(a.clockingId) === String(_amendmentClockingId) && a.status === 'rejected')
  );

  state.timesheetData.amendments.push({
    id: Date.now().toString(),
    clockingId: _amendmentClockingId,
    employeeName: clocking.employeeName,
    date: clocking.date,
    originalIn: clocking.clockIn,
    originalOut: clocking.clockOut,
    requestedIn: newIn || null,
    requestedOut: newOut || null,
    reason,
    status: 'pending',
    submittedAt: new Date().toISOString()
  });

  try {
    await saveTimesheetData();
    closeAmendmentModal();
    toast('Amendment request submitted', 'success');
    renderMyWeek(state.currentEmployee);
  } catch {
    toast('Save failed', 'error');
  }
}

async function approveAmendment(id) {
  const amendment = (state.timesheetData.amendments || []).find(a => String(a.id) === String(id));
  if (!amendment) return;

  const clocking = state.timesheetData.clockings.find(c => String(c.id) === String(amendment.clockingId));
  if (!clocking) return;

  // Apply the changes
  if (amendment.requestedIn) clocking.clockIn = amendment.requestedIn;
  if (amendment.requestedOut) clocking.clockOut = amendment.requestedOut;
  clocking.manuallyEdited = true;
  amendment.status = 'approved';
  amendment.resolvedAt = new Date().toISOString();

  try {
    await saveTimesheetData();
    toast('Amendment approved — clocking updated', 'success');
    renderManagerView();
  } catch { toast('Save failed', 'error'); }
}

async function rejectAmendment(id) {
  const amendment = (state.timesheetData.amendments || []).find(a => String(a.id) === String(id));
  if (!amendment) return;

  amendment.status = 'rejected';
  amendment.resolvedAt = new Date().toISOString();

  try {
    await saveTimesheetData();
    toast('Amendment rejected', 'info');
    renderManagerView();
  } catch { toast('Save failed', 'error'); }
}


async function setEntryStatus(id, status) {
  const entry = state.timesheetData.entries.find(e => e.id === id);
  if (!entry) return;
  entry.status = status;
  try {
    await saveTimesheetData();
    renderManagerView();
  } catch { toast('Save failed', 'error'); }
}

async function approveAll() {
  const { mon, sun } = getWeekDates(state.currentWeekOffset);
  const pending = state.timesheetData.entries.filter(
    e => e.status === 'pending' && e.date >= dateStr(mon) && e.date <= dateStr(sun)
  );
  if (!pending.length) { toast('No pending entries', 'info'); return; }
  pending.forEach(e => e.status = 'approved');
  try {
    await saveTimesheetData();
    toast(`${pending.length} entries approved`, 'success');
    renderManagerView();
  } catch { toast('Save failed', 'error'); }
}

async function writeToSharePoint() {
  const { mon, sun } = getWeekDates(state.currentWeekOffset);
  const approved = state.timesheetData.entries.filter(
    e => e.status === 'approved' &&
         e.date >= dateStr(mon) && e.date <= dateStr(sun) &&
         !e.synced &&
         e.projectId !== 'S000'  // Never write unproductive time to Project Tracker
  );

  if (!approved.length) {
    toast('No newly approved entries to sync', 'info'); return;
  }

  // Write S000 unproductive time to separate sheet
  const s000Entries = state.timesheetData.entries.filter(
    e => e.status === 'approved' &&
         e.date >= dateStr(mon) && e.date <= dateStr(sun) &&
         !e.synced &&
         e.projectId === 'S000'
  );
  if (s000Entries.length) {
    await writeUnproductiveTimeLog(s000Entries);
  }

  const ok = await writeApprovedToLabourLog(approved);
  if (ok) {
    approved.forEach(e => e.synced = true);
    s000Entries.forEach(e => e.synced = true);
    await saveTimesheetData();
    toast(`${approved.length} entries written to PROJECT TRACKER ✓`, 'success');
    renderManagerView();
  }
}

function changeWeek(dir) {
  state.currentWeekOffset += dir;
  renderManagerView();
}

function switchTab(name) {
  document.querySelectorAll('.tab').forEach((t, i) => {
    const names = ['project', 'employee', 'clockinout', 'staff', 'holidays', 'payroll', 'archive', 'reports', 'settings'];
    t.classList.toggle('active', names[i] === name);
  });
  document.querySelectorAll('.tab-content').forEach(tc => {
    tc.classList.toggle('active', tc.id === `tab-${name}`);
  });
  if (name === 'staff') renderStaffList();
  if (name === 'clockinout') { clockLogWeekOffset = 0; renderClockLogForWeek(); }
  if (name === 'holidays') setTimeout(() => renderHolidayTab(), 50);
  if (name === 'payroll') { renderPayroll(); checkArchiveReminder(); }
  if (name === 'archive') renderArchive();
  if (name === 'reports') setTimeout(() => renderReports(), 50);
  if (name === 'settings') { loadEmailSettings(); renderOfficeStaffList(); }
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
    showScreen('screenAuth');
  } else if (CURRENT_PAGE === 'projects') {
    window.location.href = 'index.html';
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
  if (emp && emp.pin) {
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

function checkHKPin() {
  const pin = document.getElementById('hkPinInput').value;
  const emp = (state.timesheetData.employees || []).find(e => e.name === _hkEmployee);
  if (emp && pin === emp.pin) {
    showHKStep3(_hkEmployee);
  } else {
    document.getElementById('hkPinError').textContent = 'Incorrect PIN — try again';
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
        <div class="hbal-item"><div class="hbal-value" style="color:var(--green)">${bal.remainingDays}</div><div class="hbal-label">Remaining</div></div>
        <div class="hbal-item"><div class="hbal-value">${bal.usedDays}</div><div class="hbal-label">Used</div></div>
        ${bal.pendingDays > 0 ? `<div class="hbal-item"><div class="hbal-value" style="color:var(--amber)">${bal.pendingDays}</div><div class="hbal-label">Pending</div></div>` : ''}
        <div class="hbal-item"><div class="hbal-value" style="color:var(--muted)">${bal.totalAllowance}</div><div class="hbal-label">Total</div></div>
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

  const request = {
    id: Date.now().toString(),
    employeeName: _hkEmployee,
    dateFrom: from,
    dateTo: to,
    type,
    reason,
    workingDays,
    status: 'pending',
    submittedAt: new Date().toISOString()
  };

  if (!state.timesheetData.holidays) state.timesheetData.holidays = [];
  state.timesheetData.holidays.push(request);

  try {
    await saveTimesheetData();
    await sendHolidayNotificationEmail(request);
    document.getElementById('hkFromDate').value = todayStr();
    document.getElementById('hkToDate').value = todayStr();
    document.getElementById('hkReason').value = '';
    toast(`Holiday request submitted (${workingDays} working days) ✓`, 'success');
    renderHKHolidayList(_hkEmployee);
    showHKStep3(_hkEmployee);
  } catch { toast('Submit failed', 'error'); }
}

// ── Holiday notification on clock-in ──
function checkHolidayClockInNotification(employeeName) {
  // Check for recently approved/rejected holidays (last 7 days)
  const recentlyActioned = (state.timesheetData.holidays || []).filter(h => {
    if (h.employeeName !== employeeName) return false;
    if (!h.approvedAt && !h.rejectedAt) return false;
    const actionDate = h.approvedAt || h.rejectedAt;
    const daysSince = (Date.now() - new Date(actionDate).getTime()) / (1000 * 60 * 60 * 24);
    return daysSince <= 7 && !h.notificationShown;
  });

  if (!recentlyActioned.length) return;

  // Show notification for each
  recentlyActioned.forEach(h => {
    const approved = h.status === 'approved';
    const msg = approved
      ? `&#10003; Holiday APPROVED: ${h.dateFrom}${h.dateFrom !== h.dateTo ? ' → ' + h.dateTo : ''} (${h.workingDays} days)`
      : `&#10005; Holiday DECLINED: ${h.dateFrom}${h.dateFrom !== h.dateTo ? ' → ' + h.dateTo : ''}`;
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
        <button class="btn btn-primary" style="width:100%" onclick="this.parentElement.parentElement.remove()">OK</button>
      </div>
    `;
    document.body.appendChild(overlay);

    // Mark as shown
    h.notificationShown = true;
  });

  // Save the notificationShown flags
  saveTimesheetData().catch(() => {});
}

let _editEntryId = null;

function openEditEntry(id) {
  const entry = state.timesheetData.entries.find(e => e.id === id);
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
  const entry = state.timesheetData.entries.find(e => e.id === _editEntryId);
  if (!entry) return;

  const newHours = parseFloat(document.getElementById('editEntryHours').value);
  const reason = document.getElementById('editEntryReason').value.trim();
  if (!newHours || newHours <= 0) { toast('Please enter valid hours', 'error'); return; }
  if (!reason) { toast('Please provide a reason for the change', 'error'); document.getElementById('editEntryReason').focus(); return; }

  entry.originalHours = entry.originalHours || entry.hours;
  entry.hours = newHours;
  entry.status = 'pending';
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
    const clockedHrs = calcHours(clocking.clockIn, clocking.clockOut, clocking.breakMins) || 0;
    const totalProjectHrs = state.timesheetData.entries
      .filter(e => e.employeeName === emp && e.date === today && e.projectId !== 'S000')
      .reduce((s, e) => s + e.hours, 0);
    const unproductiveHrs = parseFloat((clockedHrs - totalProjectHrs).toFixed(2));

    state.timesheetData.entries = state.timesheetData.entries.filter(
      e => !(e.employeeName === emp && e.date === today && e.projectId === 'S000')
    );
    if (unproductiveHrs > 0) {
      state.timesheetData.entries.push({
        id: `s000-${today}-${emp}`,
        employeeName: emp,
        projectId: 'S000',
        projectName: 'Unproductive Time',
        hours: unproductiveHrs,
        date: today,
        status: 'pending',
        autoGenerated: true,
        submittedAt: new Date().toISOString()
      });
    }
  }

  try {
    await saveTimesheetData();
    closeEditEntry();
    renderMyWeek(state.currentEmployee);
    toast('Hours updated — pending manager approval ✓', 'success');
  } catch { toast('Save failed', 'error'); }
}

function closeModal() {
  document.getElementById('confirmModal').classList.remove('active');
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
  const { emp, today, clockOut, breakMins, clocking } = _pendingClockOutData;

  // Log full shift as WGD
  const clockedHrs = calcHours(clocking.clockIn, clockOut, breakMins) || 0;
  if (clockedHrs > 0) {
    state.timesheetData.entries.push({
      id: `wgd-${today}-${emp.replace(/\s/g,'')}`,
      employeeName: emp,
      projectId: 'WGD',
      projectName: 'Workshop General Duties',
      hours: clockedHrs,
      date: today,
      status: 'pending',
      autoGenerated: true,
      submittedAt: new Date().toISOString()
    });
  }

  closeNoProjectModal();
  // Proceed with clock-out
  await finishClockOut(_pendingClockOutData);
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
// DELETE / RE-UPLOAD DRAWING
// ═══════════════════════════════════════════
function confirmDeleteDrawing(projectId, drawingId) {
  const drawing = drawingsData?.projects?.[projectId]?.drawings?.find(d => d.id === drawingId);
  if (!drawing) { toast('Drawing not found', 'error'); return; }

  showConfirm(
    `Delete "${drawing.name}"?`,
    `This permanently removes the drawing. Notes are preserved and will reappear if you re-upload a drawing with the same name.`,
    async () => { await deleteDrawing(projectId, drawingId); }
  );
}

async function deleteDrawing(projectId, drawingId) {
  const projData = drawingsData.projects[projectId];
  if (!projData) return;

  const drawing = projData.drawings.find(d => d.id === drawingId);
  if (!drawing) return;

  // Remove the drawing but keep notes archived
  projData.drawings = projData.drawings.filter(d => d.id !== drawingId);

  // Store deleted drawing notes in an archive so re-upload can restore them
  if (!projData.deletedNotes) projData.deletedNotes = {};
  if (drawing.notes?.length) {
    projData.deletedNotes[drawing.name] = drawing.notes;
  }

  try {
    setLoading(true);
    await saveDrawingsData();
    toast('Drawing removed ✓', 'success');
    renderDrawings(projectId);
    renderProjectTiles();
  } catch (e) {
    toast('Delete failed: ' + e.message, 'error');
  } finally { setLoading(false); }
}

function openReUploadDrawing(projectId, drawingId) {
  // Open upload modal but pre-fill with existing drawing info
  const drawing = drawingsData.projects[projectId]?.drawings?.find(d => d.id === drawingId);
  if (!drawing || !currentProject) return;

  document.getElementById('uploadProjectName').textContent = `${currentProject.id} — ${currentProject.name}`;
  document.getElementById('drawingNameInput').value = drawing.name;
  document.getElementById('drawingFolderPath').value = '';
  document.getElementById('uploadZoneText').textContent = 'Click to select replacement PDF file';
  document.getElementById('uploadProgress').style.display = 'none';
  document.getElementById('uploadDraftsmanNote').value = '';
  document.getElementById('uploadFinishing').value = 'none';
  document.getElementById('uploadTransport').value = 'collect';
  draftsmanUploadFile = null;

  // Store the drawing ID being replaced
  document.getElementById('uploadDrawingModal').dataset.replacingId = drawingId;
  document.getElementById('uploadDrawingModal').classList.add('active');
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
    await saveTimesheetData();
    renderOfficeStaffList();
    toast(`${name} added to office staff ✓`, 'success');
  } catch { toast('Save failed', 'error'); }
}

async function removeOfficeStaff(index) {
  if (!state.timesheetData.settings || !state.timesheetData.settings.officeStaff) return;
  const name = state.timesheetData.settings.officeStaff[index];
  state.timesheetData.settings.officeStaff.splice(index, 1);
  try {
    await saveTimesheetData();
    renderOfficeStaffList();
    toast(`${name} removed ✓`, 'success');
  } catch { toast('Save failed', 'error'); }
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

  let approvedCount = 0;
  (state.timesheetData.clockings || []).forEach(c => {
    if (c.date >= monStr && c.date <= sunStr) {
      if (c.approvalStatus === 'pending' || (!c.approvalStatus && !c.addedByManager)) {
        c.approvalStatus = 'approved';
        c.approvedBy = approver;
        c.approvedAt = new Date().toISOString();
        approvedCount++;
      }
    }
  });

  try {
    await saveTimesheetData();
    closeApproveWeekModal();
    renderClockLogForWeek();
    toast(`Week approved by ${approver} — ${approvedCount} clocking${approvedCount !== 1 ? 's' : ''} approved ✓`, 'success');
  } catch { toast('Save failed', 'error'); }
}

function loadEmailSettings() {
  const settings = state.timesheetData.settings || {};
  const payEl = document.getElementById('settingPayrollEmail');
  const ordEl = document.getElementById('settingOrderEmail');
  const draftEl = document.getElementById('settingDraftsmanEmail');
  if (payEl) payEl.value = settings.payrollEmail || '';
  if (ordEl) ordEl.value = settings.orderEmail || 'daniel@bamafabrication.co.uk';
  if (draftEl) draftEl.value = settings.draftsmanEmail || '';
}

async function saveEmailSettings() {
  if (!state.timesheetData.settings) state.timesheetData.settings = {};
  const payEl = document.getElementById('settingPayrollEmail');
  const ordEl = document.getElementById('settingOrderEmail');
  if (payEl) state.timesheetData.settings.payrollEmail = payEl.value;
  if (ordEl) state.timesheetData.settings.orderEmail = ordEl.value;
  const draftEl2 = document.getElementById('settingDraftsmanEmail');
  if (draftEl2) state.timesheetData.settings.draftsmanEmail = draftEl2.value;
  try {
    await saveTimesheetData();
    toast('Email settings saved ✓', 'success');
  } catch { toast('Save failed', 'error'); }
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
  const ampm = now.getHours() < 12 ? 'AM' : 'PM';
  el.textContent =
    `${h}:${m} ${ampm} — ${now.toLocaleDateString('en-GB', { weekday:'short', day:'numeric', month:'short' })}`;
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

  // Pro-rata calculation if employee started after holiday year start
  let allocation = emp.annualDays || DEFAULT_ANNUAL_DAYS;
  if (emp.startDate && emp.startDate > yearStart) {
    const totalDays = countWorkingDays(yearStart, yearEndStr);
    const remainingDays = countWorkingDays(emp.startDate, yearEndStr);
    allocation = Math.round((remainingDays / totalDays) * allocation * 2) / 2;
  }

  const carryover = emp.carryoverDays || 0;
  const totalAllowance = allocation + carryover;

  // Count approved holidays in this year
  const approved = (state.timesheetData.holidays || []).filter(h =>
    h.employeeName === employeeName &&
    h.status === 'approved' &&
    h.type === 'paid' &&
    h.dateFrom >= yearStart && h.dateFrom <= yearEndStr
  );
  const usedDays = approved.reduce((s, h) => s + (h.workingDays || countWorkingDays(h.dateFrom, h.dateTo)), 0);

  // Count pending
  const pending = (state.timesheetData.holidays || []).filter(h =>
    h.employeeName === employeeName &&
    h.status === 'pending' &&
    h.type === 'paid' &&
    h.dateFrom >= yearStart
  );
  const pendingDays = pending.reduce((s, h) => s + (h.workingDays || countWorkingDays(h.dateFrom, h.dateTo)), 0);

  return {
    allocation,
    carryover,
    totalAllowance,
    usedDays,
    pendingDays,
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
        <div class="hbal-label">Days Remaining</div>
      </div>
      <div class="hbal-item">
        <div class="hbal-value">${bal.usedDays}</div>
        <div class="hbal-label">Days Used</div>
      </div>
      ${bal.pendingDays > 0 ? `
      <div class="hbal-item">
        <div class="hbal-value" style="color:var(--amber)">${bal.pendingDays}</div>
        <div class="hbal-label">Days Pending</div>
      </div>` : ''}
      <div class="hbal-item">
        <div class="hbal-value" style="color:var(--muted)">${bal.totalAllowance}</div>
        <div class="hbal-label">Total Allowance</div>
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
        <span class="hdate">${h.dateFrom} → ${h.dateTo}</span>
        <span class="htype ${h.type}">${h.type === 'paid' ? 'Paid' : h.type === 'unpaid' ? 'Unpaid' : h.type}</span>
        <span style="flex:1;color:var(--muted);font-size:12px">${h.reason || ''}</span>
        <span style="font-family:var(--font-mono);font-size:12px">${h.workingDays || 0}d</span>
        <span class="tag tag-${h.status === 'approved' ? 'approved' : h.status === 'rejected' ? 'rejected' : 'pending'}" style="margin-left:8px">${h.status}</span>
      </div>
    `).join('')}
  `;
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

  const request = {
    id: Date.now().toString(),
    employeeName: state.currentEmployee,
    dateFrom: from,
    dateTo: to,
    type,
    reason,
    workingDays,
    status: 'pending',
    submittedAt: new Date().toISOString()
  };

  if (!state.timesheetData.holidays) state.timesheetData.holidays = [];
  state.timesheetData.holidays.push(request);

  try {
    await saveTimesheetData();
    // Send email notification
    await sendHolidayNotificationEmail(request);
    document.getElementById('holFromDate').value = '';
    document.getElementById('holToDate').value = '';
    document.getElementById('holReason').value = '';
    toast(`Holiday request submitted (${workingDays} working days) ✓`, 'success');
    renderEmpHolidayBalance(state.currentEmployee);
  } catch { toast('Submit failed', 'error'); }
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
        bg = 'rgba(245,158,11,.25)';
        title = 'Bank Holiday';
      } else if (isWE) {
        bg = 'rgba(100,100,100,.15)';
      } else if (hol) {
        if (hol.status === 'approved') {
          bg = hol.type === 'paid' ? 'rgba(62,207,142,.5)' : 'rgba(255,68,68,.35)';
          title = `${hol.type} holiday (approved)`;
        } else if (hol.status === 'pending') {
          bg = 'rgba(255,107,0,.4)';
          title = 'Pending approval';
          border = '1px solid var(--accent)';
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
    ${list.map(h => `
      <div class="holiday-chip" style="flex-wrap:wrap;gap:8px">
        <span style="font-weight:600;min-width:120px">${h.employeeName}</span>
        <span class="hdate">${h.dateFrom} → ${h.dateTo}</span>
        <span class="htype ${h.type}">${h.type === 'paid' ? 'Paid' : h.type === 'unpaid' ? 'Unpaid' : h.type}</span>
        <span style="font-family:var(--font-mono);font-size:12px;color:var(--accent2)">${h.workingDays}d</span>
        <span style="color:var(--muted);font-size:12px;flex:1">${h.reason || ''}</span>
        <span class="tag tag-${h.status === 'approved' ? 'approved' : h.status === 'rejected' ? 'rejected' : 'pending'}">${h.status}</span>
        ${h.status === 'pending' ? `
          <div class="approve-row">
            <button class="tiny-btn tiny-approve" onclick="approveHoliday('${h.id}')">&#10003; Approve</button>
            <button class="tiny-btn tiny-reject" onclick="rejectHoliday('${h.id}')">&#10005; Reject</button>
          </div>
        ` : ''}
      </div>
    `).join('')}
  ` : '';

  container.innerHTML = renderGroup(pending, 'Pending Approval') + renderGroup(others, 'Previous Requests');
}

async function approveHoliday(id) {
  const h = (state.timesheetData.holidays || []).find(h => h.id === id);
  if (!h) return;
  h.status = 'approved';
  h.approvedAt = new Date().toISOString();
  try {
    await saveTimesheetData();
    toast(`Holiday approved for ${h.employeeName} ✓`, 'success');
    renderHolidayTab();
    renderHolidayNotificationBanner();
  } catch { toast('Save failed', 'error'); }
}

async function rejectHoliday(id) {
  const h = (state.timesheetData.holidays || []).find(h => h.id === id);
  if (!h) return;
  h.status = 'rejected';
  h.rejectedAt = new Date().toISOString();
  try {
    await saveTimesheetData();
    toast(`Holiday rejected`, 'success');
    renderHolidayTab();
  } catch { toast('Save failed', 'error'); }
}

// Show notification banner on manager dashboard load
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

function calculatePayroll(employeeName, weekMon, weekSun) {
  const monStr = dateStr(weekMon);
  const sunStr = dateStr(weekSun);

  // Get all approved clockings for this employee this week
  const clockings = state.timesheetData.clockings.filter(c =>
    c.employeeName === employeeName &&
    c.date >= monStr && c.date <= sunStr &&
    c.approvalStatus !== 'rejected'
  );

  if (!clockings.length) return null;

  // Calculate hours per day
  const dayHours = {};
  let workedSaturday = false;
  let workedSunday = false;
  let sundayHours = 0;

  clockings.forEach(c => {
    const hrs = calcHours(c.clockIn, c.clockOut, c.breakMins) || 0;
    dayHours[c.date] = (dayHours[c.date] || 0) + hrs;

    const d = new Date(c.date + 'T12:00:00');
    const dow = d.getDay(); // 0=Sun, 6=Sat
    if (dow === 6 && hrs > 0) workedSaturday = true;
    if (dow === 0 && hrs > 0) { workedSunday = true; sundayHours += hrs; }
  });

  const totalHours = Object.values(dayHours).reduce((s, h) => s + h, 0);
  const doubleTimeApplies = workedSaturday && workedSunday;

  // Get employee rate
  const emp = (state.timesheetData.employees || []).find(e => e.name === employeeName);
  const rate = emp ? (emp.rate || 0) : 0;

  // Calculate pay breakdown
  let basicHours, overtimeHours, doubleHours;
  let basicPay, overtimePay, doublePay;

  if (doubleTimeApplies) {
    // Sunday hours are always double time
    const nonSundayHours = totalHours - sundayHours;
    doubleHours = sundayHours;

    if (nonSundayHours >= 40) {
      basicHours = 40;
      overtimeHours = nonSundayHours - 40;
    } else {
      basicHours = nonSundayHours;
      overtimeHours = 0;
    }
  } else {
    doubleHours = 0;
    if (totalHours <= 40) {
      basicHours = totalHours;
      overtimeHours = 0;
    } else {
      basicHours = 40;
      overtimeHours = totalHours - 40;
    }
  }

  basicPay = basicHours * rate;
  overtimePay = overtimeHours * rate * 1.5;
  doublePay = doubleHours * rate * 2;
  const totalPay = basicPay + overtimePay + doublePay;

  return {
    employeeName,
    rate,
    totalHours,
    basicHours: parseFloat(basicHours.toFixed(2)),
    overtimeHours: parseFloat(overtimeHours.toFixed(2)),
    doubleHours: parseFloat(doubleHours.toFixed(2)),
    basicPay: parseFloat(basicPay.toFixed(2)),
    overtimePay: parseFloat(overtimePay.toFixed(2)),
    doublePay: parseFloat(doublePay.toFixed(2)),
    totalPay: parseFloat(totalPay.toFixed(2)),
    doubleTimeApplies,
    dayHours
  };
}

// ═══════════════════════════════════════════
// REPORTS ENGINE
// ═══════════════════════════════════════════
let rptPeriod = 'week';
let rptCharts = {};

function setReportPeriod(period) {
  rptPeriod = period;
  ['week','month','year'].forEach(p => {
    const btn = document.getElementById(`rpt-btn-${p}`);
    if (btn) {
      btn.style.background = p === period ? 'var(--accent)' : 'var(--surface)';
      btn.style.color = p === period ? '#fff' : 'var(--muted)';
    }
  });
  renderReports();
}

function getReportDateRange() {
  const now = new Date();
  let from, to;

  if (rptPeriod === 'week') {
    const dow = now.getDay();
    const mon = new Date(now);
    mon.setDate(now.getDate() - (dow === 0 ? 6 : dow - 1));
    mon.setHours(0,0,0,0);
    from = dateStr(mon);
    const sun = new Date(mon); sun.setDate(mon.getDate() + 6);
    to = dateStr(sun);
  } else if (rptPeriod === 'month') {
    from = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    const last = new Date(now.getFullYear(), now.getMonth()+1, 0);
    to = dateStr(last);
  } else {
    from = `${now.getFullYear()}-01-01`;
    to = `${now.getFullYear()}-12-31`;
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
    const hrs = calcHours(c.clockIn, c.clockOut, c.breakMins) || 0;
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

  const totalClocked = clockings.reduce((s,c) => s + (calcHours(c.clockIn, c.clockOut, c.breakMins)||0), 0);
  const totalProject = entries.filter(e => e.projectId !== 'S000' && e.projectId !== 'WGD').reduce((s,e) => s + e.hours, 0);
  const totalWGD = entries.filter(e => e.projectId === 'WGD').reduce((s,e) => s + e.hours, 0);
  const totalUnproductive = entries.filter(e => e.projectId === 'S000').reduce((s,e) => s + e.hours, 0);
  const utilisation = totalClocked > 0 ? Math.round(((totalProject + totalWGD) / totalClocked) * 100) : 0;

  // By employee
  const empMap = {};
  clockings.forEach(c => {
    if (!empMap[c.employeeName]) empMap[c.employeeName] = { clocked: 0, project: 0, wgd: 0, unproductive: 0 };
    empMap[c.employeeName].clocked = Math.round((empMap[c.employeeName].clocked + (calcHours(c.clockIn, c.clockOut, c.breakMins)||0)) * 10) / 10;
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

  // Update range label
  const label = document.getElementById('rptRangeLabel');
  if (label) label.textContent = `${from} → ${to}`;

  // KPI cards
  const kpiRow = document.getElementById('rptKpiRow');
  if (kpiRow) {
    kpiRow.innerHTML = [
      { label: 'Total Hours', value: totalClocked.toFixed(1) + 'h', color: 'var(--accent2)' },
      { label: 'Project Hours', value: totalProject.toFixed(1) + 'h', color: 'var(--green)' },
      { label: 'Workshop General', value: totalWGD.toFixed(1) + 'h', color: '#6366f1' },
      { label: 'Unproductive', value: totalUnproductive.toFixed(1) + 'h', color: 'var(--red)' },
      { label: 'Utilisation', value: utilisation + '%', color: utilisation >= 80 ? 'var(--green)' : utilisation >= 60 ? 'var(--amber)' : 'var(--red)' },
    ].map(k => `
      <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:16px 18px">
        <div style="font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:1px;margin-bottom:6px">${k.label}</div>
        <div style="font-family:var(--font-display);font-size:30px;color:${k.color}">${k.value}</div>
        <div style="font-size:10px;color:var(--subtle);margin-top:4px">${periodLabels[rptPeriod]}</div>
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
}

// ── Clock Log Week Navigation ──
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
  return clockings.reduce((s, c) => s + (calcHours(c.clockIn, c.clockOut, c.breakMins) || 0), 0);
}

function renderPayroll() {
  const { mon, sun } = getWeekDates(payrollWeekOffset);
  document.getElementById('payrollWeekLabel').textContent =
    `${fmtDate(mon)} – ${fmtDate(sun)}`;

  const container = document.getElementById('payrollSummary');
  const employees = (state.timesheetData.employees || []).filter(e => e.active !== false);

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
    const dayHrs = days.map(d => {
      const hrs = getDayHoursForEmployee(e.name, d.date);
      return hrs > 0 ? hrs : 0;
    });
    const totalHrs = dayHrs.reduce((s, h) => s + h, 0);
    return { emp: e, payroll, dayHrs, totalHrs };
  }).filter(r => r.totalHrs > 0 || r.payroll);

  if (!results.length) {
    container.innerHTML = '<div class="empty-state"><div class="icon">&#163;</div>No approved clockings this week</div>';
    return;
  }

  const grandTotal = results.reduce((s, r) => s + (r.payroll?.totalPay || 0), 0);
  const totalBasic = results.reduce((s, r) => s + (r.payroll?.basicPay || 0), 0);
  const totalOT = results.reduce((s, r) => s + (r.payroll?.overtimePay || 0), 0);
  const totalDT = results.reduce((s, r) => s + (r.payroll?.doublePay || 0), 0);

  container.innerHTML = `
    <div style="overflow-x:auto">
      <table class="summary-table" style="min-width:900px">
        <thead>
          <tr>
            <th style="min-width:140px">EMPLOYEE</th>
            ${days.map(d => `<th style="text-align:center;min-width:55px">${d.label}<br><span style="font-weight:400;font-size:9px;color:var(--subtle)">${d.date.slice(8)}</span></th>`).join('')}
            <th style="text-align:center">TOTAL HRS</th>
            <th>STD (£)</th>
            <th>O/T ×1.5 (£)</th>
            <th>DBL ×2 (£)</th>
            <th style="color:var(--green)">TOTAL PAY</th>
          </tr>
        </thead>
        <tbody>
          ${results.map(r => `
            <tr>
              <td style="font-weight:600">
                ${r.emp.name}
                ${r.payroll?.doubleTimeApplies ? '<span class="manually-edited-badge" style="background:rgba(62,207,142,.15);color:var(--green);border-color:rgba(62,207,142,.3)">SAT+SUN</span>' : ''}
                <br><span style="font-size:11px;color:var(--muted);font-family:var(--font-mono)">£${(r.emp.rate||0).toFixed(2)}/hr</span>
              </td>
              ${r.dayHrs.map(h => `<td class="mono" style="text-align:center;color:${h > 0 ? 'var(--text)' : 'var(--subtle)'}">${h > 0 ? h.toFixed(1) : '—'}</td>`).join('')}
              <td class="mono" style="text-align:center;font-weight:700">${r.totalHrs.toFixed(1)}</td>
              <td class="mono">${r.payroll?.basicHours||0}h<br><span style="font-size:11px;color:var(--muted)">£${(r.payroll?.basicPay||0).toFixed(2)}</span></td>
              <td class="mono" style="color:var(--amber)">${r.payroll?.overtimeHours > 0 ? r.payroll.overtimeHours+'h' : '—'}<br><span style="font-size:11px;color:var(--muted)">${r.payroll?.overtimeHours > 0 ? '£'+r.payroll.overtimePay.toFixed(2) : ''}</span></td>
              <td class="mono" style="color:var(--accent)">${r.payroll?.doubleHours > 0 ? r.payroll.doubleHours+'h' : '—'}<br><span style="font-size:11px;color:var(--muted)">${r.payroll?.doubleHours > 0 ? '£'+r.payroll.doublePay.toFixed(2) : ''}</span></td>
              <td class="mono" style="color:var(--green);font-weight:700;font-size:15px">£${(r.payroll?.totalPay||0).toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot>
          <tr style="border-top:2px solid var(--border)">
            <td style="font-weight:700;color:var(--muted);font-size:11px;letter-spacing:1px;text-transform:uppercase">TOTALS</td>
            ${days.map((d, i) => {
              const dayTotal = results.reduce((s, r) => s + (r.dayHrs[i] || 0), 0);
              return `<td class="mono" style="text-align:center;font-weight:600">${dayTotal > 0 ? dayTotal.toFixed(1) : '—'}</td>`;
            }).join('')}
            <td class="mono" style="text-align:center;font-weight:700">${results.reduce((s,r)=>s+r.totalHrs,0).toFixed(1)}</td>
            <td class="mono" style="font-weight:600">£${totalBasic.toFixed(2)}</td>
            <td class="mono" style="font-weight:600;color:var(--amber)">£${totalOT.toFixed(2)}</td>
            <td class="mono" style="font-weight:600;color:var(--accent)">£${totalDT.toFixed(2)}</td>
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
}

async function emailPayrollReport() {
  const { mon, sun } = getWeekDates(payrollWeekOffset);
  const employees = (state.timesheetData.employees || []).filter(e => e.active !== false);
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(mon); d.setDate(mon.getDate() + i);
    days.push({ label: ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'][i], date: dateStr(d) });
  }

  const results = employees.map(e => {
    const payroll = calculatePayroll(e.name, mon, sun);
    const dayHrs = days.map(d => getDayHoursForEmployee(e.name, d.date));
    const totalHrs = dayHrs.reduce((s, h) => s + h, 0);
    return { emp: e, payroll, dayHrs, totalHrs };
  }).filter(r => r.totalHrs > 0);

  if (!results.length) { toast('No payroll data to email', 'error'); return; }

  const grandTotal = results.reduce((s, r) => s + (r.payroll?.totalPay || 0), 0);
  const weekStr = `${fmtDate(mon)} – ${fmtDate(sun)}`;
  const payrollEmail = state.timesheetData.settings?.payrollEmail || 'daniel@bamafabrication.co.uk';

  const tableRows = results.map(r => `
    <tr style="border-bottom:1px solid #eee">
      <td style="padding:8px 10px;font-weight:600">${r.emp.name}</td>
      <td style="padding:8px 10px;font-family:monospace;color:#888">£${(r.emp.rate||0).toFixed(2)}/hr</td>
      ${r.dayHrs.map(h => `<td style="padding:8px 10px;text-align:center;font-family:monospace">${h > 0 ? h.toFixed(1) : '—'}</td>`).join('')}
      <td style="padding:8px 10px;text-align:center;font-weight:700;font-family:monospace">${r.totalHrs.toFixed(1)}</td>
      <td style="padding:8px 10px;font-family:monospace">${r.payroll?.basicHours||0}h / £${(r.payroll?.basicPay||0).toFixed(2)}</td>
      <td style="padding:8px 10px;font-family:monospace;color:#f59e0b">${r.payroll?.overtimeHours > 0 ? r.payroll.overtimeHours+'h / £'+r.payroll.overtimePay.toFixed(2) : '—'}</td>
      <td style="padding:8px 10px;font-family:monospace;color:#ef4444">${r.payroll?.doubleHours > 0 ? r.payroll.doubleHours+'h / £'+r.payroll.doublePay.toFixed(2) : '—'}</td>
      <td style="padding:8px 10px;font-weight:700;color:#ff6b00;font-family:monospace">£${(r.payroll?.totalPay||0).toFixed(2)}</td>
    </tr>
  `).join('');

  const emailBody = {
    message: {
      subject: `BAMA Payroll Report — Week ${weekStr}`,
      body: {
        contentType: 'HTML',
        content: `
          <h2 style="color:#ff6b00;font-family:sans-serif">BAMA FABRICATION — Payroll Report</h2>
          <p style="font-family:sans-serif;font-size:13px;color:#888">Week: <b>${weekStr}</b></p>
          <table style="width:100%;border-collapse:collapse;font-family:sans-serif;font-size:12px">
            <thead>
              <tr style="background:#f5f5f5">
                <th style="padding:8px;text-align:left">Employee</th>
                <th style="padding:8px">Rate</th>
                ${days.map(d => `<th style="padding:8px;text-align:center">${d.label}</th>`).join('')}
                <th style="padding:8px;text-align:center">Total</th>
                <th style="padding:8px">Basic</th>
                <th style="padding:8px;color:#f59e0b">OT ×1.5</th>
                <th style="padding:8px;color:#ef4444">DBL ×2</th>
                <th style="padding:8px;color:#ff6b00">Total Pay</th>
              </tr>
            </thead>
            <tbody>${tableRows}</tbody>
            <tfoot>
              <tr style="background:#fff3e0;font-weight:700">
                <td colspan="9" style="padding:8px;text-align:right;font-family:sans-serif">Total Payroll:</td>
                <td style="padding:8px;color:#ff6b00;font-size:16px;font-family:monospace">£${grandTotal.toFixed(2)}</td>
              </tr>
            </tfoot>
          </table>
          <p style="margin-top:20px;font-family:sans-serif;font-size:11px;color:#aaa">
            Generated by BAMA Workshop Timesheet — ${new Date().toLocaleString('en-GB')}
          </p>
        `
      },
      toRecipients: [{ emailAddress: { address: payrollEmail } }]
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
      toast(`Payroll report emailed to ${payrollEmail} ✓`, 'success');
    } else {
      const err = await res.text();
      console.error('Payroll email error:', err);
      toast('Email failed — check console', 'error');
    }
  } catch (e) {
    console.error('Email error:', e);
    toast('Failed to send email', 'error');
  }
}

function generatePayrollPDF() {
  const { mon, sun } = getWeekDates(payrollWeekOffset);
  const employees = (state.timesheetData.employees || []).filter(e => e.active !== false);
  const results = employees.map(e => calculatePayroll(e.name, mon, sun)).filter(Boolean);

  if (!results.length) { toast('No payroll data to export', 'error'); return; }

  const totalBasic = results.reduce((s, r) => s + r.basicPay, 0);
  const totalOT = results.reduce((s, r) => s + r.overtimePay, 0);
  const totalDT = results.reduce((s, r) => s + r.doublePay, 0);
  const grandTotal = results.reduce((s, r) => s + r.totalPay, 0);
  const weekStr = `${fmtDate(mon)} – ${fmtDate(sun)}`;

  const printWin = window.open('', '_blank');
  printWin.document.write(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>BAMA Payroll – ${weekStr}</title>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;600;700&family=DM+Mono&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'DM Sans', sans-serif; padding: 32px; color: #111; background: #fff; }
        h1 { font-size: 28px; font-weight: 700; letter-spacing: 2px; color: #ff6b00; margin-bottom: 4px; }
        .subtitle { font-size: 13px; color: #888; margin-bottom: 8px; }
        .week { font-size: 15px; font-weight: 600; margin-bottom: 28px; color: #333; }
        table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
        th { font-size: 10px; letter-spacing: 1.5px; text-transform: uppercase; color: #888;
          padding: 8px 12px; text-align: left; border-bottom: 2px solid #eee; }
        td { padding: 12px 12px; border-bottom: 1px solid #f0f0f0; font-size: 13px; }
        .mono { font-family: 'DM Mono', monospace; }
        .name { font-weight: 600; }
        .total-pay { font-weight: 700; font-size: 15px; color: #ff6b00; }
        .ot { color: #f59e0b; }
        .dt { color: #ef4444; }
        tfoot td { font-weight: 700; border-top: 2px solid #ddd; border-bottom: none; background: #fafafa; }
        .grand { font-size: 17px; color: #ff6b00; }
        .badge { display:inline-block; padding:1px 6px; border-radius:3px; font-size:10px;
          background:#d1fae5; color:#065f46; margin-left:6px; font-family:sans-serif; }
        .footer { margin-top: 32px; font-size: 11px; color: #aaa; border-top: 1px solid #eee; padding-top: 12px; }
        @media print {
          body { padding: 16px; }
          button { display: none; }
        }
      </style>
    </head>
    <body>
      <h1>BAMA FABRICATION</h1>
      <div class="subtitle">Payroll Summary Report</div>
      <div class="week">Week: ${weekStr}</div>

      <table>
        <thead>
          <tr>
            <th>Employee</th>
            <th>Rate</th>
            <th>Total Hrs</th>
            <th>Basic (≤40h)</th>
            <th>O/T ×1.5</th>
            <th>Dbl Time ×2</th>
            <th>Total Pay</th>
          </tr>
        </thead>
        <tbody>
          ${results.map(r => `
            <tr>
              <td class="name">${r.employeeName}${r.doubleTimeApplies ? '<span class="badge">SAT+SUN</span>' : ''}</td>
              <td class="mono">£${r.rate.toFixed(2)}/hr</td>
              <td class="mono"><b>${r.totalHours.toFixed(2)}h</b></td>
              <td class="mono">${r.basicHours}h &nbsp; £${r.basicPay.toFixed(2)}</td>
              <td class="mono ot">${r.overtimeHours > 0 ? r.overtimeHours+'h &nbsp; £'+r.overtimePay.toFixed(2) : '—'}</td>
              <td class="mono dt">${r.doubleHours > 0 ? r.doubleHours+'h &nbsp; £'+r.doublePay.toFixed(2) : '—'}</td>
              <td class="mono total-pay">£${r.totalPay.toFixed(2)}</td>
            </tr>
          `).join('')}
        </tbody>
        <tfoot>
          <tr>
            <td colspan="3">TOTALS</td>
            <td class="mono">£${totalBasic.toFixed(2)}</td>
            <td class="mono ot">£${totalOT.toFixed(2)}</td>
            <td class="mono dt">£${totalDT.toFixed(2)}</td>
            <td class="mono grand">£${grandTotal.toFixed(2)}</td>
          </tr>
        </tfoot>
      </table>

      <div class="footer">
        Generated by BAMA Workshop Timesheet &nbsp;|&nbsp; ${new Date().toLocaleString('en-GB')} &nbsp;|&nbsp;
        Pay rules: Standard rate for first 40hrs. Overtime ×1.5 for hours over 40. Sunday ×2 only if Saturday also worked.
      </div>

      <script>window.onload = function() { window.print(); }<\/script>
    </body>
    </html>
  `);
  printWin.document.close();
}

// ═══════════════════════════════════════════
// WEEKLY ARCHIVE
// ═══════════════════════════════════════════
async function archiveWeek() {
  const { mon, sun } = getWeekDates(payrollWeekOffset);
  const monStr = dateStr(mon);
  const sunStr = dateStr(sun);
  const weekKey = `week_${monStr}`;

  // Check if already archived
  if (!state.timesheetData.archive) state.timesheetData.archive = {};
  if (state.timesheetData.archive[weekKey]) {
    if (!confirm(`Week of ${fmtDate(mon)} is already archived. Overwrite?`)) return;
  }

  // Snapshot all data for this week
  const weekEntries = state.timesheetData.entries.filter(e => e.date >= monStr && e.date <= sunStr);
  const weekClockings = state.timesheetData.clockings.filter(c => c.date >= monStr && c.date <= sunStr);
  const employees = (state.timesheetData.employees || []).filter(e => e.active !== false);
  const payrollResults = employees.map(e => calculatePayroll(e.name, mon, sun)).filter(Boolean);

  state.timesheetData.archive[weekKey] = {
    weekCommencing: monStr,
    weekEnding: sunStr,
    archivedAt: new Date().toISOString(),
    entries: weekEntries,
    clockings: weekClockings,
    payroll: payrollResults
  };

  try {
    await saveTimesheetData();
    toast(`Week of ${fmtDate(mon)} archived ✓`, 'success');
    renderArchive();
  } catch { toast('Archive save failed', 'error'); }
}

function renderArchive() {
  const area = document.getElementById('archiveArea');
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
              <tr><th>EMPLOYEE</th><th>TOTAL HRS</th><th>BASIC</th><th>O/T ×1.5</th><th>DBL ×2</th><th>TOTAL PAY</th></tr>
            </thead>
            <tbody>
              ${(w.payroll||[]).map(r => `
                <tr>
                  <td style="font-weight:600">${r.employeeName}</td>
                  <td class="mono">${r.totalHours.toFixed(2)}h</td>
                  <td class="mono">${r.basicHours}h &nbsp; £${r.basicPay.toFixed(2)}</td>
                  <td class="mono" style="color:var(--amber)">${r.overtimeHours > 0 ? r.overtimeHours+'h &nbsp; £'+r.overtimePay.toFixed(2) : '—'}</td>
                  <td class="mono" style="color:var(--accent)">${r.doubleHours > 0 ? r.doubleHours+'h &nbsp; £'+r.doublePay.toFixed(2) : '—'}</td>
                  <td class="mono" style="color:var(--green);font-weight:700">£${r.totalPay.toFixed(2)}</td>
                </tr>
              `).join('')}
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
        const erpRoleLabels = { workshop:'Workshop', office_admin:'Office Admin', project_manager:'Project Manager', finance:'Finance', director:'Director' };
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
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-bottom:6px">
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
              </div>
              <input type="number" class="field-input" id="edit-rate-${emp.id}" value="${emp.rate||''}"
                placeholder="Hourly rate (£)" min="0" step="0.50" style="padding:6px 10px;font-size:12px;margin-bottom:6px">
              <input type="password" class="field-input" id="edit-pin-${emp.id}" value="${emp.pin||''}"
                placeholder="PIN" maxlength="6" style="padding:6px 10px;font-size:12px;margin-bottom:6px">
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
              <div style="font-size:12px;color:var(--muted);margin-top:2px">${emp.role || 'No title set'} · <span style="color:var(--accent2)">${erpRoleLabels[erpRole] || erpRole}</span></div>
              <div style="font-size:12px;color:var(--accent2);margin-top:2px;font-family:var(--font-mono)">£${(emp.rate||0).toFixed(2)}/hr</div>
              <div style="font-size:11px;color:var(--subtle);margin-top:2px">${emp.pin ? '&#128274; PIN set' : '&#128275; No PIN'}</div>
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

  if (!state.timesheetData.employees) state.timesheetData.employees = [];

  const rateInput = document.getElementById('newEmpRate');
  const rate = parseFloat(rateInput.value) || 0;

  const pinInput2 = document.getElementById('newEmpPin');
  const pin = pinInput2.value.trim();

  const daysInput = document.getElementById('newEmpDays');
  const carryoverInput = document.getElementById('newEmpCarryover');
  const startDateInput = document.getElementById('newEmpStartDate');
  const annualDays = parseInt(daysInput.value) || 20;
  const carryoverDays = parseFloat(carryoverInput.value) || 0;
  const startDate = startDateInput.value || '';

  const staffTypeInput = document.getElementById('newEmpStaffType');
  const erpRoleInput = document.getElementById('newEmpErpRole');
  const staffType = staffTypeInput ? staffTypeInput.value : 'workshop';
  const erpRole = erpRoleInput ? erpRoleInput.value : 'workshop';

  state.timesheetData.employees.push({
    id: Date.now().toString(),
    name,
    role,
    staffType,
    erpRole,
    rate,
    pin,
    annualDays,
    carryoverDays,
    startDate,
    active: true,
    addedAt: new Date().toISOString()
  });

  // Update UI immediately
  nameInput.value = '';
  roleInput.value = '';
  rateInput.value = '';
  pinInput2.value = '';
  daysInput.value = '20';
  carryoverInput.value = '0';
  startDateInput.value = '';
  if (staffTypeInput) staffTypeInput.value = 'workshop';
  if (erpRoleInput) erpRoleInput.value = 'workshop';
  renderStaffList();
  renderHome();
  toast(`${name} added ✓`, 'success');

  // Save to SharePoint
  try {
    await saveTimesheetData();
  } catch (e) {
    console.error('Save error:', e);
    toast('Warning: changes may not have synced to SharePoint', 'error');
  }
}

function editEmployee(id) {
  const emp = state.timesheetData.employees.find(e => e.id === id);
  if (!emp) return;
  emp.editing = true;
  renderStaffList();
}

function cancelEdit(id) {
  const emp = state.timesheetData.employees.find(e => e.id === id);
  if (!emp) return;
  delete emp.editing;
  renderStaffList();
}

async function saveEmployee(id) {
  const emp = state.timesheetData.employees.find(e => e.id === id);
  if (!emp) return;

  const newName = document.getElementById(`edit-name-${id}`).value.trim();
  const newRole = document.getElementById(`edit-role-${id}`).value.trim();
  const newRate = parseFloat(document.getElementById(`edit-rate-${id}`).value) || 0;

  if (!newName) { toast('Name cannot be empty', 'error'); return; }

  const oldName = emp.name;
  const newPin = document.getElementById(`edit-pin-${id}`).value.trim();
  const newDays = parseInt(document.getElementById(`edit-days-${id}`).value) || 20;
  const newCarryover = parseFloat(document.getElementById(`edit-carryover-${id}`).value) || 0;
  const newStartDate = document.getElementById(`edit-startdate-${id}`).value || '';
  const newStaffType = document.getElementById(`edit-stafftype-${id}`)?.value || emp.staffType || 'workshop';
  const newErpRole = document.getElementById(`edit-erprole-${id}`)?.value || emp.erpRole || 'workshop';
  emp.name = newName;
  emp.role = newRole;
  emp.rate = newRate;
  emp.pin = newPin;
  emp.annualDays = newDays;
  emp.carryoverDays = newCarryover;
  emp.startDate = newStartDate;
  emp.staffType = newStaffType;
  emp.erpRole = newErpRole;
  delete emp.editing;

  // Also update any existing entries/clockings with old name
  if (oldName !== newName) {
    state.timesheetData.entries.forEach(e => {
      if (e.employeeName === oldName) e.employeeName = newName;
    });
    state.timesheetData.clockings.forEach(c => {
      if (c.employeeName === oldName) c.employeeName = newName;
    });
  }

  try {
    await saveTimesheetData();
    toast('Employee updated ✓', 'success');
    renderStaffList();
    renderHome();
  } catch { toast('Save failed', 'error'); }
}

async function toggleEmployeeActive(id) {
  const emp = state.timesheetData.employees.find(e => e.id === id);
  if (!emp) return;
  emp.active = emp.active === false ? true : false;
  try {
    await saveTimesheetData();
    toast(`${emp.name} ${emp.active ? 'reactivated' : 'deactivated'}`, 'success');
    renderStaffList();
    renderHome();
  } catch { toast('Save failed', 'error'); }
}

async function deleteEmployee(id) {
  const emp = state.timesheetData.employees.find(e => e.id === id);
  if (!emp) return;

  if (!confirm(`Remove ${emp.name}? Their historical time entries will be kept.`)) return;

  state.timesheetData.employees = state.timesheetData.employees.filter(e => e.id !== id);

  try {
    await saveTimesheetData();
    toast(`${emp.name} removed`, 'success');
    renderStaffList();
    renderHome();
  } catch { toast('Save failed', 'error'); }
}

// ═══════════════════════════════════════════
// SETTINGS
// ═══════════════════════════════════════════
async function changePin() {
  const p1 = document.getElementById('newPin1').value;
  const p2 = document.getElementById('newPin2').value;

  if (!p1) { toast('Please enter a new PIN', 'error'); return; }
  if (p1 !== p2) { toast('PINs do not match', 'error'); return; }
  if (p1.length < 4) { toast('PIN must be at least 4 characters', 'error'); return; }

  if (!state.timesheetData.settings) state.timesheetData.settings = {};
  state.timesheetData.settings.managerPin = p1;

  try {
    await saveTimesheetData();
    document.getElementById('newPin1').value = '';
    document.getElementById('newPin2').value = '';
    toast('Manager PIN updated ✓', 'success');
  } catch { toast('Save failed', 'error'); }
}

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
    ...entries.map(e => [e.date, e.employeeName, e.projectId, e.projectName, e.hours, e.status])
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
// PROJECTS MODULE
// ═══════════════════════════════════════════
const DRAWINGS_FILE = 'drawings-data.json';
const BAMA_DRIVE_ID = 'b!CxTKk9lEwkyweUqAo3CRas-huywW4KtLqOk2tNzmx-P7CX86DNhTQo14pLuU_tZu';
const PROJECTS_FOLDER = 'Projects'; // Root projects folder on BAMA1

let drawingsData = { projects: {} }; // { projectId: { drawings: [], spFolderId, spDriveId } }
let currentProject = null;
let isDraftsman = false;
let draftsmanUploadFile = null;

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

// ── Open projects screen ──
async function openProjects() {
  if (CURRENT_PAGE !== 'projects') {
    window.location.href = 'projects.html';
    return;
  }
  showScreen('screenProjects');
  renderProjectTiles();
  // Load drawings data in background
  loadDrawingsData().then(() => renderProjectTiles()).catch(() => {});
}

function renderProjectTiles() {
  const grid = document.getElementById('projectTilesGrid');
  const projects = state.projects.filter(p =>
    p.status?.toLowerCase() === 'in progress' || !p.status || p.status === 'Active'
  );

  if (!projects.length) {
    grid.innerHTML = '<div class="empty-state">No active projects found</div>';
    return;
  }

  grid.innerHTML = projects.map(p => {
    const projData = drawingsData.projects[p.id];
    const drawingCount = projData?.drawings?.length || 0;
    const completeCount = projData?.drawings?.filter(d => d.complete)?.length || 0;

    return `
      <div class="project-tile" onclick="openProjectDetail('${p.id}')">
        <div class="project-tile-id">${p.id}</div>
        <div class="project-tile-name">${p.name}</div>
        <div class="project-tile-client">${p.client || ''}</div>
        ${drawingCount > 0 ? `
          <div style="margin-top:12px;font-size:11px;font-family:var(--font-mono);color:var(--muted)">
            ${completeCount}/${drawingCount} drawings complete
          </div>
          <div style="margin-top:6px;height:3px;background:var(--border);border-radius:2px">
            <div style="height:100%;background:var(--green);border-radius:2px;width:${drawingCount ? Math.round(completeCount/drawingCount*100) : 0}%"></div>
          </div>
        ` : `<div style="margin-top:12px;font-size:11px;color:var(--subtle)">No drawings yet</div>`}
        ${drawingCount > 0 ? `<div class="project-tile-badge">${drawingCount} drawing${drawingCount>1?'s':''}</div>` : ''}
      </div>
    `;
  }).join('');
}

async function openProjectDetail(projectId) {
  const proj = state.projects.find(p => p.id === projectId);
  if (!proj) return;
  currentProject = proj;

  document.getElementById('projDetailTitle').textContent = `${proj.id} — ${proj.name}`;
  document.getElementById('projDetailMeta').textContent = proj.client ? `Client: ${proj.client}` : '';
  document.getElementById('draftsmanBar').style.display = isDraftsman ? 'flex' : 'none';
  if (isDraftsman) document.getElementById('draftsmanName').textContent = '(Draftsman Mode Active)';

  showScreen('screenProjectDetail');
  renderDrawings(projectId);
}

function renderDrawings(projectId) {
  const container = document.getElementById('drawingsList');
  const projData = drawingsData.projects[projectId];
  const drawings = projData?.drawings || [];

  if (!drawings.length) {
    container.innerHTML = `
      <div class="empty-state" style="padding:60px 24px">
        <div style="font-size:36px;margin-bottom:12px">&#128196;</div>
        <div>No drawings uploaded yet</div>
        ${isDraftsman ? '<div style="margin-top:8px;font-size:12px;color:var(--subtle)">Use the Add Drawing button above</div>' : ''}
      </div>
    `;
    return;
  }

  const employees = (state.timesheetData.employees||[]).filter(e=>e.active!==false);
  container.innerHTML = drawings.map((d, idx) => renderDrawingPanel(d, idx, projectId, employees)).join('');
}

function renderDrawingPanel(drawing, idx, projectId, employees) {
  employees = employees || (state.timesheetData.employees||[]).filter(e=>e.active!==false);
  const draftsmanNotes = (drawing.notes || []).filter(n => n.type === 'draftsman');
  const workshopNotes = (drawing.notes || []).filter(n => n.type === 'workshop');

  const previewUrl = drawing.downloadUrl || drawing.webUrl;

  return `
    <div class="drawing-panel ${drawing.complete ? 'complete' : ''}" id="drawing-panel-${drawing.id}">
      <div class="drawing-panel-header">
        <div>
          <div class="drawing-name">
            ${drawing.complete ? '&#9989; ' : '&#128196; '}${drawing.name}
          </div>
          ${drawing.finishing && drawing.finishing !== 'none' ? `
            <div style="display:flex;gap:6px;margin-top:4px;flex-wrap:wrap">
              <span style="font-size:11px;padding:2px 8px;border-radius:4px;font-weight:600;
                background:${drawing.finishing === 'galvanise' ? 'rgba(99,102,241,.2)' : 'rgba(245,158,11,.2)'};
                color:${drawing.finishing === 'galvanise' ? '#818cf8' : 'var(--amber)'}">
                ${drawing.finishing === 'galvanise' ? '⚙️ Must be Galvanised' : '🎨 Must be Painted'}
              </span>
              <span style="font-size:11px;padding:2px 8px;border-radius:4px;font-weight:600;
                background:${drawing.transport === 'deliver' ? 'rgba(255,68,68,.15)' : 'rgba(62,207,142,.15)'};
                color:${drawing.transport === 'deliver' ? 'var(--red)' : 'var(--green)'}">
                ${drawing.transport === 'deliver' ? '🚚 We deliver' : '📦 They collect'}
              </span>
            </div>
          ` : ''}
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          ${drawing.complete ? `<span class="drawing-complete-badge">&#10003; COMPLETE</span>` : `
            <button class="btn btn-success" style="padding:6px 14px;font-size:12px"
              onclick="markDrawingComplete('${projectId}', '${drawing.id}')">
              &#10003; Mark Complete
            </button>
          `}
          ${isDraftsman ? `
            <button class="btn btn-ghost" style="padding:6px 12px;font-size:12px"
              onclick="openReUploadDrawing('${projectId}', '${drawing.id}')" title="Replace PDF (notes preserved)">
              &#8634; Replace
            </button>
            ${drawing.complete ? `
              <button class="btn btn-ghost" style="padding:6px 12px;font-size:12px"
                onclick="undoDrawingComplete('${projectId}', '${drawing.id}')">
                Undo
              </button>
            ` : ''}
            <button class="btn" style="padding:6px 12px;font-size:12px;background:rgba(255,68,68,.1);border:1px solid rgba(255,68,68,.3);color:var(--red)"
              onclick="confirmDeleteDrawing('${projectId}', '${drawing.id}')">
              &#128465; Delete
            </button>
          ` : ''}
        </div>
      </div>
      <div class="drawing-panel-body">
        <!-- Preview -->
        <div class="drawing-preview-wrap" id="preview-wrap-${drawing.id}">
          <div class="drawing-preview-placeholder" id="preview-${drawing.id}">
            <div style="font-size:32px;margin-bottom:12px">&#128196;</div>
            <div style="margin-bottom:12px;color:var(--text)">${drawing.name}</div>
            <button class="btn btn-primary" style="padding:10px 20px;font-size:13px"
              onclick="loadPDFPreview('${drawing.id}', '${drawing.fileId}', '${drawing.driveId}')">
              &#128065; Load Preview
            </button>
          </div>
        </div>

        <!-- Actions -->
        <div class="drawing-actions">
          ${drawing.webUrl ? `
            <a href="${drawing.webUrl}" target="_blank" class="btn btn-ghost" style="padding:8px 16px;font-size:12px;text-decoration:none">
              &#128065; Open in SharePoint
            </a>
          ` : ''}
          <button class="btn btn-ghost" style="padding:8px 16px;font-size:12px"
            onclick="printDrawing('${drawing.id}', '${drawing.fileId || ''}', '${drawing.driveId || ''}')">
            &#128438; Print
          </button>
          <span style="font-size:11px;color:var(--subtle);margin-left:auto;align-self:center">
            Uploaded ${drawing.uploadedAt ? new Date(drawing.uploadedAt).toLocaleDateString('en-GB') : ''} by ${drawing.uploadedBy || ''}
          </span>
        </div>

        <!-- Notes -->
        <div class="notes-section">
          <!-- Draftsman notes (red) — read-only in workshop view, editable in draftsman mode -->
          <div>
            <div class="notes-col-title draftsman">&#9998; Draftsman Notes</div>
            ${draftsmanNotes.map(n => `
              <div class="note-item draftsman-note">
                <div class="note-author draftsman-note">${n.author} <span class="note-time">${new Date(n.timestamp).toLocaleDateString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</span></div>
                <div class="note-text">${n.text}</div>
              </div>
            `).join('') || `<div style="color:var(--subtle);font-size:12px;padding:8px 0">No draftsman notes yet</div>`}
            ${isDraftsman ? `
              <div class="add-note-row" style="margin-top:8px">
                <input type="text" class="field-input" id="draftsman-note-${drawing.id}"
                  placeholder="Add draftsman note..." style="font-size:12px;padding:7px 10px">
                <button class="btn btn-primary" style="padding:7px 12px;font-size:12px;white-space:nowrap"
                  onclick="addNote('${projectId}','${drawing.id}','draftsman')">Add</button>
              </div>
            ` : '<div style="font-size:11px;color:var(--subtle);margin-top:8px;font-style:italic">Draftsman access required to add notes</div>'}
          </div>

          <!-- Workshop notes (green) -->
          <div>
            <div class="notes-col-title workshop">&#128296; Workshop Notes</div>
            ${workshopNotes.map(n => `
              <div class="note-item workshop-note">
                <div class="note-author workshop-note">${n.author} <span class="note-time">${new Date(n.timestamp).toLocaleDateString('en-GB',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</span></div>
                <div class="note-text">${n.text}</div>
              </div>
            `).join('') || `<div style="color:var(--subtle);font-size:12px;padding:8px 0">No workshop notes yet</div>`}
            <div class="add-note-row">
              <input type="text" class="field-input" id="workshop-note-${drawing.id}"
                placeholder="Add workshop note..." style="font-size:12px;padding:7px 10px">
              <select class="field-input" id="workshop-note-author-${drawing.id}" style="font-size:12px;padding:7px 10px;max-width:130px">
                <option value="">Your name...</option>
                ${employees.map(e=>`<option value="${e.name}">${e.name}</option>`).join('')}
              </select>
              <button class="btn btn-success" style="padding:7px 12px;font-size:12px;white-space:nowrap"
                onclick="addNote('${projectId}','${drawing.id}','workshop')">Add</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ── Mark drawing complete ──
let _pendingCompleteData = null;

function markDrawingComplete(projectId, drawingId) {
  const drawing = drawingsData.projects[projectId]?.drawings?.find(d => d.id === drawingId);
  if (!drawing) return;
  _pendingCompleteData = { projectId, drawingId };
  openFinishingModal(drawing, projectId);
}

function openFinishingModal(drawing, projectId) {
  const finishing = drawing.finishing || 'none';
  const transport = drawing.transport || 'collect';
  const finishingLabel = finishing === 'galvanise' ? 'Galvanising' : finishing === 'paint' ? 'Painting' : 'Completion';

  document.getElementById('finishingModalIcon').textContent = finishing === 'galvanise' ? '⚙️' : finishing === 'paint' ? '🎨' : '✅';
  document.getElementById('finishingModalTitle').textContent = `Ready for ${finishingLabel}?`;
  document.getElementById('finishingModalMessage').textContent = finishing !== 'none'
    ? `Confirm this item is ready for ${finishingLabel.toLowerCase()} before marking complete.`
    : `Confirm this drawing is complete.`;

  const alertBox = document.getElementById('finishingTransportAlert');
  if (finishing !== 'none') {
    alertBox.style.display = 'block';
    if (transport === 'deliver') {
      alertBox.style.cssText = 'display:block;background:rgba(255,68,68,.1);border:1px solid rgba(255,68,68,.3);border-radius:10px;padding:14px;margin-bottom:20px;text-align:left';
      alertBox.innerHTML = `<div style="font-size:14px;margin-bottom:4px">🚚 <b style="color:var(--red)">We must deliver this</b></div><div style="font-size:12px;color:var(--muted)">Please arrange transport to drop off for ${finishingLabel.toLowerCase()}.</div>`;
    } else {
      alertBox.style.cssText = 'display:block;background:rgba(62,207,142,.08);border:1px solid rgba(62,207,142,.2);border-radius:10px;padding:14px;margin-bottom:20px;text-align:left';
      alertBox.innerHTML = `<div style="font-size:14px;margin-bottom:4px">📦 <b style="color:var(--green)">They will collect</b></div><div style="font-size:12px;color:var(--muted)">Pack up, label clearly and get ready for collection.</div>`;
    }
  } else {
    alertBox.style.display = 'none';
  }

  document.getElementById('finishingCheckLabel').textContent = finishing !== 'none'
    ? `I confirm this item is ready for ${finishingLabel.toLowerCase()}`
    : `I confirm this drawing is complete`;

  const icon = document.getElementById('finishingCheckIcon');
  icon.textContent = '';
  icon.style.background = 'var(--card)';
  icon.style.borderColor = 'var(--border)';
  document.getElementById('finishingCheckBox').style.borderColor = 'var(--border)';
  const btn = document.getElementById('finishingConfirmBtn');
  btn.disabled = true; btn.style.opacity = '.4'; btn.style.cursor = 'not-allowed';

  const sel = document.getElementById('finishingAcknowledgedBy');
  sel.innerHTML = '<option value="">Select your name...</option>';
  (state.timesheetData.employees || []).filter(e => e.active !== false).forEach(e => {
    const opt = document.createElement('option');
    opt.value = e.name; opt.textContent = e.name; sel.appendChild(opt);
  });
  sel.onchange = checkFinishingReady;

  document.getElementById('finishingModal').classList.add('active');
}

function toggleFinishingCheck() {
  const icon = document.getElementById('finishingCheckIcon');
  const isChecked = icon.textContent === '✓';
  if (isChecked) {
    icon.textContent = ''; icon.style.background = 'var(--card)'; icon.style.borderColor = 'var(--border)';
    document.getElementById('finishingCheckBox').style.borderColor = 'var(--border)';
  } else {
    icon.textContent = '✓'; icon.style.background = 'var(--green)'; icon.style.borderColor = 'var(--green)'; icon.style.color = '#fff';
    document.getElementById('finishingCheckBox').style.borderColor = 'var(--green)';
  }
  checkFinishingReady();
}

function checkFinishingReady() {
  const checked = document.getElementById('finishingCheckIcon').textContent === '✓';
  const name = document.getElementById('finishingAcknowledgedBy').value;
  const btn = document.getElementById('finishingConfirmBtn');
  const ready = checked && !!name;
  btn.disabled = !ready; btn.style.opacity = ready ? '1' : '.4'; btn.style.cursor = ready ? 'pointer' : 'not-allowed';
}

function closeFinishingModal() {
  document.getElementById('finishingModal').classList.remove('active');
  _pendingCompleteData = null;
}

async function confirmFinishingComplete() {
  if (!_pendingCompleteData) return;
  const { projectId, drawingId } = _pendingCompleteData;
  const acknowledgedBy = document.getElementById('finishingAcknowledgedBy').value;
  const drawing = drawingsData.projects[projectId]?.drawings?.find(d => d.id === drawingId);
  if (!drawing) return;

  drawing.complete = true;
  drawing.completedAt = new Date().toISOString();
  drawing.completedBy = acknowledgedBy;
  drawing.acknowledgedBy = acknowledgedBy;
  drawing.acknowledgedAt = new Date().toISOString();

  if (!drawing.notes) drawing.notes = [];
  const finishing = drawing.finishing || 'none';
  const transport = drawing.transport || 'collect';
  const finishingLabel = finishing === 'galvanise' ? 'galvanising' : finishing === 'paint' ? 'painting' : 'completion';
  const transportMsg = finishing !== 'none' ? (transport === 'deliver' ? ` — we will deliver for ${finishingLabel}` : ` — they will collect for ${finishingLabel}`) : '';
  drawing.notes.push({
    id: Date.now().toString(), type: 'workshop', author: acknowledgedBy,
    text: `✅ Marked complete${transportMsg}. Acknowledged by ${acknowledgedBy}.`,
    timestamp: new Date().toISOString(), isAcknowledgement: true
  });

  try {
    setLoading(true);
    await saveDrawingsData();
    closeFinishingModal();
    toast('Drawing marked complete ✓', 'success');
    renderDrawings(projectId);
    renderProjectTiles();
    if (finishing !== 'none') {
      await sendFinishingNotificationEmail(drawing, projectId, acknowledgedBy);
    } else {
      await notifyDrawingComplete(drawing, projectId);
    }
  } catch (e) { toast('Save failed: ' + e.message, 'error'); }
  finally { setLoading(false); }
}

async function sendFinishingNotificationEmail(drawing, projectId, acknowledgedBy) {
  const proj = state.projects.find(p => p.id === projectId);
  const draftsmanEmail = state.timesheetData.settings?.draftsmanEmail || 'daniel@bamafabrication.co.uk';
  const finishing = drawing.finishing;
  const transport = drawing.transport || 'collect';
  const finishingLabel = finishing === 'galvanise' ? 'Galvanising' : 'Painting';
  const transportMsg = transport === 'deliver'
    ? '🚚 <b style="color:#ef4444">We must deliver this item</b> — please arrange transport.'
    : '📦 <b style="color:#10b981">Item ready for collection</b> — packed and labelled.';
  try {
    const token = await getToken();
    await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: {
        subject: `Ready for ${finishingLabel} — ${drawing.name} (${projectId})`,
        body: { contentType: 'HTML', content: `
          <h2 style="color:#ff6b00;font-family:sans-serif">BAMA FABRICATION</h2>
          <h3 style="font-family:sans-serif">Drawing Ready for ${finishingLabel}</h3>
          <table style="font-family:sans-serif;font-size:13px">
            <tr><td style="padding:6px 16px 6px 0;color:#888">Drawing</td><td><b>${drawing.name}</b></td></tr>
            <tr><td style="padding:6px 16px 6px 0;color:#888">Project</td><td>${proj?.name || projectId}</td></tr>
            <tr><td style="padding:6px 16px 6px 0;color:#888">Finishing</td><td><b>${finishingLabel}</b></td></tr>
            <tr><td style="padding:6px 16px 6px 0;color:#888">Transport</td><td>${transport === 'deliver' ? 'We deliver' : 'They collect'}</td></tr>
            <tr><td style="padding:6px 16px 6px 0;color:#888">Acknowledged by</td><td>${acknowledgedBy}</td></tr>
            <tr><td style="padding:6px 16px 6px 0;color:#888">Date/Time</td><td>${new Date().toLocaleString('en-GB')}</td></tr>
          </table>
          <p style="margin-top:16px;font-family:sans-serif;font-size:13px;padding:12px;border-radius:8px;background:#f9f9f9">${transportMsg}</p>
          <p style="font-family:sans-serif;font-size:11px;color:#aaa;margin-top:12px">
            <a href="https://proud-dune-0dee63110.2.azurestaticapps.net" style="color:#ff6b00">Open BAMA Workshop App</a>
          </p>
        `},
        toRecipients: [{ emailAddress: { address: draftsmanEmail } }]
      }, saveToSentItems: false })
    });
  } catch (e) { console.warn('Finishing email failed:', e.message); }
}


async function undoDrawingComplete(projectId, drawingId) {
  const drawing = drawingsData.projects[projectId]?.drawings?.find(d => d.id === drawingId);
  if (!drawing) return;
  drawing.complete = false;
  delete drawing.completedAt;
  delete drawing.completedBy;
  try {
    await saveDrawingsData();
    toast('Marked as incomplete', 'info');
    renderDrawings(projectId);
  } catch { toast('Save failed', 'error'); }
}

async function notifyDrawingComplete(drawing, projectId) {
  const proj = state.projects.find(p => p.id === projectId);
  const settings = state.timesheetData.settings || {};
  const notifyEmail = settings.draftsmanNotifyEmail || settings.orderEmail || 'daniel@bamafabrication.co.uk';

  try {
    const token = await getToken();
    const emailBody = {
      message: {
        subject: `Drawing Completed — ${drawing.name} (${projectId})`,
        body: {
          contentType: 'HTML',
          content: `
            <h2 style="color:#ff6b00;font-family:sans-serif">BAMA FABRICATION</h2>
            <h3 style="font-family:sans-serif">Drawing Marked Complete</h3>
            <table style="font-family:sans-serif;font-size:13px">
              <tr><td style="color:#888;padding:4px 16px 4px 0">Drawing</td><td><b>${drawing.name}</b></td></tr>
              <tr><td style="color:#888;padding:4px 16px 4px 0">Project</td><td>${proj?.name || projectId}</td></tr>
              <tr><td style="color:#888;padding:4px 16px 4px 0">Completed by</td><td>${drawing.completedBy}</td></tr>
              <tr><td style="color:#888;padding:4px 16px 4px 0">Date</td><td>${new Date().toLocaleString('en-GB')}</td></tr>
            </table>
            <p style="margin-top:16px;font-family:sans-serif;font-size:12px;color:#888">
              <a href="https://proud-dune-0dee63110.2.azurestaticapps.net" style="color:#ff6b00">Open BAMA Workshop App</a>
            </p>
          `
        },
        toRecipients: [{ emailAddress: { address: notifyEmail } }]
      },
      saveToSentItems: false
    };
    await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(emailBody)
    });

    // Store in-app notification
    if (!state.timesheetData.notifications) state.timesheetData.notifications = [];
    state.timesheetData.notifications.push({
      id: Date.now().toString(),
      type: 'drawing_complete',
      message: `Drawing "${drawing.name}" on ${proj?.name || projectId} marked complete by ${drawing.completedBy}`,
      timestamp: new Date().toISOString(),
      read: false
    });
    await saveTimesheetData();
  } catch (e) {
    console.warn('Drawing complete notification failed:', e.message);
  }
}

// ── Add notes ──
async function addNote(projectId, drawingId, type) {
  const inputEl = document.getElementById(`${type}-note-${drawingId}`);
  const text = inputEl?.value?.trim();
  if (!text) { toast('Please type a note', 'error'); return; }

  let author = '';
  if (type === 'workshop') {
    author = document.getElementById(`workshop-note-author-${drawingId}`)?.value;
    if (!author) { toast('Please select your name', 'error'); return; }
  } else {
    author = 'Draftsman';
  }

  if (!drawingsData.projects[projectId]) drawingsData.projects[projectId] = { drawings: [] };
  const drawing = drawingsData.projects[projectId].drawings.find(d => d.id === drawingId);
  if (!drawing) return;

  if (!drawing.notes) drawing.notes = [];
  drawing.notes.push({
    id: Date.now().toString(),
    type,
    author,
    text,
    timestamp: new Date().toISOString()
  });

  try {
    await saveDrawingsData();
    inputEl.value = '';
    toast('Note added ✓', 'success');
    renderDrawings(projectId);
  } catch { toast('Save failed', 'error'); }
}

// ── Add Note Modal helpers ──
let _noteContext = { projectId: null, drawingId: null, type: 'workshop' };

function openAddNoteModal(projectId, drawingId, drawingName, type) {
  _noteContext = { projectId, drawingId, type };
  document.getElementById('addNoteDrawingName').textContent = drawingName || '';
  const sel = document.getElementById('noteAuthorSelect');
  sel.innerHTML = '<option value="">Select your name...</option>';
  (state.timesheetData.employees || []).filter(e => e.active !== false).forEach(emp => {
    sel.innerHTML += `<option value="${emp.name}">${emp.name}</option>`;
  });
  document.getElementById('noteText').value = '';
  document.getElementById('addNoteModal').classList.add('active');
}

function closeAddNote() {
  document.getElementById('addNoteModal').classList.remove('active');
}

async function saveNote() {
  const author = document.getElementById('noteAuthorSelect').value;
  const text = document.getElementById('noteText').value.trim();
  if (!author) { toast('Please select your name', 'error'); return; }
  if (!text) { toast('Please type a note', 'error'); return; }

  const { projectId, drawingId, type } = _noteContext;
  if (!drawingsData.projects[projectId]) drawingsData.projects[projectId] = { drawings: [] };
  const drawing = drawingsData.projects[projectId].drawings.find(d => d.id === drawingId);
  if (!drawing) return;

  if (!drawing.notes) drawing.notes = [];
  drawing.notes.push({
    id: Date.now().toString(),
    type,
    author,
    text,
    timestamp: new Date().toISOString()
  });

  try {
    await saveDrawingsData();
    closeAddNote();
    toast('Note added ✓', 'success');
    renderDrawings(projectId);
  } catch { toast('Save failed', 'error'); }
}

async function loadPDFPreview(drawingId, fileId, driveId) {
  const wrap = document.getElementById(`preview-${drawingId}`);
  if (!wrap) return;
  if (!fileId || fileId === 'undefined') {
    wrap.innerHTML = `<div class="drawing-preview-placeholder" style="color:var(--red)">No file ID — please re-upload this drawing</div>`;
    return;
  }

  wrap.innerHTML = `<div class="drawing-preview-placeholder"><div class="spinner" style="margin:0 auto"></div><div style="margin-top:12px;color:var(--muted)">Loading preview...</div></div>`;

  try {
    const token = await getToken();
    const useDriveId = driveId && driveId !== 'undefined' ? driveId : BAMA_DRIVE_ID;
    const contentRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${useDriveId}/items/${fileId}/content`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (!contentRes.ok) throw new Error(`Fetch failed: ${contentRes.status}`);
    const blob = await contentRes.blob();
    const blobUrl = URL.createObjectURL(blob);

    // Store blob URL on drawing for print use
    const outerWrap = document.getElementById(`preview-wrap-${drawingId}`);
    if (outerWrap) outerWrap.dataset.blobUrl = blobUrl;

    wrap.innerHTML = `
      <iframe src="${blobUrl}#toolbar=1&view=FitH"
        style="width:100%;height:80vh;min-height:600px;border:none;display:block;position:relative;z-index:1"
        title="Drawing Preview"></iframe>
    `;
  } catch (e) {
    wrap.innerHTML = `<div class="drawing-preview-placeholder" style="color:var(--red)">
      Preview failed: ${e.message}<br>
      <a href="#" onclick="event.preventDefault()" style="color:var(--accent);font-size:12px">Try opening in SharePoint instead</a>
    </div>`;
  }
}

async function printDrawing(drawingId, fileId, driveId) {
  // If we already have a blob URL from the preview, use it
  const outerWrap = document.getElementById(`preview-wrap-${drawingId}`);
  const existingBlobUrl = outerWrap?.dataset?.blobUrl;

  if (existingBlobUrl) {
    triggerPrintFromBlob(existingBlobUrl);
    return;
  }

  // Otherwise fetch the PDF fresh
  if (!fileId || fileId === 'undefined') {
    toast('No file ID available for printing', 'error');
    return;
  }

  toast('Preparing print...', 'info');

  try {
    const token = await getToken();
    const useDriveId = driveId && driveId !== 'undefined' ? driveId : BAMA_DRIVE_ID;
    const contentRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${useDriveId}/items/${fileId}/content`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (!contentRes.ok) throw new Error(`Fetch failed: ${contentRes.status}`);
    const blob = await contentRes.blob();
    const blobUrl = URL.createObjectURL(blob);
    if (outerWrap) outerWrap.dataset.blobUrl = blobUrl;
    triggerPrintFromBlob(blobUrl);
  } catch (e) {
    toast(`Print failed: ${e.message}`, 'error');
  }
}

function triggerPrintFromBlob(blobUrl) {
  // Create hidden iframe, load PDF, trigger print
  let printFrame = document.getElementById('printFrame');
  if (printFrame) printFrame.remove();
  printFrame = document.createElement('iframe');
  printFrame.id = 'printFrame';
  printFrame.style.cssText = 'position:fixed;right:-9999px;top:-9999px;width:1px;height:1px;opacity:0;pointer-events:none';
  printFrame.src = blobUrl;
  document.body.appendChild(printFrame);
  printFrame.onload = () => {
    try {
      printFrame.contentWindow.focus();
      printFrame.contentWindow.print();
    } catch {
      // Fallback: open in new tab for printing
      window.open(blobUrl, '_blank');
    }
  };
}

// ── Draftsman auth ──
function openDraftsmanLogin() {
  document.getElementById('draftsmanPinInput').value = '';
  document.getElementById('draftsmanPinError').textContent = '';
  document.getElementById('draftsmanLoginModal').classList.add('active');
  setTimeout(() => document.getElementById('draftsmanPinInput').focus(), 100);
}

function closeDraftsmanLogin() {
  document.getElementById('draftsmanLoginModal').classList.remove('active');
}

function checkDraftsmanPin() {
  const pin = document.getElementById('draftsmanPinInput').value;
  const storedPin = state.timesheetData.settings?.draftsmanPin;
  if (!storedPin) {
    toast('Draftsman PIN not set — go to Manager → Settings', 'error');
    closeDraftsmanLogin();
    return;
  }
  if (pin === storedPin) {
    isDraftsman = true;
    closeDraftsmanLogin();
    toast('Draftsman mode activated ✓', 'success');
    // Show persistent badge, hide login button
    const badge = document.getElementById('draftsmanBadge');
    const loginBtn = document.getElementById('draftsmanLoginBtn');
    if (badge) badge.style.display = 'flex';
    if (loginBtn) loginBtn.style.display = 'none';
    if (currentProject) {
      document.getElementById('draftsmanBar').style.display = 'flex';
      renderDrawings(currentProject.id);
    }
  } else {
    document.getElementById('draftsmanPinError').textContent = 'Incorrect PIN';
    document.getElementById('draftsmanPinInput').value = '';
  }
}

function logoutDraftsman() {
  isDraftsman = false;
  document.getElementById('draftsmanBar').style.display = 'none';
  // Hide badge, show login button
  const badge = document.getElementById('draftsmanBadge');
  const loginBtn = document.getElementById('draftsmanLoginBtn');
  if (badge) badge.style.display = 'none';
  if (loginBtn) loginBtn.style.display = '';
  if (currentProject) renderDrawings(currentProject.id);
  toast('Draftsman mode deactivated', 'info');
}

async function saveDraftsmanPin() {
  const p1 = document.getElementById('draftsmanPinSetting').value;
  const p2 = document.getElementById('draftsmanPinConfirm').value;
  if (!p1) { toast('Please enter a PIN', 'error'); return; }
  if (p1 !== p2) { toast('PINs do not match', 'error'); return; }
  if (p1.length < 4) { toast('PIN must be at least 4 characters', 'error'); return; }
  if (!state.timesheetData.settings) state.timesheetData.settings = {};
  state.timesheetData.settings.draftsmanPin = p1;
  // Also store notify email if set
  try {
    await saveTimesheetData();
    document.getElementById('draftsmanPinSetting').value = '';
    document.getElementById('draftsmanPinConfirm').value = '';
    toast('Draftsman PIN saved ✓', 'success');
  } catch { toast('Save failed', 'error'); }
}

// ── Upload Drawing ──
function openUploadDrawing() {
  if (!currentProject) return;
  document.getElementById('uploadProjectName').textContent = `${currentProject.id} — ${currentProject.name}`;
  document.getElementById('drawingNameInput').value = '';
  document.getElementById('drawingFolderPath').value = '02 - Drawings';
  document.getElementById('uploadZoneText').textContent = 'Click to select PDF file';
  document.getElementById('uploadProgress').style.display = 'none';
  document.getElementById('uploadDraftsmanNote').value = '';
  draftsmanUploadFile = null;
  document.getElementById('uploadDrawingModal').classList.add('active');
}

function closeUploadDrawing() {
  document.getElementById('uploadDrawingModal').classList.remove('active');
  draftsmanUploadFile = null;
}

function onDrawingFileSelected() {
  const file = document.getElementById('drawingFileInput').files[0];
  if (file) {
    draftsmanUploadFile = file;
    document.getElementById('uploadZoneText').textContent = `&#128196; ${file.name} (${(file.size/1024).toFixed(0)}KB)`;
    // Auto-fill drawing name from filename
    if (!document.getElementById('drawingNameInput').value) {
      document.getElementById('drawingNameInput').value = file.name.replace('.pdf','').replace('.PDF','');
    }
  }
}

async function uploadDrawing() {
  if (!draftsmanUploadFile) { toast('Please select a PDF file', 'error'); return; }
  const drawingName = document.getElementById('drawingNameInput').value.trim();
  if (!drawingName) { toast('Please enter a drawing name', 'error'); return; }

  const folderPath = document.getElementById('drawingFolderPath').value.trim();
  const projectId = currentProject.id;
  const fileName = draftsmanUploadFile.name;

  document.getElementById('uploadProgress').style.display = 'block';
  document.getElementById('uploadDrawingBtn').disabled = true;
  document.getElementById('uploadProgressBar').style.width = '30%';
  document.getElementById('uploadProgressText').textContent = 'Finding project folder...';

  try {
    const token = await getToken();

    // Find the project folder on SharePoint by searching for project ID
    let uploadPath;
    const searchRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${BAMA_DRIVE_ID}/root/search(q='${projectId}')`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    const searchData = await searchRes.json();
    const projectFolder = searchData.value?.find(item =>
      item.folder && item.name.includes(projectId)
    );

    if (projectFolder) {
      uploadPath = folderPath
        ? `/drives/${BAMA_DRIVE_ID}/items/${projectFolder.id}:/${folderPath}/${fileName}:/content`
        : `/drives/${BAMA_DRIVE_ID}/items/${projectFolder.id}:/${fileName}:/content`;
    } else {
      // Fallback: upload to Project Tracker folder
      uploadPath = `/drives/${CONFIG.driveId}/items/${CONFIG.timesheetFolderItemId}:/${projectId}-${fileName}:/content`;
    }

    document.getElementById('uploadProgressBar').style.width = '60%';
    document.getElementById('uploadProgressText').textContent = 'Uploading PDF...';

    const arrayBuffer = await draftsmanUploadFile.arrayBuffer();
    const uploadRes = await fetch(`https://graph.microsoft.com/v1.0${uploadPath}`, {
      method: 'PUT',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/pdf' },
      body: arrayBuffer
    });

    if (!uploadRes.ok) throw new Error(`Upload failed: ${uploadRes.status}`);
    const uploadedFile = await uploadRes.json();

    document.getElementById('uploadProgressBar').style.width = '90%';
    document.getElementById('uploadProgressText').textContent = 'Saving drawing info...';

    // Save to drawings data
    if (!drawingsData.projects[projectId]) drawingsData.projects[projectId] = { drawings: [] };
    // Get draftsman note if entered
    const draftsmanNoteText = document.getElementById('uploadDraftsmanNote')?.value?.trim() || '';

    const newDrawing = {
      id: Date.now().toString(),
      name: drawingName,
      fileName,
      fileId: uploadedFile.id,
      driveId: uploadedFile.parentReference?.driveId || BAMA_DRIVE_ID,
      webUrl: uploadedFile.webUrl,
      // NO downloadUrl — prevents auto-download
      uploadedBy: 'Draftsman',
      uploadedAt: new Date().toISOString(),
      complete: false,
      notes: draftsmanNoteText ? [{
        id: Date.now().toString(),
        type: 'draftsman',
        author: 'Draftsman',
        text: draftsmanNoteText,
        timestamp: new Date().toISOString()
      }] : []
    };
    // Check if we're replacing an existing drawing (preserve its notes)
    const replacingId = document.getElementById('uploadDrawingModal').dataset.replacingId;
    if (replacingId) {
      const existingDrawing = drawingsData.projects[projectId].drawings.find(d => d.id === replacingId);
      if (existingDrawing) {
        // Preserve existing notes, add any new draftsman note
        newDrawing.notes = existingDrawing.notes || [];
        if (draftsmanNoteText) {
          newDrawing.notes.push({
            id: Date.now().toString(), type: 'draftsman', author: 'Draftsman',
            text: draftsmanNoteText, timestamp: new Date().toISOString()
          });
        }
        // Replace the drawing in the array
        const idx = drawingsData.projects[projectId].drawings.findIndex(d => d.id === replacingId);
        if (idx >= 0) drawingsData.projects[projectId].drawings[idx] = newDrawing;
      } else {
        drawingsData.projects[projectId].drawings.push(newDrawing);
      }
      document.getElementById('uploadDrawingModal').dataset.replacingId = '';
    } else {
      // Check if deleted notes exist for this drawing name (restore them)
      const deletedNotes = drawingsData.projects[projectId]?.deletedNotes?.[drawingName];
      if (deletedNotes?.length) {
        newDrawing.notes = deletedNotes;
        if (draftsmanNoteText) newDrawing.notes.push({
          id: Date.now().toString(), type: 'draftsman', author: 'Draftsman',
          text: draftsmanNoteText, timestamp: new Date().toISOString()
        });
        delete drawingsData.projects[projectId].deletedNotes[drawingName];
      }
      drawingsData.projects[projectId].drawings.push(newDrawing);
    }
    await saveDrawingsData();

    document.getElementById('uploadProgressBar').style.width = '100%';
    document.getElementById('uploadProgressText').textContent = 'Done!';

    setTimeout(() => {
      closeUploadDrawing();
      toast(`${drawingName} uploaded ✓`, 'success');
      renderDrawings(projectId);
      renderProjectTiles();
    }, 500);

  } catch (e) {
    console.error('Upload error:', e);
    toast(`Upload failed: ${e.message}`, 'error');
    document.getElementById('uploadProgress').style.display = 'none';
  } finally {
    document.getElementById('uploadDrawingBtn').disabled = false;
  }
}

// ── Load settings into settings tab (draftsman PIN field) ──
// Note: integrated into the main loadEmailSettings function below via switchTab

// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
// ═══════════════════════════════════════════
// PAGE DETECTION
// ═══════════════════════════════════════════
const CURRENT_PAGE = (() => {
  const path = window.location.pathname.toLowerCase();
  if (path.includes('manager')) return 'manager';
  if (path.includes('projects') || path.includes('project')) return 'projects';
  if (path.includes('hub')) return 'hub';
  return 'index'; // default kiosk
})();

// Track whether we successfully loaded data from SharePoint
let _dataLoadedFromSharePoint = false;

async function init() {
  setLoading(true);

  // Handle token from Microsoft login redirect
  const justLoggedIn = AUTH.handleRedirect();
  if (justLoggedIn) console.log('Just returned from login, token stored');

  // Race loadTimesheetData against a 8 second timeout
  try {
    await Promise.race([
      loadTimesheetData(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 8000))
    ]);
    _dataLoadedFromSharePoint = true;
  } catch (e) {
    console.warn('Timesheet load skipped:', e.message);
    // DO NOT overwrite state with empty defaults — keep whatever was loaded
    // Only set defaults if there's truly nothing
    if (!state.timesheetData.employees || state.timesheetData.employees.length === 0) {
      console.warn('No employee data loaded — app will be read-only until data loads');
    }
  }

  // Load projects with timeout
  try {
    await Promise.race([
      loadProjects(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 8000))
    ]);
  } catch (e) {
    console.warn('Project load skipped, using fallback:', e.message);
    state.projects = FALLBACK_PROJECTS;
  }

  setLoading(false);

  // Page-specific startup
  if (CURRENT_PAGE === 'manager') {
    showScreen('screenAuth');
  } else if (CURRENT_PAGE === 'projects') {
    showScreen('screenProjects');
    renderProjectTiles();
    // Load drawings data then re-render tiles with drawing counts
    loadDrawingsData().then(() => renderProjectTiles()).catch(e => console.warn('Drawings load failed:', e.message));
  } else if (CURRENT_PAGE === 'hub') {
    // hub has its own simple rendering
  } else {
    renderHome();
  }
}

init();
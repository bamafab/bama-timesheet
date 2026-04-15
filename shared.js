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
        slots.push({ val: `${hh}:${mm}`, label: `${hh}:${mm}` });
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

// Format a YYYY-MM-DD string to DD/MM/YYYY for display
function fmtDateStr(ds) {
  if (!ds || ds.length < 10) return ds || '';
  const [y, m, d] = ds.split('-');
  return `${d}/${m}/${y}`;
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

  // Always show project time card — employees may log hours before or after clocking out
  const projectCard = document.getElementById('projectTimeCard');
  if (projectCard) projectCard.style.display = '';

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
        <div style="font-size:10px;color:var(--subtle);margin-top:3px">${emp.pin ? '&#128274; PIN set' : '&#128275; No PIN'}</div>
      </div>
    `;
  }).join('');
}

function selectManagerUser(name) {
  const emp = (state.timesheetData.employees || []).find(e => e.name === name);
  if (!emp) return;

  if (!emp.pin) {
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

function checkManagerPin() {
  const pin = document.getElementById('mgrPinInput').value;
  const emp = (state.timesheetData.employees || []).find(e => e.name === _pendingManagerUser);

  if (!emp || !emp.pin) {
    document.getElementById('mgrPinError').textContent = 'No PIN set for this user';
    return;
  }

  if (pin !== emp.pin) {
    document.getElementById('mgrPinError').textContent = 'Incorrect PIN';
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
    ? ['dashboard','staff','holidays','project','employee','clockinout','payroll','archive']
    : ['reports','settings','useraccess'];
  for (const tab of tabOrder) {
    const permKey = Object.keys(PERM_TO_TAB).find(k => PERM_TO_TAB[k] === tab);
    if (permKey && perms[permKey]) return tab;
  }
  return CURRENT_PAGE === 'office' ? 'dashboard' : 'reports'; // fallback
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
        <div style="font-size:10px;color:var(--subtle);margin-top:3px">${emp.pin ? '&#128274; PIN set' : '&#128275; No PIN'}</div>
      </div>
    `;
  }).join('');
}

function selectOfficeUser(name) {
  const emp = (state.timesheetData.employees || []).find(e => e.name === name);
  if (!emp) return;

  if (!emp.pin) {
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

function checkOfficePin() {
  const pin = document.getElementById('officePinInput').value;
  const emp = (state.timesheetData.employees || []).find(e => e.name === _pendingManagerUser);

  if (!emp || !emp.pin) {
    document.getElementById('officePinError').textContent = 'No PIN set for this user';
    return;
  }

  if (pin !== emp.pin) {
    document.getElementById('officePinError').textContent = 'Incorrect PIN';
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
  const totalHrs = weekEntries.reduce((s, e) => s + e.hours, 0);
  const pending = weekEntries.filter(e => e.status === 'pending').length;
  const approved = weekEntries.filter(e => e.status === 'approved').length;
  const emps = new Set(weekEntries.map(e => e.employeeName)).size;

  const el = (id, val) => { const e = document.getElementById(id); if (e) e.textContent = val; };
  el('stat-pending', pending);
  el('stat-approved', approved);
  el('stat-emps', emps);
  el('pendingCount', `${pending} entr${pending === 1 ? 'y' : 'ies'} pending approval`);

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
    tbody.innerHTML = '<tr><td colspan="7"><div class="empty-state"><div class="icon">📋</div>No entries this week</div></td></tr>';
    return;
  }

  tbody.innerHTML = entries.map(e => `
    <tr>
      <td><span class="mono" style="color:var(--accent2)">${e.projectId}</span></td>
      <td style="color:var(--muted)">${e.projectName}</td>
      <td>${e.employeeName}</td>
      <td class="mono" style="font-size:12px">${fmtDateStr(e.date)}</td>
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

function calcHours(clockIn, clockOut, breakMins) {
  if (!clockIn || !clockOut) return null;
  const [ih, im] = clockIn.split(':').map(Number);
  const [oh, om] = clockOut.split(':').map(Number);
  const diff = (oh * 60 + om) - (ih * 60 + im) - (breakMins || 0);
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

      const hrs = calcHours(c.clockIn, c.clockOut, c.breakMins) || 0;
      const isPending = c.approvalStatus === 'pending' || (!c.approvalStatus && !c.addedByManager);
      const isEdited = c.manuallyEdited;

      // Inline edit mode
      if (c._editing) {
        const times = [];
        for (let h = 5; h <= 22; h++) { times.push(`${String(h).padStart(2,'0')}:00`); times.push(`${String(h).padStart(2,'0')}:30`); }
        // Include the actual clock times if they're not standard 30-min slots
        const actualIn = c.clockIn || '';
        const actualOut = c.clockOut || '';
        if (actualIn && !times.includes(actualIn)) times.push(actualIn);
        if (actualOut && !times.includes(actualOut)) times.push(actualOut);
        times.sort();
        const inOpts = times.map(t => `<option value="${t}" ${t === actualIn ? 'selected' : ''}>${t}</option>`).join('');
        const outOpts = times.map(t => `<option value="${t}" ${t === actualOut ? 'selected' : ''}>${t}</option>`).join('');
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

    // Project entries for this day
    const dayEntries = (state.timesheetData.entries || []).filter(
      e => e.employeeName === employeeName && e.date === dStr
    );

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
  if (name === 'payroll') { renderPayroll(); checkArchiveReminder(); }
  if (name === 'archive') renderArchive();
  if (name === 'reports') setTimeout(() => renderReports(), 50);
  if (name === 'settings') { loadEmailSettings(); renderOfficeStaffList(); }
  if (name === 'useraccess') renderUserAccessTab();
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
  const taskEl = document.getElementById('settingTaskCompletionEmails');
  const siteEl = document.getElementById('settingSiteCompletionEmails');
  if (payEl) payEl.value = settings.payrollEmail || '';
  if (ordEl) ordEl.value = settings.orderEmail || 'daniel@bamafabrication.co.uk';
  if (draftEl) draftEl.value = settings.draftsmanEmail || '';
  if (taskEl) taskEl.value = settings.taskCompletionEmails || '';
  if (siteEl) siteEl.value = settings.siteCompletionEmails || '';
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
        <span class="hdate">${fmtDateStr(h.dateFrom)} → ${fmtDateStr(h.dateTo)}</span>
        <span class="htype ${h.type}">${h.type === 'paid' ? 'Paid' : h.type === 'unpaid' ? 'Unpaid Absence' : h.type === 'sick' ? 'Sick' : h.type === 'half' ? 'Half Day' : h.type}</span>
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
      return `
      <div class="holiday-chip" style="flex-wrap:wrap;gap:8px">
        <span style="font-weight:600;min-width:120px">${h.employeeName}</span>
        <span class="hdate">${fmtDateStr(h.dateFrom)} → ${fmtDateStr(h.dateTo)}</span>
        <span class="htype ${h.type}">${h.type === 'paid' ? 'Paid' : h.type === 'unpaid' ? 'Unpaid Absence' : h.type === 'sick' ? 'Sick' : h.type === 'half' ? 'Half Day' : h.type}</span>
        <span style="font-family:var(--font-mono);font-size:12px;color:var(--accent2)">${h.workingDays}d</span>
        <span style="color:var(--muted);font-size:12px;flex:1">${h.reason || ''}</span>
        <span class="tag tag-${h.status === 'approved' ? 'approved' : h.status === 'rejected' ? 'rejected' : 'pending'}">${h.status}</span>
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
}

async function emailPayrollReport() {
  const { mon, sun } = getWeekDates(payrollWeekOffset);
  const employees = (state.timesheetData.employees || []).filter(e => e.active !== false && (e.payType || 'payee') !== 'cis');
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
  const employees = (state.timesheetData.employees || []).filter(e => e.active !== false && (e.payType || 'payee') !== 'cis');
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
              <div style="font-size:12px;color:var(--muted);margin-top:2px">${emp.role || 'No title set'} · <span style="color:var(--accent2)">${erpRoleLabels[erpRole] || erpRole}</span> · <span style="color:var(--muted)">${payTypeLabels[payType] || 'PAYEE'}</span></div>
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
  const payTypeInput = document.getElementById('newEmpPayType');
  const staffType = staffTypeInput ? staffTypeInput.value : 'workshop';
  const erpRole = erpRoleInput ? erpRoleInput.value : 'workshop';
  const payType = payTypeInput ? payTypeInput.value : 'payee';

  state.timesheetData.employees.push({
    id: Date.now().toString(),
    name,
    role,
    staffType,
    erpRole,
    payType,
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
  if (payTypeInput) payTypeInput.value = 'payee';
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
  const newPayType = document.getElementById(`edit-paytype-${id}`)?.value || emp.payType || 'payee';
  emp.name = newName;
  emp.role = newRole;
  emp.rate = newRate;
  emp.pin = newPin;
  emp.annualDays = newDays;
  emp.carryoverDays = newCarryover;
  emp.startDate = newStartDate;
  emp.staffType = newStaffType;
  emp.erpRole = newErpRole;
  emp.payType = newPayType;
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
  const deactivating = emp.active !== false;
  if (deactivating && !confirm(`Deactivate ${emp.name}? They will no longer appear on the kiosk or in payroll.`)) return;
  emp.active = deactivating ? false : true;
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
      taskList.innerHTML = '<div class="empty-state" style="padding:20px"><div class="icon">&#9745;</div>No tasks assigned to you</div>';
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
      msgList.innerHTML = '<div class="empty-state" style="padding:20px"><div class="icon">&#9993;</div>No messages</div>';
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
      holList.innerHTML = '<div class="empty-state" style="padding:20px"><div class="icon">&#9788;</div>No pending holiday requests</div>';
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
      clockList.innerHTML = '<div class="empty-state" style="padding:20px"><div class="icon">&#9201;</div>No clockings awaiting approval</div>';
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

  const request = {
    id: Date.now().toString(),
    employeeName: currentManagerUser,
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
    toast(`Holiday request submitted (${workingDays} working days) ✓`, 'success');
    closeOfficeHolidayModal();
    renderDashboard();
  } catch (e) {
    toast('Submit failed: ' + e.message, 'error');
    state.timesheetData.holidays.pop();
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

// ── Load / Save user access data ──
async function loadUserAccessData() {
  try {
    const token = await getToken();
    const metaUrl = `https://graph.microsoft.com/v1.0/drives/${CONFIG.driveId}/items/${CONFIG.timesheetFolderItemId}:/${USER_ACCESS_FILE}`;
    const metaRes = await fetch(metaUrl, { headers: { 'Authorization': `Bearer ${token}` } });
    if (metaRes.status === 404) {
      console.log('No user-access.json yet — will create on first save');
      return;
    }
    if (!metaRes.ok) throw new Error(`User access meta fetch failed: ${metaRes.status}`);
    const meta = await metaRes.json();
    const contentRes = await fetch(
      `https://graph.microsoft.com/v1.0/drives/${CONFIG.driveId}/items/${meta.id}/content`,
      { headers: { 'Authorization': `Bearer ${token}` } }
    );
    if (!contentRes.ok) throw new Error('User access content fetch failed');
    const loaded = await contentRes.json();
    userAccessData = {
      globalAdminEmail: loaded.globalAdminEmail || '',
      users: loaded.users || {},
      accessRequests: loaded.accessRequests || []
    };
    console.log('User access data loaded:', Object.keys(userAccessData.users).length, 'users');
  } catch (e) {
    console.warn('User access data load failed:', e.message);
  }
}

async function saveUserAccessData() {
  const token = await getToken();
  const url = `https://graph.microsoft.com/v1.0/drives/${CONFIG.driveId}/items/${CONFIG.timesheetFolderItemId}:/${USER_ACCESS_FILE}:/content`;
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(userAccessData, null, 2)
  });
  if (!res.ok) throw new Error(`Save user access failed: ${res.status}`);
  console.log('User access data saved OK');
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
  { key: 'userAccess', label: 'User Access', desc: 'Manage who can access what' },
  { key: 'draftsmanMode', label: 'Draftsman Mode', desc: 'Upload drawings and manage jobs in Projects' }
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
        <div class="job-progress" title="${progress.label}">
          ${['bom','approval','parts','assembly','site'].map((el, i) => {
            const s = progress.elements[el];
            return `<div class="job-progress-dot ${s === 'complete' ? 'complete' : s === 'active' ? 'active' : ''}" title="${['BOM','Approval','Parts','Assembly','Site'][i]}: ${s}"></div>`;
          }).join('')}
        </div>
        <div class="job-badge ${isClosed ? 'closed' : 'open'}">${isClosed ? 'CLOSED' : 'OPEN'}</div>
      </div>
    `;
  }).join('');
}

function getJobProgress(job) {
  const elements = {};
  // BOM: has files = complete, else empty
  elements.bom = (job.bom?.files?.length > 0) ? 'complete' : 'empty';
  // Approval: has an approved CO = complete, has any revision = active
  const revs = job.approval?.revisions || [];
  const hasApprovedCO = revs.some(r => r.type === 'CO');
  elements.approval = hasApprovedCO ? 'complete' : revs.length > 0 ? 'active' : 'empty';
  // Parts: both sections and plates have files = complete, either has = active
  const secFiles = job.parts?.sections?.files?.length || 0;
  const platFiles = job.parts?.plates?.files?.length || 0;
  elements.parts = (secFiles > 0 && platFiles > 0) ? 'complete' : (secFiles > 0 || platFiles > 0) ? 'active' : 'empty';
  // Assembly: all tasks complete = complete, any task = active
  const tasks = job.assembly?.tasks || [];
  const allDone = tasks.length > 0 && tasks.every(t => t.status === 'complete');
  elements.assembly = allDone ? 'complete' : tasks.length > 0 ? 'active' : 'empty';
  // Site: has completedAt = complete, has files = active
  elements.site = job.site?.completedAt ? 'complete' : (job.site?.files?.length > 0) ? 'active' : 'empty';

  const completeCount = Object.values(elements).filter(v => v === 'complete').length;
  return { elements, label: `${completeCount}/5 elements complete` };
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
  renderAllElements();
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
// ELEMENT 1: BOM
// ═══════════════════════════════════════════
function renderBOM() {
  const container = document.getElementById('bomContent');
  if (!container) return;
  const bom = currentJob.bom || { files: [], notes: [] };
  const status = document.getElementById('elementBOMStatus');
  status.textContent = bom.files.length > 0 ? `${bom.files.length} file${bom.files.length>1?'s':''}` : 'Empty';
  status.style.cssText = bom.files.length > 0
    ? 'color:var(--green);background:rgba(62,207,142,.1);padding:3px 10px;border-radius:4px;font-size:11px;font-weight:600'
    : 'color:var(--subtle);font-size:11px;font-weight:600';

  let html = '';

  // Upload button (draftsman only)
  if (isDraftsman && currentJob.status !== 'closed') {
    html += `<button class="btn btn-primary" style="margin-bottom:12px;padding:8px 16px;font-size:12px" onclick="openUploadFileModal('bom')">&#43; Upload File</button>`;
  }

  // File list
  if (bom.files.length > 0) {
    html += bom.files.map(f => renderFileRow(f, 'bom')).join('');
  } else {
    html += '<div style="color:var(--subtle);font-size:13px;padding:12px 0">No BOM files uploaded yet</div>';
  }

  // Notes
  html += renderNotesSection(bom.notes, 'bom');

  container.innerHTML = html;
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
    const stLabel = latestPO.status === 'sent' ? 'Sent' : latestPO.status === 'approved' ? 'Approved' : 'Rejected';
    status.textContent = `PO${latestPO.number} ${stLabel}`;
    const stColor = latestPO.status === 'approved' ? 'var(--green)' : latestPO.status === 'rejected' ? 'var(--red)' : '#60a5fa';
    status.style.cssText = `color:${stColor};background:${latestPO.status === 'approved' ? 'rgba(62,207,142,.1)' : latestPO.status === 'rejected' ? 'rgba(255,68,68,.1)' : 'rgba(59,130,246,.1)'};padding:3px 10px;border-radius:4px;font-size:11px;font-weight:600`;
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
    const badgeClass = rev.status === 'approved' ? 'approved' : rev.status === 'rejected' ? 'rejected' : 'sent';

    html += `<div class="revision-group ${isCurrent ? 'current' : ''} ${isGrayed ? 'grayed' : ''}">
      <div class="revision-header">
        <span class="revision-badge ${badgeClass}">${rev.type}${rev.number}</span>
        <span style="font-size:12px;color:var(--muted)">${rev.status === 'sent' ? 'Sent for Approval' : rev.status === 'approved' ? 'Approved' : 'Not Approved'}</span>
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

  if (site.completedAt) {
    html += `<div style="margin-top:12px;padding:12px;background:rgba(62,207,142,.08);border:1px solid rgba(62,207,142,.2);border-radius:8px;font-size:13px;color:var(--green)">
      &#127919; Site installation completed by ${site.completedBy} on ${new Date(site.completedAt).toLocaleDateString('en-GB')}
    </div>`;
  }

  container.innerHTML = html;
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

  if (!emp.pin) {
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

function checkDraftsmanPin() {
  const pin = document.getElementById('draftsmanPinInput').value;
  const emp = (state.timesheetData.employees || []).find(e => e.name === _pendingDraftsmanUser);

  if (!emp || !emp.pin) {
    document.getElementById('draftsmanPinError').textContent = 'No PIN set for this user';
    return;
  }

  if (pin !== emp.pin) {
    document.getElementById('draftsmanPinError').textContent = 'Incorrect PIN';
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
  // Ensure user entry exists
  if (!userAccessData.users[empName]) {
    userAccessData.users[empName] = {
      permissions: {
        byProject: false, byEmployee: false, clockingInOut: false,
        payroll: false, archive: false, staff: false, holidays: false,
        reports: false, settings: false, userAccess: false, draftsmanMode: false
      }
    };
  }
  userAccessData.users[empName].permissions[permKey] = enabled;

  try {
    await saveUserAccessData();
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
    await saveUserAccessData();
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
  userAccessData.accessRequests.splice(index, 1);
  try {
    await saveUserAccessData();
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

  // Log the request
  if (!userAccessData.accessRequests) userAccessData.accessRequests = [];
  userAccessData.accessRequests.push({
    employeeName: empName,
    reason: reason,
    date: new Date().toISOString().slice(0, 16).replace('T', ' ')
  });

  try {
    await saveUserAccessData();
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
                To grant access, go to Manager → User Access tab and enable the relevant permissions for this user.
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

function closeModal() {
  document.getElementById('confirmModal').classList.remove('active');
}


// ═══════════════════════════════════════════
// INIT
// ═══════════════════════════════════════════
// ═══════════════════════════════════════════
// PAGE DETECTION
// ═══════════════════════════════════════════
const CURRENT_PAGE = (() => {
  const path = window.location.pathname.toLowerCase();
  if (path.includes('manager')) return 'manager';
  if (path.includes('office')) return 'office';
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

  // Build the list of data loads needed for this page
  // Timesheet data is always needed (employees, clockings, entries)
  // Retry up to 3 times if it fails — SharePoint cold starts can be slow
  const loadTimesheetWithRetry = async () => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        await Promise.race([
          loadTimesheetData(),
          new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), attempt === 1 ? 8000 : 12000))
        ]);
        _dataLoadedFromSharePoint = true;
        return; // success
      } catch (e) {
        console.warn(`Timesheet load attempt ${attempt}/3 failed:`, e.message);
        if (attempt < 3) {
          console.log(`Retrying in ${attempt}s...`);
          await new Promise(r => setTimeout(r, attempt * 1000));
        }
      }
    }
    // All attempts failed
    if (!state.timesheetData.employees || state.timesheetData.employees.length === 0) {
      console.warn('No employee data loaded after 3 attempts — app will be read-only until data loads');
    }
  };
  const timesheetPromise = loadTimesheetWithRetry();

  // Projects Excel only needed on kiosk and projects pages
  const projectsPromise = (CURRENT_PAGE === 'index' || CURRENT_PAGE === 'projects')
    ? Promise.race([
        loadProjects(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 8000))
      ]).catch(e => { console.warn('Project load skipped, using fallback:', e.message); state.projects = FALLBACK_PROJECTS; })
    : Promise.resolve();

  // User access needed on manager and office pages
  const userAccessPromise = (CURRENT_PAGE === 'manager' || CURRENT_PAGE === 'office')
    ? Promise.race([
        loadUserAccessData(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 6000))
      ]).catch(e => { console.warn('User access load skipped:', e.message); })
    : Promise.resolve();

  // Office tasks only needed on office page
  const officeTasksPromise = (CURRENT_PAGE === 'office')
    ? Promise.race([
        loadOfficeTasksData(),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout')), 6000))
      ]).catch(e => { console.warn('Office tasks load skipped:', e.message); })
    : Promise.resolve();

  // Run all loads in parallel — they don't depend on each other
  await Promise.all([timesheetPromise, projectsPromise, userAccessPromise, officeTasksPromise]);

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
    // Load job data then re-render tiles with job counts
    loadDrawingsData().then(() => renderProjectTiles()).catch(e => console.warn('Job data load failed:', e.message));
  } else if (CURRENT_PAGE === 'hub') {
    // hub has its own simple rendering
  } else {
    renderHome();
  }
}

init();
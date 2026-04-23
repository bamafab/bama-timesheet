# Templates Module — Integration Guide

A tab-based template editor for Payroll PDF, Attendance Report, and Delivery Notes, with live preview and SharePoint-backed logo upload. All editable fields persist via `/api/settings` under the key `templates`.

## Files in this delivery

| File | Destination |
|------|-------------|
| `templates.html` | Repo root (alongside `manager.html`) |
| `templates-module.js` | Paste into `shared.js` — position below |
| `shared-js-replacements.js` | Three functions to replace in `shared.js` |

---

## Step 1 — Add the new HTML page

Drop `templates.html` into the repo root. No build step needed.

## Step 2 — Update `staticwebapp.config.json`

Add a route so `/templates.html` is served. Behaves the same as `manager.html`:

```json
{
  "route": "/templates.html",
  "allowedRoles": ["anonymous"]
}
```

If your config has a `navigationFallback` with excluded paths, add `/templates.html` alongside `/manager.html`.

## Step 3 — Edit `shared.js`

Six small edits, then paste in two larger blocks.

### 3a. Extend `CURRENT_PAGE` detection

Find (near line 10113):

```js
const CURRENT_PAGE = (() => {
  const path = window.location.pathname.toLowerCase();
  if (path.includes('manager')) return 'manager';
  if (path.includes('office')) return 'office';
  if (path.includes('projects') || path.includes('project')) return 'projects';
  if (path.includes('hub')) return 'hub';
  return 'index';
})();
```

Add the `templates` line **before** the `projects` check (because `templates` and `projects` would both pass a loose match otherwise — specific first):

```js
const CURRENT_PAGE = (() => {
  const path = window.location.pathname.toLowerCase();
  if (path.includes('manager')) return 'manager';
  if (path.includes('office')) return 'office';
  if (path.includes('templates')) return 'templates';
  if (path.includes('projects') || path.includes('project')) return 'projects';
  if (path.includes('hub')) return 'hub';
  return 'index';
})();
```

### 3b. Add Templates permission

Find `PERMISSION_DEFS` (line 6547). Add one entry:

```js
{ key: 'templates', label: 'Templates', desc: 'Edit document templates (payroll PDF, delivery notes)' },
```

Find `PERM_TO_TAB` (line 6561). Add one entry:

```js
templates: 'templates'
```

### 3c. Update the fallback tab order

Find `findFirstAllowedTab` (line 1428). Update the manager branch to include templates:

```js
const tabOrder = CURRENT_PAGE === 'office'
  ? ['dashboard','staff','holidays','project','employee','clockinout','payroll','archive']
  : ['reports','settings','useraccess','templates'];
```

### 3d. Set a session flag on successful manager PIN

Find `checkManagerPin` (line 1334). After the line `currentManagerUser = _pendingManagerUser;` (just before the `_pendingManagerUser = null;`), add:

```js
sessionStorage.setItem('bama_mgr_authed', currentManagerUser);
```

This is the session flag the templates page reads to gate entry. It auto-clears when the browser session ends.

### 3e. Add templates startup to `init()`

Find the page-specific startup block inside `init()` (line 10190 onwards). Add a new branch — I'd suggest placing it right before the `hub` branch:

```js
} else if (CURRENT_PAGE === 'templates') {
  initTemplatesPage();
} else if (CURRENT_PAGE === 'hub') {
```

### 3f. Append the templates module

Paste the entire contents of `templates-module.js` into `shared.js` **immediately before** the `const CURRENT_PAGE = (() => {` line.

### 3g. Replace three existing functions

In `shared.js`, replace these three functions with the versions in `shared-js-replacements.js`:

- `generatePayrollPDF()` — currently ~line 5291
- `exportAttendancePDF()` — currently ~line 4469
- `buildDeliveryNoteHTML(dn, bomJob, proj, job)` — currently ~line 7962

**One behavioural change to be aware of**: `generatePayrollPDF` and `exportAttendancePDF` are now `async` (they await `loadLogoDataUri()` so the logo is embedded as a data URI, not a SharePoint URL that would 401 in the print window). If either is currently called with `onclick="generatePayrollPDF()"` in HTML, that still works — the promise is just fire-and-forget, which is fine for these.

### 3h. Add `await loadLogoDataUri()` in two existing callers

**In `saveDeliveryNotePDFToSharePoint`** (line 8049), find:

```js
const html = buildDeliveryNoteHTML(dn, bomJob, proj, job);
```

Change to:

```js
await loadLogoDataUri();
const html = buildDeliveryNoteHTML(dn, bomJob, proj, job);
```

**In `printDeliveryNote`** (line 8113), find:

```js
const html = buildDeliveryNoteHTML(dn, bomJob, currentProject || {}, currentJob || {});
```

Change to:

```js
await loadLogoDataUri();
const html = buildDeliveryNoteHTML(dn, bomJob, currentProject || {}, currentJob || {});
```

(`printDeliveryNote` is already async.)

## Step 4 — Edit `manager.html`

Add a Templates item to the sidebar. Place it next to Settings — something like:

```html
<button class="sidebar-nav-item" data-tab="templates" onclick="window.location.href='templates.html'">
  <span class="sidebar-icon">📄</span> Templates
</button>
```

The nav click goes to `templates.html` directly (not `switchTab('templates')`) because the editor lives on its own page per your earlier spec. The `data-tab="templates"` attribute lets the existing `filterSidebarTabs` function hide/show it based on permissions — users without the `templates` permission won't see it.

## Step 5 — Grant yourself the permission

First time you open the manager dashboard after deploying:

1. If the bootstrap rule is still active (no one has any permissions yet), you'll automatically get all perms including the new `templates` one.
2. Otherwise go to **User Access** → your user → tick `Templates` → save.

## Step 6 — Syntax-check before deploy

```bash
node --check shared.js
```

---

## How it hangs together at runtime

1. **User clicks Templates tab in manager.html** → `window.location.href = 'templates.html'`
2. **templates.html loads** → shared.js boots → `CURRENT_PAGE === 'templates'` → `init()` loads data → calls `initTemplatesPage()`
3. **`initTemplatesPage()` checks `sessionStorage.bama_mgr_authed`** — if absent (direct URL access without going via manager), shows access-denied screen
4. **Editor renders** — left sidebar is the template list, middle is the edit form, right is a sandboxed iframe with live preview
5. **Every keystroke** triggers `onTemplateFieldInput` → updates draft object → debounces 150 ms → re-renders preview iframe via `iframe.srcdoc`
6. **Save** calls `api.put('/api/settings', { templates: draft })` and merges the result back into `state.timesheetData.settings.templates`
7. **Existing PDF generators** (payroll, attendance, delivery note) now read from `state.timesheetData.settings.templates` via `tplCloneSettings()` inside the core builders — falling back to the hardcoded-identical `TEMPLATE_DEFAULTS` when settings are empty. So a fresh deploy with no edits produces **byte-identical output to today**.

## Logo mechanics

- Upload flow validates PNG + dims + size client-side, then `uploadFileToFolder(CONFIG.timesheetFolderItemId, 'bama-logo.png', file, 'image/png')` — overwrites any existing file
- Stored: only `logoItemId` + `logoUrl` in settings (no base64 bloat)
- At render time: `loadLogoDataUri()` fetches the file from SharePoint with the user's token, converts to base64 data URI, caches in memory for the session. The data URI embeds directly in the print window's HTML so print/PDF works without auth.

## Rollback

The three replaced functions produce byte-identical output when `state.timesheetData.settings.templates` is undefined (the `TEMPLATE_DEFAULTS` mirror the old hardcoded values exactly). If anything goes sideways, you can revert just the three functions without touching anything else — the templates module adds functions but doesn't modify existing ones beyond those three.

## What's not in v1 (and why)

- **Per-document sample data chooser** — preview uses hardcoded realistic samples. Fine for seeing layout/styling changes; not designed for "show me *this* payroll week."
- **History / versioning** — saves overwrite. No undo beyond "Discard changes" before save.
- **Order form / holiday confirmation templates** — those aren't generating documents today per your brief ("Templates will only appear once there's a document we produce"). When they start producing output, add a new block to `TEMPLATE_DEFAULTS` and a new sidebar item — the editor scaffolding is reusable.
- **Multi-language / alternate templates** — single template per document type.

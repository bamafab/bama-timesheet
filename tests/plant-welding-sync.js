// ─────────────────────────────────────────────────────────────────────────────
// tests/plant-welding-sync.js — welding machines inside the plant register (F3)
//
// The migration must not destroy anything. Two foreign keys point at
// WeldingMachines (JobAssemblies.welding_machine_id, in both
// add-job-fabrication.sql and add-staged-fabrication.sql) and the workshop
// kiosk reads /api/welding-machines. So this pins the SAFETY properties of the
// change rather than just its happy path:
//
//   • WeldingMachines is never dropped and its rows are never deleted
//   • deleting a plant item DEACTIVATES the shadow machine, never removes it
//   • the plant list must still load if the migration hasn't run yet
//   • the field mapping is what the migration and the API both use
//
// Run: node tests/plant-welding-sync.js   (exit 1 on any failure)
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');

const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'src', 'functions', 'plant-register.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '..', 'api', 'sql', 'migrate-welding-machines-into-plant.sql'), 'utf8');
const shared = fs.readFileSync(path.join(__dirname, '..', 'shared.js'), 'utf8');

let pass = 0, fail = 0;
const ok = (cond, label, extra = '') => {
  if (cond) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  — ' + extra : '')); }
};

console.log('Nothing is destroyed');
ok(!/DROP\s+TABLE\s+WeldingMachines/i.test(migration), 'migration never drops WeldingMachines');
ok(!/DELETE\s+FROM\s+WeldingMachines/i.test(migration), 'migration never deletes machine rows');
ok(!/DELETE\s+FROM\s+WeldingMachines/i.test(api),       'API never deletes machine rows');
ok(!/DROP\s+COLUMN/i.test(migration),                   'migration drops no columns');
ok(/UPDATE WeldingMachines SET is_active = 0/.test(api),
   'plant soft-delete DEACTIVATES the shadow machine instead of deleting it');
ok(/NEVER delete it/.test(api), 'the reason is documented at the call site for the next reader');
ok(!/DELETE|DROP/i.test((migration.match(/WeldingMachineWelders[\s\S]{0,200}/) || [''])[0]),
   'WeldingMachineWelders (authorised welders) is left alone');

console.log('\nMigration is safe to re-run and ordered correctly');
ok(/COL_LENGTH\('WeldingMachines', 'plant_id'\) IS NULL/.test(migration), 'plant_id add is guarded');
ok(/plant_id IS NULL/.test(migration),            'backfill only touches unlinked machines');
ok(/PlantItems.*RAISERROR|RAISERROR[\s\S]*PlantItems/.test(migration),
   'aborts with a clear error if PlantItems does not exist yet');
ok(/FUNCTION APP RESTART REQUIRED/.test(migration), 'the ALTER restart requirement is stated in the script');
ok(/broken_links/.test(migration), 'verification query checks for broken links');

console.log('\nThe register still works before the migration runs');
ok(!/WeldingMachines[\s\S]{0,80}AS welding_machine_id`/.test(api),
   'the welding link is NOT folded into ITEM_COLS (that would 500 the whole list pre-migration)');
const listBlock = (api.match(/plant-items-list[\s\S]*?^\}\);/m) || [''])[0];
ok(/try\s*\{[\s\S]*WeldingMachines[\s\S]*catch/.test(listBlock),
   'the link lookup is inside its own try/catch');
ok(/migration not run/.test(listBlock), 'the pre-migration case is explained in the warning');
const syncBlock = (api.match(/async function syncWeldingMachine[\s\S]*?^\}/m) || [''])[0];
ok(/catch\s*\(err\)/.test(syncBlock), 'sync failure never fails the plant save');

console.log('\nField mapping agrees between migration and API');
ok(/machine_name/.test(syncBlock) && /machine_name/.test(migration), 'name → machine_name');
ok(/serial_number/.test(syncBlock) && /serial_number/.test(migration), 'serial_no → serial_number');
ok(/expiry_date/.test(syncBlock) && /expiry_date/.test(migration), 'calib_due → expiry_date');
ok(/calib_due/.test(migration), 'migration maps expiry_date back to calib_due');
ok(/is_active/.test(syncBlock), 'status drives is_active');
ok(/disposed/.test(syncBlock) && /off_hired/.test(syncBlock), 'retired statuses deactivate the machine');
ok(/category !== 'welding'/.test(syncBlock), 'only welding-category items shadow a machine');

console.log('\nUI');
ok(!/Welding Equipment\s*\n\s*<\/button>/.test(shared) && !/data-tab="welding"/.test(shared),
   'the Welding Equipment sidebar entry is gone');
ok(/function plantLoadWelders/.test(shared), 'authorised welders are surfaced in the plant modal instead');
ok(/kiosk/.test(shared.slice(shared.indexOf('plantWeldingSection'), shared.indexOf('plantWeldingSection') + 1200)),
   'the modal explains the kiosk relationship to the user');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

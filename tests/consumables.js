// ─────────────────────────────────────────────────────────────────────────────
// tests/consumables.js — stock state, reorder suggestions, tally sheet grouping
//
// A wrong answer here either runs the shop out of welding wire or orders wire it
// doesn't need, so the boundaries are pinned exactly. Also pinned: stock is
// derived from the ledger (never a stored total) and nothing auto-orders.
//
// Run: node tests/consumables.js   (exit 1 on any failure)
// ─────────────────────────────────────────────────────────────────────────────
const fs = require('fs');
const path = require('path');
const shared = fs.readFileSync(path.join(__dirname, '..', 'shared.js'), 'utf8');
const api = fs.readFileSync(path.join(__dirname, '..', 'api', 'src', 'functions', 'consumables.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '..', 'api', 'sql', 'create-consumables.sql'), 'utf8');
const block = shared.slice(shared.indexOf('// CONSUMABLES (2026-07-30)'));
eval(block.replace(/^const CONS_/gm, 'var CONS_').replace(/^let _cons/gm, 'var _cons'));

let pass = 0, fail = 0;
const ok = (c, label, extra = '') => {
  if (c) { pass++; console.log('  ✓ ' + label); }
  else { fail++; console.log('  ✗ ' + label + (extra ? '  — ' + extra : '')); }
};
const item = o => ({ stock: 10, reorder_level: 5, reorder_qty: 20, on_order: 0, is_active: 1, category: 'wire', item_code: 'CON-001', ...o });

console.log('Stock state boundaries');
ok(consStockState(item({ stock: 10, reorder_level: 5 })).cls === 'ok',   'comfortably above the level → ok');
ok(consStockState(item({ stock: 5,  reorder_level: 5 })).cls === 'low',  'exactly AT the level counts as low, not ok');
ok(consStockState(item({ stock: 4.9, reorder_level: 5 })).cls === 'low', 'just below → low');
ok(consStockState(item({ stock: 0 })).cls === 'out',                     'zero → out of stock');
ok(consStockState(item({ stock: -2 })).cls === 'out',                    'negative stock (over-issued) → out, not ok');
ok(consStockState(item({ stock: 10, reorder_level: null })).cls === 'nolevel', 'no reorder level → says so rather than guessing');
ok(consStockState(item({ stock: 10, reorder_level: '' })).cls === 'nolevel',   'empty reorder level treated the same');
ok(consStockState(item({ stock: null })).cls === 'unknown',              'no stock figure → unknown, never "in stock"');
ok(consStockState(item({ stock: 'abc' })).cls === 'unknown',             'garbage stock → unknown');
ok(consStockState(item({ stock: 3, reorder_level: 5 })).short === 2,     'shortfall reported');
ok(consStockState(item({ stock: 0, reorder_level: 5 })).short === 5,     'out of stock shortfall is the full level');

console.log('\nReorder suggestions');
ok(consSuggestReorder(item({ stock: 10, reorder_level: 5 })) === null, 'nothing suggested when in stock');
ok(consSuggestReorder(item({ stock: 4, reorder_level: 5, reorder_qty: 20 })) === 20, 'uses the set reorder quantity');
ok(consSuggestReorder(item({ stock: 0, reorder_level: 5, reorder_qty: 20 })) === 20, 'out of stock suggests the same');
ok(consSuggestReorder(item({ stock: 4, reorder_level: 5, on_order: 20 })) === null,
   'nothing suggested when already on order — no double ordering');
ok(consSuggestReorder(item({ stock: 4, reorder_level: 5, reorder_qty: null })) === 6,
   'no reorder qty set → tops up to twice the level', String(consSuggestReorder(item({ stock: 4, reorder_level: 5, reorder_qty: null }))));
ok(consSuggestReorder(item({ stock: 10, reorder_level: null })) === null, 'no level → no suggestion, never a guess');
ok(consSuggestReorder(item({ stock: null })) === null, 'unknown stock → no suggestion');
ok(consSuggestReorder(item({ stock: 4.5, reorder_level: 5, reorder_qty: null })) === 6,
   'partial quantities round UP to a whole unit', String(consSuggestReorder(item({ stock: 4.5, reorder_level: 5, reorder_qty: null }))));

console.log('\nTally sheet grouping');
const cat = [
  item({ item_code: 'CON-003', category: 'gas' }),
  item({ item_code: 'CON-001', category: 'wire' }),
  item({ item_code: 'CON-002', category: 'wire' }),
  item({ item_code: 'CON-009', category: 'ppe', is_active: 0 })
];
const groups = consSheetGroups(cat);
ok(groups.length === 2, 'retired items are left off the sheet', String(groups.length));
ok(groups[0].category === 'wire', 'categories come out in the catalogue order, not alphabetical');
ok(groups[0].items.map(i => i.item_code).join(',') === 'CON-001,CON-002', 'items sorted by code within a category');
ok(groups.every(g => g.label), 'every group has a human label');
ok(consSheetGroups([]).length === 0, 'empty catalogue → no groups, no throw');
ok(consSheetGroups(null).length === 0, 'null catalogue → no throw');

console.log('\nStock is derived, never stored');
ok(!/current_stock/.test(migration), 'no stored stock column exists to drift');
ok(/STOCK IS DERIVED/i.test(migration), 'the migration states the rule');
ok(/opening_qty/.test(migration), 'opening balance is a starting point, not a running total');
ok(/SUM\(m\.qty\)[\s\S]{0,200}direction = 'in'/.test(api), 'the API sums the ledger in');
ok(/direction = 'out'/.test(api), 'and out');
ok(/AS stock/.test(api), 'and returns it as a derived field');
ok(/opening_qty\s*\n?\s*\+ ISNULL/.test(api), 'opening balance is included');

console.log('\nNothing auto-orders');
ok(/NOTHING AUTO-ORDERS/i.test(api) || /NOTHING AUTO-ORDERS/i.test(migration), 'the rule is documented');
ok(/'basket', 'approved', 'ordered', 'cancelled'/.test(api), 'a reorder must pass through approval');
ok(/status === 'approved'[\s\S]{0,160}approved_by/.test(api), 'approval records who took responsibility');
ok(/Already in the basket/.test(api), 'the same item cannot be stacked in the basket twice');
ok(!/auto.?creat|autoOrder|createPo\(/i.test(api), 'no code path creates a PO by itself');

console.log('\nLedger integrity');
ok(/qty must be greater than zero/.test(api), 'zero or negative movements are rejected');
ok(/direction must be 'in' or 'out'/.test(api), 'direction is validated');
ok(/Partial success is reported/i.test(api), 'a bad line on a paper sheet does not discard the good ones');
ok(/failures\.push/.test(api), 'and the failures come back with line numbers');
ok(/Movements are left alone/.test(api), 'retiring an item keeps its issue history true');

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);

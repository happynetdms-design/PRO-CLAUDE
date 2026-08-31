// Mirrors statement-extraction.js's sanitizeRows(). Run with plain `node`.

const MAX_ROWS = 200;
function sanitizeRows(rawRows){
  const rows = [], dropped = [];
  for(const r of (rawRows || []).slice(0, MAX_ROWS)){
    const date = typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null;
    const amount = Number(r.amount_kes);
    const direction = r.direction === 'inflow' || r.direction === 'outflow' ? r.direction : null;
    if(!date || !isFinite(amount) || amount <= 0 || !direction){
      dropped.push(r);
      continue;
    }
    rows.push({ date, amount_kes: amount, direction, description: typeof r.description === 'string' ? r.description.slice(0,200) : '' });
  }
  return { rows, dropped };
}

let failed = false;
function check(label, actual, expected){
  const ok = actual === expected;
  console.log(`${ok?'PASS':'FAIL'} — ${label}`);
  if(!ok) failed = true;
}

console.log('=== Case 1: all valid rows pass through unchanged ===');
const r1 = sanitizeRows([
  { date:'2026-08-01', amount_kes:42000, direction:'inflow', description:'Daily deposit' },
  { date:'2026-08-01', amount_kes:65000, direction:'outflow', description:'Supplier payment' }
]);
check('both rows kept, none dropped', r1.rows.length === 2 && r1.dropped.length === 0, true);
console.log('');

console.log('=== Case 2: missing/malformed date is dropped, not defaulted ===');
const r2 = sanitizeRows([{ date:'not a date', amount_kes:5000, direction:'inflow' }]);
check('bad date row dropped', r2.rows.length === 0 && r2.dropped.length === 1, true);
console.log('');

console.log('=== Case 3: non-numeric or negative amount is dropped ===');
const r3 = sanitizeRows([
  { date:'2026-08-01', amount_kes:'not a number', direction:'inflow' },
  { date:'2026-08-01', amount_kes:-500, direction:'outflow' },
  { date:'2026-08-01', amount_kes:0, direction:'outflow' }
]);
check('all three invalid-amount rows dropped', r3.rows.length === 0 && r3.dropped.length === 3, true);
console.log('');

console.log('=== Case 4: invalid direction value is dropped, never guessed ===');
const r4 = sanitizeRows([{ date:'2026-08-01', amount_kes:1000, direction:'sideways' }]);
check('bad direction dropped', r4.rows.length === 0 && r4.dropped.length === 1, true);
console.log('');

console.log('=== Case 5: a mix — good rows kept, bad rows dropped, counts both correct ===');
const r5 = sanitizeRows([
  { date:'2026-08-01', amount_kes:42000, direction:'inflow' },
  { date:'bad', amount_kes:100, direction:'inflow' },
  { date:'2026-08-02', amount_kes:38500, direction:'inflow' },
  { date:'2026-08-03', amount_kes:-1, direction:'outflow' }
]);
check('2 good rows kept, 2 bad rows dropped', r5.rows.length === 2 && r5.dropped.length === 2, true);
console.log('');

console.log('=== Case 6: MAX_ROWS ceiling is respected ===');
const manyRows = Array.from({length: 250}, (_, i) => ({ date:'2026-08-01', amount_kes: 100+i, direction:'inflow' }));
const r6 = sanitizeRows(manyRows);
check('capped at 200 even though 250 were provided', r6.rows.length + r6.dropped.length, 200);
console.log('');

console.log('=== Case 7: description longer than 200 chars is truncated, not rejected ===');
const longDesc = 'x'.repeat(500);
const r7 = sanitizeRows([{ date:'2026-08-01', amount_kes:1000, direction:'inflow', description: longDesc }]);
check('description truncated to 200 chars', r7.rows[0] && r7.rows[0].description.length, 200);
console.log('');

if(failed){ console.log('SOME CHECKS FAILED.'); process.exit(1); }
console.log('ALL CHECKS PASS — malformed rows are dropped individually, never guessed or defaulted, and a runaway extraction is capped.');

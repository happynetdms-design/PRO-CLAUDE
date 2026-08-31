// Mirrors financial-statements.js's periodBounds()/priorPeriod()/
// periodLabel(). Run with plain `node`.

function monthBounds(period){
  const [y, m] = period.split('-').map(Number);
  const first = `${period}-01`;
  const last = new Date(y, m, 0).toISOString().slice(0, 10);
  return [first, last];
}
function periodBounds(period, periodType){
  if(periodType === 'year'){ const y = Number(period); return [`${y}-01-01`, `${y}-12-31`]; }
  if(periodType === 'quarter'){
    const [yStr, qStr] = period.split('-Q');
    const y = Number(yStr), q = Number(qStr);
    const startMonth = (q - 1) * 3 + 1;
    const first = `${y}-${String(startMonth).padStart(2,'0')}-01`;
    const last = new Date(y, startMonth + 2, 0).toISOString().slice(0, 10);
    return [first, last];
  }
  return monthBounds(period);
}
function priorPeriod(period, periodType){
  if(periodType === 'year') return String(Number(period) - 1);
  if(periodType === 'quarter'){
    const [yStr, qStr] = period.split('-Q');
    let y = Number(yStr), q = Number(qStr) - 1;
    if(q < 1){ q = 4; y -= 1; }
    return `${y}-Q${q}`;
  }
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

let failed = false;
function check(label, actual, expected){
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}: got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  if(!ok) failed = true;
}

console.log('=== Quarter bounds ===');
check('Q1 2026', periodBounds('2026-Q1','quarter'), ['2026-01-01','2026-03-31']);
check('Q2 2026', periodBounds('2026-Q2','quarter'), ['2026-04-01','2026-06-30']);
check('Q3 2026', periodBounds('2026-Q3','quarter'), ['2026-07-01','2026-09-30']);
check('Q4 2026', periodBounds('2026-Q4','quarter'), ['2026-10-01','2026-12-31']);
console.log('');

console.log('=== Year bounds ===');
check('year 2026', periodBounds('2026','year'), ['2026-01-01','2026-12-31']);
check('leap year 2028', periodBounds('2028','year'), ['2028-01-01','2028-12-31']);
console.log('');

console.log('=== Prior period rollover (the part that is easy to get wrong) ===');
check('Q1 2026 -> prior', priorPeriod('2026-Q1','quarter'), '2025-Q4');
check('Q3 2026 -> prior', priorPeriod('2026-Q3','quarter'), '2026-Q2');
check('year 2026 -> prior', priorPeriod('2026','year'), '2025');
check('Jan 2026 -> prior', priorPeriod('2026-01','month'), '2025-12');
check('Aug 2026 -> prior', priorPeriod('2026-08','month'), '2026-07');
console.log('');

console.log('=== Quarter -> month equivalence (Q3 2026 should exactly span Jul-Sep) ===');
const [qStart, qEnd] = periodBounds('2026-Q3', 'quarter');
const [julStart] = monthBounds('2026-07');
const [, sepEnd] = monthBounds('2026-09');
check('Q3 start == July start', qStart, julStart);
check('Q3 end == September end', qEnd, sepEnd);
console.log('');

if(failed){ console.log('SOME CHECKS FAILED.'); process.exit(1); }
console.log('ALL CHECKS PASS.');

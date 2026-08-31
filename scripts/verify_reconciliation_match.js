// Mirrors hfms_auto_match_statement()'s exact matching logic. Run with
// plain `node` — no database needed.

// Ledger side (financial_transactions) — what's actually recorded
const ledger = [
  { id: 'ft1', date: '2026-08-01', amount: 42000, direction: 'inflow' },   // revenue day 1
  { id: 'ft2', date: '2026-08-02', amount: 38500, direction: 'inflow' },   // revenue day 2
  { id: 'ft3', date: '2026-08-01', amount: 65120, direction: 'outflow' },  // expense (gross+charges)
  { id: 'ft4', date: '2026-08-05', amount: 20000, direction: 'outflow' },  // loan repayment
];

// Bank statement side — what the real M-Pesa/bank statement shows.
// Includes: two exact matches, one amount that matches but wrong date (should NOT auto-match),
// one genuinely missing from the ledger (should stay unmatched — this is the whole point
// of reconciliation: catching a deposit nobody logged as revenue).
const statement = [
  { id: 'sl1', date: '2026-08-01', amount: 42000, direction: 'inflow' },   // exact match -> ft1
  { id: 'sl2', date: '2026-08-01', amount: 65120, direction: 'outflow' },  // exact match -> ft3
  { id: 'sl3', date: '2026-08-06', amount: 20000, direction: 'outflow' },  // same amount as ft4 but wrong date -> should NOT auto-match
  { id: 'sl4', date: '2026-08-09', amount: 15000, direction: 'inflow' },   // genuinely not in the ledger -> should stay unmatched
];

function autoMatch(statementLines, ledgerLines){
  const claimed = new Set();
  const results = [];
  for(const line of statementLines){
    const match = ledgerLines.find(ft =>
      !claimed.has(ft.id) &&
      ft.date === line.date && ft.amount === line.amount && ft.direction === line.direction
    );
    if(match){
      claimed.add(match.id);
      results.push({ line: line.id, status: 'matched', matched_to: match.id });
    } else {
      results.push({ line: line.id, status: 'unmatched' });
    }
  }
  return results;
}

const results = autoMatch(statement, ledger);
console.log('Auto-match results:');
results.forEach(r => console.log(`  ${r.line}: ${r.status}${r.matched_to ? ' -> ' + r.matched_to : ''}`));
console.log('');

const expected = {
  sl1: { status: 'matched', matched_to: 'ft1' },
  sl2: { status: 'matched', matched_to: 'ft3' },
  sl3: { status: 'unmatched' },  // amount matches ft4 but date doesn't — must NOT match
  sl4: { status: 'unmatched' },  // genuinely missing from the ledger
};

let failed = false;
for(const r of results){
  const exp = expected[r.line];
  if(r.status !== exp.status || (exp.matched_to && r.matched_to !== exp.matched_to)){
    console.log(`FAILED: ${r.line} expected ${JSON.stringify(exp)}, got ${JSON.stringify(r)}`);
    failed = true;
  }
}
if(failed){ process.exit(1); }
console.log('PASS — exact matches found correctly, near-miss (wrong date) correctly left unmatched, genuinely missing transaction correctly flagged unmatched.');
console.log('');

// Also verify: a ledger transaction can never be claimed by two statement
// lines (no double-matching), even if two statement lines have identical
// amount/date/direction.
const dupStatement = [
  { id: 'd1', date: '2026-08-01', amount: 42000, direction: 'inflow' },
  { id: 'd2', date: '2026-08-01', amount: 42000, direction: 'inflow' }, // same as d1 — only ONE should match ft1
];
const dupResults = autoMatch(dupStatement, ledger);
const matchedCount = dupResults.filter(r => r.status === 'matched').length;
console.log('Duplicate-claim test:', JSON.stringify(dupResults));
if(matchedCount !== 1){
  console.log(`FAILED — expected exactly 1 match (one ledger transaction can't be claimed twice), got ${matchedCount}.`);
  process.exit(1);
}
console.log('PASS — a ledger transaction is never claimed by more than one statement line.');
console.log('');
console.log('ALL CHECKS PASS.');

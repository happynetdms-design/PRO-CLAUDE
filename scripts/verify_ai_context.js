// Mirrors ai-assistant.js's optional ledger-derived sections. Run with
// plain `node`.

function safe(value, shouldFail){ return shouldFail ? null : value; }

function buildOptionalSections(ledgerAllTime, apAging, recentAllocations){
  const summary = {};
  if(ledgerAllTime){
    summary.cash_position_kes = ledgerAllTime.reduce((s,t)=>s+Number(t.net_amount_kes)*(t.direction==='inflow'?1:-1), 0);
  }
  if(apAging){
    summary.accounts_payable = {
      outstanding_kes: apAging.reduce((s,a)=>s+Number(a.outstanding_kes),0),
      overdue_kes: apAging.filter(a=>a.aging_bucket!=='current').reduce((s,a)=>s+Number(a.outstanding_kes),0)
    };
  }
  if(recentAllocations && recentAllocations.length){
    summary.recent_profit_first_allocations = recentAllocations.map(a => ({
      period: a.period, bucket: a.bucket, amount_kes: Number(a.amount_kes), approved: !!a.approved_at
    }));
  }
  return summary;
}

console.log('=== Case 1: everything available (foundation-fix SQL fully deployed) ===');
const ledger = [
  { direction:'inflow', net_amount_kes: 276600 },
  { direction:'outflow', net_amount_kes: 115675 },
  { direction:'inflow', net_amount_kes: 500000 },  // loan funding
  { direction:'outflow', net_amount_kes: 20000 },  // loan repayment
];
const aging = [
  { outstanding_kes: 8500, aging_bucket: 'current' },
  { outstanding_kes: 12000, aging_bucket: '1-30' }
];
const allocations = [{ period:'2026-07-01', bucket:'profit', amount_kes:57500, approved_at:'2026-08-01' }];

const full = buildOptionalSections(ledger, aging, allocations);
console.log(JSON.stringify(full, null, 2));
const expectedCash = 276600 - 115675 + 500000 - 20000;
if(full.cash_position_kes !== expectedCash){ console.log(`FAILED — expected cash position ${expectedCash}`); process.exit(1); }
if(full.accounts_payable.outstanding_kes !== 20500 || full.accounts_payable.overdue_kes !== 12000){ console.log('FAILED — AP math wrong'); process.exit(1); }
if(full.recent_profit_first_allocations[0].approved !== true){ console.log('FAILED — approved flag wrong'); process.exit(1); }
console.log('PASS — all optional sections computed correctly.');
console.log('');

console.log('=== Case 2: AP tables not deployed yet (graceful degradation) ===');
const partial = buildOptionalSections(ledger, safe(aging, true), allocations);
console.log(JSON.stringify(partial, null, 2));
if('accounts_payable' in partial){ console.log('FAILED — accounts_payable should be entirely omitted, not present with empty/null values.'); process.exit(1); }
if(!('cash_position_kes' in partial)){ console.log('FAILED — cash_position_kes should still be present since that data IS available.'); process.exit(1); }
console.log('PASS — missing data source is cleanly omitted, available ones are unaffected.');
console.log('');

console.log('=== Case 3: nothing but the base data deployed yet ===');
const minimal = buildOptionalSections(safe(ledger, true), safe(aging, true), safe(allocations, true));
console.log(JSON.stringify(minimal, null, 2));
if(Object.keys(minimal).length !== 0){ console.log('FAILED — should be an empty object, not error, when no optional source is available.'); process.exit(1); }
console.log('PASS — falls back to the base (non-ledger) summary with no crash.');
console.log('');
console.log('ALL CHECKS PASS.');

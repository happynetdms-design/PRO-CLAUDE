// Mirrors executive-dashboard.js's runway, growth, and risk-flag math.
// Run with plain `node`.

// ---- Revenue growth % ----
function growthPct(current, previous){
  return previous > 0 ? Number((((current - previous) / previous) * 100).toFixed(1)) : null;
}
console.log('=== Revenue growth ===');
const g1 = growthPct(276600, 232000); // up
const g2 = growthPct(180000, 240000); // down
const g3 = growthPct(50000, 0);       // no prior data
console.log(`276,600 vs 232,000 -> ${g1}% (expect +19.2)`);
console.log(`180,000 vs 240,000 -> ${g2}% (expect -25.0)`);
console.log(`50,000 vs 0 -> ${g3} (expect null, can't compute growth from zero)`);
if(g1 !== 19.2 || g2 !== -25 || g3 !== null){ console.log('FAILED'); process.exit(1); }
console.log('PASS');
console.log('');

// ---- Cash runway ----
function runway(cashPosition, monthlyNets){
  const avg = monthlyNets.reduce((s,n)=>s+n,0) / monthlyNets.length;
  return avg < 0 && cashPosition > 0 ? Number((cashPosition / Math.abs(avg)).toFixed(1)) : null;
}
console.log('=== Cash runway ===');
// Burning KES 50,000/month average, KES 300,000 cash on hand -> 6 months
const r1 = runway(300000, [-40000, -60000, -50000]);
console.log(`KES 300,000 cash, burning avg 50,000/mo -> ${r1} months (expect 6.0)`);
if(r1 !== 6.0){ console.log('FAILED'); process.exit(1); }
// Profitable (positive net) -> no runway concern, should be null not a scary number
const r2 = runway(300000, [40000, 60000, 50000]);
console.log(`Profitable (positive net) -> ${r2} (expect null, not a runway concern)`);
if(r2 !== null){ console.log('FAILED — should not compute a runway when cash flow is positive.'); process.exit(1); }
console.log('PASS');
console.log('');

// ---- Risk flags ----
function computeRisks({ cashRunwayMonths, apOverdue, ledgerDiff, operatingResult }){
  const risks = [];
  if(cashRunwayMonths !== null && cashRunwayMonths < 3) risks.push('critical:runway');
  if(apOverdue > 0) risks.push('warning:ap_overdue');
  if(Math.abs(ledgerDiff) > 0.01) risks.push('critical:ledger_imbalance');
  if(operatingResult < 0) risks.push('warning:operating_loss');
  return risks;
}
console.log('=== Risk flags ===');
const healthy = computeRisks({ cashRunwayMonths: 8, apOverdue: 0, ledgerDiff: 0, operatingResult: 50000 });
const struggling = computeRisks({ cashRunwayMonths: 1.5, apOverdue: 12000, ledgerDiff: 0, operatingResult: -8000 });
const broken = computeRisks({ cashRunwayMonths: 8, apOverdue: 0, ledgerDiff: 150, operatingResult: 50000 });
console.log(`Healthy business -> ${JSON.stringify(healthy)} (expect [])`);
console.log(`Struggling business -> ${JSON.stringify(struggling)} (expect 3 risks)`);
console.log(`Balanced-books-error -> ${JSON.stringify(broken)} (expect ledger imbalance flagged)`);
if(healthy.length !== 0){ console.log('FAILED — healthy business should have no risk flags.'); process.exit(1); }
if(struggling.length !== 3){ console.log('FAILED — struggling business should flag all 3 issues.'); process.exit(1); }
if(!broken.includes('critical:ledger_imbalance')){ console.log('FAILED — ledger imbalance must always be flagged, it invalidates everything else.'); process.exit(1); }
console.log('PASS');
console.log('');
console.log('ALL CHECKS PASS.');

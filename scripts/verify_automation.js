// Mirrors automation.js's threshold checks and the idempotency guarantee
// from the (branch_id, alert_key, status) unique constraint. Run with
// plain `node`.

function checkNegativeCash(allTimeTxns){
  const cash = allTimeTxns.reduce((s,t)=>s+Number(t.net_amount_kes)*(t.direction==='inflow'?1:-1), 0);
  return cash < 0 ? { key:'negative_cash', message:`Cash position is negative: KES ${cash.toLocaleString()}.` } : null;
}
function checkNegativeResult(monthTxns){
  const revenue = monthTxns.filter(t=>t.transaction_type==='revenue').reduce((s,t)=>s+Number(t.net_amount_kes),0);
  const expense = monthTxns.filter(t=>t.transaction_type==='expense').reduce((s,t)=>s+Number(t.net_amount_kes),0);
  return (revenue > 0 && expense > revenue) ? { key:'negative_result_this_month', revenue, expense } : null;
}
function checkApOverdue(apAging){
  const overdue = apAging.filter(a=>a.aging_bucket!=='current').reduce((s,a)=>s+Number(a.outstanding_kes),0);
  return overdue > 0 ? { key:'ap_overdue', overdue } : null;
}
function checkLedgerImbalance(tbRows){
  const diff = tbRows.reduce((s,r)=>s+Number(r.total_debit_kes)-Number(r.total_credit_kes),0);
  return Math.abs(diff) > 0.01 ? { key:'ledger_imbalance', diff } : null;
}

console.log('=== Threshold checks ===');
const cashOk = checkNegativeCash([{direction:'inflow',net_amount_kes:100000},{direction:'outflow',net_amount_kes:40000}]);
const cashBad = checkNegativeCash([{direction:'inflow',net_amount_kes:40000},{direction:'outflow',net_amount_kes:100000}]);
console.log(`Healthy cash (+60,000) -> ${cashOk ? 'ALERT (wrong!)' : 'no alert'} (expect no alert)`);
console.log(`Negative cash (-60,000) -> ${cashBad ? 'ALERT: ' + cashBad.message : 'no alert (wrong!)'}`);
if(cashOk !== null || cashBad === null){ console.log('FAILED'); process.exit(1); }

const resultOk = checkNegativeResult([{transaction_type:'revenue',net_amount_kes:200000},{transaction_type:'expense',net_amount_kes:150000}]);
const resultBad = checkNegativeResult([{transaction_type:'revenue',net_amount_kes:100000},{transaction_type:'expense',net_amount_kes:150000}]);
console.log(`Revenue > expense -> ${resultOk ? 'ALERT (wrong!)' : 'no alert'} (expect no alert)`);
console.log(`Expense > revenue -> ${resultBad ? 'ALERT correctly raised' : 'no alert (wrong!)'}`);
if(resultOk !== null || resultBad === null){ console.log('FAILED'); process.exit(1); }

const apOk = checkApOverdue([{outstanding_kes:5000, aging_bucket:'current'}]);
const apBad = checkApOverdue([{outstanding_kes:5000, aging_bucket:'current'},{outstanding_kes:12000, aging_bucket:'1-30'}]);
console.log(`All AP current -> ${apOk ? 'ALERT (wrong!)' : 'no alert'} (expect no alert)`);
console.log(`Some AP overdue -> ${apBad ? 'ALERT correctly raised (KES ' + apBad.overdue.toLocaleString() + ')' : 'no alert (wrong!)'}`);
if(apOk !== null || apBad === null || apBad.overdue !== 12000){ console.log('FAILED'); process.exit(1); }

const tbOk = checkLedgerImbalance([{total_debit_kes:100000, total_credit_kes:100000}]);
const tbBad = checkLedgerImbalance([{total_debit_kes:100000, total_credit_kes:99850}]);
console.log(`Balanced ledger -> ${tbOk ? 'ALERT (wrong!)' : 'no alert'} (expect no alert)`);
console.log(`Imbalanced ledger -> ${tbBad ? 'ALERT correctly raised (off by ' + tbBad.diff + ')' : 'no alert (wrong!)'}`);
if(tbOk !== null || tbBad === null){ console.log('FAILED'); process.exit(1); }
console.log('PASS — every threshold check fires only when it genuinely should.');
console.log('');

// ---- Idempotency simulation: mirrors the upsert with
// onConflict:'branch_id,alert_key,status', ignoreDuplicates:true ----
console.log('=== Idempotency (re-scanning doesn\'t duplicate an open alert) ===');
const alerts = []; // simulates the hfms_alerts table
function upsertAlert(branchId, key, status){
  const exists = alerts.find(a => a.branch_id===branchId && a.alert_key===key && a.status===status);
  if(exists) return false; // ignoreDuplicates — no-op, matches real upsert behavior
  alerts.push({ branch_id: branchId, alert_key: key, status });
  return true;
}
const scan1 = upsertAlert('b1', 'ap_overdue', 'open');
const scan2 = upsertAlert('b1', 'ap_overdue', 'open'); // same issue, still open — re-scan should NOT duplicate
const scan3 = upsertAlert('b1', 'ap_overdue', 'open'); // scanning a third time — still no duplicate
console.log(`First scan raises alert: ${scan1} (expect true)`);
console.log(`Second scan (still open): ${scan2} (expect false — no duplicate)`);
console.log(`Third scan (still open): ${scan3} (expect false — no duplicate)`);
console.log(`Total alert rows for this issue: ${alerts.filter(a=>a.branch_id==='b1'&&a.alert_key==='ap_overdue').length} (expect 1)`);
if(scan1 !== true || scan2 !== false || scan3 !== false || alerts.length !== 1){
  console.log('FAILED — re-scanning should never create duplicate open alerts.');
  process.exit(1);
}
console.log('PASS — repeated scans never duplicate an already-open alert.');
console.log('');
console.log('ALL CHECKS PASS.');

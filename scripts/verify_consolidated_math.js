// Mirrors financial-statements-consolidated.js's aggregation logic. Run
// with plain `node`.

function aggregateConsolidated(branches, journalLines){
  const byBranch = {};
  for(const b of branches) byBranch[b.id] = { branch_id: b.id, name: b.name, revenue_kes: 0, expense_kes: 0 };

  for(const l of journalLines){
    if(!byBranch[l.branch_id]) continue;
    if(l.account_type === 'revenue') byBranch[l.branch_id].revenue_kes += l.credit_kes - l.debit_kes;
    else if(l.account_type === 'expense') byBranch[l.branch_id].expense_kes += l.debit_kes - l.credit_kes;
  }

  const branchResults = Object.values(byBranch).map(b => ({
    ...b, operating_result_kes: b.revenue_kes - b.expense_kes
  }));
  const total = branchResults.reduce((s,b) => ({
    revenue_kes: s.revenue_kes + b.revenue_kes,
    expense_kes: s.expense_kes + b.expense_kes,
    operating_result_kes: s.operating_result_kes + b.operating_result_kes
  }), { revenue_kes:0, expense_kes:0, operating_result_kes:0 });

  return { branchResults, total };
}

const branches = [
  { id: 'main', name: 'Main Branch' },
  { id: 'kisumu', name: 'Kisumu Branch' },
  { id: 'nakuru', name: 'Nakuru Branch' }
];

const lines = [
  { branch_id:'main', account_type:'revenue', debit_kes:0, credit_kes:276600 },
  { branch_id:'main', account_type:'expense', debit_kes:115675, credit_kes:0 },
  { branch_id:'kisumu', account_type:'revenue', debit_kes:0, credit_kes:198400 },
  { branch_id:'kisumu', account_type:'expense', debit_kes:104200, credit_kes:0 },
  { branch_id:'nakuru', account_type:'revenue', debit_kes:0, credit_kes:0 }, // no activity this period
];

const { branchResults, total } = aggregateConsolidated(branches, lines);

console.log('=== Per-branch results ===');
branchResults.forEach(b => console.log(` ${b.name}: revenue ${b.revenue_kes.toLocaleString()}, expense ${b.expense_kes.toLocaleString()}, result ${b.operating_result_kes.toLocaleString()}`));
console.log('');
console.log('=== Consolidated total ===');
console.log(`Revenue: ${total.revenue_kes.toLocaleString()}, Expense: ${total.expense_kes.toLocaleString()}, Operating Result: ${total.operating_result_kes.toLocaleString()}`);
console.log('');

let failed = false;
function check(label, actual, expected){
  const ok = Math.abs(actual - expected) < 0.01;
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}: got ${actual}, expected ${expected}`);
  if(!ok) failed = true;
}

check('Main Branch revenue', branchResults.find(b=>b.branch_id==='main').revenue_kes, 276600);
check('Kisumu Branch revenue', branchResults.find(b=>b.branch_id==='kisumu').revenue_kes, 198400);
check('Nakuru Branch has zero activity, not an error', branchResults.find(b=>b.branch_id==='nakuru').revenue_kes, 0);
check('Total revenue == sum of branches', total.revenue_kes, 276600 + 198400 + 0);
check('Total expense == sum of branches', total.expense_kes, 115675 + 104200 + 0);
check('Total operating result == sum of branches', total.operating_result_kes, (276600-115675) + (198400-104200) + 0);

console.log('');
if(failed){ console.log('SOME CHECKS FAILED.'); process.exit(1); }
console.log('ALL CHECKS PASS — every branch total is correctly isolated, and the consolidated total is exactly their sum.');

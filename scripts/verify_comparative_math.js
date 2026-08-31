// Mirrors financial-statements.js's comparative-period calculation. Run
// with plain `node`.

function pctChange(curr, prev){
  return prev !== 0 ? Number((((curr-prev)/Math.abs(prev))*100).toFixed(1)) : null;
}
function comparative(currRevenue, currExpense, prevRevenue, prevExpense){
  const currResult = currRevenue - currExpense;
  const prevResult = prevRevenue - prevExpense;
  return {
    revenue_kes: Number((currRevenue - prevRevenue).toFixed(2)), revenue_pct: pctChange(currRevenue, prevRevenue),
    expense_kes: Number((currExpense - prevExpense).toFixed(2)), expense_pct: pctChange(currExpense, prevExpense),
    operating_result_kes: Number((currResult - prevResult).toFixed(2)), operating_result_pct: pctChange(currResult, prevResult)
  };
}

console.log('=== Case 1: revenue grew, expenses grew slower (a healthy month) ===');
const c1 = comparative(276600, 115675, 232000, 108000);
console.log(JSON.stringify(c1, null, 2));
if(c1.revenue_kes !== Number((276600-232000).toFixed(2))){ console.log('FAILED'); process.exit(1); }
if(c1.revenue_pct <= 0){ console.log('FAILED — revenue grew, variance should be positive.'); process.exit(1); }
console.log('PASS — variance and percentage both correctly positive.');
console.log('');

console.log('=== Case 2: comparing against a period with zero revenue (new branch, first month) ===');
const c2 = comparative(50000, 20000, 0, 0);
console.log(JSON.stringify(c2, null, 2));
if(c2.revenue_pct !== null || c2.expense_pct !== null){
  console.log('FAILED — percentage change from zero is undefined and must be null, not Infinity or a fabricated number.');
  process.exit(1);
}
if(c2.revenue_kes !== 50000){ console.log('FAILED — absolute variance should still compute even when percentage cannot.'); process.exit(1); }
console.log('PASS — percentage correctly null when comparing against zero, absolute variance still computed.');
console.log('');

console.log('=== Case 3: a decline (revenue fell, should be negative) ===');
const c3 = comparative(180000, 100000, 240000, 100000);
console.log(`Revenue variance: ${c3.revenue_kes} KES, ${c3.revenue_pct}%`);
if(c3.revenue_kes >= 0 || c3.revenue_pct >= 0){ console.log('FAILED — a revenue decline must show negative variance.'); process.exit(1); }
console.log('PASS — decline correctly shown as negative.');
console.log('');

console.log('=== Case 4: expenses declining from a negative prior base (loss narrowing) ===');
const c4 = comparative(150000, 160000, 100000, 140000); // curr result -10,000, prev result -40,000
console.log(`Operating result variance: ${c4.operating_result_kes} KES, ${c4.operating_result_pct}%`);
if(c4.operating_result_kes <= 0){ console.log('FAILED — an improving (less negative) result should show positive variance.'); process.exit(1); }
console.log('PASS — improvement from a larger loss to a smaller loss correctly shows positive variance.');
console.log('');
console.log('ALL CHECKS PASS.');

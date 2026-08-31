// Mirrors scenario.js's calculation. Run with plain `node`.

function runScenario(baselineRevenue, baselineExpense, revenueChangePct, expenseChangePct, pct){
  const scenarioRevenue = Number((baselineRevenue * (1 + revenueChangePct/100)).toFixed(2));
  const scenarioExpense = Number((baselineExpense * (1 + expenseChangePct/100)).toFixed(2));
  const baselineResult = baselineRevenue - baselineExpense;
  const scenarioResult = Number((scenarioRevenue - scenarioExpense).toFixed(2));
  const forRevenue = (rev) => ({
    profit: Number((rev*pct.profit/100).toFixed(2)), owner_debt: Number((rev*pct.owner_debt/100).toFixed(2)),
    tax: Number((rev*pct.tax/100).toFixed(2)), opex: Number((rev*pct.opex/100).toFixed(2))
  });
  return {
    scenarioRevenue, scenarioExpense, baselineResult, scenarioResult,
    resultChange: Number((scenarioResult - baselineResult).toFixed(2)),
    allocations: { baseline: forRevenue(baselineRevenue), scenario: forRevenue(scenarioRevenue) }
  };
}

const pct = { profit: 5, owner_debt: 20, tax: 15, opex: 60 };

console.log('=== Scenario 1: revenue falls 10% ===');
const s1 = runScenario(276600, 115675, -10, 0, pct);
console.log(JSON.stringify(s1, null, 2));
const expectedRev1 = Number((276600 * 0.9).toFixed(2));
if(s1.scenarioRevenue !== expectedRev1){ console.log('FAILED — revenue reduction math wrong.'); process.exit(1); }
if(s1.resultChange >= 0){ console.log('FAILED — a revenue drop should make the result worse, not better.'); process.exit(1); }
console.log('PASS — revenue reduced correctly, operating result correctly worsens.');
console.log('');

console.log('=== Scenario 2: expenses rise 15% ===');
const s2 = runScenario(276600, 115675, 0, 15, pct);
const expectedExp2 = Number((115675 * 1.15).toFixed(2));
console.log(`Scenario expense: ${s2.scenarioExpense} (expect ${expectedExp2})`);
if(s2.scenarioExpense !== expectedExp2){ console.log('FAILED'); process.exit(1); }
if(s2.scenarioRevenue !== 276600){ console.log('FAILED — revenue should be untouched when only expense_change_pct is set.'); process.exit(1); }
console.log('PASS — expense increased correctly, revenue correctly untouched.');
console.log('');

console.log('=== Scenario 3: Profit First allocations scale with hypothetical revenue ===');
const s3 = runScenario(200000, 100000, 20, 0, pct); // revenue up 20% -> 240,000
console.log(`Scenario revenue: ${s3.scenarioRevenue} (expect 240000)`);
console.log(`Scenario Profit First — profit bucket: ${s3.allocations.scenario.profit} (expect 12000, 5% of 240,000)`);
console.log(`Scenario Profit First — opex bucket: ${s3.allocations.scenario.opex} (expect 144000, 60% of 240,000)`);
if(s3.scenarioRevenue !== 240000 || s3.allocations.scenario.profit !== 12000 || s3.allocations.scenario.opex !== 144000){
  console.log('FAILED — Profit First allocation scaling is wrong.');
  process.exit(1);
}
const bucketSum = s3.allocations.scenario.profit + s3.allocations.scenario.owner_debt + s3.allocations.scenario.tax + s3.allocations.scenario.opex;
console.log(`Bucket sum: ${bucketSum} (expect 240000, since percentages sum to 100)`);
if(bucketSum !== 240000){ console.log('FAILED — allocation buckets do not sum back to the scenario revenue.'); process.exit(1); }
console.log('PASS — allocations scale correctly with hypothetical revenue and always sum back to it.');
console.log('');
console.log('ALL CHECKS PASS.');

// Mirrors hfms_close_period_with_entries()'s closing-entry math. Run with
// plain `node` — no database needed.

function closePeriod(revenueAccounts, expenseAccounts){
  // revenueAccounts / expenseAccounts: [{account, balance}] — balance is
  // this period's activity only (credit-side for revenue, debit-side for
  // expense), mirroring what the SQL's period-scoped GROUP BY computes.
  const lines = [];
  let revenueTotal = 0, expenseTotal = 0;

  for(const r of revenueAccounts){
    if(r.balance === 0) continue;
    lines.push({ account: r.account, debit: r.balance, credit: 0 }); // zero out a credit-balance account
    revenueTotal += r.balance;
  }
  for(const e of expenseAccounts){
    if(e.balance === 0) continue;
    lines.push({ account: e.account, debit: 0, credit: e.balance }); // zero out a debit-balance account
    expenseTotal += e.balance;
  }

  const net = revenueTotal - expenseTotal;
  if(net >= 0){
    lines.push({ account: '3100', debit: 0, credit: net });
  } else {
    lines.push({ account: '3100', debit: Math.abs(net), credit: 0 });
  }
  return { lines, revenueTotal, expenseTotal, net };
}

function assertBalanced(lines, label){
  const debit = lines.reduce((s,l)=>s+l.debit,0);
  const credit = lines.reduce((s,l)=>s+l.credit,0);
  console.log(`${label}: debits ${debit.toLocaleString()}, credits ${credit.toLocaleString()}`);
  if(Math.abs(debit-credit) > 0.01){ console.log(`FAILED — ${label} does not balance.`); process.exit(1); }
}

console.log('=== Case 1: profitable period ===');
const profit = closePeriod(
  [{ account:'4000', balance: 276600 }],
  [{ account:'5000', balance: 115500 }, { account:'5100', balance: 175 }]
);
console.log(JSON.stringify(profit, null, 2));
assertBalanced(profit.lines, 'Profitable close');
if(profit.net !== 160925){ console.log('FAILED — net income wrong.'); process.exit(1); }
const retainedLine = profit.lines.find(l=>l.account==='3100');
if(retainedLine.credit !== 160925){ console.log('FAILED — Retained Earnings should be credited by the profit.'); process.exit(1); }
console.log('PASS');
console.log('');

console.log('=== Case 2: loss-making period ===');
const loss = closePeriod(
  [{ account:'4000', balance: 90000 }],
  [{ account:'5000', balance: 130000 }]
);
assertBalanced(loss.lines, 'Loss-making close');
if(loss.net !== -40000){ console.log('FAILED — net loss wrong.'); process.exit(1); }
const retainedLossLine = loss.lines.find(l=>l.account==='3100');
if(retainedLossLine.debit !== 40000){ console.log('FAILED — Retained Earnings should be debited by the loss.'); process.exit(1); }
console.log('PASS — a loss correctly debits (reduces) Retained Earnings instead of crediting it.');
console.log('');

console.log('=== Case 3: Retained Earnings accumulates correctly across multiple closes ===');
let retainedEarningsBalance = 0; // credit-normal account: track as net credit
const month1 = closePeriod([{account:'4000',balance:200000}], [{account:'5000',balance:150000}]); // +50,000
const month2 = closePeriod([{account:'4000',balance:180000}], [{account:'5000',balance:220000}]); // -40,000
const month3 = closePeriod([{account:'4000',balance:300000}], [{account:'5000',balance:100000}]); // +200,000
for(const m of [month1, month2, month3]){
  const line = m.lines.find(l=>l.account==='3100');
  retainedEarningsBalance += line.credit - line.debit;
}
console.log(`Month 1 net: +50,000, Month 2 net: -40,000, Month 3 net: +200,000`);
console.log(`Retained Earnings after 3 closes: ${retainedEarningsBalance.toLocaleString()} (expect 210,000)`);
if(retainedEarningsBalance !== 210000){ console.log('FAILED — Retained Earnings did not accumulate correctly across periods.'); process.exit(1); }
console.log('PASS — Retained Earnings correctly accumulates net income/loss across sequential period closes.');
console.log('');
console.log('ALL CHECKS PASS.');

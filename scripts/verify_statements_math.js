// Mirrors financial-statements.js's Balance Sheet math against the same
// simulated postings as verify_ledger_math.js, and asserts the fundamental
// accounting identity holds: Assets = Liabilities + Equity + Current
// Earnings. Run with plain `node` — no database needed. This is meant to
// be run whenever the posting logic in
// supabase/hfms_foundation_fix_02_journal_posting.sql changes, before
// trusting financial-statements.js against a real database.

const COA_TYPE = {
  '1000': 'asset', '1100': 'asset', '1200': 'asset', '1300': 'asset',
  '2000': 'liability', '2100': 'liability', '2200': 'liability',
  '3000': 'equity', '3100': 'equity',
  '4000': 'revenue',
  '5000': 'expense', '5100': 'expense', '5200': 'expense'
};

// Same sample data as verify_ledger_math.js
const revenueEntries = [
  { id: 'r1', date: '2026-08-01', amount_kes: 42000 },
  { id: 'r2', date: '2026-08-02', amount_kes: 38500 },
  { id: 'r3', date: '2026-08-03', amount_kes: 51000 },
];
const expenses = [
  { id: 'e1', date: '2026-08-01', amount_kes: 65000, charges_kes: 120, owner_funded: false, account_kind: 'mobile_money' },
  { id: 'e2', date: '2026-08-02', amount_kes: 38000, charges_kes: 0, owner_funded: false, account_kind: 'bank' },
  { id: 'e3', date: '2026-08-04', amount_kes: 12500, charges_kes: 55, owner_funded: true, account_kind: 'mobile_money' },
];
const loans = [
  { id: 'l1', debt_name: 'John (Director)', start_date: '2025-01-01', original_principal_kes: 500000 },
  { id: 'l2', debt_name: 'Sacco Loan', start_date: '2025-03-01', original_principal_kes: 800000 },
];
const loanPayments = [
  { id: 'p1', loan_id: 'l1', date: '2026-08-05', amount_kes: 20000 },
  { id: 'p2', loan_id: 'l2', date: '2026-08-06', amount_kes: 35000 },
];

const ft = [];
for (const r of revenueEntries) ft.push({ type: 'revenue', gross: r.amount_kes, charges: 0, net: r.amount_kes, owner_funded: false, account_kind: null });
for (const e of expenses) ft.push({ type: 'expense', gross: e.amount_kes, charges: e.charges_kes, net: e.amount_kes + e.charges_kes, owner_funded: e.owner_funded, account_kind: e.account_kind });
for (const l of loans) ft.push({ type: 'owner_loan_funding', gross: l.original_principal_kes, charges: 0, net: l.original_principal_kes, owner_funded: false, account_kind: null });
for (const p of loanPayments) ft.push({ type: 'owner_loan_repayment', gross: p.amount_kes, charges: 0, net: p.amount_kes, owner_funded: false, account_kind: null });

function postOne(t){
  const cash = t.account_kind === 'bank' ? '1000' : '1100';
  const lines = [];
  if(t.type === 'revenue'){
    lines.push({ account: cash, debit: t.net, credit: 0 });
    lines.push({ account: '4000', debit: 0, credit: t.net });
  } else if(t.type === 'expense'){
    lines.push({ account: '5000', debit: t.gross, credit: 0 });
    if(t.charges > 0) lines.push({ account: '5100', debit: t.charges, credit: 0 });
    if(t.owner_funded) lines.push({ account: '2200', debit: 0, credit: t.net });
    else lines.push({ account: cash, debit: 0, credit: t.net });
  } else if(t.type === 'owner_loan_funding'){
    lines.push({ account: cash, debit: t.net, credit: 0 });
    lines.push({ account: '2200', debit: 0, credit: t.net });
  } else if(t.type === 'owner_loan_repayment'){
    lines.push({ account: '2200', debit: t.net, credit: 0 });
    lines.push({ account: cash, debit: 0, credit: t.net });
  }
  return lines;
}

// Post everything, accumulate per-account net balances (like the endpoint's groupByAccount)
const byAccount = {};
for(const t of ft){
  for(const l of postOne(t)){
    byAccount[l.account] = byAccount[l.account] || { debit: 0, credit: 0 };
    byAccount[l.account].debit += l.debit;
    byAccount[l.account].credit += l.credit;
  }
}

function sumByType(type, normal){
  return Object.entries(byAccount)
    .filter(([code]) => COA_TYPE[code] === type)
    .reduce((s,[,v]) => s + (normal==='debit' ? v.debit - v.credit : v.credit - v.debit), 0);
}

const totalAssets = sumByType('asset', 'debit');
const totalLiabilities = sumByType('liability', 'credit');
const totalEquity = sumByType('equity', 'credit'); // 0 in this dataset — nothing posts to 3000/3100 yet
const totalRevenue = sumByType('revenue', 'credit');
const totalExpense = sumByType('expense', 'debit');
const currentEarnings = totalRevenue - totalExpense;

const balanceCheck = Number((totalAssets - (totalLiabilities + totalEquity + currentEarnings)).toFixed(2));

console.log(`Total Assets:              KES ${totalAssets.toLocaleString()}`);
console.log(`Total Liabilities:         KES ${totalLiabilities.toLocaleString()}`);
console.log(`Total Equity (excl. earnings): KES ${totalEquity.toLocaleString()}`);
console.log(`Current Earnings (Rev-Exp): KES ${currentEarnings.toLocaleString()}`);
console.log(`Liabilities + Equity + Earnings: KES ${(totalLiabilities+totalEquity+currentEarnings).toLocaleString()}`);
console.log(`Balance check (Assets - (L+E+Earnings)), must be 0: KES ${balanceCheck}`);
console.log('');

if(balanceCheck !== 0){
  console.log('FAILED — balance sheet does not balance.');
  process.exit(1);
}
console.log('PASS — Assets = Liabilities + Equity + Current Earnings, exactly.');

// Cross-check against the P&L figure computed a different way (independently
// summed from the source revenue/expense arrays, not from journal postings)
// to make sure the ledger-derived P&L agrees with the raw source data.
const sourceRevenue = revenueEntries.reduce((s,r)=>s+r.amount_kes,0);
const sourceExpense = expenses.reduce((s,e)=>s+e.amount_kes+e.charges_kes,0);
console.log('');
console.log(`Source-data revenue: KES ${sourceRevenue.toLocaleString()} vs ledger revenue: KES ${totalRevenue.toLocaleString()}`);
console.log(`Source-data expense: KES ${sourceExpense.toLocaleString()} vs ledger expense: KES ${totalExpense.toLocaleString()}`);
if(sourceRevenue !== totalRevenue || sourceExpense !== totalExpense){
  console.log('FAILED — ledger P&L does not match source data.');
  process.exit(1);
}
console.log('PASS — P&L matches source data exactly.');

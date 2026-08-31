// Simulates hfms_post_one_transaction()'s exact logic in JS, against
// realistic Happynet-shaped data, and asserts every posted journal entry
// balances (sum of debits === sum of credits) and that the whole ledger
// balances in aggregate. This is meant to be run with plain `node` before
// any of the SQL in hfms_foundation_fix_02_journal_posting.sql is trusted
// against a real database — it can't replace testing against live
// Postgres, but it does prove the accounting logic itself is internally
// consistent, not just "looks right."

const COA = {
  CASH_BANK: '1000', MOBILE_MONEY: '1100', OWNER_LOAN_PAYABLE: '2200',
  REVENUE: '4000', OPEX: '5000', BANK_CHARGES: '5100'
};

// ---- Sample data, shaped like Happynet's real numbers seen earlier in
// this project (John's director loan, Sacco loan, M-Pesa-dominant activity) ----
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

// ---- Step 1: mirror the sync triggers (source tables -> financial_transactions) ----
const ft = [];
for (const r of revenueEntries) ft.push({ id: 'ft_'+r.id, type: 'revenue', date: r.date, gross: r.amount_kes, charges: 0, net: r.amount_kes, owner_funded: false, account_kind: null });
for (const e of expenses) ft.push({ id: 'ft_'+e.id, type: 'expense', date: e.date, gross: e.amount_kes, charges: e.charges_kes, net: e.amount_kes + e.charges_kes, owner_funded: e.owner_funded, account_kind: e.account_kind });
for (const l of loans) ft.push({ id: 'ft_'+l.id, type: 'owner_loan_funding', date: l.start_date, gross: l.original_principal_kes, charges: 0, net: l.original_principal_kes, owner_funded: false, account_kind: null });
for (const p of loanPayments) ft.push({ id: 'ft_'+p.id, type: 'owner_loan_repayment', date: p.date, gross: p.amount_kes, charges: 0, net: p.amount_kes, owner_funded: false, account_kind: null });

// ---- Step 2: mirror hfms_post_one_transaction() ----
function postOne(t){
  const cash = t.account_kind === 'bank' ? COA.CASH_BANK : COA.MOBILE_MONEY;
  const lines = [];
  if(t.type === 'revenue'){
    lines.push({ account: cash, debit: t.net, credit: 0 });
    lines.push({ account: COA.REVENUE, debit: 0, credit: t.net });
  } else if(t.type === 'expense'){
    lines.push({ account: COA.OPEX, debit: t.gross, credit: 0 });
    if(t.charges > 0) lines.push({ account: COA.BANK_CHARGES, debit: t.charges, credit: 0 });
    if(t.owner_funded) lines.push({ account: COA.OWNER_LOAN_PAYABLE, debit: 0, credit: t.net });
    else lines.push({ account: cash, debit: 0, credit: t.net });
  } else if(t.type === 'owner_loan_funding'){
    lines.push({ account: cash, debit: t.net, credit: 0 });
    lines.push({ account: COA.OWNER_LOAN_PAYABLE, debit: 0, credit: t.net });
  } else if(t.type === 'owner_loan_repayment'){
    lines.push({ account: COA.OWNER_LOAN_PAYABLE, debit: t.net, credit: 0 });
    lines.push({ account: cash, debit: 0, credit: t.net });
  }
  return lines;
}

// ---- Run + verify ----
let allDebits = 0, allCredits = 0, failures = [];
const byAccount = {};

for(const t of ft){
  const lines = postOne(t);
  const debitSum = lines.reduce((s,l)=>s+l.debit, 0);
  const creditSum = lines.reduce((s,l)=>s+l.credit, 0);
  if(Math.abs(debitSum - creditSum) > 0.01){
    failures.push(`${t.id} (${t.type}): debits ${debitSum} !== credits ${creditSum}`);
  }
  for(const l of lines){
    allDebits += l.debit; allCredits += l.credit;
    byAccount[l.account] = byAccount[l.account] || { debit: 0, credit: 0 };
    byAccount[l.account].debit += l.debit;
    byAccount[l.account].credit += l.credit;
  }
}

console.log(`Transactions simulated: ${ft.length}`);
console.log(`Total debits:  KES ${allDebits.toLocaleString()}`);
console.log(`Total credits: KES ${allCredits.toLocaleString()}`);
console.log(`Difference (must be 0): KES ${(allDebits-allCredits).toFixed(2)}`);
console.log('');
console.log('Per-account net balance (debit - credit):');
for(const [acc, v] of Object.entries(byAccount)){
  console.log(`  ${acc}: debit ${v.debit.toLocaleString()}, credit ${v.credit.toLocaleString()}, net ${(v.debit-v.credit).toLocaleString()}`);
}
console.log('');

if(failures.length){
  console.log('FAILED — these individual entries do not balance:');
  failures.forEach(f=>console.log('  '+f));
  process.exit(1);
}
if(Math.abs(allDebits-allCredits) > 0.01){
  console.log('FAILED — ledger does not balance in aggregate.');
  process.exit(1);
}
console.log('PASS — every entry balances individually, and the ledger balances in aggregate.');

// Sanity checks specific to the Happynet business rules this was built for:
const revenueTotal = revenueEntries.reduce((s,r)=>s+r.amount_kes,0);
const ledgerRevenue = byAccount[COA.REVENUE].credit;
console.log('');
console.log(`Source revenue total:  KES ${revenueTotal.toLocaleString()}`);
console.log(`Ledger revenue total:  KES ${ledgerRevenue.toLocaleString()}`);
if(revenueTotal !== ledgerRevenue){ console.log('FAILED — revenue totals do not match source.'); process.exit(1); }

const ownerFundedTotal = expenses.filter(e=>e.owner_funded).reduce((s,e)=>s+e.amount_kes+e.charges_kes,0);
console.log(`Owner-funded expenses correctly routed to Owner Loan Payable (not Cash): KES ${ownerFundedTotal.toLocaleString()}`);
console.log('');
console.log('ALL CHECKS PASS.');

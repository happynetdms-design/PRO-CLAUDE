// Mirrors financial-statements-consolidated.js's extended aggregation.
// Run with plain `node`.
//
// The Balance Sheet identity (Assets = Liabilities + Equity) only holds
// when the underlying journal lines actually came from balanced
// double-entry postings — hand-picking asset/liability numbers that look
// plausible is NOT good enough proof, they have to be derived the same
// way the real posting logic derives them. So this simulates real
// transactions per branch (same pattern as scripts/verify_ledger_math.js)
// and posts them, rather than inventing Balance Sheet figures directly.

function postTransaction(type, net, gross, charges, ownerFunded){
  const cash = '1100';
  const lines = [];
  if(type === 'revenue'){
    lines.push({ account: cash, debit: net, credit: 0 });
    lines.push({ account: '4000', debit: 0, credit: net });
  } else if(type === 'expense'){
    lines.push({ account: '5000', debit: gross, credit: 0 });
    if(charges > 0) lines.push({ account: '5100', debit: charges, credit: 0 });
    if(ownerFunded) lines.push({ account: '2200', debit: 0, credit: net });
    else lines.push({ account: cash, debit: 0, credit: net });
  }
  return lines;
}

const branchTxns = {
  main: [
    { type:'revenue', net:276600, gross:276600, charges:0 },
    { type:'expense', net:115675, gross:115500, charges:175 },
  ],
  kisumu: [
    { type:'revenue', net:198400, gross:198400, charges:0 },
    { type:'expense', net:104200, gross:104000, charges:200 },
  ]
};

const ACCOUNT_TYPE = { '1100':'asset', '2200':'liability', '4000':'revenue', '5000':'expense', '5100':'expense' };

function aggregate(branchTxns){
  const byBranch = {};
  for(const branchId of Object.keys(branchTxns)){
    byBranch[branchId] = { total_assets_kes:0, total_liabilities_kes:0, current_earnings_kes:0 };
    for(const t of branchTxns[branchId]){
      const lines = postTransaction(t.type, t.net, t.gross, t.charges, false);
      for(const l of lines){
        const acctType = ACCOUNT_TYPE[l.account];
        const b = byBranch[branchId];
        if(acctType==='asset') b.total_assets_kes += l.debit - l.credit;
        else if(acctType==='liability') b.total_liabilities_kes += l.credit - l.debit;
        else if(acctType==='revenue') b.current_earnings_kes += l.credit - l.debit;
        else if(acctType==='expense') b.current_earnings_kes -= (l.debit - l.credit);
      }
    }
  }
  return byBranch;
}

const result = aggregate(branchTxns);
console.log('=== Per-branch Balance Sheet ===');
for(const [id, b] of Object.entries(result)){
  console.log(` ${id}: assets ${b.total_assets_kes.toLocaleString()}, liabilities ${b.total_liabilities_kes.toLocaleString()}, current earnings ${b.current_earnings_kes.toLocaleString()}`);
}

let failed = false;
function check(label, actual, expected){
  const ok = Math.abs(actual-expected) < 0.01;
  console.log(`${ok?'PASS':'FAIL'} — ${label}: got ${actual}, expected ${expected}`);
  if(!ok) failed = true;
}

console.log('');
console.log('=== Balance Sheet identity holds PER BRANCH (Assets = Liabilities + Equity) ===');
check('Main: assets - (liabilities + earnings)', result.main.total_assets_kes - (result.main.total_liabilities_kes + result.main.current_earnings_kes), 0);
check('Kisumu: assets - (liabilities + earnings)', result.kisumu.total_assets_kes - (result.kisumu.total_liabilities_kes + result.kisumu.current_earnings_kes), 0);

console.log('');
console.log('=== Balance Sheet identity ALSO holds at the CONSOLIDATED level ===');
const totalAssets = result.main.total_assets_kes + result.kisumu.total_assets_kes;
const totalLiabilities = result.main.total_liabilities_kes + result.kisumu.total_liabilities_kes;
const totalEarnings = result.main.current_earnings_kes + result.kisumu.current_earnings_kes;
check('Consolidated: assets - (liabilities + earnings)', totalAssets - (totalLiabilities + totalEarnings), 0);
console.log(`Consolidated assets: ${totalAssets.toLocaleString()}, liabilities: ${totalLiabilities.toLocaleString()}, earnings: ${totalEarnings.toLocaleString()}`);

console.log('');
if(failed){ console.log('SOME CHECKS FAILED.'); process.exit(1); }
console.log('ALL CHECKS PASS — the balance sheet identity holds for every branch individually AND for the consolidated total.');

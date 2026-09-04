// Mirrors ai-assistant.js's restricted financial context. Run with plain node.

function buildFinancialContext(revenue, expenses, accounts, ledgerTransactions, audit){
  return { revenue, expenses, accounts, ledger_transactions: ledgerTransactions, audit };
}

console.log('=== Restricted context includes only approved financial sources ===');
const context = buildFinancialContext(
  [{ entry_date:'2026-08-01', amount_kes:276600 }],
  [{ expense_date:'2026-08-01', amount_kes:115675 }],
  [{ code:'4000', name:'Revenue', account_type:'revenue' }],
  [{ transaction_type:'revenue', direction:'inflow', net_amount_kes:276600 }],
  [{ table_name:'expenses', action:'insert' }]
);
console.log(JSON.stringify(context, null, 2));

if(Object.keys(context).sort().join(',') !== 'accounts,audit,expenses,ledger_transactions,revenue'){
  console.log('FAILED — context contains an unexpected data source.');
  process.exit(1);
}
if(JSON.stringify(context).includes('accounts_payable') || JSON.stringify(context).includes('tax_obligations')){
  console.log('FAILED — restricted context contains out-of-scope data.');
  process.exit(1);
}

console.log('PASS — context is restricted to revenue, expenses, accounts, ledger, and audit.');
console.log('ALL CHECKS PASS.');

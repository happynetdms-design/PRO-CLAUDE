// Mirrors hfms_recompute_loan_balance()'s logic. Run with plain `node`.

function recomputeLoanBalance(loan, loanPayments, expenses){
  const dedicated = loanPayments
    .filter(p => p.loan_id === loan.id)
    .reduce((s,p) => s + p.amount_kes, 0);

  let reimbursement = 0;
  if(loan.lender && loan.lender.trim()){
    reimbursement = expenses
      .filter(e => !e.is_deleted && e.status !== 'rejected'
        && (e.category||'').toLowerCase() === 'reimbursement'
        && (e.paid_to||'').toLowerCase().includes(loan.lender.toLowerCase()))
      .reduce((s,e) => s + e.amount_kes + (e.charges_kes||0), 0);
  }

  const balance = Math.max(0, loan.original_principal_kes - dedicated - reimbursement);
  return { balance, status: balance <= 0 ? 'PAID_OFF' : 'ACTIVE', dedicated, reimbursement };
}

let failed = false;
function check(label, actual, expected){
  const ok = typeof expected === 'number' ? Math.abs(actual - expected) < 0.01 : actual === expected;
  console.log(`${ok?'PASS':'FAIL'} — ${label}: got ${actual}, expected ${expected}`);
  if(!ok) failed = true;
}

const loan = { id:'l1', lender:'John', original_principal_kes: 77600 };

console.log('=== Case 1: only dedicated payments, no matching expenses ===');
let r = recomputeLoanBalance(loan, [{loan_id:'l1', amount_kes:20000}], []);
check('balance after one dedicated payment', r.balance, 57600);
check('status still ACTIVE', r.status, 'ACTIVE');
console.log('');

console.log('=== Case 2: only a Reimbursement expense, no dedicated payment ===');
r = recomputeLoanBalance(loan, [], [
  { is_deleted:false, status:'posted', category:'Reimbursement', paid_to:'John Kamau Irungu', amount_kes:5000, charges_kes:12 }
]);
check('balance reduced by the matching expense (incl. charges)', r.balance, 77600 - 5012);
console.log('');

console.log('=== Case 3: BOTH paths combine (this is the whole point of the fix) ===');
r = recomputeLoanBalance(loan,
  [{loan_id:'l1', amount_kes:20000}],
  [{ is_deleted:false, status:'posted', category:'Reimbursement', paid_to:'John Kamau Irungu', amount_kes:5000, charges_kes:12 }]
);
check('balance nets both sources', r.balance, 77600 - 20000 - 5012);
console.log('');

console.log('=== Case 4: a non-matching expense (wrong category) does NOT count ===');
r = recomputeLoanBalance(loan, [], [
  { is_deleted:false, status:'posted', category:'Fuel', paid_to:'John Kamau Irungu', amount_kes:5000, charges_kes:0 }
]);
check('wrong category never counts, even with matching vendor', r.balance, 77600);
console.log('');

console.log('=== Case 5: a non-matching expense (wrong vendor) does NOT count ===');
r = recomputeLoanBalance(loan, [], [
  { is_deleted:false, status:'posted', category:'Reimbursement', paid_to:'Someone Else Entirely', amount_kes:5000, charges_kes:0 }
]);
check('right category, wrong vendor never counts', r.balance, 77600);
console.log('');

console.log('=== Case 6: a soft-deleted expense is excluded, even if it would otherwise match ===');
r = recomputeLoanBalance(loan, [], [
  { is_deleted:true, status:'posted', category:'Reimbursement', paid_to:'John Kamau Irungu', amount_kes:5000, charges_kes:0 }
]);
check('deleted expense never counts', r.balance, 77600);
console.log('');

console.log('=== Case 7: editing an expense OUT of matching (category changed away from Reimbursement) correctly stops counting it ===');
const before = { is_deleted:false, status:'posted', category:'Reimbursement', paid_to:'John Kamau Irungu', amount_kes:5000, charges_kes:0 };
const after = { ...before, category:'Fuel' }; // person re-categorized it
const balanceBefore = recomputeLoanBalance(loan, [], [before]).balance;
const balanceAfter = recomputeLoanBalance(loan, [], [after]).balance;
check('balance before edit reflects the match', balanceBefore, 77600 - 5000);
check('balance after re-categorizing away is back to full principal', balanceAfter, 77600);
console.log('');

console.log('=== Case 8: balance never goes negative even if payments exceed principal ===');
r = recomputeLoanBalance(loan, [{loan_id:'l1', amount_kes:90000}], []);
check('floored at zero, not negative', r.balance, 0);
check('status flips to PAID_OFF', r.status, 'PAID_OFF');
console.log('');

if(failed){ console.log('SOME CHECKS FAILED.'); process.exit(1); }
console.log('ALL CHECKS PASS — both repayment paths combine correctly, non-matches never count, and edits are reflected live.');

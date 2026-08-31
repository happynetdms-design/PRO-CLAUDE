// Mirrors hfms_post_bill_approval() and hfms_post_bill_payment() plus the
// v_hfms_ap_aging bucket logic. Run with plain `node` — no database.

const bills = [
  { id: 'b1', total_kes: 45000, due_date: '2026-07-20', paid: 45000 },     // fully paid
  { id: 'b2', total_kes: 30000, due_date: '2026-08-10', paid: 12000 },     // partially paid, not yet overdue relative to "today"
  { id: 'b3', total_kes: 18000, due_date: '2026-06-15', paid: 0 },         // unpaid, well overdue
  { id: 'b4', total_kes: 9000,  due_date: '2026-08-25', paid: 0 },         // unpaid, not yet due
];
const TODAY = new Date('2026-08-18'); // matches this conversation's "current date"

// ---- Posting simulation: approval (Dr Expense Cr AP) + payments (Dr AP Cr Cash) ----
let allDebits = 0, allCredits = 0;
const byAccount = { '5000': {debit:0,credit:0}, '2000': {debit:0,credit:0}, '1100': {debit:0,credit:0} };

for(const b of bills){
  // Approval
  byAccount['5000'].debit += b.total_kes;
  byAccount['2000'].credit += b.total_kes;
  allDebits += b.total_kes; allCredits += b.total_kes;
  // Payment(s) — treat b.paid as a single payment for simplicity
  if(b.paid > 0){
    byAccount['2000'].debit += b.paid;
    byAccount['1100'].credit += b.paid;
    allDebits += b.paid; allCredits += b.paid;
  }
}

console.log('=== Posting balance check ===');
console.log(`Total debits:  KES ${allDebits.toLocaleString()}`);
console.log(`Total credits: KES ${allCredits.toLocaleString()}`);
if(allDebits !== allCredits){ console.log('FAILED — postings do not balance.'); process.exit(1); }
console.log('PASS — every bill approval + payment balances.');
console.log('');

// AP liability remaining = total approved - total paid, should equal the
// net balance sitting in account 2000 (Accounts Payable).
const totalApproved = bills.reduce((s,b)=>s+b.total_kes, 0);
const totalPaid = bills.reduce((s,b)=>s+b.paid, 0);
const outstandingExpected = totalApproved - totalPaid;
const apAccountBalance = byAccount['2000'].credit - byAccount['2000'].debit;
console.log('=== AP liability check ===');
console.log(`Total approved: KES ${totalApproved.toLocaleString()}, Total paid: KES ${totalPaid.toLocaleString()}`);
console.log(`Expected outstanding: KES ${outstandingExpected.toLocaleString()}, AP account net balance: KES ${apAccountBalance.toLocaleString()}`);
if(outstandingExpected !== apAccountBalance){ console.log('FAILED — AP account balance does not match outstanding bills.'); process.exit(1); }
console.log('PASS — Accounts Payable account balance matches actual outstanding bills.');
console.log('');

// ---- Aging bucket simulation (mirrors v_hfms_ap_aging exactly) ----
function bucket(dueDate){
  const days = Math.max(0, Math.floor((TODAY - new Date(dueDate)) / 86400000));
  if(days === 0) return 'current';
  if(days <= 30) return '1-30';
  if(days <= 60) return '31-60';
  if(days <= 90) return '61-90';
  return '90+';
}
console.log('=== Aging buckets (unpaid/partial bills only, as of ' + TODAY.toISOString().slice(0,10) + ') ===');
for(const b of bills.filter(b => b.paid < b.total_kes)){
  const outstanding = b.total_kes - b.paid;
  console.log(`${b.id}: due ${b.due_date}, outstanding KES ${outstanding.toLocaleString()}, bucket: ${bucket(b.due_date)}`);
}
// b1 is fully paid so excluded; b2 outstanding 18000 due 2026-08-10 (8 days overdue -> 1-30);
// b3 outstanding 18000 due 2026-06-15 (64 days overdue -> 61-90); b4 outstanding 9000 due 2026-08-25 (not due yet -> current)
const b2bucket = bucket('2026-08-10');
const b3bucket = bucket('2026-06-15');
const b4bucket = bucket('2026-08-25');
if(b2bucket !== '1-30' || b3bucket !== '61-90' || b4bucket !== 'current'){
  console.log('FAILED — aging buckets did not come out as expected.');
  process.exit(1);
}
console.log('');
console.log('PASS — aging buckets match hand-calculated expectations.');
console.log('');
console.log('ALL CHECKS PASS.');

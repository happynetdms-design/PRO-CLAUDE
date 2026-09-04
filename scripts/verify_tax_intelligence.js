// Mirrors tax-intelligence.js's dueForRule(), status(), and the payment-
// status transition logic from the 'payment' action. Run with plain
// `node` — no database needed. "Today" is fixed to this conversation's
// actual current date so the test is reproducible.

const TODAY = new Date('2026-08-19');

function isoDate(d){ return d.toISOString().slice(0,10); }
function utcDate(year, month, day){ return new Date(Date.UTC(year, month, day)); }
function daysUntil(s){
  if(!s) return null;
  const b = new Date(`${s}T00:00:00`);
  return Math.ceil((b - new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate())) / 86400000);
}
function dueForRule(periodEnd, rule){
  const p = new Date(`${periodEnd}T00:00:00`);
  const r = (rule||'').toLowerCase();
  if(r.includes('20th day of following month')) return isoDate(utcDate(p.getUTCFullYear(), p.getUTCMonth()+1, 20));
  if(r.includes('9th day of following month')) return isoDate(utcDate(p.getUTCFullYear(), p.getUTCMonth()+1, 9));
  return null;
}
function status(period){
  const due = period.payment_due_date || period.filing_due_date;
  const days = daysUntil(due);
  const paid = Number(period.amount_paid_kes||0), dueAmt = Number(period.amount_due_kes||0);
  if(period.payment_status==='paid' && ['filed','nil','not_applicable'].includes(period.filing_status)) return { label:'Compliant', severity:'good' };
  if(due && days<0) return { label:'Overdue', severity:'critical' };
  if(due && days<=7) return { label:'Due within 7 days', severity:'warning' };
  if(due && days<=30) return { label:'Due within 30 days', severity:'info' };
  if(dueAmt>paid) return { label:'Unpaid / Open', severity:'warning' };
  return { label:'On track', severity:'good' };
}
function paymentStatusAfter(period, newPaidTotal){
  const due = Number(period.amount_due_kes||0);
  if(newPaidTotal > due && due > 0) return 'overpaid';
  if(newPaidTotal >= due && due > 0) return 'paid';
  if(newPaidTotal > 0) return 'partially_paid';
  return 'unpaid';
}

console.log('=== Due-date rule math ===');
const vatDue = dueForRule('2026-08-31', '20th day of following month');
const payeDue = dueForRule('2026-08-31', '9th day of following month');
console.log(`VAT for period ending 2026-08-31 -> due ${vatDue} (expect 2026-09-20)`);
console.log(`PAYE for period ending 2026-08-31 -> due ${payeDue} (expect 2026-09-09)`);
if(vatDue !== '2026-09-20' || payeDue !== '2026-09-09'){ console.log('FAILED — due-date math is wrong.'); process.exit(1); }
console.log('PASS');
console.log('');

console.log('=== Compliance status (today = 2026-08-19) ===');
const cases = [
  { name: 'Overdue (due 2026-08-09)', period: { payment_due_date:'2026-08-09', amount_due_kes:45000, amount_paid_kes:0 }, expect:'critical' },
  { name: 'Due within 7 days (due 2026-08-24)', period: { payment_due_date:'2026-08-24', amount_due_kes:18000, amount_paid_kes:0 }, expect:'warning' },
  { name: 'Due within 30 days (due 2026-09-15)', period: { payment_due_date:'2026-09-15', amount_due_kes:18000, amount_paid_kes:0 }, expect:'info' },
  { name: 'Compliant (paid + filed)', period: { payment_due_date:'2026-07-20', amount_due_kes:20000, amount_paid_kes:20000, payment_status:'paid', filing_status:'filed' }, expect:'good' },
];
let failed = false;
for(const c of cases){
  const s = status(c.period);
  console.log(`  ${c.name}: ${s.label} (${s.severity})`);
  if(s.severity !== c.expect){ console.log(`    FAILED — expected severity ${c.expect}`); failed = true; }
}
if(failed) process.exit(1);
console.log('PASS — all compliance statuses match expectations.');
console.log('');

console.log('=== Payment status transitions ===');
const period = { amount_due_kes: 45000 };
const t1 = paymentStatusAfter(period, 20000);   // partial
const t2 = paymentStatusAfter(period, 45000);   // exactly paid
const t3 = paymentStatusAfter(period, 50000);   // overpaid
const t4 = paymentStatusAfter(period, 0);       // unpaid
console.log(`Paid 20,000 of 45,000 -> ${t1} (expect partially_paid)`);
console.log(`Paid 45,000 of 45,000 -> ${t2} (expect paid)`);
console.log(`Paid 50,000 of 45,000 -> ${t3} (expect overpaid)`);
console.log(`Paid 0 of 45,000 -> ${t4} (expect unpaid)`);
if(t1!=='partially_paid'||t2!=='paid'||t3!=='overpaid'||t4!=='unpaid'){
  console.log('FAILED — payment status transitions are wrong.');
  process.exit(1);
}
console.log('PASS — all payment status transitions correct.');
console.log('');
console.log('ALL CHECKS PASS.');

// Mirrors audit_row_change()'s action-classification logic using plain
// JS objects standing in for jsonb rows. Run with plain `node`.

function classifyAction(tgOp, oldRow, newRow){
  if(tgOp === 'INSERT') return 'insert';
  const hasIsDeleted = Object.prototype.hasOwnProperty.call(newRow, 'is_deleted');
  const hasStatus = Object.prototype.hasOwnProperty.call(newRow, 'status');
  if(hasIsDeleted && newRow.is_deleted && !(oldRow.is_deleted || false)) return 'soft_delete';
  if(hasStatus && oldRow.status !== newRow.status) return 'status_change';
  return 'update';
}

let failed = false;
function check(label, actual, expected){
  const ok = actual === expected;
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${label}: got '${actual}', expected '${expected}'`);
  if(!ok) failed = true;
}

console.log('=== Tables WITH is_deleted (revenue_entries, expenses, loans, bill_payments) ===');
check('insert', classifyAction('INSERT', null, {is_deleted:false, amount:100}), 'insert');
check('soft delete', classifyAction('UPDATE', {is_deleted:false}, {is_deleted:true}), 'soft_delete');
check('ordinary field edit', classifyAction('UPDATE', {is_deleted:false, amount:100}, {is_deleted:false, amount:150}), 'update');
console.log('');

console.log('=== Tables WITHOUT is_deleted, WITH status (accounting_periods) ===');
console.log('This is the case that would have thrown an error with the original trigger.');
check('period closed', classifyAction('UPDATE', {status:'open'}, {status:'closed'}), 'status_change');
check('period reopened', classifyAction('UPDATE', {status:'closed'}, {status:'reopened'}), 'status_change');
check('non-status field edit', classifyAction('UPDATE', {status:'open', reason:null}, {status:'open', reason:'correcting a typo'}), 'update');
console.log('');

console.log('=== Table with BOTH is_deleted and status (bills) — is_deleted takes priority ===');
check('soft-deleted bill', classifyAction('UPDATE', {is_deleted:false, status:'approved'}, {is_deleted:true, status:'approved'}), 'soft_delete');
check('bill status change', classifyAction('UPDATE', {is_deleted:false, status:'draft'}, {is_deleted:false, status:'approved'}), 'status_change');
console.log('');

console.log('=== Table with NEITHER column — must never throw ===');
let threw = false;
try{
  const r = classifyAction('UPDATE', {amount:100}, {amount:120});
  console.log(`No throw — got '${r}' (expect 'update')`);
  if(r !== 'update') failed = true;
}catch(e){ threw = true; console.log('FAILED — threw:', e.message); }
if(threw) failed = true;
console.log('');

if(failed){ console.log('SOME CHECKS FAILED.'); process.exit(1); }
console.log('ALL CHECKS PASS — classification is correct across every column shape, and nothing ever throws.');

// Mirrors audit_row_change()'s action-classification logic using plain
// JS objects standing in for jsonb rows. Run with plain `node`.

function normalizeEntryDate(value){
  if(value && String(value).trim()) return String(value).trim();
  return new Date().toISOString().slice(0,10);
}

function buildAuditMeta(userId, opts = {}){
  const now = opts.now || new Date().toISOString();
  return {
    created_at: opts.created_at || now,
    created_by: opts.created_by || userId || null,
    updated_at: opts.updated_at || now,
    updated_by: opts.updated_by || userId || null
  };
}

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

console.log('=== Daily-entry date normalization ===');
check('blank date defaults to today', normalizeEntryDate(''), new Date().toISOString().slice(0,10));
check('explicit date is preserved', normalizeEntryDate('2026-09-09'), '2026-09-09');
console.log('');

console.log('=== Audit metadata defaults ===');
check('created_by is set from user', buildAuditMeta('user-123').created_by, 'user-123');
check('updated_by mirrors the actor', buildAuditMeta('user-123').updated_by, 'user-123');
check('created_at and updated_at are both present', Boolean(buildAuditMeta('user-123').created_at && buildAuditMeta('user-123').updated_at), true);
console.log('');

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

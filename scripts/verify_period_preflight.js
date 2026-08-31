// Mirrors accounting-periods.js's preflight checklist classification. Run
// with plain `node`.

function classifyLedger(diff){
  return Math.abs(diff) < 0.01 ? 'pass' : 'fail';
}
function classifyCount(count){
  return count > 0 ? 'warn' : 'pass';
}
function canClose(checklist){
  return !checklist.some(c => c.status === 'fail');
}

let failed = false;
function check(label, actual, expected){
  const ok = actual === expected;
  console.log(`${ok?'PASS':'FAIL'} — ${label}: got ${actual}, expected ${expected}`);
  if(!ok) failed = true;
}

console.log('=== Ledger balance classification ===');
check('balanced (diff 0)', classifyLedger(0), 'pass');
check('balanced (tiny rounding, 0.005)', classifyLedger(0.005), 'pass');
check('unbalanced (off by 150)', classifyLedger(150), 'fail');
check('unbalanced (off by -0.5)', classifyLedger(-0.5), 'fail');
console.log('');

console.log('=== Count-based checks (pending approvals, drafts, open reconciliation, sync errors) ===');
check('zero pending', classifyCount(0), 'pass');
check('some pending', classifyCount(3), 'warn');
console.log('');

console.log('=== Overall can_close derivation ===');
check('all pass -> can close', canClose([{status:'pass'},{status:'pass'},{status:'pass'}]), true);
check('warnings only -> can still close', canClose([{status:'pass'},{status:'warn'},{status:'warn'}]), true);
check('any fail -> cannot close', canClose([{status:'pass'},{status:'pass'},{status:'fail'}]), false);
console.log('');

if(failed){ console.log('SOME CHECKS FAILED.'); process.exit(1); }
console.log('ALL CHECKS PASS — warnings never block closing, but a single failure (an unbalanced ledger) always does.');

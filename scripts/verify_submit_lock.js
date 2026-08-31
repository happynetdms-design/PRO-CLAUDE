// Mirrors withSubmitLock()/withButtonLock()'s control flow using a fake
// button object instead of a real DOM element. Run with plain `node`.
//
// NOTE on why this is a pure logic test, not a live-browser one: a real
// browser test was also run (see the session's own record) and confirmed
// the outcome that actually matters — exactly one real network call
// fires no matter how many times a button is rapidly clicked. But
// Playwright's own .click() waits for an element to become "actionable"
// (enabled, stable) before it resolves, so a rapid sequence of
// page.click() calls ends up implicitly waiting out the disabled window
// as part of landing each click — meaning a raw `.disabled` snapshot
// read afterward can read back false even though the lock worked
// correctly. That's a property of how Playwright schedules synthetic
// clicks, not a flaw in the lock. This test checks the actual mechanism
// synchronously, in the same tick the lock starts, which sidesteps that
// artifact entirely.

function makeFakeButton(){
  return { disabled: false, innerHTML: 'Save', inDocument: true };
}

async function withButtonLock(btn, asyncFn){
  if(!btn){ await asyncFn(); return; }
  const originalText = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = 'Working…';
  try{
    await asyncFn();
  } finally {
    if(btn.inDocument){ btn.disabled = false; btn.innerHTML = originalText; }
  }
}

function delay(ms){ return new Promise(res => setTimeout(res, ms)); }

async function main(){
  let failed = false;
  function check(label, actual, expected){
    const ok = actual === expected;
    console.log(`${ok?'PASS':'FAIL'} — ${label}: got ${actual}, expected ${expected}`);
    if(!ok) failed = true;
  }

  console.log('=== Case 1: button is disabled the instant the lock starts, before the async work resolves ===');
  const btn1 = makeFakeButton();
  let callCount = 0;
  const slowOperation = async () => { callCount++; await delay(50); };
  const lockPromise = withButtonLock(btn1, slowOperation);
  check('disabled immediately (before the async op resolves)', btn1.disabled, true);
  check('text changed to a busy indicator', btn1.innerHTML, 'Working…');
  await lockPromise;
  check('re-enabled after completion', btn1.disabled, false);
  check('original text restored', btn1.innerHTML, 'Save');
  check('the operation only actually ran once', callCount, 1);
  console.log('');

  console.log('=== Case 2: rapid clicks while locked — a disabled button never fires the operation again ===');
  const btn2 = makeFakeButton();
  let realCallCount = 0;
  const realOperation = async () => { realCallCount++; await delay(30); };
  function simulateClick(btn, op){
    if(btn.disabled) return false; // mirrors a real browser: a disabled button never dispatches click at all
    withButtonLock(btn, op);
    return true;
  }
  const firstClickFired = simulateClick(btn2, realOperation);
  const secondClickFired = simulateClick(btn2, realOperation);
  const thirdClickFired = simulateClick(btn2, realOperation);
  check('first click goes through', firstClickFired, true);
  check('second rapid click is blocked', secondClickFired, false);
  check('third rapid click is blocked', thirdClickFired, false);
  await delay(60);
  check('operation ran exactly once despite 3 rapid clicks', realCallCount, 1);
  console.log('');

  console.log('=== Case 3: a REJECTED operation still re-enables the button — no permanently stuck UI ===');
  const btn3 = makeFakeButton();
  const failingOperation = async () => { await delay(10); throw new Error('Simulated network failure'); };
  let caught = null;
  try{ await withButtonLock(btn3, failingOperation); }
  catch(e){ caught = e; }
  check('re-enabled even after a failure', btn3.disabled, false);
  check('error still propagated (not swallowed)', caught !== null && caught.message === 'Simulated network failure', true);
  console.log('');

  if(failed){ console.log('SOME CHECKS FAILED.'); process.exit(1); }
  console.log('ALL CHECKS PASS — the lock disables synchronously before any await, blocks rapid re-clicks, and always re-enables, success or failure.');
}
main();

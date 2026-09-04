/* ---------------- Auth / Boot ---------------- */

let loginSignupMode = false;
let signupMsg = null;
let loginResetMode = false;
let resetMsg = null;
let recoveryToken = null; // { accessToken, refreshToken } from a recovery link
let recoveryMsg = null;

function renderAccessPending(){
  setSession(null);
  renderLogin();
}

function renderRecovery(){
  root().innerHTML = `
    <div class="login-wrap">
      <div class="login-hero">
        <div class="login-hero-rings"></div>
        <div class="login-hero-grid"></div>
        <div>
          <div class="login-logo">
            <span class="login-logo-mark">🤙</span>
            <span class="login-logo-word">happy<b>net</b></span>
          </div>
          <div class="login-logo-sub"><i></i><span>TECHNOLOGIES</span><i></i></div>
          <div class="login-brand-tag">FINANCE OPERATING SYSTEM <span>•</span> BUILT FOR MOMENTUM</div>
        </div>
      </div>
      <div class="login-panel">
        <div class="login-card">
          <div class="login-card-icon">${ICON_SIGNAL}</div>
          <p class="login-title">Set a new password</p>
          <p class="login-sub">Choose a new password for your account — at least 8 characters.</p>
          ${recoveryMsg && recoveryMsg.ok ? `
          <div class="hint" style="margin:10px 0;">Password updated. You can sign in with it now.</div>
          <button class="btn full" style="background:var(--ink); color:#fff;" id="recovery-to-signin">Go to sign in</button>
          ` : `
          <form id="form-recovery">
            <label>New Password</label>
            <div class="login-input-wrap">${ICON_LOCK}<input type="password" name="password" placeholder="At least 8 characters" required minlength="8" autocomplete="new-password"></div>
            <label>Confirm Password</label>
            <div class="login-input-wrap">${ICON_LOCK}<input type="password" name="confirm" placeholder="Re-enter the password" required minlength="8" autocomplete="new-password"></div>
            <button class="btn full" style="background:var(--ink); color:#fff;" type="submit">Set New Password</button>
            ${recoveryMsg && !recoveryMsg.ok ? `<div class="err-msg" style="margin-top:12px;">${recoveryMsg.text}</div>` : ''}
          </form>
          `}
        </div>
      </div>
    </div>`;
  const formRecovery = document.getElementById('form-recovery');
  if(formRecovery) formRecovery.addEventListener('submit', async e=>{
    e.preventDefault();
    const fd = new FormData(formRecovery);
    const password = fd.get('password'), confirm = fd.get('confirm');
    if(password !== confirm){ recoveryMsg = { ok:false, text:"Passwords don't match." }; renderRecovery(); return; }
    const submitBtn = formRecovery.querySelector('button[type=submit]');
    submitBtn.disabled = true; submitBtn.innerHTML = 'Updating…';
    try{
      await apiUpdatePassword(recoveryToken, password);
      recoveryMsg = { ok:true };
      renderRecovery();
    }catch(err){
      recoveryMsg = { ok:false, text: err.message };
      renderRecovery();
    }
  });
  const toSignin = document.getElementById('recovery-to-signin');
  if(toSignin) toSignin.addEventListener('click', ()=>{
    recoveryToken = null; recoveryMsg = null;
    renderLogin();
  });
}

function renderLogin(errMsg){
  root().innerHTML = `
    <div class="login-wrap">
      <div class="login-hero">
        <div class="login-hero-rings"></div>
        <div>
          <div class="login-logo">
            <span class="login-logo-mark">🤙</span>
            <span class="login-logo-word">happy<b>net</b></span>
          </div>
          <div class="login-logo-sub"><i></i><span>TECHNOLOGIES</span><i></i></div>
        </div>

        <div class="login-hero-mid">
          <h1 class="login-headline">Smart Finances<br>Stronger Business<i></i></h1>
          <p class="login-hero-sub">Track performance, manage finances and make data-driven decisions.</p>

          <div class="login-features">
            <div class="login-feature">
              <div class="login-feature-icon">${ICON_BAR_CHART}</div>
              <span>Financial<br>Insights</span>
            </div>
            <div class="login-feature">
              <div class="login-feature-icon">${ICON_PIE_CHART}</div>
              <span>Real-time<br>Reports</span>
            </div>
            <div class="login-feature">
              <div class="login-feature-icon">${ICON_TRENDING_UP}</div>
              <span>Performance<br>Tracking</span>
            </div>
            <div class="login-feature">
              <div class="login-feature-icon">${ICON_SHIELD}</div>
              <span>Secure<br>Access</span>
            </div>
          </div>

          <div class="login-hero-chart">${LOGIN_CHART_SVG}</div>
          <div class="login-proof-row"><span><b>01</b> Clarity in every entry</span><span><b>02</b> Decisions with context</span></div>
        </div>

        <div class="login-security">
          <div class="login-security-icon">${ICON_SHIELD_SM}</div>
          <span>Your data is protected with enterprise grade security.</span>
        </div>
      </div>

      <div class="login-panel">
        <div class="login-card">
          <div class="login-card-eyebrow"><span></span> SECURE WORKSPACE ACCESS</div>
          <div class="login-card-icon">${ICON_SIGNAL}</div>
          ${loginResetMode ? `
          <p class="login-title">Reset your password</p>
          <p class="login-sub">Enter your account email — we'll send a reset link if it exists.</p>
          <form id="form-reset" novalidate>
            <label>Email Address</label>
            <div class="login-input-wrap">${ICON_MAIL}<input type="email" name="email" placeholder="Enter your email" required autocomplete="username"></div>
            <button class="btn full" style="background:var(--ink); color:#fff;" type="submit">Send Reset Link</button>
            ${resetMsg ? `<div class="${resetMsg.ok ? 'hint' : 'err-msg'}" style="margin-top:12px;">${resetMsg.text}</div>` : ''}
          </form>
          <p class="login-foot"><a id="back-to-signin">&larr; Back to sign in</a></p>
          ` : loginSignupMode ? `
          <p class="login-title">Create your account</p>
          <p class="login-sub">You'll be able to sign in right away — an admin still needs to grant you access to a branch before you'll see any data.</p>
          ${signupMsg && signupMsg.needsConfirmation ? `
          <div class="hint" style="margin:10px 0;">Almost there — check <b>${signupMsg.email}</b> for a confirmation link before signing in.</div>
          <p class="login-foot"><a id="back-to-signin">&larr; Back to sign in</a></p>
          ` : signupMsg && signupMsg.needsAccess ? `
          <div class="hint" style="margin:10px 0;">Your account was created. The default Main Branch will be assigned automatically when you sign in.</div>
          <p class="login-foot"><a id="back-to-signin">&larr; Back to sign in</a></p>
          ` : `
          <form id="form-signup" novalidate>
            <label>Full Name</label>
            <div class="login-input-wrap">${ICON_USER}<input type="text" name="full_name" placeholder="Your name" required autocomplete="name"></div>
            <label>Email Address</label>
            <div class="login-input-wrap">${ICON_MAIL}<input type="email" name="email" placeholder="Enter your email" required autocomplete="username"></div>
            <label>Password</label>
            <div class="login-input-wrap">
              ${ICON_LOCK}
              <input type="password" name="password" id="signup-password" placeholder="At least 8 characters" required minlength="8" autocomplete="new-password">
              <button type="button" class="toggle-pw" id="toggle-signup-pw" aria-label="Show password">${ICON_EYE}</button>
            </div>
            <div class="password-hint" id="signup-password-hint">Use at least 8 characters.</div>
            <button class="btn full" style="background:var(--ink); color:#fff;" type="submit">Create Account</button>
            ${signupMsg && !signupMsg.ok ? `<div class="err-msg" style="margin-top:12px;">${signupMsg.text}</div>` : ''}
          </form>
          <p class="login-foot"><a id="back-to-signin">&larr; Back to sign in</a></p>
          `}
          ` : `
          <p class="login-title">Welcome Back</p>
          <p class="login-sub">Sign in to access your financial dashboard</p>
          <form id="form-login" novalidate>
            <label>Email Address</label>
            <div class="login-input-wrap">${ICON_MAIL}<input type="email" name="email" placeholder="Enter your email" required autocomplete="username"></div>
            <label>Password</label>
            <div class="login-input-wrap">
              ${ICON_LOCK}
              <input type="password" name="password" id="login-password" placeholder="Enter your password" required autocomplete="current-password">
              <button type="button" class="toggle-pw" id="toggle-pw" aria-label="Show password">${ICON_EYE}</button>
            </div>
            <div class="login-row-between">
              <label class="check-row" style="margin:0; text-transform:none; font-weight:500; color:var(--ink-soft);"><input type="checkbox" name="remember" checked style="margin:0;"> Remember me</label>
              <a id="forgot-password">Forgot Password?</a>
            </div>
            <button class="btn full" style="background:var(--ink); color:#fff;" type="submit">${ICON_LOCK_SM_WHITE}Sign In</button>
            ${errMsg ? `<div class="err-msg" style="margin-top:12px;">${errMsg}</div>` : ''}
          </form>
          <p class="login-foot">Don't have an account? <a id="go-to-signup">Create Account</a></p>
          `}
        </div>
      </div>
    </div>`;
  const formLogin = document.getElementById('form-login');
  if(formLogin) formLogin.addEventListener('submit', async e=>{
    e.preventDefault();
    const fd = new FormData(e.target);
    const submitBtn = e.target.querySelector('button[type=submit]');
    submitBtn.disabled = true; submitBtn.innerHTML = 'Signing in…';
    try{
      await apiLogin(fd.get('email'), fd.get('password'), fd.get('remember') === 'on');
      await startApp();
    }catch(err){
      submitBtn.disabled = false; submitBtn.innerHTML = `${ICON_LOCK_SM_WHITE}Sign In`;
      renderLogin(err.message);
    }
  });
  const togglePw = document.getElementById('toggle-pw');
  if(togglePw) togglePw.addEventListener('click', ()=>{
    const pw = document.getElementById('login-password');
    const showing = pw.type === 'text';
    pw.type = showing ? 'password' : 'text';
    togglePw.innerHTML = showing ? ICON_EYE : ICON_EYE_OFF;
    togglePw.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  });
  const forgotLink = document.getElementById('forgot-password');
  if(forgotLink) forgotLink.addEventListener('click', (e)=>{
    e.preventDefault();
    loginResetMode = true; resetMsg = null; renderLogin();
  });
  const goToSignup = document.getElementById('go-to-signup');
  if(goToSignup) goToSignup.addEventListener('click', (e)=>{
    e.preventDefault();
    loginSignupMode = true; signupMsg = null; renderLogin();
  });
  const backToSignin = document.getElementById('back-to-signin');
  if(backToSignin) backToSignin.addEventListener('click', (e)=>{
    e.preventDefault();
    loginResetMode = false; resetMsg = null;
    loginSignupMode = false; signupMsg = null;
    renderLogin();
  });
  const formSignup = document.getElementById('form-signup');
  if(formSignup) formSignup.addEventListener('submit', async e=>{
    e.preventDefault();
    const fd = new FormData(formSignup);
    const email = fd.get('email');
    const submitBtn = formSignup.querySelector('button[type=submit]');
    submitBtn.disabled = true; submitBtn.innerHTML = 'Creating account…';
    try{
      const result = await apiSignup(email, fd.get('password'), fd.get('full_name'));
      if(result.needsConfirmation){
        signupMsg = { ok:true, needsConfirmation:true, email:result.email };
        renderLogin();
      } else {
        signupMsg = { ok:true, needsAccess:true, email:result.email };
        renderLogin();
      }
    }catch(err){
      submitBtn.disabled = false; submitBtn.innerHTML = 'Create Account';
      signupMsg = { ok:false, text: err.message };
      renderLogin();
    }
  });
  const toggleSignupPw = document.getElementById('toggle-signup-pw');
  if(toggleSignupPw) toggleSignupPw.addEventListener('click', ()=>{
    const pw = document.getElementById('signup-password');
    const showing = pw.type === 'text';
    pw.type = showing ? 'password' : 'text';
    toggleSignupPw.innerHTML = showing ? ICON_EYE : ICON_EYE_OFF;
    toggleSignupPw.setAttribute('aria-label', showing ? 'Show password' : 'Hide password');
  });
  const signupPassword = document.getElementById('signup-password');
  const signupPasswordHint = document.getElementById('signup-password-hint');
  if(signupPassword && signupPasswordHint) signupPassword.addEventListener('input', ()=>{
    const length = signupPassword.value.length;
    signupPasswordHint.textContent = length === 0 ? 'Use at least 8 characters.' :
      length < 8 ? `${8 - length} more character${8 - length === 1 ? '' : 's'} required.` : 'Password length looks good.';
    signupPasswordHint.classList.toggle('valid', length >= 8);
  });
  const formReset = document.getElementById('form-reset');
  if(formReset) formReset.addEventListener('submit', async e=>{
    e.preventDefault();
    const fd = new FormData(e.target);
    const submitBtn = e.target.querySelector('button[type=submit]');
    submitBtn.disabled = true; submitBtn.textContent = 'Sending…';
    try{
      await apiRequestPasswordReset(fd.get('email'));
      resetMsg = { ok:true, text:'If that email has an account, a reset link is on its way. Check your inbox.' };
    }catch(err){
      resetMsg = { ok:false, text: err.message };
    }
    renderLogin();
  });
}

async function startApp(){
  const s = getSession();
  if(!s){ renderLogin(); return; }
  if(!await restoreAuthSession(s)){
    setSession(null);
    renderLogin('Your session expired — please sign in again.');
    return;
  }
  currentUserEmail = s.user ? s.user.email : '';
  root().innerHTML = `<div class="loading-screen">Loading Happynet…</div>`;
  try{
    await loadState();
  }catch(e){
    if(e.code === 'ACCESS_PENDING'){ renderAccessPending(); return; }
    const msg = String(e && e.message || '');
    if(msg.includes('Could not load your access') || msg.includes('Could not validate your branch access') || msg.includes('no branch access')){
      renderLogin();
      return;
    }
    renderLogin(msg || 'Your session expired — please sign in again.');
    return;
  }
  render();
  loadAlerts(); // default tab is Dashboard, which shows alerts — load once on boot
  checkSyncHealth(); // silent Head-Office-only check; surfaces as a sidebar badge only if something's actually wrong
}

// Last-resort safety net for anything that slips past the specific
// try/catch blocks already in each async function — never meant to
// replace those (they give a much more specific, useful message), just a
// backstop so a genuinely unanticipated bug surfaces as a toast instead
// of failing completely silently.
window.addEventListener('error', (e)=>{
  console.error('Uncaught error:', e.error || e.message);
});
window.addEventListener('unhandledrejection', (e)=>{
  console.error('Unhandled promise rejection:', e.reason);
  if(typeof showToast === 'function'){
    showToast('Something unexpected went wrong: ' + (e.reason && e.reason.message ? e.reason.message : 'please try again.'), 'error');
  }
});

(async function boot(){
  // Both password-recovery and signup-confirmation links land here with
  // tokens in the URL fragment — Supabase's own hosted verification
  // already confirmed the link is genuine before handing back the token.
  const hash = window.location.hash;
  if(hash && hash.includes('access_token=')){
    const params = new URLSearchParams(hash.slice(1));
    const token = params.get('access_token');
    const refreshToken = params.get('refresh_token');
    const type = params.get('type');
    history.replaceState(null, '', window.location.pathname + window.location.search); // scrub tokens from the visible URL/history
    if(type === 'recovery' && token){
      recoveryToken = { accessToken:token, refreshToken };
      renderRecovery();
      return;
    }
    if(token && refreshToken){
      // A signup-confirmation link (or any other flow handing back a
      // ready session) — sign them straight in rather than making a
      // freshly-confirmed person land back at a bare login form.
      const expiresAt = Number(params.get('expires_at')) || (Math.floor(Date.now()/1000) + 3600);
      setSession({ access_token: token, refresh_token: refreshToken, expires_at: expiresAt, user: {} }, true);
      await startApp();
      return;
    }
  }
  const s = getSession();
  if(s){ await startApp(); } else { renderLogin(); }
})();

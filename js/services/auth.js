/* Direct Supabase authentication and the app's legacy session adapter. */
const SUPABASE_URL = 'https://xwbwabxqtnzsxcjhnmzc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3YndhYnhxdG56c3hjamhubXpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxODE5MDIsImV4cCI6MjEwMzc1NzkwMn0.MQWeXkA9dYcdAqhOOrlnmiT9Eryy6Mymcdto4jOFK7c';
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: { persistSession:false, autoRefreshToken:false, detectSessionInUrl:false }
});
const SESSION_KEY = 'happynet_session';
const ALLOWED_USER_ROLES = new Set(['owner','finance_manager','accountant','branch_manager','auditor','viewer']);

function waitForAuth(milliseconds){
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

async function provisionDefaultAccessFallback(){
  const { data } = await withAuthTimeout(supabaseClient.auth.getSession());
  const token = data && data.session && data.session.access_token;
  if(!token) return false;
  const response = await withAuthTimeout(fetch('/api/onboarding-access', {
    method:'POST',
    headers:{ Authorization:`Bearer ${token}`, 'Content-Type':'application/json' }
  }));
  if(!response.ok) return false;
  const body = await response.json();
  return !!(body && body.grant && body.grant.branch_id && ALLOWED_USER_ROLES.has(body.grant.role));
}

async function resolveUserAccess(user){
  const readAccessGrants = async () => {
    const result = await withAuthTimeout(supabaseClient
      .from('user_branch_access')
      .select('branch_id, role, branches(id, name, code)')
      .eq('user_id', user.id));
    if(result.error) throw result.error;
    return (result.data || []).filter(grant =>
      grant && typeof grant.branch_id === 'string' && ALLOWED_USER_ROLES.has(grant.role)
    ).map(grant => ({
      branch_id:grant.branch_id,
      role:grant.role,
      name:grant.branches && grant.branches.name,
      code:grant.branches && grant.branches.code
    }));
  };

  let lastError = null;
  for(let attempt = 0; attempt < 3; attempt++){
    try{
      const grants = await readAccessGrants();
      if(grants.length) return { grants, pending:false };
    }catch(error){ lastError = error; }

    if(attempt < 2) await waitForAuth(250 * (attempt + 1));
  }

  try{
    const defaultBranchResult = await withAuthTimeout(supabaseClient.rpc('ensure_default_branch_access'));
    if(defaultBranchResult && defaultBranchResult.error){
      const message = String(defaultBranchResult.error.message || '').toLowerCase();
      if(!message.includes('does not exist') && !message.includes('schema cache') && !message.includes('no active branch') && !message.includes('authentication is required')){
        lastError = defaultBranchResult.error;
      }
    }
  }catch(error){ lastError = error; }

  try{
    await provisionDefaultAccessFallback();
  }catch(error){ lastError = error; }

  try{
    const grants = await readAccessGrants();
    if(grants.length) return { grants, pending:false };
  }catch(error){ lastError = error; }

  // A missing grant is an authorization state, not a database exception.
  // If there are no active branches yet, surface the pending-access screen.
  // Otherwise, a default branch assignment can be provisioned automatically.
  try{
    const result = await withAuthTimeout(supabaseClient
      .from('branches')
      .select('id, name, code')
      .eq('is_active', true)
      .order('created_at', { ascending:true })
      .limit(1));
    if(result.error) throw result.error;
    const branch = (result.data || [])[0] || null;
    return { grants:[], pending:true, suggestedBranch:branch, queryError:lastError };
  }catch(error){
    if(lastError) throw lastError;
    throw error;
  }
}

function getSession(){
  try{
    const fromSession = sessionStorage.getItem(SESSION_KEY);
    if(fromSession) return JSON.parse(fromSession);
    return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
  }catch(e){ return null; }
}

function setSession(s, remember){
  if(remember === undefined) remember = !sessionStorage.getItem(SESSION_KEY);
  if(s){
    if(remember){ localStorage.setItem(SESSION_KEY, JSON.stringify(s)); sessionStorage.removeItem(SESSION_KEY); }
    else { sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); localStorage.removeItem(SESSION_KEY); }
  }else{
    localStorage.removeItem(SESSION_KEY);
    sessionStorage.removeItem(SESSION_KEY);
  }
}

function authErrorMessage(error){
  const code = String(error && (error.code || error.name || '')).toLowerCase();
  const message = String(error && error.message || '').toLowerCase();
  if(code.includes('invalid_login') || code.includes('invalid_credentials') || message.includes('invalid login credentials')){
    return 'The email or password is incorrect.';
  }
  if(code.includes('email_not_confirmed') || message.includes('email not confirmed')){
    return 'Please confirm your email address before signing in.';
  }
  if(code.includes('over_request_rate_limit') || code.includes('too_many_requests') || message.includes('rate limit') || message.includes('too many')){
    return 'Too many sign-in attempts. Please wait a few minutes and try again.';
  }
  if(code.includes('user_already_exists') || message.includes('already registered') || message.includes('already been registered')){
    return 'An account with this email already exists. Try signing in instead.';
  }
  if(code.includes('weak_password') || message.includes('password should be at least')){
    return 'Choose a stronger password with at least 8 characters.';
  }
  if(code.includes('timeout') || message.includes('timeout') || message.includes('network') || message.includes('failed to fetch')){
    return 'We could not reach authentication right now. Check your connection and try again.';
  }
  return error && error.message ? error.message : 'Sign in failed. Please try again.';
}

async function apiSignup(email, password, fullName){
  if(typeof email !== 'string' || !email.trim() || typeof password !== 'string' || password.length < 8){
    throw new Error('Enter a valid email and a password of at least 8 characters.');
  }
  try{
    const response = await withAuthTimeout(fetch('/api/signup', {
      method:'POST',
      headers:{ 'Content-Type':'application/json', Accept:'application/json' },
      body:JSON.stringify({ email:email.trim(), password, full_name:String(fullName || '').trim() })
    }));
    const body = await response.json().catch(()=>({}));
    if(!response.ok) throw new Error(body.error || 'Account creation did not complete. Please try again.');
    if(body.needs_confirmation) return { needsConfirmation:true, email:email.trim() };
    return { needsAccess:true, email:email.trim() };
  }catch(error){ throw new Error(authErrorMessage(error)); }
}

async function apiRequestPasswordReset(email){
  if(typeof email !== 'string' || !email.trim()) throw new Error('Email address is required.');
  try{
    const { error } = await withAuthTimeout(supabaseClient.auth.resetPasswordForEmail(email.trim(), {
      redirectTo:window.location.origin + window.location.pathname
    }));
    if(error) throw error;
  }catch(error){ throw new Error(authErrorMessage(error)); }
}

async function apiUpdatePassword(recoverySession, password){
  if(!recoverySession || !recoverySession.accessToken || !recoverySession.refreshToken){
    throw new Error('This password reset link is incomplete or has expired. Request a new link.');
  }
  if(typeof password !== 'string' || password.length < 8){
    throw new Error('Your new password must be at least 8 characters.');
  }
  try{
    const { error:setError } = await withAuthTimeout(supabaseClient.auth.setSession({
      access_token:recoverySession.accessToken,
      refresh_token:recoverySession.refreshToken
    }));
    if(setError) throw setError;
    const { error } = await withAuthTimeout(supabaseClient.auth.updateUser({ password }));
    if(error) throw error;
    await supabaseClient.auth.signOut({ scope:'local' }).catch(()=>{});
  }catch(error){ throw new Error(authErrorMessage(error)); }
}

function withAuthTimeout(promise, milliseconds = 15000){
  let timer;
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => {
      const error = new Error('Authentication request timed out.');
      error.code = 'auth_timeout';
      reject(error);
    }, milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function apiLogin(email, password, remember){
  if(typeof email !== 'string' || !email.trim() || typeof password !== 'string' || !password){
    throw new Error('Email and password are required.');
  }

  let authData;
  try{
    const result = await withAuthTimeout(supabaseClient.auth.signInWithPassword({ email:email.trim(), password }));
    if(result.error) throw result.error;
    authData = result.data;
  }catch(error){
    throw new Error(authErrorMessage(error));
  }

  const session = authData && authData.session;
  const user = authData && authData.user;
  if(!session || !session.access_token || !session.refresh_token || !user || !user.id){
    await supabaseClient.auth.signOut({ scope:'local' }).catch(()=>{});
    throw new Error('Sign in did not return a complete authentication session.');
  }

  let access;
  try{
    access = await resolveUserAccess(user);
  }catch(error){
    await supabaseClient.auth.signOut({ scope:'local' }).catch(()=>{});
    throw new Error('Could not validate your branch access. Please try again.');
  }

  const primaryGrant = access.grants[0];
  const sessionData = {
    access_token: session.access_token,
    refresh_token: session.refresh_token,
    token: session.access_token,
    expires_at: session.expires_at,
    user: { ...user, ...(primaryGrant || {}) },
    grants: access.grants,
    access_pending: access.pending,
    suggested_branch: access.suggestedBranch || null
  };
  setSession(sessionData, remember);
  return sessionData;
}

async function restoreAuthSession(storedSession){
  if(!storedSession || !storedSession.access_token || !storedSession.refresh_token) return false;
  try{
    const { data, error } = await withAuthTimeout(supabaseClient.auth.setSession({
      access_token:storedSession.access_token,
      refresh_token:storedSession.refresh_token
    }));
    return !error && !!(data && data.session && data.user);
  }catch(error){
    return false;
  }
}

async function apiRefresh(){
  const stored = getSession();
  if(!stored || !stored.refresh_token) return false;
  try{
    const { data, error } = await supabaseClient.auth.refreshSession({ refresh_token:stored.refresh_token });
    if(error || !data || !data.session || !data.user){ setSession(null); return false; }
    const grant = stored.user && stored.user.branch_id ? {
      branch_id:stored.user.branch_id, role:stored.user.role
    } : undefined;
    setSession({
      access_token:data.session.access_token,
      refresh_token:data.session.refresh_token,
      token:data.session.access_token,
      expires_at:data.session.expires_at,
      user:{ ...data.user, ...(grant || {}) },
      grants:stored.grants || (grant ? [grant] : [])
    });
    return true;
  }catch(e){ return false; }
}

async function apiLogout(){
  try{ await supabaseClient.auth.signOut({ scope:'local' }); }
  catch(e){ /* Always clear the app session below. */ }
  setSession(null);
}

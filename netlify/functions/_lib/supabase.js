// Shared helpers for all Netlify Functions in this app.
// Two Supabase clients are used, both server-side only — neither key ever
// reaches the browser:
//   - anon client:    used only to perform sign-in / token-refresh, exactly
//                      like a browser would, just from the function instead.
//   - admin client:    uses the service_role key. Used to (a) validate a
//                      user's access token on every request, and (b) read/
//                      write tables directly. Because this bypasses RLS,
//                      every function using it MUST run its own permission
//                      check via _lib/rbac.js before touching data — see
//                      requireBranchAccess() there.
const { createClient } = require('@supabase/supabase-js');

function anonClient(){
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken:false, persistSession:false }
  });
}

function adminClient(){
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken:false, persistSession:false }
  });
}

function bearerToken(event){
  const h = event.headers.authorization || event.headers.Authorization || '';
  return h.replace(/^Bearer\s+/i, '').trim();
}

// Validates the caller's access token and returns { user, admin }, or
// { error } if the token is missing/invalid/expired.
async function requireUser(event){
  const token = bearerToken(event);
  if(!token) return { error: 'Missing bearer token.' };
  const admin = adminClient();
  const { data, error } = await admin.auth.getUser(token);
  if(error || !data.user) return { error: 'Invalid or expired session.' };
  return { user: data.user, admin };
}

function json(statusCode, body){
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  };
}

module.exports = { anonClient, adminClient, bearerToken, requireUser, json };

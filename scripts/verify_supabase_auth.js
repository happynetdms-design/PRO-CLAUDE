/*
 * Direct Supabase Auth diagnostic.
 * Usage: node scripts/verify_supabase_auth.js
 *
 * This intentionally uses the supplied bootstrap credentials so it can verify
 * the repaired account without Netlify functions or a service-role key.
 */
const SUPABASE_URL = 'https://xwbwabxqtnzsxcjhnmzc.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Inh3YndhYnhxdG56c3hjamhubXpjIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODgxODE5MDIsImV4cCI6MjEwMzc1NzkwMn0.MQWeXkA9dYcdAqhOOrlnmiT9Eryy6Mymcdto4jOFK7c';
const EMAIL = 'admin@happy.com';
const PASSWORD = '12345678';
const USER_ID = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
const ROLES = new Set(['owner','finance_manager','accountant','branch_manager','auditor','viewer']);

function headers(token){
  return { apikey:SUPABASE_ANON_KEY, Authorization:`Bearer ${token || SUPABASE_ANON_KEY}` };
}
async function request(path, options = {}){
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try{
    return await fetch(`${SUPABASE_URL}${path}`, {
      ...options,
      headers:{ ...headers(options.token), ...(options.headers || {}) },
      signal:controller.signal
    });
  }finally{ clearTimeout(timer); }
}
async function json(res){
  const text = await res.text();
  try{ return text ? JSON.parse(text) : {}; }catch{ return { raw:text }; }
}

(async () => {
  try{
    const authRes = await request('/auth/v1/token?grant_type=password', {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ email:EMAIL, password:PASSWORD })
    });
    const authBody = await json(authRes);
    if(!authRes.ok) throw new Error(`Auth failed (${authRes.status}): ${authBody.error_description || authBody.msg || authBody.message || 'unknown error'}`);
    if(!authBody.access_token || !authBody.refresh_token || !authBody.user || !authBody.user.id){
      throw new Error('Auth returned an incomplete session payload.');
    }
    if(authBody.user.id !== USER_ID) throw new Error(`Unexpected user id: ${authBody.user.id}`);

    const accessRes = await request(`/rest/v1/user_branch_access?select=branch_id,role&user_id=eq.${encodeURIComponent(USER_ID)}`, { token:authBody.access_token });
    const accessBody = await json(accessRes);
    if(!accessRes.ok) throw new Error(`Access query failed (${accessRes.status}): ${accessBody.message || accessBody.details || 'unknown error'}`);
    const valid = (Array.isArray(accessBody) ? accessBody : []).filter(row => row.branch_id && ROLES.has(row.role));
    if(!valid.length) throw new Error('No active branch grant with an allowed role was returned.');

    console.log(JSON.stringify({
      ok:true,
      auth_status:authRes.status,
      user_id:authBody.user.id,
      email:authBody.user.email,
      branch_grants:valid
    }, null, 2));
  }catch(error){
    console.error(JSON.stringify({ ok:false, error:error.name === 'AbortError' ? 'Request timed out.' : error.message }, null, 2));
    process.exitCode = 1;
  }
})();

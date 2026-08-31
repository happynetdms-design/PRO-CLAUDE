// Self-service signup — creates a real Supabase Auth account so a new
// person can authenticate, but deliberately grants them access to
// nothing. A row only appears in user_branch_access when a Head Office
// admin explicitly adds one via Staff & Access (staff.js) — this endpoint
// never touches that table. loadState() in the frontend already refuses
// to start the app for a user with zero branch grants ("ask an admin to
// grant you access"), so a self-registered account is fully authenticated
// but functionally inert until someone deliberately lets it in.
const { anonClient, adminClient, json } = require('./_lib/supabase');

function isValidEmail(email){
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

exports.handler = async (event) => {
  if(event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });

  let body;
  try{ body = JSON.parse(event.body || '{}'); }
  catch(e){ return json(400, { error: 'Invalid JSON body.' }); }

  const { email, password, full_name } = body;
  if(!email || !isValidEmail(email)) return json(400, { error: 'A valid email address is required.' });
  if(!password || password.length < 8) return json(400, { error: 'Password must be at least 8 characters.' });

  try{
    const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL || `https://${event.headers.host}`;
    const anon = anonClient();
    const { data, error } = await anon.auth.signUp({
      email, password,
      options: {
        emailRedirectTo: siteUrl + '/',
        data: full_name ? { full_name } : undefined
      }
    });
    if(error) return json(400, { error: error.message });

    // user_profiles has no auto-populating trigger — create the row here
    // so the name entered at signup actually shows up in the app (me.js
    // reads full_name from this table, not from Auth's own metadata).
    // Uses the admin client since a not-yet-confirmed user has no session
    // to write with themselves yet.
    if(data.user && full_name){
      const admin = adminClient();
      const { error: profileErr } = await admin.from('user_profiles').upsert({ user_id: data.user.id, full_name });
      if(profileErr) console.error('signup: could not create user_profiles row', profileErr);
      // Not fatal — the account itself is real and can sign in either way.
    }

    if(data.session){
      // Email confirmation is disabled on this project — the account is
      // immediately usable. Return the same shape login.js does, so the
      // frontend can sign them straight in.
      return json(201, {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
        expires_at: data.session.expires_at,
        user: { id: data.user.id, email: data.user.email },
        needs_confirmation: false
      });
    }

    // Email confirmation is required — no session yet. The person needs
    // to click the link in their inbox before they can sign in at all.
    return json(201, { needs_confirmation: true });
  }catch(e){
    console.error('signup error', e);
    return json(500, { error: 'Unexpected error creating the account.' });
  }
};

// The other half of password-reset.js. That endpoint asks Supabase to
// email a recovery link; this one is what actually sets the new password
// once the person clicks it and comes back with a valid recovery token.
//
// The recovery link (per password-reset.js's redirectTo) lands the person
// back on this app with #access_token=...&type=recovery in the URL —
// Supabase's own hosted verification already confirmed the link is
// genuine before handing back that token, so this only needs to confirm
// the token identifies a real user (anon client, no password needed —
// that's the whole point of a recovery token) and then use the admin
// client to set the new password.
const { anonClient, adminClient, json } = require('./_lib/supabase');

exports.handler = async (event) => {
  if(event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });

  let body;
  try{ body = JSON.parse(event.body || '{}'); }
  catch(e){ return json(400, { error: 'Invalid JSON body.' }); }

  const { access_token, new_password } = body;
  if(!access_token || !new_password) return json(400, { error: 'access_token and new_password are required.' });
  if(new_password.length < 8) return json(400, { error: 'Password must be at least 8 characters.' });

  try{
    const anon = anonClient();
    const { data: userData, error: userErr } = await anon.auth.getUser(access_token);
    if(userErr || !userData || !userData.user){
      return json(401, { error: 'This reset link has expired or was already used. Request a new one.' });
    }

    const admin = adminClient();
    const { error: updateErr } = await admin.auth.admin.updateUserById(userData.user.id, { password: new_password });
    if(updateErr) return json(500, { error: updateErr.message });

    return json(200, { ok: true });
  }catch(e){
    console.error('password-update error', e);
    return json(500, { error: 'Unexpected error setting the new password.' });
  }
};

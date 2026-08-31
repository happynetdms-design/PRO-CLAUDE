const { bearerToken, adminClient, json } = require('./_lib/supabase');

exports.handler = async (event) => {
  if(event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });

  const token = bearerToken(event);
  if(!token) return json(200, { ok: true }); // nothing to revoke, client clears local session anyway

  try{
    const admin = adminClient();
    // Invalidates the refresh token family behind this access token.
    await admin.auth.admin.signOut(token);
  }catch(e){
    // Non-fatal — the client discards its local session regardless.
    console.error('logout error', e);
  }
  return json(200, { ok: true });
};

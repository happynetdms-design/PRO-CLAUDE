const { anonClient, json } = require('./_lib/supabase');

exports.handler = async (event) => {
  if(event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });

  let body;
  try{ body = JSON.parse(event.body || '{}'); }
  catch(e){ return json(400, { error: 'Invalid JSON body.' }); }

  const { refresh_token } = body;
  if(!refresh_token) return json(400, { error: 'refresh_token is required.' });

  try{
    const supabase = anonClient();
    const { data, error } = await supabase.auth.refreshSession({ refresh_token });
    if(error) return json(401, { error: error.message });

    return json(200, {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      user: { id: data.user.id, email: data.user.email }
    });
  }catch(e){
    console.error('refresh error', e);
    return json(500, { error: 'Unexpected error refreshing session.' });
  }
};

const { anonClient, json } = require('./_lib/supabase');

exports.handler = async (event) => {
  if(event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });

  let body;
  try{ body = JSON.parse(event.body || '{}'); }
  catch(e){ return json(400, { error: 'Invalid JSON body.' }); }

  const { email, password } = body;
  if(!email || !password) return json(400, { error: 'Email and password are required.' });

  try{
    const supabase = anonClient();
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if(error) return json(401, { error: error.message });

    return json(200, {
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token,
      expires_at: data.session.expires_at,
      user: { id: data.user.id, email: data.user.email }
    });
  }catch(e){
    console.error('login error', e);
    return json(500, { error: 'Unexpected error signing in.' });
  }
};

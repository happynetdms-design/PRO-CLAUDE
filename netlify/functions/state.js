const { requireUser, json } = require('./_lib/supabase');

const STATE_ID = 'happynet'; // one company, one branch — one shared row

exports.handler = async (event) => {
  const { user, admin, error } = await requireUser(event);
  if(error) return json(401, { error });

  if(event.httpMethod === 'GET'){
    const { data, error: dbErr } = await admin
      .from('app_state')
      .select('data')
      .eq('id', STATE_ID)
      .maybeSingle();
    if(dbErr) return json(500, { error: dbErr.message });
    return json(200, { data: data ? data.data : {} });
  }

  if(event.httpMethod === 'POST'){
    let body;
    try{ body = JSON.parse(event.body || '{}'); }
    catch(e){ return json(400, { error: 'Invalid JSON body.' }); }

    if(typeof body.data !== 'object' || body.data === null){
      return json(400, { error: 'Body must include a "data" object.' });
    }

    const { error: dbErr } = await admin.from('app_state').upsert({
      id: STATE_ID,
      data: body.data,
      updated_by: user.id,
      updated_at: new Date().toISOString()
    });
    if(dbErr) return json(500, { error: dbErr.message });
    return json(200, { ok: true });
  }

  return json(405, { error: 'Method not allowed.' });
};

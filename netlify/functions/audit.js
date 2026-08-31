const { requireUser, adminClient, json } = require('./_lib/supabase');
const { getAccess } = require('./_lib/rbac');

exports.handler = async (event) => {
  if(event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed.' });
  const admin = adminClient();

  const { user, error } = await requireUser(event);
  if(error) return json(401, { error });

  try{
    const access = await getAccess(admin, user.id);
    if(!access.isHeadOffice){
      return json(403, { error: 'The audit log is visible to Head Office roles only.' });
    }

    const { table_name, record_id, limit } = event.queryStringParameters || {};
    let q = admin.from('audit_log').select('*');
    if(table_name) q = q.eq('table_name', table_name);
    if(record_id) q = q.eq('record_id', record_id);
    q = q.order('changed_at', { ascending: false }).limit(Math.min(Number(limit) || 200, 1000));

    const { data, error: dbErr } = await q;
    if(dbErr) return json(500, { error: dbErr.message });
    return json(200, { audit_log: data });
  }catch(e){
    console.error('audit error', e);
    return json(500, { error: 'Unexpected error loading the audit log.' });
  }
};

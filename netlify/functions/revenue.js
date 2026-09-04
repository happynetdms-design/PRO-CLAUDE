const { requireUser, adminClient, json } = require('./_lib/supabase');
const { requireBranchAccess } = require('./_lib/rbac');

exports.handler = async (event) => {
  const admin = adminClient();
  const method = event.httpMethod;

  // branch_id comes from the query string for GET, from the body otherwise.
  let body = {};
  if(method !== 'GET'){
    try{ body = JSON.parse(event.body || '{}'); }
    catch(e){ return json(400, { error: 'Invalid JSON body.' }); }
  }
  const branchId = method === 'GET'
    ? (event.queryStringParameters || {}).branch_id
    : body.branch_id;

  const ctx = await requireBranchAccess(event, requireUser, admin, branchId, { write: method !== 'GET' });
  if(ctx.error) return json(ctx.status, { error: ctx.error });

  try{
    if(method === 'GET'){
      const { from, to } = event.queryStringParameters || {};
      let q = admin.from('revenue_entries').select('*').eq('branch_id', branchId).eq('is_deleted', false);
      if(from) q = q.gte('entry_date', from);
      if(to) q = q.lte('entry_date', to);
      const { data, error } = await q.order('entry_date', { ascending: false });
      if(error) return json(500, { error: error.message });
      return json(200, { revenue: data });
    }

    if(method === 'POST'){
      const rows = Array.isArray(body.entries) ? body.entries : [body];
      for(const r of rows){
        if(!r.entry_date || r.amount_kes === undefined || r.amount_kes === null){
          return json(400, { error: 'Each entry needs entry_date and amount_kes.' });
        }
      }

      const inserted = [];
      const skipped = [];
      for(const r of rows){
        const payload = {
          ...(r.id ? { id: r.id } : {}),
          branch_id: branchId, entry_date: r.entry_date,
          account_id: r.account_id || null, category_id: r.category_id || null,
          amount_kes: r.amount_kes, notes: r.notes || null,
          source: r.source || 'manual', created_by: ctx.user.id
        };
        const { data, error } = await admin.from('revenue_entries').insert(payload).select().maybeSingle();
        if(error){ skipped.push({ row: r, reason: error.message }); continue; }
        inserted.push(data);
      }
      return json(201, { inserted, skipped, revenue: inserted }); // `revenue` kept for any existing caller expecting the old single-array shape
    }

    if(method === 'PATCH'){
      if(!body.id) return json(400, { error: 'id is required.' });
      const updatable = ['entry_date', 'account_id', 'category_id', 'amount_kes', 'notes'];
      const patch = {};
      for(const k of updatable) if(body[k] !== undefined) patch[k] = body[k];
      patch.updated_at = new Date().toISOString();

      const { data, error } = await admin
        .from('revenue_entries').update(patch)
        .eq('id', body.id).eq('branch_id', branchId)
        .select().maybeSingle();
      if(error) return json(500, { error: error.message });
      if(!data) return json(404, { error: 'Entry not found on this branch.' });
      return json(200, { revenue: data });
    }

    if(method === 'DELETE'){
      if(!body.id) return json(400, { error: 'id is required.' });
      const { data, error } = await admin
        .from('revenue_entries')
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .eq('id', body.id).eq('branch_id', branchId)
        .select().maybeSingle();
      if(error) return json(500, { error: error.message });
      if(!data) return json(404, { error: 'Entry not found on this branch.' });
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed.' });
  }catch(e){
    console.error('revenue error', e);
    return json(500, { error: 'Unexpected error handling revenue.' });
  }
};

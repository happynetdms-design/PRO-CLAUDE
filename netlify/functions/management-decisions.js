const { requireUser, adminClient, json } = require('./_lib/supabase');
const { requireBranchAccess } = require('./_lib/rbac');

exports.handler = async (event) => {
  const admin = adminClient();
  const method = event.httpMethod;

  let body = {};
  if(method !== 'GET'){
    try{ body = JSON.parse(event.body || '{}'); }
    catch(e){ return json(400, { error: 'Invalid JSON body.' }); }
  }
  const branchId = method === 'GET' ? (event.queryStringParameters || {}).branch_id : body.branch_id;

  const ctx = await requireBranchAccess(event, requireUser, admin, branchId, { write: method !== 'GET' });
  if(ctx.error) return json(ctx.status, { error: ctx.error });

  try{
    if(method === 'GET'){
      const { data, error } = await admin.from('management_decisions').select('*').eq('branch_id', branchId)
        .order('status', { ascending: true })
        .order('priority', { ascending: false })
        .order('due_date', { ascending: true, nullsFirst: false });
      if(error) return json(500, { error: error.message });
      return json(200, { decisions: data });
    }

    if(method === 'POST'){
      const { title, description, priority, owner_name, due_date, source } = body;
      if(!title || !title.trim()) return json(400, { error: 'title is required.' });
      const payload = {
        branch_id: branchId, title: title.trim(), description: description || null,
        priority: ['low','medium','high','critical'].includes(priority) ? priority : 'medium',
        owner_name: owner_name || null, due_date: due_date || null,
        source: source === 'risk_flag' ? 'risk_flag' : 'manual',
        created_by: ctx.user.id
      };
      const { data, error } = await admin.from('management_decisions').insert(payload).select().maybeSingle();
      if(error) return json(500, { error: error.message });
      return json(201, { decision: data });
    }

    if(method === 'PATCH'){
      const { id, status, title, description, priority, owner_name, due_date } = body;
      if(!id) return json(400, { error: 'id is required.' });
      const patch = {};
      if(status !== undefined){
        if(!['open','in_progress','done','dismissed'].includes(status)) return json(400, { error: 'Invalid status.' });
        patch.status = status;
        if(status === 'done' || status === 'dismissed'){ patch.resolved_by = ctx.user.id; patch.resolved_at = new Date().toISOString(); }
        else { patch.resolved_by = null; patch.resolved_at = null; }
      }
      if(title !== undefined) patch.title = title;
      if(description !== undefined) patch.description = description;
      if(priority !== undefined) patch.priority = priority;
      if(owner_name !== undefined) patch.owner_name = owner_name;
      if(due_date !== undefined) patch.due_date = due_date;
      const { data, error } = await admin.from('management_decisions').update(patch).eq('id', id).eq('branch_id', branchId).select().maybeSingle();
      if(error) return json(500, { error: error.message });
      if(!data) return json(404, { error: 'Decision not found on this branch.' });
      return json(200, { decision: data });
    }

    return json(405, { error: 'Method not allowed.' });
  }catch(e){
    console.error('management-decisions error', e);
    return json(500, { error: 'Unexpected error handling management decisions.' });
  }
};

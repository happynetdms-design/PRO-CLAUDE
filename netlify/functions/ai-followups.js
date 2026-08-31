// AI follow-ups — a human clicks "Track this" on an assistant message that
// made a recommendation worth acting on. The AI never proposes a
// structured action and never executes anything; this is a plain to-do
// list a person curates and resolves themselves. See
// hfms_foundation_fix_11_ai_followups.sql for why this is deliberately
// simpler than an "AI action-proposal" workflow.
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
      const { data, error } = await admin.from('ai_follow_ups').select('*').eq('branch_id', branchId)
        .order('status', { ascending: true }).order('created_at', { ascending: false });
      if(error) return json(500, { error: error.message });
      return json(200, { follow_ups: data });
    }

    if(method === 'POST'){
      const { description, message_id } = body;
      if(!description || !description.trim()) return json(400, { error: 'description is required.' });
      const { data, error } = await admin.from('ai_follow_ups')
        .insert({ branch_id: branchId, description: description.trim(), message_id: message_id || null, created_by: ctx.user.id })
        .select().maybeSingle();
      if(error) return json(500, { error: error.message });
      return json(201, { follow_up: data });
    }

    if(method === 'PATCH'){
      const { id, status } = body;
      if(!id || !status) return json(400, { error: 'id and status are required.' });
      if(!['done','dismissed','open'].includes(status)) return json(400, { error: "status must be 'done', 'dismissed', or 'open'." });
      const patch = { status };
      if(status !== 'open'){ patch.resolved_by = ctx.user.id; patch.resolved_at = new Date().toISOString(); }
      const { data, error } = await admin.from('ai_follow_ups').update(patch).eq('id', id).eq('branch_id', branchId).select().maybeSingle();
      if(error) return json(500, { error: error.message });
      if(!data) return json(404, { error: 'Follow-up not found on this branch.' });
      return json(200, { follow_up: data });
    }

    return json(405, { error: 'Method not allowed.' });
  }catch(e){
    console.error('ai-followups error', e);
    return json(500, { error: 'Unexpected error handling AI follow-ups.' });
  }
};

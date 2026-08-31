// Per-branch home for the app's few remaining un-normalized fields:
// categories, monthlyArchive, closedMonths. See supabase/branch_misc_state.sql
// for why this exists — the old /api/state (state.js) is a single global
// row and doesn't know about branches; this does.
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
  const branchId = method === 'GET'
    ? (event.queryStringParameters || {}).branch_id
    : body.branch_id;

  const ctx = await requireBranchAccess(event, requireUser, admin, branchId, { write: method !== 'GET' });
  if(ctx.error) return json(ctx.status, { error: ctx.error });

  try{
    if(method === 'GET'){
      const { data, error } = await admin
        .from('branch_misc_state').select('data').eq('branch_id', branchId).maybeSingle();
      if(error) return json(500, { error: error.message });
      return json(200, { data: data ? data.data : {} });
    }

    if(method === 'POST'){
      if(!body.data || typeof body.data !== 'object') return json(400, { error: 'data (object) is required.' });
      const { data, error } = await admin
        .from('branch_misc_state')
        .upsert({ branch_id: branchId, data: body.data, updated_by: ctx.user.id })
        .select('data').maybeSingle();
      if(error) return json(500, { error: error.message });
      return json(200, { data: data.data });
    }

    return json(405, { error: 'Method not allowed.' });
  }catch(e){
    console.error('branch-state error', e);
    return json(500, { error: 'Unexpected error handling branch state.' });
  }
};

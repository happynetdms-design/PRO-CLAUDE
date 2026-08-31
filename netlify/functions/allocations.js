const { requireUser, adminClient, json } = require('./_lib/supabase');
const { requireBranchAccess } = require('./_lib/rbac');

const BUCKETS = ['profit', 'owner_debt', 'tax', 'opex'];

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
      const { period } = event.queryStringParameters || {};
      let q = admin.from('allocations').select('*').eq('branch_id', branchId);
      if(period) q = q.eq('period', period);
      const { data, error } = await q.order('period', { ascending: false });
      if(error) return json(500, { error: error.message });
      return json(200, { allocations: data });
    }

    if(method === 'POST'){
      // Records/overwrites the computed allocation for each bucket in a
      // period. The frontend does the Profit First math (revenue x each
      // percentage from profit_first_settings); this endpoint just persists
      // the result as the auditable "proof" record.
      if(!body.period || !Array.isArray(body.buckets)){
        return json(400, { error: 'period and buckets[] are required.' });
      }
      for(const b of body.buckets){
        if(!BUCKETS.includes(b.bucket) || b.amount_kes === undefined){
          return json(400, { error: `Each bucket needs a valid name (${BUCKETS.join(', ')}) and amount_kes.` });
        }
      }
      const rows = body.buckets.map(b => ({
        branch_id: branchId,
        period: body.period,
        bucket: b.bucket,
        amount_kes: b.amount_kes,
        computed_at: new Date().toISOString()
      }));
      const { data, error } = await admin
        .from('allocations')
        .upsert(rows, { onConflict: 'branch_id,period,bucket' })
        .select();
      if(error) return json(500, { error: error.message });
      return json(200, { allocations: data });
    }

    if(method === 'PATCH'){
      if(!body.id) return json(400, { error: 'id is required.' });
      const { data, error } = await admin
        .from('allocations')
        .update({ approved_by: ctx.user.id, approved_at: new Date().toISOString(), proof_note: body.proof_note || null })
        .eq('id', body.id).eq('branch_id', branchId)
        .select().maybeSingle();
      if(error) return json(500, { error: error.message });
      if(!data) return json(404, { error: 'Allocation not found on this branch.' });
      return json(200, { allocation: data });
    }

    return json(405, { error: 'Method not allowed.' });
  }catch(e){
    console.error('allocations error', e);
    return json(500, { error: 'Unexpected error handling allocations.' });
  }
};

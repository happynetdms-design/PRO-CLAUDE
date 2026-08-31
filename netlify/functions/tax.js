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
        .from('tax_obligations')
        .select('*, tax_payments(id, payment_date, amount_kes, reference)')
        .eq('branch_id', branchId)
        .order('tax_type');
      if(error) return json(500, { error: error.message });
      return json(200, { tax_obligations: data });
    }

    if(method === 'POST'){
      if(!body.tax_type) return json(400, { error: 'tax_type is required.' });
      const payload = {
        ...(body.id ? { id: body.id } : {}),
        branch_id: branchId,
        tax_type: body.tax_type,
        applicable: body.applicable !== undefined ? body.applicable : true,
        frequency: body.frequency || 'Monthly',
        due_day_of_month: body.due_day_of_month || null,
        manual_next_due_date: body.manual_next_due_date || null,
        estimated_amount_kes: body.estimated_amount_kes || 0,
        filing_authority: body.filing_authority || 'KRA',
        notes: body.notes || null
      };
      const { data, error } = await admin.from('tax_obligations').insert(payload).select().maybeSingle();
      if(error){
        if(error.code === '23505') return json(409, { error: `${body.tax_type} already exists on this branch.` });
        return json(500, { error: error.message });
      }
      return json(201, { tax_obligation: data });
    }

    if(method === 'PATCH'){
      if(!body.id) return json(400, { error: 'id is required.' });
      const updatable = ['tax_type', 'applicable', 'frequency', 'due_day_of_month',
        'manual_next_due_date', 'estimated_amount_kes', 'filing_authority', 'notes'];
      const patch = {};
      for(const k of updatable) if(body[k] !== undefined) patch[k] = body[k];
      const { data, error } = await admin
        .from('tax_obligations').update(patch)
        .eq('id', body.id).eq('branch_id', branchId)
        .select().maybeSingle();
      if(error) return json(500, { error: error.message });
      if(!data) return json(404, { error: 'Tax obligation not found on this branch.' });
      return json(200, { tax_obligation: data });
    }

    if(method === 'DELETE'){
      if(!body.id) return json(400, { error: 'id is required.' });
      const { error } = await admin.from('tax_obligations').delete()
        .eq('id', body.id).eq('branch_id', branchId);
      if(error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed.' });
  }catch(e){
    console.error('tax error', e);
    return json(500, { error: 'Unexpected error handling tax obligations.' });
  }
};

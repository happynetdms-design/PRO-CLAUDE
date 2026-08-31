const { requireUser, adminClient, json } = require('./_lib/supabase');
const { requireBranchAccess } = require('./_lib/rbac');

exports.handler = async (event) => {
  if(event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
  const admin = adminClient();

  let body;
  try{ body = JSON.parse(event.body || '{}'); }
  catch(e){ return json(400, { error: 'Invalid JSON body.' }); }

  const { branch_id: branchId, tax_obligation_id, payment_date, amount_kes, reference } = body;
  const ctx = await requireBranchAccess(event, requireUser, admin, branchId, { write: true });
  if(ctx.error) return json(ctx.status, { error: ctx.error });

  if(!tax_obligation_id || !payment_date || amount_kes === undefined){
    return json(400, { error: 'tax_obligation_id, payment_date and amount_kes are required.' });
  }

  try{
    const { data: ob, error: obErr } = await admin
      .from('tax_obligations').select('id').eq('id', tax_obligation_id).eq('branch_id', branchId).maybeSingle();
    if(obErr) return json(500, { error: obErr.message });
    if(!ob) return json(404, { error: 'Tax obligation not found on this branch.' });

    const { data, error } = await admin
      .from('tax_payments')
      .insert({ tax_obligation_id, payment_date, amount_kes, reference: reference || null, created_by: ctx.user.id })
      .select().maybeSingle();
    if(error) return json(500, { error: error.message });
    return json(201, { payment: data });
  }catch(e){
    console.error('tax-payments error', e);
    return json(500, { error: 'Unexpected error recording tax payment.' });
  }
};

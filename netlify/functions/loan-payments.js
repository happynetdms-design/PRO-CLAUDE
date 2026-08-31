// Plain CRUD for loan_payments. Balance math (loan.current_balance_kes) is
// computed client-side, same as the existing app already does, and synced
// separately via /api/loans — this endpoint does NOT adjust loan balances
// itself, to avoid double-applying the change.
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
      // loan_payments has no branch_id of its own — scope through loans.
      const { data: loanIds } = await admin.from('loans').select('id').eq('branch_id', branchId);
      const ids = (loanIds || []).map(l => l.id);
      if(ids.length === 0) return json(200, { loan_payments: [] });
      const { data, error } = await admin
        .from('loan_payments').select('*').in('loan_id', ids)
        .order('payment_date', { ascending: false });
      if(error) return json(500, { error: error.message });
      return json(200, { loan_payments: data });
    }

    if(method === 'POST'){
      if(!body.loan_id || !body.payment_date || body.amount_kes === undefined){
        return json(400, { error: 'loan_id, payment_date and amount_kes are required.' });
      }
      // Confirm the loan is actually on this branch before attaching a payment to it.
      const { data: loan } = await admin.from('loans').select('id').eq('id', body.loan_id).eq('branch_id', branchId).maybeSingle();
      if(!loan) return json(404, { error: 'Loan not found on this branch.' });

      const payload = {
        ...(body.id ? { id: body.id } : {}),
        loan_id: body.loan_id,
        payment_date: body.payment_date,
        amount_kes: body.amount_kes,
        note: body.note || null,
        created_by: ctx.user.id
      };
      const { data, error } = await admin.from('loan_payments').insert(payload).select().maybeSingle();
      if(error) return json(500, { error: error.message });
      return json(201, { payment: data });
    }

    if(method === 'PATCH'){
      if(!body.id) return json(400, { error: 'id is required.' });
      const updatable = ['loan_id', 'payment_date', 'amount_kes', 'note'];
      const patch = {};
      for(const k of updatable) if(body[k] !== undefined) patch[k] = body[k];
      const { data, error } = await admin.from('loan_payments').update(patch).eq('id', body.id).select().maybeSingle();
      if(error) return json(500, { error: error.message });
      if(!data) return json(404, { error: 'Payment not found.' });
      return json(200, { payment: data });
    }

    if(method === 'DELETE'){
      if(!body.id) return json(400, { error: 'id is required.' });
      const { error } = await admin.from('loan_payments').delete().eq('id', body.id);
      if(error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed.' });
  }catch(e){
    console.error('loan-payments error', e);
    return json(500, { error: 'Unexpected error handling loan payments.' });
  }
};

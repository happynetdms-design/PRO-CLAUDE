// Accounts Payable — bills, payments, and aging. Approval and payment
// posting call the SQL functions from hfms_foundation_fix_04.sql (which
// do the actual double-entry work) rather than duplicating that logic here.
const { requireUser, adminClient, json } = require('./_lib/supabase');
const { requireBranchAccess } = require('./_lib/rbac');

// Same category-by-name resolution pattern as expenses.js — categories are
// plain names in this app, not something the user picks an ID for.
async function resolveCategoryId(admin, branchId, categoryName){
  if(!categoryName) return null;
  const { data } = await admin.from('categories')
    .select('id').eq('branch_id', branchId).eq('name', categoryName).eq('kind', 'expense').maybeSingle();
  if(data) return data.id;
  const { data: created, error } = await admin.from('categories')
    .insert({ branch_id: branchId, name: categoryName, kind: 'expense' })
    .select('id').maybeSingle();
  if(error) return null;
  return created.id;
}

exports.handler = async (event) => {
  const admin = adminClient();
  const method = event.httpMethod;
  const path = (event.path || '').split('/').pop(); // supports /api/bills and /api/bills/aging via redirect alias

  let body = {};
  if(method !== 'GET'){
    try{ body = JSON.parse(event.body || '{}'); }
    catch(e){ return json(400, { error: 'Invalid JSON body.' }); }
  }
  const branchId = method === 'GET' ? (event.queryStringParameters || {}).branch_id : body.branch_id;

  const ctx = await requireBranchAccess(event, requireUser, admin, branchId, { write: method !== 'GET' });
  if(ctx.error) return json(ctx.status, { error: ctx.error });

  try{
    const action = (event.queryStringParameters || {}).action;

    if(method === 'GET' && action === 'aging'){
      const { data, error } = await admin.from('v_hfms_ap_aging').select('*').eq('branch_id', branchId).order('days_overdue', { ascending: false });
      if(error) return json(500, { error: error.message });
      return json(200, { aging: data });
    }

    if(method === 'GET'){
      const { data, error } = await admin
        .from('bills')
        .select('*, suppliers(name), bill_payments(id, payment_date, amount_kes, reference)')
        .eq('branch_id', branchId).eq('is_deleted', false)
        .order('invoice_date', { ascending: false });
      if(error) return json(500, { error: error.message });
      return json(200, { bills: data });
    }

    if(method === 'POST' && action === 'approve'){
      if(!body.id) return json(400, { error: 'id is required.' });
      // Same separation-of-duties restriction as expense approvals — an
      // Accountant can create and log a bill, but approving it (which
      // posts a real expense to the ledger) needs a Branch Manager or
      // Head Office. This was missing when bills.js was first built;
      // fixing it here rather than leaving it inconsistent with expenses.
      if(!ctx.access.isHeadOffice && ctx.role !== 'branch_manager'){
        return json(403, { error: 'Only a Branch Manager or Head Office can approve a bill.' });
      }
      const { data: je, error } = await admin.rpc('hfms_post_bill_approval', { p_bill_id: body.id });
      if(error) return json(400, { error: error.message });
      return json(200, { journal_entry_id: je });
    }

    if(method === 'POST' && action === 'pay'){
      const { bill_id, payment_date, amount_kes, account_name, reference } = body;
      if(!bill_id || !payment_date || !amount_kes) return json(400, { error: 'bill_id, payment_date and amount_kes are required.' });
      let account_id = null;
      if(account_name){
        const { data: acc } = await admin.from('financial_accounts').select('id').eq('branch_id', branchId).eq('name', account_name).maybeSingle();
        account_id = acc ? acc.id : null;
      }
      const { data: payment, error: payErr } = await admin
        .from('bill_payments')
        .insert({ bill_id, payment_date, amount_kes, account_id, reference: reference || null, created_by: ctx.user.id })
        .select().maybeSingle();
      if(payErr) return json(500, { error: payErr.message });

      const { data: je, error: postErr } = await admin.rpc('hfms_post_bill_payment', { p_payment_id: payment.id });
      if(postErr){
        // Roll back the payment row if posting failed (e.g. closed period)
        // so a bill never shows a payment that was never actually posted.
        await admin.from('bill_payments').delete().eq('id', payment.id);
        return json(400, { error: postErr.message });
      }
      return json(201, { payment, journal_entry_id: je });
    }

    if(method === 'POST'){
      const { supplier_id, invoice_number, invoice_date, due_date, category_name, subtotal_kes, tax_kes, notes } = body;
      if(!supplier_id || !invoice_date || subtotal_kes === undefined) return json(400, { error: 'supplier_id, invoice_date and subtotal_kes are required.' });
      const tax = tax_kes || 0;
      const category_id = await resolveCategoryId(admin, branchId, category_name);
      const payload = {
        branch_id: branchId, supplier_id, invoice_number: invoice_number || null,
        invoice_date, due_date: due_date || null, category_id,
        subtotal_kes, tax_kes: tax, total_kes: Number(subtotal_kes) + Number(tax),
        notes: notes || null, created_by: ctx.user.id
      };
      const { data, error } = await admin.from('bills').insert(payload).select().maybeSingle();
      if(error){
        if(error.code === '23505') return json(409, { error: 'A bill with this invoice number already exists for this supplier.' });
        return json(500, { error: error.message });
      }
      return json(201, { bill: data });
    }

    if(method === 'DELETE'){
      if(!body.id) return json(400, { error: 'id is required.' });
      const { data: bill } = await admin.from('bills').select('status').eq('id', body.id).eq('branch_id', branchId).maybeSingle();
      if(!bill) return json(404, { error: 'Bill not found on this branch.' });
      if(bill.status !== 'draft') return json(400, { error: 'Only a draft (not yet approved) bill can be deleted — void it instead once approved.' });
      const { error } = await admin.from('bills').update({ is_deleted: true }).eq('id', body.id);
      if(error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed.' });
  }catch(e){
    console.error('bills error', e);
    return json(500, { error: 'Unexpected error handling bills.' });
  }
};

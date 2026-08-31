const { requireUser, adminClient, json } = require('./_lib/supabase');
const { requireBranchAccess } = require('./_lib/rbac');

// The app treats accounts and categories as plain names, not managed
// entities with stable IDs — accounts are the fixed list seeded during
// migration; categories are freely typed by staff. This resolves a name to
// the matching row's id, creating a new category on the fly if it's new
// (accounts are never auto-created — the 4-account list is fixed).
async function resolveAccountId(admin, branchId, accountName){
  if(!accountName) return null;
  const { data } = await admin.from('financial_accounts')
    .select('id').eq('branch_id', branchId).eq('name', accountName).maybeSingle();
  return data ? data.id : null;
}
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
      const { from, to, status } = event.queryStringParameters || {};
      let q = admin.from('expenses')
        .select('*, financial_accounts(name), categories(name)')
        .eq('branch_id', branchId).eq('is_deleted', false);
      if(from) q = q.gte('expense_date', from);
      if(to) q = q.lte('expense_date', to);
      if(status) q = q.eq('status', status);
      const { data, error } = await q.order('expense_date', { ascending: false });
      if(error) return json(500, { error: error.message });
      return json(200, { expenses: data });
    }

    if(method === 'POST'){
      // Supports a single expense or a bulk import (e.g. Tende export rows).
      // Each row is inserted individually so one duplicate txn_ref doesn't
      // sink an entire batch — duplicates are reported back, not silently
      // dropped, so whoever's importing can see exactly what was skipped.
      const rows = Array.isArray(body.entries) ? body.entries : [body];
      const inserted = [];
      const skipped = [];

      for(const r of rows){
        if(!r.expense_date || r.amount_kes === undefined || r.amount_kes === null){
          skipped.push({ row: r, reason: 'Missing expense_date or amount_kes.' });
          continue;
        }
        const accountId = r.account_id || await resolveAccountId(admin, branchId, r.account_name);
        const categoryId = r.category_id || await resolveCategoryId(admin, branchId, r.category_name);
        const payload = {
          ...(r.id ? { id: r.id } : {}),
          branch_id: branchId,
          expense_date: r.expense_date,
          txn_ref: r.txn_ref || null,
          account_id: accountId,
          category_id: categoryId,
          supplier_id: r.supplier_id || null,
          description: r.description || null,
          paid_to: r.paid_to || null,
          amount_kes: r.amount_kes,
          charges_kes: r.charges_kes || 0,
          owner_funded: !!r.owner_funded,
          status: r.status || 'posted',
          source: r.source || 'manual',
          created_by: ctx.user.id
        };
        const { data, error } = await admin.from('expenses').insert(payload).select().maybeSingle();
        if(error){
          // 23505 = unique_violation — our duplicate-txn_ref guard tripped.
          if(error.code === '23505'){
            skipped.push({ row: r, reason: `Duplicate txn_ref "${r.txn_ref}" already exists on this branch.` });
            continue;
          }
          return json(500, { error: error.message });
        }
        inserted.push(data);
      }
      return json(201, { inserted, skipped });
    }

    if(method === 'PATCH'){
      if(!body.id) return json(400, { error: 'id is required.' });

      // Approving/rejecting a pending expense is a separation-of-duties
      // action — restricted to Branch Manager or Head Office, same as the
      // UI only shows the buttons to those roles. Enforced here too since
      // ctx.role alone (a plain "can write on this branch" check above)
      // would otherwise let an Accountant approve their own submission via
      // a direct API call.
      const isApprovalAction = body.status === 'posted' || body.status === 'rejected';
      if(isApprovalAction){
        const APPROVER_ROLES = ['owner', 'finance_manager', 'branch_manager'];
        if(!ctx.access.isHeadOffice && !APPROVER_ROLES.includes(ctx.role)){
          const { data: current } = await admin.from('expenses').select('status').eq('id', body.id).eq('branch_id', branchId).maybeSingle();
          if(current && current.status === 'pending_approval'){
            return json(403, { error: 'Only a Branch Manager or Head Office can approve or reject an expense.' });
          }
        }
      }

      const updatable = ['expense_date', 'account_id', 'category_id', 'supplier_id',
        'description', 'paid_to', 'amount_kes', 'charges_kes', 'owner_funded', 'status'];
      const patch = {};
      for(const k of updatable) if(body[k] !== undefined) patch[k] = body[k];
      if(body.account_name !== undefined) patch.account_id = await resolveAccountId(admin, branchId, body.account_name);
      if(body.category_name !== undefined) patch.category_id = await resolveCategoryId(admin, branchId, body.category_name);

      // Approving is an explicit action, not just a status flip, so we can
      // always answer "who approved this and when" later.
      if(body.status === 'posted' && body.approve === true){
        patch.approved_by = ctx.user.id;
        patch.approved_at = new Date().toISOString();
      }
      patch.updated_at = new Date().toISOString();

      const { data, error } = await admin
        .from('expenses').update(patch)
        .eq('id', body.id).eq('branch_id', branchId)
        .select().maybeSingle();
      if(error) return json(500, { error: error.message });
      if(!data) return json(404, { error: 'Expense not found on this branch.' });
      return json(200, { expense: data });
    }

    if(method === 'DELETE'){
      if(!body.id) return json(400, { error: 'id is required.' });
      const { data, error } = await admin
        .from('expenses')
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .eq('id', body.id).eq('branch_id', branchId)
        .select().maybeSingle();
      if(error) return json(500, { error: error.message });
      if(!data) return json(404, { error: 'Expense not found on this branch.' });
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed.' });
  }catch(e){
    console.error('expenses error', e);
    return json(500, { error: 'Unexpected error handling expenses.' });
  }
};

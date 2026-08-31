// Accounting periods — close/reopen. Closing locks journal POSTING for a
// date range (see hfms_foundation_fix_03_accounting_periods.sql for why
// that's the right layer); it never blocks ordinary revenue/expense entry.
// Same role restriction as Profit First settings — this is a Head
// Office/Branch Manager action, not a routine accountant one.
const { requireUser, adminClient, json } = require('./_lib/supabase');
const { requireBranchAccess } = require('./_lib/rbac');

const PERIOD_MANAGER_ROLES = ['owner', 'finance_manager', 'branch_manager'];

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
    if(method === 'GET' && (event.queryStringParameters||{}).action === 'preflight'){
      const periodStart = event.queryStringParameters.period_start;
      const periodEnd = event.queryStringParameters.period_end;
      if(!periodStart || !periodEnd) return json(400, { error: 'period_start and period_end are required.' });

      // Every check here is informational — none of them block closing on
      // its own except the ledger balance, which the close function itself
      // already refuses on. This just surfaces what the close function
      // would refuse (or what's still messy) BEFORE someone clicks the
      // button, rather than after.
      const [{ data: tbRows }, pendingExpensesRes, draftBillsRes, openReconRes, syncErrorsRes] = await Promise.all([
        admin.from('v_hfms_trial_balance').select('total_debit_kes, total_credit_kes').eq('branch_id', branchId).then(r=>r).catch(()=>({data:null})),
        admin.from('expenses').select('id', { count:'exact', head:true }).eq('branch_id', branchId).eq('status','pending_approval').eq('is_deleted', false).gte('expense_date', periodStart).lte('expense_date', periodEnd).then(r=>r).catch(()=>({count:null})),
        admin.from('bills').select('id', { count:'exact', head:true }).eq('branch_id', branchId).eq('status','draft').eq('is_deleted', false).gte('invoice_date', periodStart).lte('invoice_date', periodEnd).then(r=>r).catch(()=>({count:null})),
        admin.from('bank_statement_imports').select('id', { count:'exact', head:true }).eq('branch_id', branchId).in('status',['in_progress','submitted']).lte('period_start', periodEnd).gte('period_end', periodStart).then(r=>r).catch(()=>({count:null})),
        admin.from('hfms_sync_errors').select('id', { count:'exact', head:true }).gte('occurred_at', periodStart).then(r=>r).catch(()=>({count:null}))
      ]);

      const checklist = [];

      if(tbRows){
        const diff = tbRows.reduce((s,r)=>s+Number(r.total_debit_kes)-Number(r.total_credit_kes),0);
        checklist.push({
          label: 'Ledger balances (debits = credits)',
          status: Math.abs(diff) < 0.01 ? 'pass' : 'fail',
          detail: Math.abs(diff) < 0.01 ? 'Balanced.' : `Off by KES ${diff.toFixed(2)} — closing will be refused until this is fixed.`
        });
      }
      const pendingCount = pendingExpensesRes?.count ?? null;
      if(pendingCount !== null) checklist.push({
        label: 'Expense approvals', status: pendingCount > 0 ? 'warn' : 'pass',
        detail: pendingCount > 0 ? `${pendingCount} expense(s) awaiting approval this period — won't be reflected in the ledger until approved.` : 'Nothing pending.'
      });
      const draftCount = draftBillsRes?.count ?? null;
      if(draftCount !== null) checklist.push({
        label: 'Bill approvals', status: draftCount > 0 ? 'warn' : 'pass',
        detail: draftCount > 0 ? `${draftCount} bill(s) still in draft this period — won't post to the ledger until approved.` : 'Nothing in draft.'
      });
      const reconCount = openReconRes?.count ?? null;
      if(reconCount !== null) checklist.push({
        label: 'Reconciliation', status: reconCount > 0 ? 'warn' : 'pass',
        detail: reconCount > 0 ? `${reconCount} statement import(s) for this period not yet approved.` : 'Nothing open for this period.'
      });
      const syncErrCount = syncErrorsRes?.count ?? null;
      if(syncErrCount !== null) checklist.push({
        label: 'Ledger sync health', status: syncErrCount > 0 ? 'warn' : 'pass',
        detail: syncErrCount > 0 ? `${syncErrCount} sync failure(s) recorded since this period started — the ledger may be missing entries.` : 'No sync failures recorded.'
      });

      const canClose = !checklist.some(c => c.status === 'fail');
      return json(200, { checklist, can_close: canClose });
    }

    if(method === 'GET'){
      const { data, error } = await admin
        .from('accounting_periods').select('*').eq('branch_id', branchId)
        .order('period_start', { ascending: false });
      if(error) return json(500, { error: error.message });
      return json(200, { periods: data });
    }

    if(!ctx.access.isHeadOffice && !PERIOD_MANAGER_ROLES.includes(ctx.role)){
      return json(403, { error: 'Only Head Office or the Branch Manager can close or reopen accounting periods.' });
    }

    if(method === 'POST'){
      const { period_start, period_end } = body;
      if(!period_start || !period_end) return json(400, { error: 'period_start and period_end are required.' });
      const { data, error } = await admin.rpc('hfms_close_period_with_entries', {
        p_branch: branchId, p_start: period_start, p_end: period_end, p_user: ctx.user.id
      });
      if(error) return json(400, { error: error.message }); // includes the "doesn't balance" / "already closed" refusals
      return json(201, { closing_journal_entry_id: data });
    }

    if(method === 'PATCH'){
      const { period_id, reason } = body;
      if(!period_id || !reason) return json(400, { error: 'period_id and reason are required to reopen a period.' });
      const { error } = await admin.rpc('hfms_reopen_period', {
        p_branch: branchId, p_period_id: period_id, p_user: ctx.user.id, p_reason: reason
      });
      if(error) return json(400, { error: error.message });
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed.' });
  }catch(e){
    console.error('accounting-periods error', e);
    return json(500, { error: 'Unexpected error handling accounting periods.' });
  }
};

// Automation/alerts scan. Deliberately monitoring-only — this never
// creates a transaction, posts a journal entry, or executes anything. It
// only ever writes to hfms_alerts. See hfms_foundation_fix_08_automation.sql
// for why the scope was cut down from the uploaded zip's version.
const { requireUser, adminClient, json } = require('./_lib/supabase');
const { requireBranchAccess } = require('./_lib/rbac');

async function safe(promise){
  try{ const { data, error } = await promise; if(error) return null; return data; }
  catch(e){ return null; }
}

async function raiseAlert(admin, branchId, key, severity, message){
  // Idempotent by design: the unique (branch_id, alert_key, status) constraint
  // means this is a no-op if the same issue is already an open alert —
  // re-scanning repeatedly never creates duplicates.
  await admin.from('hfms_alerts').upsert(
    { branch_id: branchId, alert_key: key, severity, message, status: 'open' },
    { onConflict: 'branch_id,alert_key,status', ignoreDuplicates: true }
  );
}

exports.handler = async (event) => {
  const admin = adminClient();
  const method = event.httpMethod;

  let body = {};
  if(method !== 'GET'){
    try{ body = JSON.parse(event.body || '{}'); }
    catch(e){ return json(400, { error: 'Invalid JSON body.' }); }
  }
  const branchId = method === 'GET' ? (event.queryStringParameters || {}).branch_id : body.branch_id;
  const action = (event.queryStringParameters || {}).action || body.action;

  const ctx = await requireBranchAccess(event, requireUser, admin, branchId, { write: method !== 'GET' });
  if(ctx.error) return json(ctx.status, { error: ctx.error });

  try{
    if(method === 'GET'){
      const { data, error } = await admin.from('hfms_alerts').select('*').eq('branch_id', branchId)
        .order('status', { ascending: true }).order('created_at', { ascending: false });
      if(error) return json(500, { error: error.message });
      return json(200, { alerts: data });
    }

    if(method === 'POST' && action === 'dismiss'){
      if(!body.id) return json(400, { error: 'id is required.' });
      const { error } = await admin.from('hfms_alerts')
        .update({ status: 'dismissed', dismissed_by: ctx.user.id, dismissed_at: new Date().toISOString() })
        .eq('id', body.id).eq('branch_id', branchId);
      if(error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }

    if(method === 'POST' && (action === 'scan' || !action)){
      const monthStart = new Date(); monthStart.setDate(1);
      const monthStartStr = monthStart.toISOString().slice(0,10);
      const today = new Date().toISOString().slice(0,10);

      const [allTimeTxns, monthTxns, apAging, tbRows] = await Promise.all([
        safe(admin.from('financial_transactions').select('direction, net_amount_kes').eq('branch_id', branchId).eq('is_deleted', false)),
        safe(admin.from('financial_transactions').select('transaction_type, direction, net_amount_kes').eq('branch_id', branchId).eq('is_deleted', false).gte('transaction_date', monthStartStr).lte('transaction_date', today)),
        safe(admin.from('v_hfms_ap_aging').select('outstanding_kes, aging_bucket').eq('branch_id', branchId)),
        safe(admin.from('v_hfms_trial_balance').select('*'))
      ]);

      let scanned = 0, raised = 0;

      if(allTimeTxns){
        scanned++;
        const cash = allTimeTxns.reduce((s,t)=>s+Number(t.net_amount_kes)*(t.direction==='inflow'?1:-1), 0);
        // Simple 3-month lookback burn rate would need historical data
        // fetched separately (done in executive-dashboard.js's fuller
        // calculation) — here, a lighter check: is cash negative at all,
        // which is unambiguous and needs no trend data.
        if(cash < 0){
          await raiseAlert(admin, branchId, 'negative_cash', 'critical', `Cash position is negative: KES ${cash.toLocaleString()}.`);
          raised++;
        }
      }

      if(monthTxns){
        scanned++;
        const revenue = monthTxns.filter(t=>t.transaction_type==='revenue').reduce((s,t)=>s+Number(t.net_amount_kes),0);
        const expense = monthTxns.filter(t=>t.transaction_type==='expense').reduce((s,t)=>s+Number(t.net_amount_kes),0);
        if(revenue > 0 && expense > revenue){
          await raiseAlert(admin, branchId, 'negative_result_this_month', 'warning', `This month's expenses (KES ${expense.toLocaleString()}) exceed revenue (KES ${revenue.toLocaleString()}).`);
          raised++;
        }
      }

      if(apAging){
        scanned++;
        const overdue = apAging.filter(a=>a.aging_bucket!=='current').reduce((s,a)=>s+Number(a.outstanding_kes),0);
        if(overdue > 0){
          await raiseAlert(admin, branchId, 'ap_overdue', 'warning', `KES ${overdue.toLocaleString()} in overdue supplier bills.`);
          raised++;
        }
      }

      if(tbRows){
        scanned++;
        const diff = tbRows.reduce((s,r)=>s+Number(r.total_debit_kes)-Number(r.total_credit_kes),0);
        if(Math.abs(diff) > 0.01){
          await raiseAlert(admin, branchId, 'ledger_imbalance', 'critical', `The ledger does not balance (off by KES ${diff.toFixed(2)}).`);
          raised++;
        }
      }

      const { data: openAlerts } = await admin.from('hfms_alerts').select('*').eq('branch_id', branchId).eq('status', 'open');
      return json(200, { scanned, raised, open_alerts: openAlerts || [] });
    }

    return json(405, { error: 'Method not allowed.' });
  }catch(e){
    console.error('automation error', e);
    return json(500, { error: 'Unexpected error running the automation scan.' });
  }
};

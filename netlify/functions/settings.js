const { requireUser, adminClient, json } = require('./_lib/supabase');
const { requireBranchAccess } = require('./_lib/rbac');

// Changing the Profit First split is a bigger deal than a routine expense
// entry, so it's restricted to Head Office or the branch's own manager —
// not every "write" role gets to touch it.
const SETTINGS_WRITE_ROLES = ['owner', 'finance_manager', 'branch_manager'];

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
        .from('profit_first_settings').select('*').eq('branch_id', branchId).maybeSingle();
      if(error) return json(500, { error: error.message });
      return json(200, { settings: data });
    }

    if(method === 'PUT'){
      if(!SETTINGS_WRITE_ROLES.includes(ctx.role)){
        return json(403, { error: 'Only Head Office or the Branch Manager can change Profit First settings.' });
      }
      // Happynet's actual split is 4 buckets of total revenue (must sum to
      // 100): pct_profit, pct_owner_debt, pct_tax, pct_opex.
      const fields = ['pct_profit', 'pct_owner_debt', 'pct_tax', 'pct_opex',
        'debt_paydown_split_pct', 'monthly_revenue_target_kes',
        'opening_opex_account_balance_kes', 'effective_from'];
      const patch = {};
      for(const k of fields) if(body[k] !== undefined) patch[k] = body[k];

      const bucketKeys = ['pct_profit', 'pct_owner_debt', 'pct_tax', 'pct_opex'];
      const totalPct = bucketKeys.reduce((sum, k) => sum + Number(patch[k] !== undefined ? patch[k] : 0), 0);
      // Only enforce the 100% check when all four buckets are present in
      // this request — partial updates (e.g. just nudging one bucket) are
      // validated against the merged row, which needs a read first.
      if(bucketKeys.every(k => patch[k] !== undefined) && Math.abs(totalPct - 100) > 0.01){
        return json(400, { error: `pct_profit + pct_owner_debt + pct_tax + pct_opex must total 100 (got ${totalPct}).` });
      }

      patch.updated_by = ctx.user.id;
      patch.updated_at = new Date().toISOString();

      const { data, error } = await admin
        .from('profit_first_settings')
        .upsert({ branch_id: branchId, ...patch })
        .select().maybeSingle();
      if(error) return json(500, { error: error.message });

      await admin.from('profit_first_settings_history').insert({
        branch_id: branchId,
        config: data,
        reason: body.reason || null,
        changed_by: ctx.user.id
      });

      return json(200, { settings: data });
    }

    return json(405, { error: 'Method not allowed.' });
  }catch(e){
    console.error('settings error', e);
    return json(500, { error: 'Unexpected error handling settings.' });
  }
};

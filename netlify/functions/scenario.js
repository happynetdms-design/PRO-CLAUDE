// Scenario analysis — "what happens if revenue falls 10%?" Deliberately
// NOT AI-generated: this is plain arithmetic off real current-month
// actuals, so the numbers are exactly reproducible and auditable, not a
// model's guess. Never writes anything — pure calculation, and every
// response is explicitly labeled FORECAST so it can never be confused
// with the real ledger.
const { requireUser, adminClient, json } = require('./_lib/supabase');
const { requireBranchAccess } = require('./_lib/rbac');

exports.handler = async (event) => {
  if(event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed.' });
  const admin = adminClient();

  const q = event.queryStringParameters || {};
  const branchId = q.branch_id;
  const revenueChangePct = Number(q.revenue_change_pct || 0);
  const expenseChangePct = Number(q.expense_change_pct || 0);

  const ctx = await requireBranchAccess(event, requireUser, admin, branchId, { write: false });
  if(ctx.error) return json(ctx.status, { error: ctx.error });

  try{
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    const monthEnd = new Date(now.getFullYear(), now.getMonth()+1, 0).toISOString().slice(0,10);

    const [{ data: txns, error: txnErr }, { data: settings }] = await Promise.all([
      admin.from('financial_transactions').select('transaction_type, direction, net_amount_kes')
        .eq('branch_id', branchId).eq('is_deleted', false).gte('transaction_date', monthStart).lte('transaction_date', monthEnd),
      admin.from('profit_first_settings').select('*').eq('branch_id', branchId).maybeSingle()
    ]);
    if(txnErr) return json(500, { error: txnErr.message });

    const baselineRevenue = (txns||[]).filter(t=>t.transaction_type==='revenue').reduce((s,t)=>s+Number(t.net_amount_kes),0);
    const baselineExpense = (txns||[]).filter(t=>t.transaction_type==='expense').reduce((s,t)=>s+Number(t.net_amount_kes),0);
    const baselineResult = baselineRevenue - baselineExpense;

    const scenarioRevenue = Number((baselineRevenue * (1 + revenueChangePct/100)).toFixed(2));
    const scenarioExpense = Number((baselineExpense * (1 + expenseChangePct/100)).toFixed(2));
    const scenarioResult = Number((scenarioRevenue - scenarioExpense).toFixed(2));

    let allocations = null;
    if(settings){
      const pct = {
        profit: Number(settings.pct_profit), owner_debt: Number(settings.pct_owner_debt),
        tax: Number(settings.pct_tax), opex: Number(settings.pct_opex)
      };
      const forRevenue = (rev) => ({
        profit_kes: Number((rev * pct.profit/100).toFixed(2)),
        owner_debt_kes: Number((rev * pct.owner_debt/100).toFixed(2)),
        tax_kes: Number((rev * pct.tax/100).toFixed(2)),
        opex_kes: Number((rev * pct.opex/100).toFixed(2))
      });
      allocations = { baseline: forRevenue(baselineRevenue), scenario: forRevenue(scenarioRevenue) };
    }

    return json(200, {
      label: 'FORECAST — hypothetical, not a change to any real record',
      period: monthStart.slice(0,7),
      inputs: { revenue_change_pct: revenueChangePct, expense_change_pct: expenseChangePct },
      baseline: { revenue_kes: baselineRevenue, expense_kes: baselineExpense, operating_result_kes: baselineResult },
      scenario: { revenue_kes: scenarioRevenue, expense_kes: scenarioExpense, operating_result_kes: scenarioResult },
      result_change_kes: Number((scenarioResult - baselineResult).toFixed(2)),
      profit_first_allocations: allocations
    });
  }catch(e){
    console.error('scenario error', e);
    return json(500, { error: 'Unexpected error computing the scenario.' });
  }
};

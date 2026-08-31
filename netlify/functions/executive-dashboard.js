// Executive Command Center — read-only aggregation over everything built
// so far this session: the ledger (financial_transactions), loans (owner
// funding), bills (AP), tax_periods (compliance), allocations (Profit
// First). Every number here is a fact or a plain calculation from facts —
// no AI-generated text, no "recommendations." That's a different, later
// concern (the AI CFO), and mixing the two here would make it harder to
// tell what's verified arithmetic and what's a model's guess.
const { requireUser, adminClient, json } = require('./_lib/supabase');
const { requireBranchAccess } = require('./_lib/rbac');

function monthBounds(period){
  const [y, m] = period.split('-').map(Number);
  const first = `${period}-01`;
  const last = new Date(y, m, 0).toISOString().slice(0, 10);
  return [first, last];
}
function prevMonth(period){
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m - 2, 1); // m is 1-indexed; -2 to go back one month from a 0-indexed Date
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

exports.handler = async (event) => {
  if(event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed.' });
  const admin = adminClient();

  const q = event.queryStringParameters || {};
  const branchId = q.branch_id;
  const period = q.period || new Date().toISOString().slice(0, 7);

  const ctx = await requireBranchAccess(event, requireUser, admin, branchId, { write: false });
  if(ctx.error) return json(ctx.status, { error: ctx.error });

  try{
    const [curStart, curEnd] = monthBounds(period);
    const [prevStart, prevEnd] = monthBounds(prevMonth(period));

    const sumTxns = (txns, type) => txns.filter(t=>t.transaction_type===type).reduce((s,t)=>s+Number(t.net_amount_kes)*(t.direction==='inflow'?1:-1), 0);

    const [curTxnsRes, prevTxnsRes, allTxnsRes, loansRes, apAgingRes, allocationsRes, tbRes] = await Promise.all([
      admin.from('financial_transactions').select('transaction_type, direction, net_amount_kes').eq('branch_id', branchId).eq('is_deleted', false).gte('transaction_date', curStart).lte('transaction_date', curEnd),
      admin.from('financial_transactions').select('transaction_type, direction, net_amount_kes').eq('branch_id', branchId).eq('is_deleted', false).gte('transaction_date', prevStart).lte('transaction_date', prevEnd),
      admin.from('financial_transactions').select('transaction_type, direction, net_amount_kes, transaction_date').eq('branch_id', branchId).eq('is_deleted', false).gte('transaction_date', new Date(new Date(curEnd).setMonth(new Date(curEnd).getMonth()-3)).toISOString().slice(0,10)).lte('transaction_date', curEnd),
      admin.from('loans').select('current_balance_kes').eq('branch_id', branchId).eq('is_deleted', false),
      admin.from('v_hfms_ap_aging').select('outstanding_kes, aging_bucket').eq('branch_id', branchId),
      admin.from('allocations').select('bucket, amount_kes, approved_at, period').eq('branch_id', branchId).order('period', { ascending: false }).limit(4),
      admin.from('v_hfms_trial_balance').select('*')
    ]);

    const curTxns = curTxnsRes.data || [], prevTxns = prevTxnsRes.data || [];
    const revenue = sumTxns(curTxns, 'revenue');
    const expense = -sumTxns(curTxns, 'expense'); // sumTxns returns negative for outflow; flip to positive
    const prevRevenue = sumTxns(prevTxns, 'revenue');
    const operatingResult = revenue - expense;
    const revenueGrowthPct = prevRevenue > 0 ? Number((((revenue - prevRevenue) / prevRevenue) * 100).toFixed(1)) : null;

    // Cash position: net of everything ever posted (all-time), not just this period.
    const { data: allTimeTxns } = await admin.from('financial_transactions').select('transaction_type, direction, net_amount_kes').eq('branch_id', branchId).eq('is_deleted', false);
    const cashPosition = (allTimeTxns || []).reduce((s,t)=>s + Number(t.net_amount_kes) * (t.direction==='inflow'?1:-1), 0);

    // Cash runway: average of the last 3 months' net operating cash flow
    // (revenue - expense only, financing excluded — a loan repayment isn't
    // "burn" in the same sense as an operating expense). If burning cash,
    // runway = current cash / monthly burn rate.
    const last3 = allTxnsRes.data || [];
    const monthlyNet = {};
    for(const t of last3){
      const m = t.transaction_date.slice(0,7);
      if(t.transaction_type !== 'revenue' && t.transaction_type !== 'expense') continue;
      monthlyNet[m] = (monthlyNet[m] || 0) + Number(t.net_amount_kes) * (t.direction==='inflow'?1:-1);
    }
    const months = Object.keys(monthlyNet).sort();
    const avgMonthlyNet = months.length ? months.reduce((s,m)=>s+monthlyNet[m],0) / months.length : 0;
    const cashRunwayMonths = avgMonthlyNet < 0 && cashPosition > 0 ? Number((cashPosition / Math.abs(avgMonthlyNet)).toFixed(1)) : null;

    const ownerLoanBalance = (loansRes.data || []).reduce((s,l)=>s+Number(l.current_balance_kes), 0);

    const apOutstanding = (apAgingRes.data || []).reduce((s,a)=>s+Number(a.outstanding_kes), 0);
    const apOverdue = (apAgingRes.data || []).filter(a => !['current'].includes(a.aging_bucket)).reduce((s,a)=>s+Number(a.outstanding_kes), 0);

    const ledgerDiff = (tbRes.data || []).reduce((s,r)=>s + Number(r.total_debit_kes) - Number(r.total_credit_kes), 0);

    const risks = [];
    if(cashRunwayMonths !== null && cashRunwayMonths < 3) risks.push({ level: 'critical', message: `Cash runway is ${cashRunwayMonths} months at the current burn rate.` });
    if(apOverdue > 0) risks.push({ level: 'warning', message: `KES ${apOverdue.toLocaleString()} in overdue supplier bills.` });
    if(Math.abs(ledgerDiff) > 0.01) risks.push({ level: 'critical', message: `The ledger does not balance (off by KES ${ledgerDiff.toFixed(2)}) — figures above may be unreliable until this is fixed.` });
    if(operatingResult < 0) risks.push({ level: 'warning', message: `Operating loss of KES ${Math.abs(operatingResult).toLocaleString()} this period.` });

    return json(200, {
      period, period_start: curStart, period_end: curEnd,
      revenue_kes: revenue, expense_kes: expense, operating_result_kes: operatingResult,
      revenue_growth_pct: revenueGrowthPct,
      cash_position_kes: cashPosition, cash_runway_months: cashRunwayMonths,
      owner_loan_balance_kes: ownerLoanBalance,
      ap_outstanding_kes: apOutstanding, ap_overdue_kes: apOverdue,
      ledger_balanced: Math.abs(ledgerDiff) < 0.01,
      recent_allocations: allocationsRes.data || [],
      risks
    });
  }catch(e){
    console.error('executive-dashboard error', e);
    return json(500, { error: 'Unexpected error computing the executive dashboard.' });
  }
};

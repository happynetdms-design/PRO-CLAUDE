// Consolidated P&L across every branch — Head Office only. Financial
// statements everywhere else in this app are branch-scoped by design
// (requireBranchAccess checks a specific branch_id); this is the one
// deliberate exception, restricted to Head Office because it crosses
// branch boundaries the same way Staff & Access and the audit log already
// do. Read-only, same as financial-statements.js — this never writes
// anything.
const { requireUser, adminClient, json } = require('./_lib/supabase');
const { getAccess } = require('./_lib/rbac');

function monthBounds(period){
  const [y, m] = period.split('-').map(Number);
  const first = `${period}-01`;
  const last = new Date(y, m, 0).toISOString().slice(0, 10);
  return [first, last];
}
function periodBounds(period, periodType){
  if(periodType === 'year'){ const y = Number(period); return [`${y}-01-01`, `${y}-12-31`]; }
  if(periodType === 'quarter'){
    const [yStr, qStr] = period.split('-Q');
    const y = Number(yStr), q = Number(qStr);
    const startMonth = (q - 1) * 3 + 1;
    const first = `${y}-${String(startMonth).padStart(2,'0')}-01`;
    const last = new Date(y, startMonth + 2, 0).toISOString().slice(0, 10);
    return [first, last];
  }
  return monthBounds(period);
}
function periodLabel(period, periodType){
  if(periodType === 'year') return period;
  if(periodType === 'quarter'){ const [y, q] = period.split('-Q'); return `Q${q} ${y}`; }
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m-1, 1).toLocaleString('en-US', { month:'long', year:'numeric' });
}

exports.handler = async (event) => {
  if(event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed.' });
  const admin = adminClient();

  const { user, error } = await requireUser(event);
  if(error) return json(401, { error });

  const access = await getAccess(admin, user.id);
  if(!access.isHeadOffice){
    return json(403, { error: 'Consolidated (all-branch) statements are visible to Head Office roles only.' });
  }

  const q = event.queryStringParameters || {};
  const periodType = ['month','quarter','year'].includes(q.period_type) ? q.period_type : 'month';
  const period = q.period || new Date().toISOString().slice(0, periodType === 'year' ? 4 : 7);

  try{
    const [periodStart, periodEnd] = periodBounds(period, periodType);

    const { data: branches, error: branchErr } = await admin
      .from('branches').select('id, name, code').eq('is_active', true).order('name');
    if(branchErr) return json(500, { error: branchErr.message });
    if(!branches || branches.length === 0) return json(200, {
      period, period_type: periodType, period_label: periodLabel(period, periodType), branches: [],
      total: { revenue_kes:0, expense_kes:0, operating_result_kes:0, total_assets_kes:0, total_liabilities_kes:0, current_earnings_kes:0, total_equity_kes:0, cash_operating_kes:0, cash_financing_kes:0, net_cash_movement_kes:0 }
    });

    // Revenue/expense activity WITHIN the period (P&L) — one query for
    // every branch, split apart in memory rather than one query per branch.
    const { data: lines, error: linesErr } = await admin
      .from('journal_lines')
      .select('debit_kes, credit_kes, chart_of_accounts(account_type), journal_entries!inner(entry_date, branch_id, status)')
      .in('journal_entries.branch_id', branches.map(b=>b.id))
      .eq('journal_entries.status', 'posted')
      .gte('journal_entries.entry_date', periodStart)
      .lte('journal_entries.entry_date', periodEnd);
    if(linesErr) return json(500, { error: linesErr.message });

    // Balance sheet accounts are cumulative TO periodEnd, not scoped to
    // the period start — a separate query with a different date filter.
    const { data: bsLines, error: bsErr } = await admin
      .from('journal_lines')
      .select('debit_kes, credit_kes, chart_of_accounts(account_type), journal_entries!inner(entry_date, branch_id, status)')
      .in('journal_entries.branch_id', branches.map(b=>b.id))
      .eq('journal_entries.status', 'posted')
      .lte('journal_entries.entry_date', periodEnd);
    if(bsErr) return json(500, { error: bsErr.message });

    // Cash flow comes from financial_transactions (matches how the
    // single-branch statement computes it), within the period.
    const { data: txns, error: txnErr } = await admin
      .from('financial_transactions')
      .select('branch_id, transaction_type, direction, net_amount_kes')
      .in('branch_id', branches.map(b=>b.id)).eq('is_deleted', false)
      .gte('transaction_date', periodStart).lte('transaction_date', periodEnd);
    if(txnErr) return json(500, { error: txnErr.message });

    const byBranch = {};
    for(const b of branches) byBranch[b.id] = {
      branch_id: b.id, name: b.name, code: b.code,
      revenue_kes: 0, expense_kes: 0,
      total_assets_kes: 0, total_liabilities_kes: 0, current_earnings_kes: 0,
      cash_operating_kes: 0, cash_financing_kes: 0
    };

    for(const l of (lines || [])){
      const acc = l.chart_of_accounts;
      const branchId = l.journal_entries.branch_id;
      if(!acc || !byBranch[branchId]) continue;
      if(acc.account_type === 'revenue') byBranch[branchId].revenue_kes += Number(l.credit_kes) - Number(l.debit_kes);
      else if(acc.account_type === 'expense') byBranch[branchId].expense_kes += Number(l.debit_kes) - Number(l.credit_kes);
    }

    for(const l of (bsLines || [])){
      const acc = l.chart_of_accounts;
      const branchId = l.journal_entries.branch_id;
      if(!acc || !byBranch[branchId]) continue;
      if(acc.account_type === 'asset') byBranch[branchId].total_assets_kes += Number(l.debit_kes) - Number(l.credit_kes);
      else if(acc.account_type === 'liability') byBranch[branchId].total_liabilities_kes += Number(l.credit_kes) - Number(l.debit_kes);
      else if(acc.account_type === 'revenue') byBranch[branchId].current_earnings_kes += Number(l.credit_kes) - Number(l.debit_kes);
      else if(acc.account_type === 'expense') byBranch[branchId].current_earnings_kes -= (Number(l.debit_kes) - Number(l.credit_kes));
    }

    for(const t of (txns || [])){
      if(!byBranch[t.branch_id]) continue;
      const signed = Number(t.net_amount_kes) * (t.direction === 'inflow' ? 1 : -1);
      if(t.transaction_type === 'revenue' || t.transaction_type === 'expense') byBranch[t.branch_id].cash_operating_kes += signed;
      else if(t.transaction_type === 'owner_loan_funding' || t.transaction_type === 'owner_loan_repayment') byBranch[t.branch_id].cash_financing_kes += signed;
    }

    const round2 = n => Number(n.toFixed(2));
    const branchResults = Object.values(byBranch).map(b => ({
      branch_id: b.branch_id, name: b.name, code: b.code,
      revenue_kes: round2(b.revenue_kes), expense_kes: round2(b.expense_kes),
      operating_result_kes: round2(b.revenue_kes - b.expense_kes),
      total_assets_kes: round2(b.total_assets_kes), total_liabilities_kes: round2(b.total_liabilities_kes),
      current_earnings_kes: round2(b.current_earnings_kes),
      total_equity_kes: round2(b.current_earnings_kes), // no separate owner-equity postings yet, same as the single-branch statement
      cash_operating_kes: round2(b.cash_operating_kes), cash_financing_kes: round2(b.cash_financing_kes),
      net_cash_movement_kes: round2(b.cash_operating_kes + b.cash_financing_kes)
    })).sort((a,b) => a.name.localeCompare(b.name));

    const sumField = f => round2(branchResults.reduce((s,b)=>s+b[f], 0));
    const total = {
      revenue_kes: sumField('revenue_kes'), expense_kes: sumField('expense_kes'), operating_result_kes: sumField('operating_result_kes'),
      total_assets_kes: sumField('total_assets_kes'), total_liabilities_kes: sumField('total_liabilities_kes'),
      current_earnings_kes: sumField('current_earnings_kes'), total_equity_kes: sumField('total_equity_kes'),
      cash_operating_kes: sumField('cash_operating_kes'), cash_financing_kes: sumField('cash_financing_kes'),
      net_cash_movement_kes: sumField('net_cash_movement_kes')
    };

    return json(200, {
      period, period_type: periodType, period_label: periodLabel(period, periodType),
      period_start: periodStart, period_end: periodEnd,
      branches: branchResults, total
    });
  }catch(e){
    console.error('financial-statements-consolidated error', e);
    return json(500, { error: 'Unexpected error computing the consolidated statement.' });
  }
};

// Financial statements — P&L, Balance Sheet, Cash Flow. Read-only: this
// endpoint never writes anything. Every number here is computed live from
// journal_lines/chart_of_accounts (the ledger fixed in
// hfms_foundation_fix_01/02.sql) and financial_transactions — not cached,
// not pre-aggregated, so it's never stale relative to what's actually
// posted.
//
// ACCOUNTING NOTE ON THE BALANCE SHEET
// hfms_foundation_fix_09_period_close_entries.sql added real closing
// entries (zeroing Revenue/Expense into Retained Earnings on close). This
// endpoint needed no changes for that — "Current Earnings" here has
// always been cumulative Revenue minus Expense, so once a period is
// closed with a real entry, that period's activity naturally drops out of
// the cumulative total on its own. What "Current Earnings" means in
// practice: activity since the last period close, or since inception if
// none have been closed yet. The integrity check (Assets = Liabilities +
// Equity) is expected to balance to the cent either way — verified in
// scripts/verify_statements_math.js before this was written.
const { requireUser, adminClient, json } = require('./_lib/supabase');
const { requireBranchAccess } = require('./_lib/rbac');

function monthBounds(period){
  // period is 'YYYY-MM'; returns [firstDay, lastDay] as 'YYYY-MM-DD'.
  const [y, m] = period.split('-').map(Number);
  const first = `${period}-01`;
  const last = new Date(y, m, 0).toISOString().slice(0, 10);
  return [first, last];
}

// Generalizes monthBounds() to also cover quarters ('2026-Q3') and full
// years ('2026'), so the same P&L/Balance Sheet/Cash Flow logic below
// works unchanged for any of the three — only the date range differs.
function periodBounds(period, periodType){
  if(periodType === 'year'){
    const y = Number(period);
    return [`${y}-01-01`, `${y}-12-31`];
  }
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

// The immediately preceding period of the same type — used for
// comparative reporting. Handles the two rollover edge cases (Q1 -> prior
// year's Q4, January -> prior December) explicitly.
function priorPeriod(period, periodType){
  if(periodType === 'year') return String(Number(period) - 1);
  if(periodType === 'quarter'){
    const [yStr, qStr] = period.split('-Q');
    let y = Number(yStr), q = Number(qStr) - 1;
    if(q < 1){ q = 4; y -= 1; }
    return `${y}-Q${q}`;
  }
  const [y, m] = period.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

function periodLabel(period, periodType){
  if(periodType === 'year') return period;
  if(periodType === 'quarter'){
    const [y, q] = period.split('-Q');
    return `Q${q} ${y}`;
  }
  const [y, m] = period.split('-').map(Number);
  return new Date(y, m-1, 1).toLocaleString('en-US', { month:'long', year:'numeric' });
}

exports.handler = async (event) => {
  if(event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed.' });
  const admin = adminClient();

  const q = event.queryStringParameters || {};
  const branchId = q.branch_id;
  const periodType = ['month','quarter','year'].includes(q.period_type) ? q.period_type : 'month';
  const period = q.period || new Date().toISOString().slice(0, periodType === 'year' ? 4 : 7);
  // compare_period is fully optional and explicit — the frontend has a
  // second period input; if the user leaves it blank, no comparison runs.
  const comparePeriod = q.compare_period || null;
  const statement = q.statement || 'summary'; // pl | balance_sheet | cashflow | summary

  const ctx = await requireBranchAccess(event, requireUser, admin, branchId, { write: false });
  if(ctx.error) return json(ctx.status, { error: ctx.error });

  try{
    const [periodStart, periodEnd] = periodBounds(period, periodType);

    // Every journal_lines row that's actually posted (not void), joined to
    // its account and entry date — this is the one query everything below
    // is sliced from, so P&L and Balance Sheet can never disagree about
    // what "posted" means.
    const { data: lines, error: linesErr } = await admin
      .from('journal_lines')
      .select('debit_kes, credit_kes, chart_of_accounts(code, name, account_type), journal_entries!inner(entry_date, branch_id, status)')
      .eq('journal_entries.branch_id', branchId)
      .eq('journal_entries.status', 'posted');
    if(linesErr) return json(500, { error: linesErr.message });

    const inPeriod = lines.filter(l => l.journal_entries.entry_date >= periodStart && l.journal_entries.entry_date <= periodEnd);
    const toDate = lines.filter(l => l.journal_entries.entry_date <= periodEnd);

    function groupByAccount(rows){
      const byAccount = {};
      for(const r of rows){
        const acc = r.chart_of_accounts;
        if(!acc) continue;
        const key = acc.code;
        byAccount[key] = byAccount[key] || { code: acc.code, name: acc.name, type: acc.account_type, debit: 0, credit: 0 };
        byAccount[key].debit += Number(r.debit_kes);
        byAccount[key].credit += Number(r.credit_kes);
      }
      return Object.values(byAccount);
    }

    // ---------------- P&L (movement within the period only) ----------------
    const periodAccounts = groupByAccount(inPeriod);
    const revenueLines = periodAccounts.filter(a => a.type === 'revenue').map(a => ({ ...a, amount: a.credit - a.debit }));
    const expenseLines = periodAccounts.filter(a => a.type === 'expense').map(a => ({ ...a, amount: a.debit - a.credit }));
    const totalRevenue = revenueLines.reduce((s,a)=>s+a.amount, 0);
    const totalExpense = expenseLines.reduce((s,a)=>s+a.amount, 0);
    const operatingResult = totalRevenue - totalExpense;

    // ---------------- Comparative period (optional) — reuses the same
    // `lines` already fetched above (no extra query needed, since that
    // query wasn't date-filtered at the database level to begin with) ----------------
    let comparative = null;
    if(comparePeriod){
      const [cmpStart, cmpEnd] = periodBounds(comparePeriod, periodType);
      const cmpInPeriod = lines.filter(l => l.journal_entries.entry_date >= cmpStart && l.journal_entries.entry_date <= cmpEnd);
      const cmpAccounts = groupByAccount(cmpInPeriod);
      const cmpRevenue = cmpAccounts.filter(a=>a.type==='revenue').reduce((s,a)=>s+(a.credit-a.debit),0);
      const cmpExpense = cmpAccounts.filter(a=>a.type==='expense').reduce((s,a)=>s+(a.debit-a.credit),0);
      const cmpResult = cmpRevenue - cmpExpense;
      const pctChange = (curr, prev) => prev !== 0 ? Number((((curr-prev)/Math.abs(prev))*100).toFixed(1)) : null;
      comparative = {
        period: comparePeriod, period_label: periodLabel(comparePeriod, periodType), period_start: cmpStart, period_end: cmpEnd,
        revenue_kes: cmpRevenue, expense_kes: cmpExpense, operating_result_kes: cmpResult,
        variance: {
          revenue_kes: Number((totalRevenue - cmpRevenue).toFixed(2)), revenue_pct: pctChange(totalRevenue, cmpRevenue),
          expense_kes: Number((totalExpense - cmpExpense).toFixed(2)), expense_pct: pctChange(totalExpense, cmpExpense),
          operating_result_kes: Number((operatingResult - cmpResult).toFixed(2)), operating_result_pct: pctChange(operatingResult, cmpResult)
        }
      };
    }

    // ---------------- Balance Sheet (cumulative balance as of period end) ----------------
    const cumulativeAccounts = groupByAccount(toDate);
    const assetLines = cumulativeAccounts.filter(a => a.type === 'asset').map(a => ({ ...a, amount: a.debit - a.credit }));
    const liabilityLines = cumulativeAccounts.filter(a => a.type === 'liability').map(a => ({ ...a, amount: a.credit - a.debit }));
    const equityLines = cumulativeAccounts.filter(a => a.type === 'equity').map(a => ({ ...a, amount: a.credit - a.debit }));
    const cumulativeRevenue = cumulativeAccounts.filter(a=>a.type==='revenue').reduce((s,a)=>s+(a.credit-a.debit),0);
    const cumulativeExpense = cumulativeAccounts.filter(a=>a.type==='expense').reduce((s,a)=>s+(a.debit-a.credit),0);
    const currentEarnings = cumulativeRevenue - cumulativeExpense;

    const totalAssets = assetLines.reduce((s,a)=>s+a.amount, 0);
    const totalLiabilities = liabilityLines.reduce((s,a)=>s+a.amount, 0);
    const totalEquity = equityLines.reduce((s,a)=>s+a.amount, 0) + currentEarnings;
    const balanceCheck = Number((totalAssets - (totalLiabilities + totalEquity)).toFixed(2));

    // ---------------- Cash Flow (from financial_transactions, not the ledger —
    // simpler and matches what actually moved cash, without re-deriving it
    // from journal line movements in the cash accounts) ----------------
    const { data: txns, error: txnErr } = await admin
      .from('financial_transactions')
      .select('transaction_type, direction, net_amount_kes, transaction_date')
      .eq('branch_id', branchId).eq('is_deleted', false)
      .gte('transaction_date', periodStart).lte('transaction_date', periodEnd);
    if(txnErr) return json(500, { error: txnErr.message });

    const sumType = (type) => txns.filter(t=>t.transaction_type===type).reduce((s,t)=>s+Number(t.net_amount_kes)*(t.direction==='inflow'?1:-1), 0);
    const operatingCash = sumType('revenue') + sumType('expense');
    const financingCash = sumType('owner_loan_funding') + sumType('owner_loan_repayment');
    const netCashMovement = operatingCash + financingCash;

    const result = {
      branch_id: branchId, period, period_type: periodType, period_label: periodLabel(period, periodType),
      period_start: periodStart, period_end: periodEnd,
      profit_and_loss: {
        revenue: revenueLines.sort((a,b)=>a.code.localeCompare(b.code)),
        expenses: expenseLines.sort((a,b)=>a.code.localeCompare(b.code)),
        total_revenue_kes: totalRevenue, total_expense_kes: totalExpense, operating_result_kes: operatingResult,
        comparative
      },
      balance_sheet: {
        as_of: periodEnd,
        assets: assetLines.sort((a,b)=>a.code.localeCompare(b.code)),
        liabilities: liabilityLines.sort((a,b)=>a.code.localeCompare(b.code)),
        equity: equityLines.sort((a,b)=>a.code.localeCompare(b.code)),
        current_earnings_kes: currentEarnings,
        total_assets_kes: totalAssets, total_liabilities_kes: totalLiabilities, total_equity_kes: totalEquity,
        balance_check_kes: balanceCheck, // must be 0 — if not, something upstream is wrong; don't trust the statement
        is_balanced: Math.abs(balanceCheck) < 0.01
      },
      cash_flow: {
        operating_kes: operatingCash, financing_kes: financingCash, net_movement_kes: netCashMovement
      }
    };

    if(statement === 'pl') return json(200, { profit_and_loss: result.profit_and_loss, period });
    if(statement === 'balance_sheet') return json(200, { balance_sheet: result.balance_sheet, period });
    if(statement === 'cashflow') return json(200, { cash_flow: result.cash_flow, period });
    return json(200, result);
  }catch(e){
    console.error('financial-statements error', e);
    return json(500, { error: 'Unexpected error computing financial statements.' });
  }
};

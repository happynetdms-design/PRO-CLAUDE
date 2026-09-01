/* ---------------- Financial Statements (Phase 13 foundation) ----------------
   Read-only view over the ledger fixed in hfms_foundation_fix_01/02.sql.
   If those SQL files haven't been run on this branch's Supabase project
   yet, the endpoint will error (missing tables) — handled below with a
   clear "not set up yet" message rather than a cryptic failure. */
let periodsState = { loading:false, periods:null, error:null, actionMsg:null };

async function loadPeriods(){
  periodsState.loading = true; render();
  try{
    const res = await apiFetch(`/api/accounting-periods?branch_id=${state.branchId}`, { method:'GET' });
    const body = await res.json();
    if(!res.ok) throw new Error(body.error || 'Could not load accounting periods.');
    periodsState.periods = body.periods || [];
    periodsState.error = null;
  }catch(e){
    periodsState.error = e.message;
  }
  periodsState.loading = false;
  render();
}
let closePreflightState = { open:false, loading:false, checklist:null, canClose:true, error:null };

async function openClosePreflight(){
  const [start, end] = monthToRange(statementsState.period);
  closePreflightState = { open:true, loading:true, checklist:null, canClose:true, error:null };
  render();
  try{
    const res = await apiFetch(`/api/accounting-periods?action=preflight&branch_id=${state.branchId}&period_start=${start}&period_end=${end}`, { method:'GET' });
    const body = await res.json();
    if(!res.ok) throw new Error(body.error || 'Could not run the pre-close checklist.');
    closePreflightState.checklist = body.checklist;
    closePreflightState.canClose = body.can_close;
  }catch(e){
    closePreflightState.error = e.message;
  }
  closePreflightState.loading = false;
  render();
}
function closeClosePreflight(){ closePreflightState = { open:false, loading:false, checklist:null, canClose:true, error:null }; render(); }
async function confirmClosePeriod(){
  const [start, end] = monthToRange(statementsState.period);
  periodsState.actionMsg = null;
  try{
    const res = await apiFetch('/api/accounting-periods', {
      method:'POST', headers: JSONH,
      body: JSON.stringify({ branch_id: state.branchId, period_start: start, period_end: end })
    });
    const body = await res.json();
    if(!res.ok) throw new Error(body.error || 'Could not close the period.');
    periodsState.actionMsg = { ok:true, text:'Period closed.' };
    closeClosePreflight();
    await loadPeriods();
  }catch(e){
    periodsState.actionMsg = { ok:false, text: e.message };
    closeClosePreflight();
  }
}
function closePreflightHtml(){
  const { loading, checklist, canClose, error } = closePreflightState;
  const [start, end] = monthToRange(statementsState.period);
  return `
  <div class="modal-backdrop"><div class="modal" style="max-width:520px;">
    <h2 style="margin-top:0;">Close ${start} to ${end}?</h2>
    ${loading ? `<p class="hint">Checking...</p>` : ''}
    ${error ? `<p class="hint" style="color:#c0392b;">${error}</p>` : ''}
    ${checklist ? `
      <div style="display:flex; flex-direction:column; gap:8px; margin:14px 0;">
        ${checklist.map(c=>`
          <div style="display:flex; gap:10px; align-items:flex-start; padding:10px 12px; border-radius:8px; background:${c.status==='fail'?'var(--alert-soft)':c.status==='warn'?'var(--tone-gold-soft)':'var(--good-soft)'};">
            <span style="flex-shrink:0;">${c.status==='fail'?ic('lock',15):c.status==='warn'?ic('lock',15):ic('trendUp',15)}</span>
            <div><div style="font-weight:600; font-size:13px;">${c.label}</div><div class="hint" style="margin-top:2px;">${c.detail}</div></div>
          </div>`).join('')}
      </div>
      <p class="hint">${canClose ? "This posts a real closing journal entry — zeroing Revenue and Expense into Retained Earnings — and locks further journal posting for these dates. It does not stop you logging revenue or expenses, only the ledger's own record of them." : 'Closing is refused until the ledger balances — fix that first.'}</p>
    ` : ''}
    <div style="display:flex; gap:10px; justify-content:flex-end; margin-top:16px;">
      <button class="btn ghost" id="btn-cancel-close-period">Cancel</button>
      ${checklist ? `<button class="btn gold" id="btn-confirm-close-period" ${!canClose?'disabled':''}>Close Period</button>` : ''}
    </div>
  </div></div>`;
}
async function reopenPeriod(periodId){
  const reason = await promptDialog('Why are you reopening this period? (required, goes on the record)');
  if(!reason || !reason.trim()) return;
  try{
    const res = await apiFetch('/api/accounting-periods', {
      method:'PATCH', headers: JSONH,
      body: JSON.stringify({ branch_id: state.branchId, period_id: periodId, reason: reason.trim() })
    });
    const body = await res.json();
    if(!res.ok) throw new Error(body.error || 'Could not reopen the period.');
    await loadPeriods();
  }catch(e){
    showToast('Could not reopen: ' + e.message, 'error');
  }
}
function monthToRange(period){
  const [y,m] = period.split('-').map(Number);
  const start = `${period}-01`;
  const end = new Date(y, m, 0).toISOString().slice(0,10);
  return [start, end];
}

let statementsState = { loading:false, data:null, error:null, period: new Date().toISOString().slice(0,7), periodType:'month', comparePeriod: null, compareEnabled:false };

// Client-side mirror of financial-statements.js's priorPeriod() — same
// logic, verified there (scripts/verify_period_rollup.js). Duplicated
// intentionally rather than round-tripping to the server just to compute
// what period comes before another.
function priorPeriodClient(period, periodType){
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
// A sensible default period value when switching type (e.g. Month -> Quarter).
function defaultPeriodFor(periodType){
  const now = new Date();
  if(periodType === 'year') return String(now.getFullYear());
  if(periodType === 'quarter') return `${now.getFullYear()}-Q${Math.floor(now.getMonth()/3)+1}`;
  return now.toISOString().slice(0,7);
}

let consolidatedState = { loading:false, data:null, error:null };
async function loadConsolidated(period, periodType){
  consolidatedState = { loading:true, data:null, error:null };
  render();
  try{
    const res = await apiFetch(`/api/financial-statements-consolidated?period=${period}&period_type=${periodType}`, { method:'GET' });
    const body = await res.json();
    if(!res.ok) throw new Error(body.error || 'Could not load the consolidated statement.');
    consolidatedState.data = body;
  }catch(e){ consolidatedState.error = e.message; }
  consolidatedState.loading = false;
  render();
}
function consolidatedSectionHtml(){
  const { loading, data, error } = consolidatedState;
  return `
    <div class="section-head"><h2>Consolidated — all branches</h2>
      <div class="toolbar">${!data && !loading ? `<button class="btn ghost sm" id="btn-load-consolidated">Load consolidated statement for ${statementsState.period}</button>` : ''}</div>
    </div>
    ${loading ? `<div class="card" style="margin-bottom:20px;"><span class="hint">Loading…</span></div>` : ''}
    ${error ? `<div class="card" style="margin-bottom:20px;"><div class="hint" style="color:#c0392b;">${error}</div></div>` : ''}
    ${data ? `
    <h3 style="font-size:13px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin:0 0 8px;">Profit &amp; Loss by branch</h3>
    <div class="table-wrap" style="margin-bottom:20px;"><table>
      <thead><tr><th class="txt">Branch</th><th>Revenue</th><th>Expenses</th><th>Operating Result</th></tr></thead>
      <tbody>
        ${data.branches.map(b=>`<tr><td class="txt">${b.name}</td><td>${KES0(b.revenue_kes)}</td><td>${KES0(b.expense_kes)}</td><td class="${b.operating_result_kes<0?'neg':'pos'}">${KES0(b.operating_result_kes)}</td></tr>`).join('')}
        <tr style="font-weight:800; border-top:2px solid var(--ink);"><td class="txt">Company-wide Total</td><td>${KES0(data.total.revenue_kes)}</td><td>${KES0(data.total.expense_kes)}</td><td class="${data.total.operating_result_kes<0?'neg':'pos'}">${KES0(data.total.operating_result_kes)}</td></tr>
      </tbody>
    </table></div>

    <h3 style="font-size:13px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin:0 0 8px;">Balance Sheet by branch (as of ${data.period_end})</h3>
    <div class="table-wrap" style="margin-bottom:20px;"><table>
      <thead><tr><th class="txt">Branch</th><th>Assets</th><th>Liabilities</th><th>Current Earnings</th><th class="txt">Balanced?</th></tr></thead>
      <tbody>
        ${data.branches.map(b=>{
          const diff = Number((b.total_assets_kes - (b.total_liabilities_kes + b.current_earnings_kes)).toFixed(2));
          const balanced = Math.abs(diff) < 0.01;
          return `<tr><td class="txt">${b.name}</td><td>${KES0(b.total_assets_kes)}</td><td>${KES0(b.total_liabilities_kes)}</td><td>${KES0(b.current_earnings_kes)}</td><td class="txt">${balanced ? `<span class="tag good">Yes</span>` : `<span class="tag alert">Off by ${KES0(diff)}</span>`}</td></tr>`;
        }).join('')}
        <tr style="font-weight:800; border-top:2px solid var(--ink);"><td class="txt">Company-wide Total</td><td>${KES0(data.total.total_assets_kes)}</td><td>${KES0(data.total.total_liabilities_kes)}</td><td>${KES0(data.total.current_earnings_kes)}</td><td></td></tr>
      </tbody>
    </table></div>

    <h3 style="font-size:13px; text-transform:uppercase; letter-spacing:.04em; color:var(--muted); margin:0 0 8px;">Cash Flow by branch</h3>
    <div class="table-wrap" style="margin-bottom:20px;"><table>
      <thead><tr><th class="txt">Branch</th><th>Operating</th><th>Financing</th><th>Net Movement</th></tr></thead>
      <tbody>
        ${data.branches.map(b=>`<tr><td class="txt">${b.name}</td><td class="${b.cash_operating_kes<0?'neg':'pos'}">${KES0(b.cash_operating_kes)}</td><td class="${b.cash_financing_kes<0?'neg':'pos'}">${KES0(b.cash_financing_kes)}</td><td class="${b.net_cash_movement_kes<0?'neg':'pos'}">${KES0(b.net_cash_movement_kes)}</td></tr>`).join('')}
        <tr style="font-weight:800; border-top:2px solid var(--ink);"><td class="txt">Company-wide Total</td><td class="${data.total.cash_operating_kes<0?'neg':'pos'}">${KES0(data.total.cash_operating_kes)}</td><td class="${data.total.cash_financing_kes<0?'neg':'pos'}">${KES0(data.total.cash_financing_kes)}</td><td class="${data.total.net_cash_movement_kes<0?'neg':'pos'}">${KES0(data.total.net_cash_movement_kes)}</td></tr>
      </tbody>
    </table></div>
    ` : ''}
  `;
}

async function loadStatements(period, periodType, compareEnabled){
  statementsState = {
    loading:true, data:null, error:null,
    period: period || statementsState.period,
    periodType: periodType || statementsState.periodType,
    compareEnabled: compareEnabled !== undefined ? compareEnabled : statementsState.compareEnabled,
    comparePeriod: null
  };
  consolidatedState = { loading:false, data:null, error:null }; // a new period invalidates any loaded consolidated view
  if(statementsState.compareEnabled){
    statementsState.comparePeriod = priorPeriodClient(statementsState.period, statementsState.periodType);
  }
  render();
  try{
    let url = `/api/financial-statements?branch_id=${state.branchId}&period=${statementsState.period}&period_type=${statementsState.periodType}`;
    if(statementsState.comparePeriod) url += `&compare_period=${statementsState.comparePeriod}`;
    const res = await apiFetch(url, { method:'GET' });
    const body = await res.json();
    if(!res.ok) throw new Error(body.error || 'Could not load financial statements.');
    statementsState.data = body;
  }catch(e){
    statementsState.error = e.message;
  }
  statementsState.loading = false;
  render();
}

function viewStatements(){
  const { loading, data, error, period, periodType, compareEnabled } = statementsState;
  const [pYear, pQ] = periodType==='quarter' ? period.split('-Q') : [period.slice(0,4), null];
  return `
    <div class="topbar"><div><h1>Financial Statements</h1><div class="sub">P&amp;L, Balance Sheet, and Cash Flow — computed live from the posted ledger, never cached.</div></div>
      <div class="topbar-actions">
        <select id="statements-period-type" style="padding:8px 12px; border-radius:8px; border:1px solid var(--hair);">
          <option value="month" ${periodType==='month'?'selected':''}>Month</option>
          <option value="quarter" ${periodType==='quarter'?'selected':''}>Quarter</option>
          <option value="year" ${periodType==='year'?'selected':''}>Year</option>
        </select>
        ${periodType==='month' ? `<input type="month" id="statements-period" value="${period}" style="padding:8px 12px; border-radius:8px; border:1px solid var(--hair);">` : ''}
        ${periodType==='quarter' ? `
          <select id="statements-period-quarter" style="padding:8px 12px; border-radius:8px; border:1px solid var(--hair);">
            ${[1,2,3,4].map(q=>`<option value="${q}" ${Number(pQ)===q?'selected':''}>Q${q}</option>`).join('')}
          </select>
          <input type="number" id="statements-period-year" value="${pYear}" style="width:90px; padding:8px 12px; border-radius:8px; border:1px solid var(--hair);">
        ` : ''}
        ${periodType==='year' ? `<input type="number" id="statements-period" value="${period}" style="width:110px; padding:8px 12px; border-radius:8px; border:1px solid var(--hair);">` : ''}
        <label class="check-row" style="margin:0; text-transform:none; font-weight:500;"><input type="checkbox" id="statements-compare-toggle" ${compareEnabled?'checked':''}> vs. prior period</label>
        ${data ? `
        <button class="btn ghost sm" id="btn-export-statements-pdf">Export PDF</button>
        <button class="btn ghost sm" id="btn-export-statements-xls">Export Excel</button>
        <button class="btn ghost sm" id="btn-export-statements-csv">Export CSV</button>
        ` : ''}
      </div>
    </div>

    ${loading ? `<div class="card"><span class="hint">Loading…</span></div>` : ''}
    ${error ? `
      <div class="card">
        <div class="hint" style="color:#c0392b; margin-bottom:8px;">${error}</div>
        <div class="hint">If this is the first time you're viewing this, the ledger foundation SQL (<code>hfms_foundation_fix_01_ledger_sync.sql</code> and <code>_02_journal_posting.sql</code>) may not have been run against this branch's Supabase project yet — these statements read from tables those files create.</div>
      </div>` : ''}

    ${data ? `
    ${data.profit_and_loss.comparative ? `
    <div class="card" style="margin-bottom:16px;">
      <h3 style="margin-bottom:12px;">Comparative — ${data.period_label} vs. ${data.profit_and_loss.comparative.period_label}</h3>
      <table>
        <thead><tr><th class="txt">Line</th><th>${data.profit_and_loss.comparative.period_label}</th><th>${data.period_label}</th><th>Variance</th><th>%</th></tr></thead>
        <tbody>
          <tr>
            <td class="txt">Revenue</td>
            <td>${KES0(data.profit_and_loss.comparative.revenue_kes)}</td>
            <td>${KES0(data.profit_and_loss.total_revenue_kes)}</td>
            <td class="${data.profit_and_loss.comparative.variance.revenue_kes<0?'neg':'pos'}">${data.profit_and_loss.comparative.variance.revenue_kes>=0?'+':''}${KES0(data.profit_and_loss.comparative.variance.revenue_kes)}</td>
            <td class="${data.profit_and_loss.comparative.variance.revenue_pct<0?'neg':'pos'}">${data.profit_and_loss.comparative.variance.revenue_pct===null?'n/a':(data.profit_and_loss.comparative.variance.revenue_pct>=0?'+':'')+data.profit_and_loss.comparative.variance.revenue_pct+'%'}</td>
          </tr>
          <tr>
            <td class="txt">Expenses</td>
            <td>${KES0(data.profit_and_loss.comparative.expense_kes)}</td>
            <td>${KES0(data.profit_and_loss.total_expense_kes)}</td>
            <td class="${data.profit_and_loss.comparative.variance.expense_kes>0?'neg':'pos'}">${data.profit_and_loss.comparative.variance.expense_kes>=0?'+':''}${KES0(data.profit_and_loss.comparative.variance.expense_kes)}</td>
            <td class="${data.profit_and_loss.comparative.variance.expense_pct>0?'neg':'pos'}">${data.profit_and_loss.comparative.variance.expense_pct===null?'n/a':(data.profit_and_loss.comparative.variance.expense_pct>=0?'+':'')+data.profit_and_loss.comparative.variance.expense_pct+'%'}</td>
          </tr>
          <tr style="font-weight:700; border-top:1px solid var(--hair);">
            <td class="txt">Operating Result</td>
            <td>${KES0(data.profit_and_loss.comparative.operating_result_kes)}</td>
            <td>${KES0(data.profit_and_loss.operating_result_kes)}</td>
            <td class="${data.profit_and_loss.comparative.variance.operating_result_kes<0?'neg':'pos'}">${data.profit_and_loss.comparative.variance.operating_result_kes>=0?'+':''}${KES0(data.profit_and_loss.comparative.variance.operating_result_kes)}</td>
            <td class="${data.profit_and_loss.comparative.variance.operating_result_pct<0?'neg':'pos'}">${data.profit_and_loss.comparative.variance.operating_result_pct===null?'n/a':(data.profit_and_loss.comparative.variance.operating_result_pct>=0?'+':'')+data.profit_and_loss.comparative.variance.operating_result_pct+'%'}</td>
          </tr>
        </tbody>
      </table>
    </div>` : ''}
    <div class="grid" style="grid-template-columns:1fr 1fr; align-items:start;">
      <div class="card">
        <h3 style="margin-bottom:12px;">Profit &amp; Loss — ${data.period_label}</h3>
        <table>
          <tbody>
            ${data.profit_and_loss.revenue.map(r=>`<tr><td class="txt">${r.name}</td><td>${KES0(r.amount)}</td></tr>`).join('')}
            <tr style="font-weight:700; border-top:1px solid var(--hair);"><td class="txt">Total Revenue</td><td>${KES0(data.profit_and_loss.total_revenue_kes)}</td></tr>
            ${data.profit_and_loss.expenses.map(e=>`<tr><td class="txt">${e.name}</td><td>(${KES0(e.amount)})</td></tr>`).join('')}
            <tr style="font-weight:700; border-top:1px solid var(--hair);"><td class="txt">Total Expenses</td><td>(${KES0(data.profit_and_loss.total_expense_kes)})</td></tr>
            <tr style="font-weight:800; border-top:2px solid var(--ink);"><td class="txt">Operating Result</td><td class="${data.profit_and_loss.operating_result_kes<0?'neg':'pos'}">${KES0(data.profit_and_loss.operating_result_kes)}</td></tr>
          </tbody>
        </table>
      </div>

      <div class="card">
        <h3 style="margin-bottom:4px;">Balance Sheet — as of ${data.balance_sheet.as_of}</h3>
        <div style="margin-bottom:12px;">${data.balance_sheet.is_balanced
          ? `<span class="tag good">${ic('trendUp',12)} Balanced — Assets = Liabilities + Equity</span>`
          : `<span class="tag alert">${ic('lock',12)} Out of balance by ${KES0(data.balance_sheet.balance_check_kes)} — do not trust this statement</span>`}</div>
        <table>
          <tbody>
            <tr style="font-weight:700;"><td class="txt">Assets</td><td></td></tr>
            ${data.balance_sheet.assets.map(a=>`<tr><td class="txt" style="padding-left:16px;">${a.name}</td><td>${KES0(a.amount)}</td></tr>`).join('')}
            <tr style="font-weight:700; border-top:1px solid var(--hair);"><td class="txt">Total Assets</td><td>${KES0(data.balance_sheet.total_assets_kes)}</td></tr>
            <tr style="font-weight:700; padding-top:8px;"><td class="txt" style="padding-top:12px;">Liabilities</td><td></td></tr>
            ${data.balance_sheet.liabilities.map(l=>`<tr><td class="txt" style="padding-left:16px;">${l.name}</td><td>${KES0(l.amount)}</td></tr>`).join('')}
            <tr style="font-weight:700; border-top:1px solid var(--hair);"><td class="txt">Total Liabilities</td><td>${KES0(data.balance_sheet.total_liabilities_kes)}</td></tr>
            <tr style="font-weight:700;"><td class="txt" style="padding-top:12px;">Equity</td><td></td></tr>
            ${data.balance_sheet.equity.map(e=>`<tr><td class="txt" style="padding-left:16px;">${e.name}</td><td>${KES0(e.amount)}</td></tr>`).join('')}
            <tr><td class="txt" style="padding-left:16px;">Current Earnings (since last period close)</td><td>${KES0(data.balance_sheet.current_earnings_kes)}</td></tr>
            <tr style="font-weight:800; border-top:2px solid var(--ink);"><td class="txt">Total Liabilities + Equity</td><td>${KES0(data.balance_sheet.total_liabilities_kes + data.balance_sheet.total_equity_kes)}</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <div class="section-head"><h2>Cash Flow — ${data.period_label}</h2></div>
    <div class="card">
      <table>
        <tbody>
          <tr><td class="txt">Operating (revenue &amp; expenses)</td><td class="${data.cash_flow.operating_kes<0?'neg':'pos'}">${KES0(data.cash_flow.operating_kes)}</td></tr>
          <tr><td class="txt">Financing (owner loan funding &amp; repayments)</td><td class="${data.cash_flow.financing_kes<0?'neg':'pos'}">${KES0(data.cash_flow.financing_kes)}</td></tr>
          <tr style="font-weight:800; border-top:2px solid var(--ink);"><td class="txt">Net Cash Movement</td><td class="${data.cash_flow.net_movement_kes<0?'neg':'pos'}">${KES0(data.cash_flow.net_movement_kes)}</td></tr>
        </tbody>
      </table>
    </div>
    ` : ''}

    ${state.isHeadOffice && state.allBranches && state.allBranches.length > 1 ? consolidatedSectionHtml() : ''}

    ${canManageSettings() ? `
    <div class="section-head"><h2>Accounting periods</h2>
      <div class="toolbar">${periodType==='month'
        ? `<button class="btn ghost sm" id="btn-close-period">Close current period (${period})</button>`
        : `<span class="hint">Switch to Month view to close a period — closing is always done one calendar month at a time.</span>`}</div>
    </div>
    <div class="card">
      ${periodsState.actionMsg ? `<div class="hint" style="color:${periodsState.actionMsg.ok?'inherit':'#c0392b'}; margin-bottom:10px;">${periodsState.actionMsg.text}</div>` : ''}
      ${periodsState.loading ? `<span class="hint">Loading…</span>` : (periodsState.periods && periodsState.periods.length ? `
      <div class="table-wrap"><table>
        <thead><tr><th class="txt">Period</th><th class="txt">Status</th><th class="txt">Closed</th><th></th></tr></thead>
        <tbody>
          ${periodsState.periods.map(p=>`
            <tr>
              <td class="txt">${p.period_start} – ${p.period_end}</td>
              <td class="txt"><span class="tag ${p.status==='closed'?'neutral':'good'}">${p.status}</span></td>
              <td class="txt">${p.closed_at ? new Date(p.closed_at).toLocaleDateString() : '—'}</td>
              <td>${p.status==='closed' ? `<button class="btn ghost sm" data-reopen-period="${p.id}">Reopen</button>` : ''}</td>
            </tr>`).join('')}
        </tbody>
      </table></div>` : `<span class="hint">No periods closed yet — books are open for all dates.</span>`)}
    </div>` : ''}
    ${closePreflightState.open ? closePreflightHtml() : ''}
  `;
}

let branchCompareState = { loading:false, rows:null, error:null };

/* ---------------- Suppliers & Bills (Accounts Payable) ---------------- */

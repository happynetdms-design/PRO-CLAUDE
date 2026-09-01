/* ---------------- DASHBOARD ---------------- */

/* ---------------- Automation / Alerts (monitoring only, in-app only) ---------------- */
let alertsState = { loading:false, alerts:null, error:null, scanning:false };

async function loadAlerts(){
  alertsState.loading = true; render();
  try{
    const res = await apiFetch(`/api/automation?branch_id=${state.branchId}`, { method:'GET' });
    const body = await res.json();
    if(!res.ok) throw new Error(body.error || 'Could not load alerts.');
    alertsState.alerts = body.alerts || [];
    alertsState.error = null;
  }catch(e){ alertsState.error = e.message; }
  alertsState.loading = false;
  render();
}
async function scanForAlerts(){
  alertsState.scanning = true; render();
  try{
    const res = await apiFetch('/api/automation?action=scan', { method:'POST', headers: JSONH, body: JSON.stringify({ branch_id: state.branchId }) });
    const body = await res.json();
    if(!res.ok) throw new Error(body.error || 'Scan failed.');
    alertsState.alerts = body.open_alerts || [];
    alertsState.error = null;
  }catch(e){ alertsState.error = e.message; }
  alertsState.scanning = false;
  render();
}
async function dismissAlert(id){
  try{
    const res = await apiFetch('/api/automation?action=dismiss', { method:'POST', headers: JSONH, body: JSON.stringify({ branch_id: state.branchId, id }) });
    const body = await res.json();
    if(!res.ok) throw new Error(body.error || 'Could not dismiss.');
    await loadAlerts();
  }catch(e){ showToast(e.message, 'error'); }
}
function alertsSectionHtml(){
  const { alerts, error, scanning } = alertsState;
  const open = (alerts||[]).filter(a=>a.status==='open');
  return `
    <div style="display:flex; justify-content:flex-end; margin-bottom:${open.length?'0':'14px'};">
      <button class="btn ghost sm no-print" id="btn-scan-alerts" ${scanning?'disabled':''}>${scanning?'Scanning…':'Scan for issues'}</button>
    </div>
    ${error ? `<div class="hint" style="color:#c0392b; margin-bottom:14px;">${error}</div>` : ''}
    ${open.length ? `
    <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:22px;">
      ${open.map(a=>`
        <div class="card" style="padding:12px 16px; display:flex; align-items:center; justify-content:space-between; gap:10px; border-left:4px solid ${a.severity==='critical'?'var(--alert)':'var(--gold)'};">
          <div style="display:flex; align-items:center; gap:10px;">${ic('lock',15)}<span>${a.message}</span></div>
          <button class="btn ghost sm no-print" data-dismiss-alert="${a.id}">Dismiss</button>
        </div>`).join('')}
    </div>` : ''}
  `;
}

function viewDashboard(){
  const d = dashboardData();
  const closed = state.closedMonths.includes(d.ym);
  return `
    <div class="topbar">
      <div><h1>Monthly Dashboard</h1><div class="sub">Live view of ${monthLabel(d.ym)} — nothing here is manually edited.</div></div>
      <div class="topbar-actions">
        <div class="month-pill ${closed?'closed':''}"><span class="dot">${ic('calendar',13)}</span>Day ${d.daysElapsed} of ${d.dim}</div>
        <button class="btn ghost sm no-print" id="btn-print-report">${ic('printer',14)}Print Monthly Report</button>
      </div>
    </div>

    ${alertsSectionHtml()}

    <div class="grid kpi">
      <div class="card kpi">
        <div class="kpi-head"><h3>Revenue Pace</h3><div class="kpi-icon tone-gold">${ic('trendUp',16)}</div></div>
        <div class="big">${d.revenuePacePct.toFixed(0)}%</div>
        <div class="signal lit-${signalLevel(d.revenuePacePct)}"><i></i><i></i><i></i><i></i></div>
        <div class="foot" style="margin-top:8px;">${KES(d.totalRevenue)} booked toward a ${KES(d.target)} target</div>
      </div>
      <div class="card kpi">
        <div class="kpi-head"><h3>Operating Expense Pace</h3><div class="kpi-icon tone-navy">${ic('wallet',16)}</div></div>
        <div class="big">${d.opexPacePct.toFixed(0)}%</div>
        <div class="signal lit-${signalLevel(200-d.opexPacePct)}"><i></i><i></i><i></i><i></i></div>
        <div class="foot" style="margin-top:8px;">${d.overspent ? `<span class="tag alert">Overspent ${KES(Math.abs(d.opexVariance))}</span>` : `<span class="tag good">${KES(d.opexVariance)} left</span>`} of ${KES(d.alloc.opex)} budget</div>
      </div>
      <div class="card kpi">
        <div class="kpi-head"><h3>Projected Month-End Revenue</h3><div class="kpi-icon tone-good">${ic('target',16)}</div></div>
        <div class="big">${KES(d.projRevenue)}</div>
        <div class="foot">${d.projRevenue>=d.target?'On track to clear target':'Tracking below target'}</div>
      </div>
      <div class="card kpi">
        <div class="kpi-head"><h3>Projected Month-End OpEx</h3><div class="kpi-icon tone-navy">${ic('pieChart',16)}</div></div>
        <div class="big">${KES(d.projOpex)}</div>
        <div class="foot">vs ${KES(d.alloc.opex)} budgeted so far this month</div>
      </div>
    </div>

    <div class="section-head"><h2>Business health, in plain English</h2></div>
    <div class="narrative"><div class="narrative-icon">${ic('message',15)}</div>${narrativeText(d)}</div>

    <div class="section-head"><h2>Where today's shilling goes</h2>
      <div class="toolbar"><span class="hint">Default split — edit in Settings</span></div>
    </div>
    <div class="pf-bucket-row">
      <div class="pf-bucket" style="--tone:var(--gold-deep);"><div class="pf-bucket-icon">${ic('piggyBank',16)}</div><div class="label">Profit (${state.settings.pct_profit}%)</div><div class="amt">${KES(d.alloc.profit)}</div></div>
      <div class="pf-bucket" style="--tone:#6C63B5;"><div class="pf-bucket-icon">${ic('handshake',16)}</div><div class="label">Owner Pay &amp; Debt (${state.settings.pct_owner_debt}%)</div><div class="amt">${KES(d.alloc.owner_debt)}</div></div>
      <div class="pf-bucket" style="--tone:var(--alert);"><div class="pf-bucket-icon">${ic('landmark',16)}</div><div class="label">Tax Reserve (${state.settings.pct_tax}%)</div><div class="amt">${KES(d.alloc.tax)}</div></div>
      <div class="pf-bucket" style="--tone:var(--ink-soft);"><div class="pf-bucket-icon">${ic('briefcase',16)}</div><div class="label">OpEx Budget (${state.settings.pct_opex}%)</div><div class="amt">${KES(d.alloc.opex)}</div></div>
    </div>

    <div class="section-head"><h2>Close ${monthLabel(d.ym)}</h2></div>
    <div class="card">
      <div style="display:flex; justify-content:space-between; align-items:center; gap:14px; flex-wrap:wrap;">
        <div class="sub" style="color:var(--muted); font-size:13.5px;">Archives this month's totals into the Trend Archive and opens a fresh month. Past data is kept forever, never deleted.</div>
        ${canWrite() ? `<button class="btn gold" id="btn-close-month" ${closed?'disabled':''}>${closed?'Month already closed':'Close Month'}</button>` : `<span class="hint" style="display:flex; align-items:center; gap:8px;">${ic('lock',14)}Read-only access</span>`}
      </div>
    </div>
    ${renderCloseMonthModal(d)}
  `;
}

function renderCloseMonthModal(d){
  if(!confirmCloseMonth) return '';
  return `
    <div class="modal-backdrop" id="modal-backdrop">
      <div class="modal">
        <h3>Close ${monthLabel(d.ym)}?</h3>
        <div class="sub" style="color:var(--muted); font-size:13.5px;">This snapshots the totals below into the Trend Archive. ${monthLabel(d.ym)} will then be locked — new entries for this month will be blocked.</div>
        <div class="totals">
          <div><span>Total Revenue</span><b class="num">${KES(d.totalRevenue)}</b></div>
          <div><span>Profit Reserved</span><b class="num">${KES(d.alloc.profit)}</b></div>
          <div><span>Owner Pay &amp; Debt</span><b class="num">${KES(d.alloc.owner_debt)}</b></div>
          <div><span>Tax Reserve</span><b class="num">${KES(d.alloc.tax)}</b></div>
          <div><span>OpEx Budget</span><b class="num">${KES(d.alloc.opex)}</b></div>
          <div><span>Actual OpEx (net)</span><b class="num">${KES(d.netOpex)}</b></div>
        </div>
        <div class="modal-actions">
          <button class="btn ghost" id="btn-cancel-close">Cancel</button>
          <button class="btn gold" id="btn-confirm-close">Confirm &amp; Archive</button>
        </div>
      </div>
    </div>
  `;
}

function doCloseMonth(){
  const d = dashboardData();
  state.monthlyArchive.push({
    id: uid(), month: d.ym, month_label: monthLabel(d.ym),
    total_revenue_kes: d.totalRevenue,
    daily_avg_revenue_kes: d.daysElapsed? d.totalRevenue/d.daysElapsed : 0,
    profit_reserved_kes: d.alloc.profit,
    owner_pay_allocated_kes: d.alloc.owner_debt,
    tax_reserve_kes: d.alloc.tax,
    opex_budget_kes: d.alloc.opex,
    actual_opex_kes: d.netOpex,
    opex_running_balance_kes: d.alloc.opex - d.netOpex,
    net_cash_to_ops_kes: d.totalRevenue - d.netOpex - d.alloc.profit - d.alloc.owner_debt - d.alloc.tax + (d.alloc.opex-d.netOpex),
    opex_ratio_pct: d.totalRevenue? (d.netOpex/d.totalRevenue)*100 : 0,
    revenue_achievement_pct: d.target? (d.totalRevenue/d.target)*100 : 0
  });
  state.closedMonths.push(d.ym);
  confirmCloseMonth = false;
  queueSave();
  render();
}

/* ---------------- DAILY ENTRY ---------------- */

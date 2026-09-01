/* ---------------- Executive Dashboard ---------------- */
let executiveState = { loading:false, data:null, error:null };
let decisionQueueState = { loading:false, decisions:null, error:null, formOpen:false, formError:null, prefill:null };

async function loadDecisionQueue(){
  try{
    const res = await apiFetch(`/api/management-decisions?branch_id=${state.branchId}`, { method:'GET' });
    const body = await res.json();
    if(!res.ok) throw new Error(body.error || 'Could not load the decision queue.');
    decisionQueueState.decisions = body.decisions || [];
    decisionQueueState.error = null;
  }catch(e){ decisionQueueState.error = e.message; }
  render();
}
function openDecisionForm(prefill){
  decisionQueueState.formOpen = true;
  decisionQueueState.formError = null;
  decisionQueueState.prefill = prefill || null;
  render();
}
function closeDecisionForm(){
  decisionQueueState.formOpen = false; decisionQueueState.prefill = null; decisionQueueState.formError = null;
  render();
}
async function addDecision(fields){
  decisionQueueState.formError = null;
  try{
    const res = await apiFetch('/api/management-decisions', { method:'POST', headers: JSONH, body: JSON.stringify({ branch_id: state.branchId, ...fields }) });
    const body = await res.json();
    if(!res.ok) throw new Error(body.error || 'Could not add this decision.');
    closeDecisionForm();
    await loadDecisionQueue();
  }catch(e){ decisionQueueState.formError = e.message; render(); }
}
async function setDecisionStatus(id, status){
  try{
    const res = await apiFetch('/api/management-decisions', { method:'PATCH', headers: JSONH, body: JSON.stringify({ branch_id: state.branchId, id, status }) });
    const body = await res.json();
    if(!res.ok) throw new Error(body.error || 'Could not update.');
    await loadDecisionQueue();
  }catch(e){ showToast(e.message, 'error'); }
}
let scenarioState = { loading:false, result:null, error:null };

async function runScenario(){
  scenarioState.loading = true; scenarioState.error = null; render();
  try{
    const revPct = document.getElementById('scenario-revenue-pct').value || 0;
    const expPct = document.getElementById('scenario-expense-pct').value || 0;
    const res = await apiFetch(`/api/scenario?branch_id=${state.branchId}&revenue_change_pct=${revPct}&expense_change_pct=${expPct}`, { method:'GET' });
    const body = await res.json();
    if(!res.ok) throw new Error(body.error || 'Could not run the scenario.');
    scenarioState.result = body;
  }catch(e){ scenarioState.error = e.message; }
  scenarioState.loading = false;
  render();
}

async function loadExecutive(period){
  executiveState = { loading:true, data:null, error:null };
  render();
  try{
    const p = period || new Date().toISOString().slice(0,7);
    const res = await apiFetch(`/api/executive-dashboard?branch_id=${state.branchId}&period=${p}`, { method:'GET' });
    const body = await res.json();
    if(!res.ok) throw new Error(body.error || 'Could not load the executive dashboard.');
    executiveState.data = body;
  }catch(e){ executiveState.error = e.message; }
  executiveState.loading = false;
  render();
}

function viewExecutive(){
  const { loading, data, error } = executiveState;
  return `
    <div class="topbar"><div><h1>Executive Dashboard</h1><div class="sub">Facts and calculations only, pulled live from the ledger, AP, and loans — no AI-generated commentary here, that's a separate concern.</div></div></div>

    ${loading ? `<div class="card"><span class="hint">Loading…</span></div>` : ''}
    ${error ? `<div class="card"><div class="hint" style="color:#c0392b;">${error}</div><div class="hint">Needs the ledger foundation SQL run against Supabase first.</div></div>` : ''}

    ${data ? `
    ${data.risks.length ? `
    <div class="section-head"><h2>Needs attention</h2></div>
    <div style="display:flex; flex-direction:column; gap:8px; margin-bottom:22px;">
      ${data.risks.map((r,i)=>`<div class="card" style="padding:12px 16px; display:flex; align-items:center; justify-content:space-between; gap:10px; border-left:4px solid ${r.level==='critical'?'var(--alert)':'var(--gold)'};"><div style="display:flex; align-items:center; gap:10px;">${ic('lock',15)}<span>${r.message}</span></div><button class="btn ghost sm" data-track-decision="${i}" data-risk-message="${r.message.replace(/"/g,'&quot;')}" data-risk-level="${r.level}">Track as decision</button></div>`).join('')}
    </div>` : `<div class="card" style="margin-bottom:22px; display:flex; align-items:center; gap:10px;">${ic('trendUp',16)}<span>No issues flagged — cash, AP, and the ledger all look healthy.</span></div>`}

    <div class="grid kpi" style="margin-bottom:22px;">
      <div class="card kpi"><h3>Revenue (${monthLabel(data.period)})</h3><div class="big">${KES(data.revenue_kes)}</div>
        ${data.revenue_growth_pct!==null ? `<div class="foot"><span class="tag ${data.revenue_growth_pct>=0?'good':'alert'}">${data.revenue_growth_pct>=0?'+':''}${data.revenue_growth_pct}% vs last month</span></div>` : ''}</div>
      <div class="card kpi"><h3>Operating Result</h3><div class="big" style="color:${data.operating_result_kes<0?'var(--alert)':'inherit'};">${KES(data.operating_result_kes)}</div></div>
      <div class="card kpi"><h3>Cash Position</h3><div class="big">${KES(data.cash_position_kes)}</div>
        ${data.cash_runway_months!==null ? `<div class="foot"><span class="tag alert">${data.cash_runway_months} months runway at current burn</span></div>` : `<div class="foot">Cash flow positive — no runway concern</div>`}</div>
      <div class="card kpi"><h3>Ledger Integrity</h3><div class="big" style="font-size:20px; color:${data.ledger_balanced?'var(--good)':'var(--alert)'};">${data.ledger_balanced?'Balanced':'OUT OF BALANCE'}</div></div>
    </div>

    <div class="grid kpi" style="margin-bottom:22px;">
      <div class="card kpi"><h3>Owner Loan Balance</h3><div class="big" style="font-size:20px;">${KES(data.owner_loan_balance_kes)}</div><div class="foot">What the business owes John and other owner-lenders</div></div>
      <div class="card kpi"><h3>Accounts Payable</h3><div class="big" style="font-size:20px;">${KES(data.ap_outstanding_kes)}</div>${data.ap_overdue_kes>0?`<div class="foot"><span class="tag alert">${KES(data.ap_overdue_kes)} overdue</span></div>`:''}</div>
    </div>

    ${data.recent_allocations.length ? `
    <div class="section-head"><h2>Recent Profit First allocations</h2></div>
    <div class="table-wrap"><table>
      <thead><tr><th class="txt">Period</th><th class="txt">Bucket</th><th>Amount</th><th class="txt">Approved</th></tr></thead>
      <tbody>${data.recent_allocations.map(a=>`<tr><td class="txt">${a.period}</td><td class="txt" style="text-transform:capitalize;">${a.bucket.replace(/_/g,' ')}</td><td>${KES0(a.amount_kes)}</td><td class="txt">${a.approved_at?'Yes':'Pending'}</td></tr>`).join('')}</tbody>
    </table></div>` : ''}
    ` : ''}

    <div class="section-head"><h2>Decision queue</h2>
      <div class="toolbar"><button class="btn ghost sm" id="btn-add-decision">+ New Decision</button></div>
    </div>
    <div class="card" style="margin-bottom:22px;">
      ${decisionQueueState.formError ? `<div class="hint" style="color:#c0392b; margin-bottom:10px;">${decisionQueueState.formError}</div>` : ''}
      ${decisionQueueState.formOpen ? `
      <form id="form-add-decision" style="margin-bottom:16px; padding-bottom:16px; border-bottom:1px solid var(--hair);">
        <div class="form-row">
          <div><label>Title</label><input type="text" name="title" placeholder="e.g. Renegotiate Sacco loan terms" value="${decisionQueueState.prefill?.title||''}" required></div>
          <div><label>Priority</label><select name="priority">
            ${['low','medium','high','critical'].map(p=>`<option value="${p}" ${decisionQueueState.prefill?.priority===p?'selected':''}>${p}</option>`).join('')}
          </select></div>
          <div><label>Owner</label><input type="text" name="owner_name" placeholder="who's responsible"></div>
          <div><label>Due Date</label><input type="date" name="due_date"></div>
        </div>
        <div><label>Notes</label><input type="text" name="description" placeholder="optional detail"></div>
        <button class="btn gold" type="submit" style="margin-top:10px;">Add to Queue</button>
        <button type="button" class="btn ghost" id="btn-cancel-decision">Cancel</button>
      </form>` : ''}
      ${(decisionQueueState.decisions||[]).filter(d=>d.status==='open'||d.status==='in_progress').length===0 ? `<span class="hint">Nothing in the queue.</span>` : `
      <table>
        <thead><tr><th class="txt">Title</th><th class="txt">Priority</th><th class="txt">Owner</th><th>Due</th><th class="txt">Status</th><th></th></tr></thead>
        <tbody>
          ${decisionQueueState.decisions.filter(d=>d.status==='open'||d.status==='in_progress').map(d=>`
            <tr>
              <td class="txt">${d.title}</td>
              <td class="txt"><span class="tag ${d.priority==='critical'||d.priority==='high'?'alert':d.priority==='medium'?'neutral':'good'}">${d.priority}</span></td>
              <td class="txt">${d.owner_name||'—'}</td>
              <td class="txt">${d.due_date||'—'}</td>
              <td class="txt"><span class="tag neutral">${d.status.replace('_',' ')}</span></td>
              <td style="white-space:nowrap;">
                ${d.status==='open' ? `<button class="btn ghost sm" data-decision-status="${d.id}" data-new-status="in_progress">Start</button>` : ''}
                <button class="btn ghost sm" data-decision-status="${d.id}" data-new-status="done">Done</button>
                <button class="btn ghost sm" data-decision-status="${d.id}" data-new-status="dismissed">Dismiss</button>
              </td>
            </tr>`).join('')}
        </tbody>
      </table>`}
    </div>

    <div class="section-head"><h2>Scenario analysis</h2></div>
    <div class="card">
      <div class="hint" style="margin-bottom:14px;">${ic('lock',13)} Hypothetical only — this never changes any real record. Every figure below is computed live from this month's actual revenue and expenses.</div>
      <div class="form-row">
        <div><label>Revenue change (%)</label><input type="number" id="scenario-revenue-pct" value="0" step="1"></div>
        <div><label>Expense change (%)</label><input type="number" id="scenario-expense-pct" value="0" step="1"></div>
      </div>
      <button class="btn gold" id="btn-run-scenario">Run Scenario</button>
      ${scenarioState.error ? `<div class="hint" style="color:#c0392b; margin-top:10px;">${scenarioState.error}</div>` : ''}
      ${scenarioState.result ? scenarioResultHtml(scenarioState.result) : ''}
    </div>
  `;
}
function scenarioResultHtml(r){
  return `
    <div style="margin-top:18px; padding-top:18px; border-top:1px solid var(--hair);">
      <div class="tag neutral" style="margin-bottom:14px;">FORECAST — ${monthLabel(r.period)}</div>
      <div class="grid kpi" style="grid-template-columns:repeat(3,1fr);">
        <div class="card kpi"><h3>Baseline Result</h3><div class="big" style="font-size:19px;">${KES0(r.baseline.operating_result_kes)}</div></div>
        <div class="card kpi"><h3>Scenario Result</h3><div class="big" style="font-size:19px; color:${r.scenario.operating_result_kes<0?'var(--alert)':'inherit'};">${KES0(r.scenario.operating_result_kes)}</div></div>
        <div class="card kpi"><h3>Change</h3><div class="big" style="font-size:19px; color:${r.result_change_kes<0?'var(--alert)':'var(--good)'};">${r.result_change_kes>=0?'+':''}${KES0(r.result_change_kes)}</div></div>
      </div>
      ${r.profit_first_allocations ? `
      <div class="section-head" style="margin-top:18px;"><h2 style="font-size:14px;">Profit First allocation under this scenario</h2></div>
      <table>
        <thead><tr><th class="txt">Bucket</th><th>Baseline</th><th>Scenario</th></tr></thead>
        <tbody>
          <tr><td class="txt">Profit</td><td>${KES0(r.profit_first_allocations.baseline.profit_kes)}</td><td>${KES0(r.profit_first_allocations.scenario.profit_kes)}</td></tr>
          <tr><td class="txt">Owner Pay &amp; Debt</td><td>${KES0(r.profit_first_allocations.baseline.owner_debt_kes)}</td><td>${KES0(r.profit_first_allocations.scenario.owner_debt_kes)}</td></tr>
          <tr><td class="txt">Tax Reserve</td><td>${KES0(r.profit_first_allocations.baseline.tax_kes)}</td><td>${KES0(r.profit_first_allocations.scenario.tax_kes)}</td></tr>
          <tr><td class="txt">OpEx</td><td>${KES0(r.profit_first_allocations.baseline.opex_kes)}</td><td>${KES0(r.profit_first_allocations.scenario.opex_kes)}</td></tr>
        </tbody>
      </table>` : ''}
    </div>
  `;
}


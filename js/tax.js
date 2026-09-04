/* ---------------- TAX CALENDAR ---------------- */

function viewTax(){
  const d = dashboardData(); // single source of truth for tax reserve balance
  const applicable = state.taxObligations.filter(t=>t.applicable);
  const now = new Date(); const in30 = new Date(); in30.setDate(now.getDate()+30);
  const dueSoon = applicable.filter(t => {
    if(t.frequency==='Monthly') return true; // recurring monthly always counts within 30d window
    if(t.manual_next_due_date) return new Date(t.manual_next_due_date) <= in30;
    return false;
  });
  const estimatedDueSoon = dueSoon.reduce((s,t)=>s+Number(t.estimated_amount_kes||0),0);
  const reserveBalance = d.alloc.tax; // pulled from Monthly Dashboard's real tax reserve total
  const shortfall = estimatedDueSoon - reserveBalance;

  return `
    <div class="topbar"><div><h1>Tax Compliance Calendar</h1><div class="sub">Reserve balance is pulled live from the Monthly Dashboard — one source of truth.</div></div></div>

    <div class="grid kpi">
      <div class="card kpi"><h3>Tax Reserve Balance (${monthLabel(d.ym)})</h3><div class="big" style="font-size:22px;">${KES(reserveBalance)}</div></div>
      <div class="card kpi"><h3>Estimated Due, Next 30 Days</h3><div class="big" style="font-size:22px;">${KES(estimatedDueSoon)}</div></div>
      <div class="card kpi"><h3>Status</h3>
        <div style="margin-top:6px;">${shortfall > 0 ? `<span class="tag alert">Reserve shortfall of ${KES(shortfall)}</span>` : `<span class="tag good">Reserve covers the next 30 days</span>`}</div>
      </div>
    </div>

    <div class="section-head"><h2>Obligation register</h2></div>
    <div class="table-wrap"><table>
      <thead><tr><th class="txt">Tax Type</th><th class="txt">Applicable</th><th class="txt">Frequency</th><th>Due</th><th>Est. Amount</th><th class="txt">Authority</th><th></th></tr></thead>
      <tbody>
        ${state.taxObligations.map(t=>`
          <tr>
            <td class="txt">${t.tax_type}</td>
            <td class="txt"><input type="checkbox" data-tax-applicable="${t.id}" ${t.applicable?'checked':''} ${canWrite()?'':'disabled'}></td>
            <td class="txt">
              <select data-tax-frequency="${t.id}" ${canWrite()?'':'disabled'}>
                ${['Monthly','Quarterly','Annual'].map(f=>`<option ${t.frequency===f?'selected':''}>${f}</option>`).join('')}
              </select>
            </td>
            <td class="txt">${t.frequency==='Monthly'
              ? `Day <input style="width:52px; display:inline; padding:4px 6px;" type="number" min="1" max="28" data-tax-dueday="${t.id}" value="${t.due_day_of_month}" ${canWrite()?'':'disabled'}>`
              : `<input type="date" data-tax-manualdue="${t.id}" value="${t.manual_next_due_date||''}" ${canWrite()?'':'disabled'}>`}</td>
            <td><input style="width:110px;" type="number" min="0" data-tax-amount="${t.id}" value="${t.estimated_amount_kes}" ${canWrite()?'':'disabled'}></td>
            <td class="txt"><input style="width:100px;" type="text" data-tax-authority="${t.id}" value="${t.filing_authority}" ${canWrite()?'':'disabled'}></td>
            <td>${canWrite() ? `<button class="btn ghost sm" data-del-tax="${t.id}">Remove</button>` : ''}</td>
          </tr>`).join('')}
      </tbody>
    </table></div>
    ${canWrite() ? `<div class="section-head"></div><button class="btn ghost sm" id="btn-add-tax">+ Add custom tax type</button>` : ''}

    ${taxIntelState.loading || taxIntelState.data || taxIntelState.error ? taxIntelSectionHtml() : `
      <div class="section-head"><h2>Tax Intelligence</h2></div>
      <div class="card"><button class="btn ghost sm" id="btn-load-tax-intel">Load filing periods, deadlines &amp; compliance status</button></div>
    `}
  `;
}

/* ---------------- Tax Intelligence (per-period filing/payment tracking) ---------------- */
let taxIntelState = { loading:false, data:null, error:null, formError:null };

async function loadTaxIntel(){
  taxIntelState.loading = true; render();
  try{
    const res = await apiFetch(`/api/tax-intelligence?branch_id=${state.branchId}`, { method:'GET' });
    const body = await safeParseJson(res);
    if(!res.ok) throw new Error(body.error || 'Could not load tax intelligence.');
    taxIntelState.data = body;
    taxIntelState.error = null;
  }catch(e){ taxIntelState.error = e.message; }
  taxIntelState.loading = false;
  render();
}
async function createTaxPeriod(obligationId, periodStart, periodEnd, amountDue){
  taxIntelState.formError = null;
  try{
    const res = await apiFetch('/api/tax-intelligence', {
      method:'POST', headers: JSONH,
      body: JSON.stringify({ branch_id: state.branchId, action:'period', tax_obligation_id: obligationId, period_start: periodStart, period_end: periodEnd, amount_due_kes: amountDue })
    });
    const body = await safeParseJson(res);
    if(!res.ok) throw new Error(body.error || 'Could not create period.');
    await loadTaxIntel();
  }catch(e){ taxIntelState.formError = e.message; render(); }
}
async function fileTaxPeriod(periodId){
  const ref = (await promptDialog('Filing reference (optional):')) || null;
  try{
    const res = await apiFetch('/api/tax-intelligence', { method:'POST', headers: JSONH, body: JSON.stringify({ branch_id: state.branchId, action:'file', tax_period_id: periodId, filing_status:'filed', filing_reference: ref }) });
    const body = await safeParseJson(res);
    if(!res.ok) throw new Error(body.error || 'Could not mark as filed.');
    await loadTaxIntel();
  }catch(e){ showToast(e.message, 'error'); }
}
async function recordTaxPayment(periodId, dueRemaining){
  const amountStr = await promptDialog(`Payment amount (KES) — remaining due is ${dueRemaining}:`, dueRemaining);
  if(!amountStr) return;
  const amount = Number(amountStr);
  if(!amount || amount<=0){ showToast('Enter a valid amount.', 'error'); return; }
  try{
    const res = await apiFetch('/api/tax-intelligence', { method:'POST', headers: JSONH, body: JSON.stringify({ branch_id: state.branchId, action:'payment', tax_period_id: periodId, amount_kes: amount, payment_date: todayISO() }) });
    const body = await safeParseJson(res);
    if(!res.ok) throw new Error(body.error || 'Could not record payment.');
    await loadTaxIntel();
  }catch(e){ showToast(e.message, 'error'); }
}

function taxIntelSectionHtml(){
  const { loading, data, error, formError } = taxIntelState;
  return `
    <div class="section-head"><h2>Tax Intelligence — filing periods &amp; deadlines</h2></div>
    ${loading && !data ? `<div class="card"><span class="hint">Loading…</span></div>` : ''}
    ${error ? `<div class="card"><div class="hint" style="color:#c0392b;">${error}</div><div class="hint">Needs <code>hfms_foundation_fix_06_tax_intelligence.sql</code> run against Supabase first.</div></div>` : ''}
    ${formError ? `<div class="hint" style="color:#c0392b; margin-bottom:10px;">${formError}</div>` : ''}
    ${data ? `
      <div class="grid kpi" style="margin-bottom:20px;">
        <div class="card kpi"><h3>Open Periods</h3><div class="big" style="font-size:20px;">${data.summary.openCount}</div></div>
        <div class="card kpi"><h3>Overdue</h3><div class="big" style="font-size:20px; color:${data.summary.overdueCount>0?'var(--alert)':'inherit'};">${data.summary.overdueCount}</div></div>
        <div class="card kpi"><h3>Due Within 30 Days</h3><div class="big" style="font-size:20px;">${KES0(data.summary.due30Kes)}</div></div>
        <div class="card kpi"><h3>Total Outstanding</h3><div class="big" style="font-size:20px;">${KES0(data.summary.outstandingKes)}</div></div>
      </div>

      ${canWrite() ? `
      <div class="form-card">
        <h3>Open a filing period</h3>
        <form id="form-tax-period">
          <div class="form-row">
            <div><label>Tax Type</label><select name="tax_obligation_id">${state.taxObligations.map(t=>`<option value="${t.id}">${t.tax_type}</option>`).join('')}</select></div>
            <div><label>Period Start</label><input type="date" name="period_start" required></div>
            <div><label>Period End</label><input type="date" name="period_end" required></div>
            <div><label>Amount Due (KES)</label><input type="number" name="amount_due_kes" min="0" required></div>
          </div>
          <button class="btn gold" type="submit">Open Period</button>
        </form>
      </div>` : ''}

      <div class="table-wrap"><table>
        <thead><tr><th class="txt">Tax Type</th><th class="txt">Period</th><th>Due</th><th>Amount Due</th><th>Paid</th><th class="txt">Status</th><th></th></tr></thead>
        <tbody>
          ${(data.periods||[]).length===0 ? `<tr class="empty-row"><td colspan="7">No filing periods opened yet.</td></tr>` : data.periods.map(p=>{
            const remaining = Number(p.amount_due_kes) - Number(p.amount_paid_kes);
            const sev = p.compliance.severity;
            return `<tr>
              <td class="txt">${p.tax_obligations ? p.tax_obligations.tax_type : ''}</td>
              <td class="txt">${p.period_start} – ${p.period_end}</td>
              <td class="txt">${p.payment_due_date || p.filing_due_date || '—'}</td>
              <td>${KES0(p.amount_due_kes)}</td>
              <td>${KES0(p.amount_paid_kes)}</td>
              <td class="txt"><span class="tag ${sev==='good'?'good':sev==='critical'?'alert':'neutral'}">${p.compliance.label}</span></td>
              <td style="white-space:nowrap;">
                ${canWrite() && p.filing_status!=='filed' ? `<button class="btn ghost sm" data-file-period="${p.id}">Mark Filed</button>` : ''}
                ${canWrite() && remaining>0 ? `<button class="btn ghost sm" data-pay-period="${p.id}" data-period-remaining="${remaining}">Record Payment</button>` : ''}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>

      <div class="section-head"><h2>Reference: official deadline rules</h2></div>
      <div class="card">
        <table>
          <thead><tr><th class="txt">Tax Type</th><th class="txt">Frequency</th><th class="txt">Due Rule</th><th class="txt">Source</th></tr></thead>
          <tbody>
            ${(data.rules||[]).map(r=>`<tr><td class="txt">${r.tax_type}</td><td class="txt">${r.frequency}</td><td class="txt">${r.due_rule}</td><td class="txt">${r.source_url?`<a href="${r.source_url}" target="_blank" rel="noopener">KRA ↗</a>`:'—'}</td></tr>`).join('')}
          </tbody>
        </table>
      </div>
    ` : ''}
  `;
}

/* ---------------- TREND ARCHIVE ---------------- */

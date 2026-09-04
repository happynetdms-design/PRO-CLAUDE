/* ---------------- Reconciliation ---------------- */
let reconcileState = { loading:false, imports:null, current:null, lines:null, suggestions:null, error:null, formError:null };
let statementExtractState = { loading:false, result:null, error:null };

async function extractStatementDocument(file){
  if(!file) return;
  statementExtractState = { loading:true, result:null, error:null };
  render();
  try{
    const dataUrl = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result);
      reader.onerror = () => rej(new Error('Could not read that file.'));
      reader.readAsDataURL(file);
    });
    const base64 = dataUrl.split(',')[1] || '';
    const res = await apiFetch('/api/statement-extraction', {
      method:'POST', headers: JSONH,
      body: JSON.stringify({ branch_id: state.branchId, file_name: file.name, content_type: file.type, data_base64: base64 })
    });
    const body = await safeParseJson(res);
    if(!res.ok) throw new Error(body.error || 'Could not read this statement.');
    statementExtractState.result = body;
  }catch(e){
    statementExtractState.error = e.message;
  }
  statementExtractState.loading = false;
  render();
}

async function loadImports(){
  reconcileState.loading = true; render();
  try{
    const res = await apiFetch(`/api/reconciliation?branch_id=${state.branchId}`, { method:'GET' });
    const body = await safeParseJson(res);
    if(!res.ok) throw new Error(body.error || 'Could not load reconciliation imports.');
    reconcileState.imports = body.imports || [];
    reconcileState.error = null;
  }catch(e){ reconcileState.error = e.message; }
  reconcileState.loading = false;
  render();
}
async function openImport(importId){
  reconcileState.loading = true; render();
  try{
    const res = await apiFetch(`/api/reconciliation?import_id=${importId}`, { method:'GET' });
    const body = await safeParseJson(res);
    if(!res.ok) throw new Error(body.error || 'Could not load this import.');
    reconcileState.current = importId;
    reconcileState.lines = body.lines || [];
    reconcileState.suggestions = body.suggestions || [];
  }catch(e){ reconcileState.error = e.message; }
  reconcileState.loading = false;
  render();
}
function parseStatementText(text){
  // One line per transaction: date,amount,description — matches the same
  // "paste or upload a simple export" pattern as the Tende importer, just
  // simpler since there's no fixed spreadsheet template for a bank/mobile-
  // money statement across providers.
  return text.trim().split('\n').map(line => {
    const [date, amount, ...rest] = line.split(',');
    return { date: (date||'').trim(), amount_kes: Number((amount||'').trim()), description: rest.join(',').trim() };
  }).filter(l => l.date && !isNaN(l.amount_kes) && l.amount_kes !== 0);
}
async function createImport(label, accountName, periodStart, periodEnd, rawText){
  reconcileState.formError = null;
  const lines = parseStatementText(rawText);
  if(lines.length === 0){ reconcileState.formError = 'No valid lines found — each line should be "date,amount,description", one per transaction.'; render(); return; }
  try{
    const res = await apiFetch('/api/reconciliation?action=create', {
      method:'POST', headers: JSONH,
      body: JSON.stringify({ branch_id: state.branchId, label, account_name: accountName, period_start: periodStart, period_end: periodEnd, lines })
    });
    const body = await safeParseJson(res);
    if(!res.ok) throw new Error(body.error || 'Could not create import.');
    await loadImports();
    await openImport(body.import.id);
  }catch(e){ reconcileState.formError = e.message; render(); }
}
async function resolveLine(lineId, resolution, matchedTxnId){
  try{
    const res = await apiFetch('/api/reconciliation?action=resolve', {
      method:'POST', headers: JSONH,
      body: JSON.stringify({ branch_id: state.branchId, line_id: lineId, resolution, matched_transaction_id: matchedTxnId })
    });
    const body = await safeParseJson(res);
    if(!res.ok) throw new Error(body.error || 'Could not resolve line.');
    await openImport(reconcileState.current);
  }catch(e){ showToast('Could not resolve: ' + e.message, 'error'); }
}
async function submitImport(){
  try{
    const res = await apiFetch('/api/reconciliation?action=submit', { method:'POST', headers: JSONH, body: JSON.stringify({ branch_id: state.branchId, import_id: reconcileState.current }) });
    const body = await safeParseJson(res);
    if(!res.ok) throw new Error(body.error || 'Could not submit.');
    await loadImports(); await openImport(reconcileState.current);
  }catch(e){ showToast(e.message, 'error'); }
}
async function approveImport(){
  try{
    const res = await apiFetch('/api/reconciliation?action=approve', { method:'POST', headers: JSONH, body: JSON.stringify({ branch_id: state.branchId, import_id: reconcileState.current }) });
    const body = await safeParseJson(res);
    if(!res.ok) throw new Error(body.error || 'Could not approve.');
    await loadImports(); await openImport(reconcileState.current);
  }catch(e){ showToast(e.message, 'error'); }
}

function viewReconcile(){
  const { loading, imports, current, lines, suggestions, error, formError } = reconcileState;
  const currentImport = imports ? imports.find(i=>i.id===current) : null;

  if(current && lines){
    const unmatchedCount = lines.filter(l=>l.match_status==='unmatched').length;
    return `
      <div class="topbar"><div><h1>Reconciliation</h1><div class="sub">${currentImport ? currentImport.label : ''} — matches your statement against the ledger. Never edits the ledger, only marks lines matched or excluded.</div></div>
        <div class="topbar-actions"><button class="btn ghost sm" id="btn-back-to-imports">&larr; All imports</button></div>
      </div>
      <div class="grid kpi" style="margin-bottom:20px;">
        <div class="card kpi"><h3>Total Lines</h3><div class="big" style="font-size:22px;">${lines.length}</div></div>
        <div class="card kpi"><h3>Matched</h3><div class="big" style="font-size:22px; color:var(--good);">${lines.filter(l=>l.match_status==='matched').length}</div></div>
        <div class="card kpi"><h3>Unmatched</h3><div class="big" style="font-size:22px; color:${unmatchedCount>0?'var(--alert)':'inherit'};">${unmatchedCount}</div></div>
        <div class="card kpi"><h3>Excluded</h3><div class="big" style="font-size:22px;">${lines.filter(l=>l.match_status==='excluded').length}</div></div>
      </div>

      <div class="table-wrap"><table>
        <thead><tr><th>Date</th><th class="txt">Description</th><th>Amount</th><th class="txt">Direction</th><th class="txt">Status</th><th></th></tr></thead>
        <tbody>
          ${lines.map(l=>{
            const suggestion = (suggestions||[]).find(s=>s.statement_line_id===l.id);
            return `<tr>
              <td class="txt">${l.line_date}</td>
              <td class="txt">${l.description||''}</td>
              <td>${KES0(l.amount_kes)}</td>
              <td class="txt">${l.direction}</td>
              <td class="txt"><span class="tag ${l.match_status==='matched'?'good':l.match_status==='excluded'?'neutral':'alert'}">${l.match_status}${l.match_confidence?' ('+l.match_confidence+')':''}</span></td>
              <td>${l.match_status==='unmatched' && canWrite() ? `
                ${suggestion ? `<button class="btn ghost sm" data-match-line="${l.id}" data-match-txn="${suggestion.suggested_transaction_id}">Match to ${suggestion.transaction_date} (${suggestion.days_apart}d apart)</button>` : ''}
                <button class="btn ghost sm" data-exclude-line="${l.id}">Exclude</button>
              ` : ''}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table></div>

      ${canWrite() ? `
      <div class="card" style="margin-top:20px; display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px;">
        <div class="hint">${unmatchedCount>0 ? `${unmatchedCount} line(s) still need resolving before this can be submitted.` : 'Every line resolved — ready to submit.'}</div>
        <div style="display:flex; gap:10px;">
          ${currentImport && currentImport.status==='in_progress' ? `<button class="btn ghost" id="btn-submit-import" ${unmatchedCount>0?'disabled':''}>Submit for Approval</button>` : ''}
          ${currentImport && currentImport.status==='submitted' && canManageSettings() ? `<button class="btn gold" id="btn-approve-import">Approve</button>` : ''}
          ${currentImport && currentImport.status==='approved' ? `<span class="tag good">${ic('trendUp',12)} Approved</span>` : ''}
        </div>
      </div>` : ''}
    `;
  }

  return `
    <div class="topbar"><div><h1>Reconciliation</h1><div class="sub">Match a bank or mobile-money statement against your ledger.</div></div></div>
    ${loading ? `<div class="card"><span class="hint">Loading…</span></div>` : ''}
    ${error ? `<div class="card"><div class="hint" style="color:#c0392b;">${error}</div>${/bank_statement_imports|bank_statement_lines|reconciliation/i.test(error) ? `<div class="hint">This needs <code>hfms_foundation_fix_05_reconciliation.sql</code> run against Supabase first.</div>` : ''}</div>` : ''}
    ${formError ? `<div class="hint" style="color:#c0392b; margin-bottom:10px;">${formError}</div>` : ''}

    ${canWrite() ? `
    <div class="form-card">
      <h3>Import a statement</h3>
      <div style="margin-bottom:14px; padding-bottom:14px; border-top:0; border-bottom:1px solid var(--hair);">
        <label style="display:block; margin-bottom:6px;">Have a photo or PDF of the statement? Extract the lines automatically</label>
        <input type="file" id="statement-doc-upload" accept="image/*,.pdf">
        <div class="hint" style="margin-top:6px;">${ic('lock',12)} Unlike the Tende/Organization Utility CSV imports, this hasn't been proven against a real statement yet — always check the extracted lines below against the statement before importing.</div>
        ${statementExtractState.loading ? `<div class="hint" style="margin-top:8px;">Reading the statement…</div>` : ''}
        ${statementExtractState.error ? `<div class="hint" style="color:#c0392b; margin-top:8px;">${statementExtractState.error}</div>` : ''}
        ${statementExtractState.result ? `
          <div class="hint" style="margin-top:8px;">Extracted ${statementExtractState.result.rows.length} line(s) (confidence: ${statementExtractState.result.confidence})${statementExtractState.result.dropped_count>0?`, ${statementExtractState.result.dropped_count} row(s) skipped as unreadable — add those manually if needed`:''}.
          ${statementExtractState.result.statement_total_withdrawn!==null || statementExtractState.result.statement_total_paid_in!==null ? `The statement's own printed totals (Paid In: ${statementExtractState.result.statement_total_paid_in ?? 'not shown'}, Withdrawn: ${statementExtractState.result.statement_total_withdrawn ?? 'not shown'}) are shown so you can check the extracted lines sum to the same figures before importing.` : ''}
          </div>` : ''}
      </div>
      <div class="form-row">
        <div><label>Label</label><input type="text" id="recon-label" placeholder="e.g. M-Pesa statement, August 2026"></div>
        <div><label>Account</label><select id="recon-account">${ACCOUNTS.map(a=>`<option>${a}</option>`).join('')}</select></div>
        <div><label>Period Start</label><input type="date" id="recon-start"></div>
        <div><label>Period End</label><input type="date" id="recon-end"></div>
      </div>
      <label>Statement lines — one per line: <code>date,amount,description</code> (negative amount = money out)</label>
      <textarea id="recon-lines" rows="6" style="width:100%; font-family:'IBM Plex Mono',monospace; font-size:12.5px; padding:10px; border-radius:8px; border:1px solid var(--hair);" placeholder="2026-08-01,42000,Daily till deposit&#10;2026-08-01,-65120,Liquid Telecom payment">${statementExtractState.result ? statementExtractState.result.rows.map(r=>`${r.date},${r.direction==='outflow'?'-':''}${r.amount_kes},${r.description}`).join('\n') : ''}</textarea>
      <button class="btn gold" id="btn-create-import" style="margin-top:10px;">Import &amp; Auto-Match</button>
    </div>` : ''}

    <div class="section-head"><h2>Past imports</h2></div>
    <div class="table-wrap"><table>
      <thead><tr><th class="txt">Label</th><th class="txt">Account</th><th>Period</th><th class="txt">Status</th><th></th></tr></thead>
      <tbody>
        ${(imports||[]).length===0 ? `<tr class="empty-row"><td colspan="5">No statements imported yet.</td></tr>` : (imports||[]).map(i=>`
          <tr>
            <td class="txt">${i.label}</td>
            <td class="txt">${i.financial_accounts ? i.financial_accounts.name : '—'}</td>
            <td class="txt">${i.period_start} – ${i.period_end}</td>
            <td class="txt"><span class="tag ${i.status==='approved'?'good':i.status==='submitted'?'neutral':'alert'}">${i.status}</span></td>
            <td><button class="btn ghost sm" data-open-import="${i.id}">Open</button></td>
          </tr>`).join('')}
      </tbody>
    </table></div>
  `;
}

async function loadBranchCompare(){
  branchCompareState = { loading:true, rows:null, error:null };
  render();
  try{
    const ym = currentOpenMonth();
    const rows = await Promise.all(state.allBranches.map(async b => {
      const [revRes, expRes] = await Promise.all([
        apiList('/api/revenue', b.branch_id),
        apiList('/api/expenses', b.branch_id)
      ]);
      const revenue = (revRes.revenue||[]).filter(r=>monthKey(r.entry_date)===ym).reduce((s,r)=>s+Number(r.amount_kes),0);
      const expenses = (expRes.expenses||[])
        .filter(e=>monthKey(e.expense_date)===ym && e.status!=='pending_approval' && e.status!=='rejected')
        .reduce((s,e)=>s+Number(e.amount_kes)+Number(e.charges_kes||0),0);
      return { branch_id: b.branch_id, name: b.name, revenue, expenses };
    }));
    branchCompareState = { loading:false, rows, error:null };
  }catch(e){
    branchCompareState = { loading:false, rows:null, error:e.message };
  }
  render();
}

let chartRefs = {};
function drawArchiveCharts(){
  const rows = state.monthlyArchive.slice().sort((a,b)=>a.month<b.month?-1:1);
  const labels = rows.map(r=>r.month_label);
  Object.values(chartRefs).forEach(c=>c && c.destroy());
  if(!window.Chart || rows.length===0){ chartRefs={}; return; }
  const inkSoft = '#3B4B63', gold='#D9A441', good='#2F7A5C';
  chartRefs.revOpex = new Chart(document.getElementById('chart-rev-opex'), {
    type:'bar',
    data:{labels, datasets:[
      {label:'Revenue', data:rows.map(r=>r.total_revenue_kes), backgroundColor:gold},
      {label:'Net OpEx', data:rows.map(r=>r.actual_opex_kes), backgroundColor:inkSoft}
    ]},
    options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{position:'bottom'}}}
  });
  chartRefs.ratio = new Chart(document.getElementById('chart-opex-ratio'), {
    type:'line', data:{labels, datasets:[{label:'OpEx Ratio %', data:rows.map(r=>r.opex_ratio_pct), borderColor:inkSoft, tension:.3}]},
    options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}}
  });
  chartRefs.achv = new Chart(document.getElementById('chart-rev-achieve'), {
    type:'line', data:{labels, datasets:[{label:'Revenue Achievement %', data:rows.map(r=>r.revenue_achievement_pct), borderColor:good, tension:.3}]},
    options:{responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}}
  });
}

/* ---------------- SETTINGS ---------------- */

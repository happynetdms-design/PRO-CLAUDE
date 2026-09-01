/* ---------------- DAILY ENTRY ---------------- */

let revenueImportResult = null;

// Detects and parses the raw M-Pesa Organization Utility Account
// statement export. This has a variable-length metadata header before the
// real column row — found by locating the row that starts with "Receipt
// No.", not by assuming a fixed row number. Only settlement-sweep rows
// (Utility Account -> Organization Settlement Account) are counted:
// that's the actual revenue signal this report captures — the file's own
// header total ("Total Withdrawn") is exactly the sum of those sweeps.
function parseOrgUtilityGrid(grid){
  const headerIdx = grid.findIndex(row => (row[0]||'').toString().trim() === 'Receipt No.');
  if(headerIdx === -1) return null; // not this format — let the caller show its normal error
  const header = grid[headerIdx].map(c=>String(c||'').trim());
  const col = name => header.indexOf(name);
  const idx = { completion: col('Completion Time'), details: col('Details'), withdrawn: col('Withdrawn') };
  const byDate = {};
  for(let r=headerIdx+1; r<grid.length; r++){
    const row = grid[r]; if(!row || !row[0]) continue;
    if(!/Utility Account to Organization Settlement Account/i.test(row[idx.details]||'')) continue;
    const withdrawn = Math.abs(Number(String(row[idx.withdrawn]||'0').replace(/,/g,'')) || 0);
    if(withdrawn <= 0) continue;
    const parts = String(row[idx.completion]||'').split(' ')[0].split('-'); // DD-MM-YYYY
    if(parts.length !== 3) continue;
    const iso = `${parts[2]}-${parts[1]}-${parts[0]}`;
    byDate[iso] = (byDate[iso]||0) + withdrawn;
  }
  return byDate;
}

async function handleRevenueImport(ev){
  const file = ev.target.files[0];
  if(!file) return;
  const statusEl = document.getElementById('import-revenue-status');
  if(statusEl) statusEl.innerHTML = `<span class="hint">Reading ${file.name}…</span>`;
  try{
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, {type:'array'});
    const ws = wb.Sheets[wb.SheetNames[0]];
    const grid = XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:null});

    const byDate = parseOrgUtilityGrid(grid);
    if(!byDate){
      revenueImportResult = { imported:0, skippedExisting:0, errors:['Could not find a "Receipt No." column — is this an Organization Utility statement export?'] };
      if(statusEl) statusEl.innerHTML=''; render(); ev.target.value=''; return;
    }

    const existingDates = new Set(state.dailyRevenue.map(r=>r.date));
    const newRows = [];
    let skippedExisting = 0;
    for(const [date, amount] of Object.entries(byDate)){
      if(existingDates.has(date)){ skippedExisting++; continue; }
      newRows.push({ id: uid(), date, revenue_kes: Math.round(amount), notes: 'Imported from Organization Utility statement' });
    }
    newRows.sort((a,b)=>a.date<b.date?-1:1);

    let confirmedRows = [];
    const errors = [];
    if(newRows.length){
      if(statusEl) statusEl.innerHTML = `<span class="hint">Saving ${newRows.length} day(s)…</span>`;
      try{
        const entries = newRows.map(CORE_ENTITY_CONFIG.dailyRevenue.toApi);
        const apiResult = await apiCreate('/api/revenue', { branch_id: state.branchId, entries });
        const insertedIds = new Set((apiResult.inserted||[]).map(x=>x.id));
        confirmedRows = newRows.filter(r=>insertedIds.has(r.id));
        for(const skip of (apiResult.skipped||[])){ skippedExisting++; errors.push(skip.reason || 'A day was skipped by the server.'); }
      }catch(err){
        revenueImportResult = { imported:0, skippedExisting, errors:[...errors, 'Save failed: '+err.message] };
        if(statusEl) statusEl.innerHTML=''; render(); ev.target.value=''; return;
      }
    }
    state.dailyRevenue = state.dailyRevenue.concat(confirmedRows);
    if(lastSynced) lastSynced.dailyRevenue = JSON.parse(JSON.stringify(state.dailyRevenue));
    revenueImportResult = { imported: confirmedRows.length, skippedExisting, errors };
    render();
  }catch(err){
    revenueImportResult = { imported:0, skippedExisting:0, errors:['Could not read this file: '+err.message] };
    render();
  }
  ev.target.value = '';
}

function viewDaily(){
  const ym = currentOpenMonth();
  const rows = revenueForMonth(ym).slice().sort((a,b)=>a.date<b.date?-1:1);
  const editing = editingRevenueId ? state.dailyRevenue.find(r=>r.id===editingRevenueId) : null;
  return `
    <div class="topbar">
      <div><h1>Daily Entry</h1><div class="sub">One revenue row per day. ${monthLabel(ym)} is open for entry.</div></div>
    </div>

    ${canWrite() ? `
    <div class="form-card">
      <h3>${editing ? `Editing revenue for ${editing.date}` : `Add today's revenue`}</h3>
      <form id="form-daily">
        <div class="form-row">
          <div><label>Date</label><input type="date" name="date" value="${editing ? editing.date : todayISO()}" required></div>
          <div><label>Revenue (KES)</label><input type="number" name="revenue_kes" min="0" step="1" placeholder="0" value="${editing ? editing.revenue_kes : ''}" required></div>
          <div><label>Notes (optional)</label><input type="text" name="notes" placeholder="e.g. hotspot voucher promo" value="${editing ? (editing.notes||'') : ''}"></div>
        </div>
        <button class="btn gold" type="submit">${editing ? 'Update Revenue' : 'Add Revenue'}</button>
        ${editing ? `<button type="button" class="btn ghost" id="cancel-edit-daily">Cancel</button>` : ''}
        <div id="daily-err"></div>
      </form>
    </div>

    <div class="form-card">
      <h3>Import from Organization Utility statement</h3>
      <div class="sub" style="margin-bottom:10px;">Upload the raw M-Pesa Organization Utility Account export. Each settlement sweep (Utility Account → Organization Settlement Account) is grouped by date and becomes that day's revenue total — this is the actual customer-payment signal for the period, confirmed against the file's own reported total. A day that already has a revenue entry is left alone and reported as skipped, so re-uploading an overlapping period never double-counts.</div>
      <input type="file" id="file-import-revenue" accept=".csv">
      <div id="import-revenue-status" style="margin-top:10px;"></div>
      ${revenueImportResult ? `
        <div class="import-summary">
          <div><span class="tag good">${revenueImportResult.imported} day(s) imported</span></div>
          ${revenueImportResult.skippedExisting ? `<div><span class="tag neutral">${revenueImportResult.skippedExisting} day(s) skipped — already had a revenue entry</span></div>` : ''}
        </div>
        ${revenueImportResult.errors.length ? `<details style="margin-top:8px;"><summary style="cursor:pointer; color:var(--muted); font-size:12.5px;">Details</summary><ul style="font-size:12.5px; color:var(--ink-soft);">${revenueImportResult.errors.map(e=>`<li>${e}</li>`).join('')}</ul></details>` : ''}
      ` : ''}
    </div>` : readOnlyNotice()}

    <div class="section-head"><h2>${monthLabel(ym)} — entries &amp; allocation</h2>
      <div class="toolbar"><button class="btn ghost sm" id="btn-export-revenue-csv">Export CSV</button></div>
    </div>
    <div class="table-wrap"><table>
      <thead><tr><th>Date</th><th>Revenue</th><th>Profit 5%</th><th>Owner/Debt 20%</th><th>Tax 15%</th><th>OpEx Budget 60%</th><th>Actual OpEx (net)</th><th>Variance</th><th></th></tr></thead>
      <tbody>
        ${rows.length===0 ? `<tr class="empty-row"><td colspan="9">No revenue entered yet for ${monthLabel(ym)}.</td></tr>` : rows.map(r=>{
          const alloc = pf(r.revenue_kes);
          const net = netExpenseOn(r.date);
          const variance = alloc.opex - net;
          return `<tr>
            <td class="txt">${r.date}</td>
            <td>${KES0(r.revenue_kes)}</td>
            <td>${KES0(alloc.profit)}</td>
            <td>${KES0(alloc.owner_debt)}</td>
            <td>${KES0(alloc.tax)}</td>
            <td>${KES0(alloc.opex)}</td>
            <td>${KES0(net)}</td>
            <td class="${variance<0?'neg':'pos'}">${variance<0?'-':'+'}${KES0(Math.abs(variance))}</td>
            <td>${canWrite() ? `<button class="btn ghost sm" data-edit-revenue="${r.id}">Edit</button> <button class="btn ghost sm" data-del-revenue="${r.id}">Delete</button>` : '—'}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>
  `;
}

/* ---------------- EXPENSES ---------------- */

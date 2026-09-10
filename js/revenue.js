/* ---------------- DAILY ENTRY ---------------- */

let revenueImportResult = null;
let selectedRevenueIds = new Set();
window.dailyEntryDateFilter = window.dailyEntryDateFilter || '';
window.revenueGroupFilter = window.revenueGroupFilter || 'all';
window.revenueSearchTerm = window.revenueSearchTerm || '';

function formatAuditTimestamp(value){
  if(!value) return '—';
  const d = new Date(value);
  if(Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'medium' });
}

function formatAuditUser(value){
  if(!value) return '—';
  return String(value).length > 18 ? `${String(value).slice(0,16)}…` : String(value);
}

function revenueSourceLabel(value){
  const source = String(value || 'hotspot').toLowerCase();
  if(source.includes('fibre') || source.includes('fiber')) return 'Fibre';
  if(source.includes('hotspot')) return 'Hotspot';
  return 'Hotspot';
}

function revenueSourceTotals(rows){
  return rows.reduce((acc, row) => {
    const key = revenueSourceLabel(row.source);
    acc[key] = (acc[key] || 0) + Number(row.revenue_kes || 0);
    acc.total += Number(row.revenue_kes || 0);
    return acc;
  }, { Hotspot: 0, Fibre: 0, total: 0 });
}

function filteredRevenueRows(rows){
  const group = window.revenueGroupFilter || 'all';
  const term = (window.revenueSearchTerm || '').trim().toLowerCase();
  return rows.filter(row => {
    const groupPass = group === 'all' || revenueSourceLabel(row.source) === group;
    if(!groupPass) return false;
    if(!term) return true;
    const haystack = [
      row.date, row.notes, row.source, row.created_by_name, row.updated_by_name,
      String(row.revenue_kes), String(row.created_by), String(row.updated_by)
    ].join(' ').toLowerCase();
    return haystack.includes(term);
  });
}

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

    const newRows = [];
    for(const [date, amount] of Object.entries(byDate)){
      newRows.push({ id: uid(), date, revenue_kes: Math.round(amount), notes: 'Imported from Organization Utility statement' });
    }
    newRows.sort((a,b)=>a.date<b.date?-1:1);

    let confirmedRows = [];
    const errors = [];
    if(newRows.length){
      if(statusEl) statusEl.innerHTML = `<span class="hint">Saving ${newRows.length} daily total(s)…</span>`;
      try{
        const entries = newRows.map(CORE_ENTITY_CONFIG.dailyRevenue.toApi);
        const apiResult = await apiCreate('/api/revenue', { branch_id: state.branchId, entries });
        const insertedIds = new Set((apiResult.inserted||[]).map(x=>x.id));
        confirmedRows = newRows.filter(r=>insertedIds.has(r.id));
        for(const skip of (apiResult.skipped||[])){ errors.push(skip.reason || 'A revenue entry was skipped by the server.'); }
      }catch(err){
        revenueImportResult = { imported:0, skippedExisting:0, errors:[...errors, 'Save failed: '+err.message] };
        if(statusEl) statusEl.innerHTML=''; render(); ev.target.value=''; return;
      }
    }
    state.dailyRevenue = state.dailyRevenue.concat(confirmedRows);
    if(lastSynced) lastSynced.dailyRevenue = JSON.parse(JSON.stringify(state.dailyRevenue));
    revenueImportResult = { imported: confirmedRows.length, skippedExisting:0, errors };
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
  const filteredRows = filteredRevenueRows(window.dailyEntryDateFilter ? rows.filter(r => r.date === window.dailyEntryDateFilter) : rows);
  const sourceTotals = revenueSourceTotals(filteredRows);
  const editing = editingRevenueId ? state.dailyRevenue.find(r=>r.id===editingRevenueId) : null;
  const selectedVisibleCount = filteredRows.filter(r => selectedRevenueIds.has(r.id)).length;
  const allVisibleSelected = filteredRows.length > 0 && selectedVisibleCount === filteredRows.length;
  return `
    <div class="topbar">
      <div><h1>Daily Entry</h1><div class="sub">Add as many revenue transactions as needed. Daily totals are computed from all entries for the date. ${monthLabel(ym)} is open for entry.</div></div>
    </div>

    ${canWrite() ? `
    <div class="form-card">
      <h3>${editing ? `Editing revenue for ${editing.date}` : `Add today's revenue`}</h3>
      <form id="form-daily">
        <div class="form-row">
          <div><label>Date</label><input type="date" name="date" value="${editing ? editing.date : todayISO()}" required></div>
          <div><label>Revenue (KES)</label><input type="number" name="revenue_kes" min="0" step="1" placeholder="0" value="${editing ? editing.revenue_kes : ''}" required></div>
          <div><label>Source</label>
            <select name="source">
              <option value="hotspot" ${(!editing || (editing.source || 'hotspot') === 'hotspot') ? 'selected' : ''}>Hotspot</option>
              <option value="fibre" ${(editing && (editing.source || 'hotspot') === 'fibre') ? 'selected' : ''}>Fibre</option>
            </select>
          </div>
          <div><label>Notes (optional)</label><input type="text" name="notes" placeholder="e.g. hotspot voucher promo" value="${editing ? (editing.notes||'') : ''}"></div>
        </div>
        <button class="btn gold" type="submit">${editing ? 'Update Revenue' : 'Add Revenue'}</button>
        ${editing ? `<button type="button" class="btn ghost" id="cancel-edit-daily">Cancel</button>` : ''}
        <div id="daily-err"></div>
      </form>
    </div>

    <div class="form-card">
      <h3>Import from Organization Utility statement</h3>
      <div class="sub" style="margin-bottom:10px;">Upload the raw M-Pesa Organization Utility Account export. Settlement sweeps are grouped into one imported daily total, while any existing entries for the same date remain separate. Re-upload only files that have not already been recorded.</div>
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

    <div class="section-head"><h2>${monthLabel(ym)} — entries &amp; allocation</h2></div>
    <div class="toolbar" style="margin-bottom:10px; align-items:center; gap:10px; flex-wrap:wrap;">
      <label style="display:flex; align-items:center; gap:8px; margin:0; font-size:12px; color:var(--muted);">
        <input type="checkbox" id="select-all-revenue-visible" ${allVisibleSelected && filteredRows.length ? 'checked' : ''} />
        <span>Select visible</span>
      </label>
      <button class="btn ghost sm" id="btn-edit-selected-revenue" ${selectedRevenueIds.size ? '' : 'disabled'}>Adjust selected</button>
      <button class="btn ghost sm" id="btn-export-selected-revenue">Export selected</button>
      <button class="btn ghost sm" id="btn-delete-selected-revenue" ${selectedRevenueIds.size ? '' : 'disabled'}>Delete selected</button>
      <select id="revenue-group-filter" style="min-width:140px;">
        <option value="all" ${window.revenueGroupFilter === 'all' ? 'selected' : ''}>All revenue</option>
        <option value="Hotspot" ${window.revenueGroupFilter === 'Hotspot' ? 'selected' : ''}>Hotspot</option>
        <option value="Fibre" ${window.revenueGroupFilter === 'Fibre' ? 'selected' : ''}>Fibre</option>
      </select>
      <input type="search" id="revenue-search" value="${window.revenueSearchTerm}" placeholder="Search entry, name, value" style="min-width:220px;" />
      <label style="display:flex; align-items:center; gap:8px; margin:0; font-size:12px; color:var(--muted);">
        <span>Filter</span>
        <input type="date" id="daily-entry-date-filter" value="${window.dailyEntryDateFilter}" style="width:150px;" />
      </label>
      ${window.dailyEntryDateFilter ? `<button class="btn ghost sm" id="btn-clear-daily-date-filter" type="button">Clear</button>` : ''}
      <button class="btn ghost sm" id="btn-export-revenue-csv">Export all</button>
    </div>

    <div class="table-wrap" style="max-height:540px; overflow:auto;">
      <table>
        <thead style="position:sticky; top:0; z-index:1; background:var(--card);">
          <tr>
            <th style="width:26px;"><input type="checkbox" id="select-all-revenue-hidden" title="Select all visible revenue rows" ${allVisibleSelected && filteredRows.length ? 'checked' : ''}></th>
            <th>Date</th><th>Revenue</th><th>Profit 5%</th><th>Owner/Debt 20%</th><th>Tax 15%</th><th>OpEx Budget 60%</th><th>Actual OpEx (net)</th><th>Variance</th><th>Source</th><th>Created by</th><th>Created at</th><th>Updated by</th><th>Updated at</th><th></th>
          </tr>
        </thead>
        <tbody>
          ${filteredRows.length===0 ? `<tr class="empty-row"><td colspan="15">${window.dailyEntryDateFilter ? `No revenue found for ${window.dailyEntryDateFilter}.` : `No revenue entered yet for ${monthLabel(ym)}.`}</td></tr>` : filteredRows.map(r=>{
            const alloc = pf(r.revenue_kes);
            const net = netExpenseOn(r.date);
            const variance = alloc.opex - net;
            const rowSelected = selectedRevenueIds.has(r.id);
            return `<tr>
              <td><input type="checkbox" class="revenue-row-select" data-revenue-select="${r.id}" ${rowSelected ? 'checked' : ''}></td>
              <td class="txt">${r.date}</td>
              <td>${KES0(r.revenue_kes)}</td>
              <td>${KES0(alloc.profit)}</td>
              <td>${KES0(alloc.owner_debt)}</td>
              <td>${KES0(alloc.tax)}</td>
              <td>${KES0(alloc.opex)}</td>
              <td>${KES0(net)}</td>
              <td class="${variance<0?'neg':'pos'}">${variance<0?'-':''}${KES0(Math.abs(variance))}</td>
              <td class="txt">${revenueSourceLabel(r.source)}</td>
              <td class="txt">${formatAuditUser(r.created_by_name || r.created_by)}</td>
              <td class="txt">${formatAuditTimestamp(r.created_at)}</td>
              <td class="txt">${formatAuditUser(r.updated_by_name || r.updated_by)}</td>
              <td class="txt">${formatAuditTimestamp(r.updated_at)}</td>
              <td>${canWrite() ? `<button class="btn ghost sm" data-edit-revenue="${r.id}">Edit</button> <button class="btn ghost sm" data-del-revenue="${r.id}">Delete</button>` : '—'}</td>
            </tr>`;
          }).join('')}
        </tbody>
        <tfoot>
          <tr style="background:var(--neutral-soft); font-weight:700;">
            <td colspan="2">Totals</td>
            <td>${KES0(sourceTotals.total || 0)}</td>
            <td colspan="5"></td>
            <td>${KES0(sourceTotals.Hotspot || 0)}</td>
            <td colspan="1">Hotspot</td>
            <td>${KES0(sourceTotals.Fibre || 0)}</td>
            <td colspan="3">Fibre</td>
          </tr>
        </tfoot>
      </table>
    </div>
  `;
}

/* ---------------- EXPENSES ---------------- */

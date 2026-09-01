/* ---------------- EXPENSES ---------------- */

let expenseFilters = {category:'', account:'', ownerFundedOnly:false, pendingOnly:false};
let editingRevenueId = null;
let editingExpenseId = null;
let selectedExpenseIds = new Set(); // bulk-approve/reject — only ever holds ids of pending_approval rows

async function bulkApproveExpenses(ids){
  if(ids.length === 0) return;
  if(!(await confirmDialog(`Approve ${ids.length} expense(s)? This posts them all to the ledger and they'll count toward this month's totals.`))) return;
  let succeeded = 0, failed = 0;
  for(const id of ids){
    try{
      await apiUpdate('/api/expenses', { branch_id: state.branchId, id, status:'posted', approve:true });
      const rec = state.expenses.find(e=>e.id===id);
      if(rec) rec.status = 'posted';
      succeeded++;
    }catch(e){ failed++; }
  }
  lastSynced.expenses = JSON.parse(JSON.stringify(state.expenses));
  selectedExpenseIds.clear();
  showToast(failed === 0 ? `${succeeded} expense(s) approved.` : `${succeeded} approved, ${failed} failed — check them individually.`, failed === 0 ? 'success' : 'error');
  render();
}
async function bulkRejectExpenses(ids){
  if(ids.length === 0) return;
  if(!(await confirmDialog(`Reject ${ids.length} expense(s)? They won't count toward this month's totals.`))) return;
  let succeeded = 0, failed = 0;
  for(const id of ids){
    try{
      await apiUpdate('/api/expenses', { branch_id: state.branchId, id, status:'rejected' });
      const rec = state.expenses.find(e=>e.id===id);
      if(rec) rec.status = 'rejected';
      succeeded++;
    }catch(e){ failed++; }
  }
  lastSynced.expenses = JSON.parse(JSON.stringify(state.expenses));
  selectedExpenseIds.clear();
  showToast(failed === 0 ? `${succeeded} expense(s) rejected.` : `${succeeded} rejected, ${failed} failed — check them individually.`, failed === 0 ? 'success' : 'error');
  render();
}
let editingLoanId = null;
let editingPaymentId = null;
let importResult = null; // {imported, skippedDupe, skippedInvalid, errors:[]}
let importing = false;

function filteredExpenseRows(){
  let rows = state.expenses.slice();
  if(expenseFilters.category) rows = rows.filter(e=>e.category===expenseFilters.category);
  if(expenseFilters.account) rows = rows.filter(e=>e.account_used===expenseFilters.account);
  if(expenseFilters.ownerFundedOnly) rows = rows.filter(e=>e.owner_funded);
  if(expenseFilters.pendingOnly) rows = rows.filter(e=>e.status==='pending_approval');
  rows = sortRows('expenses', rows, (row, key) => {
    if(key==='amount') return row.amount_kes + row.charges_kes;
    if(key==='account') return row.account_used;
    if(key==='category') return row.category;
    if(key==='status') return row.status;
    return row.date; // default and 'date'
  }, 'date', 'asc');
  return rows;
}

function viewExpenses(){
  const ym = currentOpenMonth();
  let rows = filteredExpenseRows();
  const runningTotal = rows.reduce((s,e)=>s+e.amount_kes+e.charges_kes,0);
  const grossThisMonth = expensesForMonth(ym).reduce((s,e)=>s+e.amount_kes+e.charges_kes,0);
  const netThisMonth = monthTotals(ym).netOpex;
  const pendingCount = state.expenses.filter(e=>e.status==='pending_approval').length;
  const editing = editingExpenseId ? state.expenses.find(e=>e.id===editingExpenseId) : null;

  return `
    <div class="topbar">
      <div><h1>Expenses</h1><div class="sub">Every real money-out transaction. Duplicate transaction references are rejected outright.</div></div>
    </div>

    ${canWrite() ? `
    <div class="form-card">
      <h3>${editing ? `Editing expense "${editing.txn_ref}"` : `Log an expense`}</h3>
      ${!editing ? `
      <div style="margin-bottom:16px; padding-bottom:16px; border-bottom:1px solid var(--hair);">
        <label style="display:block; margin-bottom:6px;">Have a photo of the receipt? Extract the details automatically</label>
        <input type="file" id="doc-intel-upload" accept="image/*">
        ${docIntelState.loading && docIntelState.context==='expense' ? `<div class="hint" style="margin-top:8px;">Reading the receipt…</div>` : ''}
        ${docIntelState.error && docIntelState.context==='expense' ? `<div class="hint" style="color:#c0392b; margin-top:8px;">${docIntelState.error}</div>` : ''}
        ${docIntelState.context==='expense' && docIntelState.result ? `<div class="hint" style="margin-top:8px;">${docIntelState.result.extracted ? `Extracted (confidence: ${docIntelState.result.confidence}) — fields below have been pre-filled. Check them before saving.` : docIntelState.result.note}</div>` : ''}
      </div>` : ''}
      <form id="form-expense">
        <div class="form-row">
          <div><label>Date</label><input type="date" name="date" value="${editing ? editing.date : (docIntelExtractedFor('expense')?.date || todayISO())}" required></div>
          <div><label>Txn Ref</label><input type="text" name="txn_ref" placeholder="e.g. QK7X2ABC" value="${editing ? editing.txn_ref : ''}" required></div>
          <div><label>Account Used</label><select name="account_used">${ACCOUNTS.map(a=>`<option ${editing&&editing.account_used===a?'selected':''}>${a}</option>`).join('')}</select></div>
          <div><label>Category</label>
            <div style="display:flex; gap:6px;">
              <select name="category" style="flex:1;">${CATS().map(c=>`<option ${(editing ? editing.category===c : docIntelExtractedFor('expense')?.suggested_category===c)?'selected':''}>${c}</option>`).join('')}</select>
              <button type="button" class="btn ghost sm" id="btn-add-category" title="Add a new category">+ New</button>
            </div>
          </div>
        </div>
        <div class="form-row">
          <div><label>Description</label><input type="text" name="description" placeholder="What was this for?" value="${editing ? (editing.description||'') : (docIntelExtractedFor('expense')?.description || '')}"></div>
          <div><label>Paid To (optional)</label><input type="text" name="paid_to" value="${editing ? (editing.paid_to||'') : (docIntelExtractedFor('expense')?.vendor || '')}"></div>
          <div><label>Amount (KES)</label><input type="number" name="amount_kes" min="0" step="1" value="${editing ? editing.amount_kes : (docIntelExtractedFor('expense')?.amount_kes || '')}" required></div>
          <div><label>Charges (KES)</label><input type="number" name="charges_kes" min="0" step="1" value="${editing ? editing.charges_kes : 0}"></div>
        </div>
        <div class="check-row" style="margin-bottom:12px;">
          <input type="checkbox" name="owner_funded" id="owner_funded" ${editing&&editing.owner_funded?'checked':''}><label for="owner_funded" style="text-transform:none; font-weight:500; margin:0; color:var(--ink-soft);">Paid using owner/related-party personal funds (not the OpEx account)</label>
        </div>
        ${!canApprove() ? `
        <div class="check-row" style="margin-bottom:12px;">
          <input type="checkbox" name="needs_approval" id="needs_approval" ${editing&&editing.status==='pending_approval'?'checked':''}><label for="needs_approval" style="text-transform:none; font-weight:500; margin:0; color:var(--ink-soft);">Submit for approval (won't count toward totals until a Branch Manager or Head Office approves it)</label>
        </div>` : ''}
        <button class="btn gold" type="submit">${editing ? 'Update Expense' : 'Log Expense'}</button>
        ${editing ? `<button type="button" class="btn ghost" id="cancel-edit-expense">Cancel</button>` : ''}
        <div id="expense-err"></div>
      </form>
    </div>

    <div class="form-card">
      <h3>Import expenses from a spreadsheet</h3>
      <div class="sub" style="margin-bottom:10px;">Upload Happynet's raw Tende "payments report" export directly — no manual pre-processing needed. Internal transfers between Tende sub-wallets are excluded automatically (only real money paid out counts), category and vendor are best-effort filled in from each transaction's remark (review before trusting fully). A pre-processed sheet with Date/Txn Ref/Account Used/Category/etc. columns still works too. Rows whose Txn Ref already exists — in the app or elsewhere in the same file — are skipped automatically.</div>
      <input type="file" id="file-import" accept=".xlsx,.xls,.csv">
      <div id="import-status" style="margin-top:10px;"></div>
      ${importResult ? `
        <div class="import-summary">
          <div><span class="tag good">${importResult.imported} imported</span></div>
          ${importResult.skippedDupe ? `<div><span class="tag neutral">${importResult.skippedDupe} skipped — duplicate Txn Ref</span></div>` : ''}
          ${importResult.skippedInvalid ? `<div><span class="tag alert">${importResult.skippedInvalid} skipped — missing/invalid data</span></div>` : ''}
        </div>
        ${importResult.errors.length ? `<details style="margin-top:8px;"><summary style="cursor:pointer; color:var(--muted); font-size:12.5px;">Show skipped rows</summary><ul style="font-size:12.5px; color:var(--ink-soft);">${importResult.errors.map(e=>`<li>${e}</li>`).join('')}</ul></details>` : ''}
      ` : ''}
    </div>` : readOnlyNotice()}

    <div class="summary-strip">
      <div class="item"><span>Gross OpEx (this month)</span><b>${KES(grossThisMonth)}</b></div>
      <div class="item"><span>Net OpEx (this month, feeds dashboard)</span><b>${KES(netThisMonth)}</b></div>
      <div class="item"><span>Owner-funded (this month)</span><b>${KES(grossThisMonth-netThisMonth)}</b></div>
    </div>

    <div class="section-head"><h2>All expenses</h2>
      <div class="toolbar">
        <select id="filter-category"><option value="">All categories</option>${CATS().map(c=>`<option ${expenseFilters.category===c?'selected':''}>${c}</option>`).join('')}</select>
        <select id="filter-account"><option value="">All accounts</option>${ACCOUNTS.map(a=>`<option ${expenseFilters.account===a?'selected':''}>${a}</option>`).join('')}</select>
        <label class="check-row" style="margin:0;"><input type="checkbox" id="filter-owner" ${expenseFilters.ownerFundedOnly?'checked':''}> Owner-funded only</label>
        ${canApprove() ? `<label class="check-row" style="margin:0;"><input type="checkbox" id="filter-pending" ${expenseFilters.pendingOnly?'checked':''}> Pending approval only${pendingCount>0?` (${pendingCount})`:''}</label>` : ''}
        <button class="btn ghost sm" id="btn-export-expenses-csv">Export CSV</button>
        <button class="btn ghost sm" id="btn-export-expenses-xlsx">Export .xlsx</button>
      </div>
    </div>
    ${attachmentsState.targetType==='expense' ? attachmentsPanelHtml() : ''}
    ${canApprove() && selectedExpenseIds.size > 0 ? `
    <div class="card" style="margin-bottom:14px; padding:12px 16px; display:flex; align-items:center; justify-content:space-between; border-left:4px solid var(--gold);">
      <span>${selectedExpenseIds.size} selected</span>
      <div style="display:flex; gap:8px;">
        <button class="btn gold sm" id="btn-bulk-approve">Approve Selected</button>
        <button class="btn ghost sm" id="btn-bulk-reject">Reject Selected</button>
        <button class="btn ghost sm" id="btn-bulk-clear">Clear</button>
      </div>
    </div>` : ''}
    <div class="table-wrap"><table>
      <thead><tr>${canApprove() ? `<th style="width:24px;"><input type="checkbox" id="select-all-pending" title="Select all pending-approval rows on this page"></th>` : ''}${sortableHeaderHtml('Date','date','expenses')}<th>Txn Ref</th>${sortableHeaderHtml('Account','account','expenses')}${sortableHeaderHtml('Category','category','expenses')}<th class="txt">Description</th>${sortableHeaderHtml('Amount','amount','expenses')}<th>Charges</th><th>Total</th><th>Owner-funded</th>${sortableHeaderHtml('Status','status','expenses')}<th></th></tr></thead>
      <tbody>
        ${(()=>{ const { pageRows } = paginateRows('expenses', rows); return pageRows.length===0 ? `<tr class="empty-row"><td colspan="${canApprove()?12:11}">No expenses match these filters.</td></tr>` : pageRows.map(e=>`
          <tr>
            ${canApprove() ? `<td>${e.status==='pending_approval' ? `<input type="checkbox" class="expense-row-checkbox" data-expense-checkbox="${e.id}" ${selectedExpenseIds.has(e.id)?'checked':''}>` : ''}</td>` : ''}
            <td class="txt">${e.date}</td>
            <td class="txt">${e.txn_ref}</td>
            <td class="txt">${e.account_used}</td>
            <td class="txt">${e.category}</td>
            <td class="txt">${e.description||''}</td>
            <td>${KES0(e.amount_kes)}</td>
            <td>${KES0(e.charges_kes)}</td>
            <td>${KES0(e.amount_kes+e.charges_kes)}</td>
            <td>${e.owner_funded? '<span class="tag neutral">Yes</span>':'—'}</td>
            <td class="txt">${statusTag(e.status)}</td>
            <td style="white-space:nowrap;">
              ${e.status==='pending_approval' && canApprove() ? `<button class="btn ghost sm" data-approve-expense="${e.id}">Approve</button> <button class="btn ghost sm" data-reject-expense="${e.id}">Reject</button> ` : ''}
              ${canWrite() ? `<button class="btn ghost sm" data-edit-expense="${e.id}">Edit</button> <button class="btn ghost sm" data-del-expense="${e.id}">Delete</button> ` : ''}<button class="btn ghost sm" data-attach-expense="${e.id}" title="Receipts / attachments">📎</button>
            </td>
          </tr>`).join(''); })()}
      </tbody>
      ${rows.length>0?`<tfoot><tr><td colspan="7" class="txt" style="font-weight:600;">Running total (filtered view)</td><td colspan="3" style="font-weight:700;">${KES0(runningTotal)}</td></tr></tfoot>`:''}
    </table></div>
    ${paginationControlsHtml('expenses', paginateRows('expenses', rows))}
  `;
}

/* ---------------- EXPENSE IMPORT (spreadsheet upload) ---------------- */

// Best-effort category guess from a Tende transaction's remark text —
// informed directly by how Happynet has actually been categorizing these
// same transactions by hand for the last two months (cross-checked
// against their real TENDE EXPENSE LOG). Always overridable after import;
// this never silently commits to a wrong category, it just saves typing
// on the easy majority of rows.
const TENDE_CATEGORY_RULES = [
  [/fuel|petrol|diesel|rubis|shell|total /i, 'Fuel'],
  [/transport|matatu|boda|delivery/i, 'Transport'],
  [/token|electricity|kplc|hotspot token/i, 'Electricity'],
  [/internet|bandwidth|bypass|oneisp|data bundle|data buddle/i, 'Internet & Bandwidth'],
  [/\brent\b|realtors/i, 'Rent'],
  [/commission|caretaker/i, 'Commission'],
  [/repair|socket|patrix|car wash|maintenance/i, 'Repairs'],
  [/toilet paper|printing|stationery|office supplies/i, 'Office Supplies'],
  [/advert|marketing|promo/i, 'Marketing'],
  [/welfare|charity/i, 'Welfare'],
  [/reimburse/i, 'Reimbursement'],
  [/router|poe|cable|inventory|xpon/i, 'Inventory'],
  [/salary|wage|labour|advance|payroll/i, 'Payroll'],
];
function guessTendeCategory(remark, tendeWallet){
  const text = remark || '';
  for(const [re, cat] of TENDE_CATEGORY_RULES) if(re.test(text)) return cat;
  if(/INVENTORY/i.test(tendeWallet)) return 'Inventory';
  return 'Other';
}
// Tende's own STATUS MESSAGE spells out the real vendor name (e.g. "...to
// M-PESA Till 8697324 - NEW ZULUS 5 on 27th Aug...") — extract it instead
// of falling back to a bare till/phone number.
function extractTendeVendor(statusMessage, remark, receiver){
  if(statusMessage){
    const m = statusMessage.match(/(?:Till|to)\s+\d+\s*-\s*([A-Za-z0-9 .'&]+?)\s+on\s+\d/);
    if(m) return m[1].trim();
  }
  return receiver ? String(receiver).replace(/^="?|"?$/g, '') : (remark || '');
}
// Detects and parses Happynet's raw Tende "payments report" export
// directly — no manual pre-processing into the simplified layout needed.
// Two things it deliberately does that a naive import wouldn't:
//   1. Drops SND_TENDE rows — these are transfers between Happynet's own
//      Tende sub-wallets (Overall -> Payroll, -> Inventory, etc.), not
//      real money leaving the business. Importing them would double-count
//      every shilling: once as an internal transfer, again as the real
//      external payment it eventually funds.
//   2. Only imports STATUS = SUCCESS rows.
function parseRawTendeGrid(grid){
  const header = (grid[0]||[]).map(c=>String(c||'').trim().toUpperCase());
  const need = ['DATE INITIATED','SERVICE','STATUS','REF NO','AMOUNT'];
  if(!need.every(h=>header.includes(h))) return null; // not this format — let the caller fall through
  const col = name => header.indexOf(name);
  const idx = {
    dateInit: col('DATE INITIATED'), dateAppr: col('DATE APPROVED'), account: col('ACCOUNT'),
    service: col('SERVICE'), amount: col('AMOUNT'), charge: col('CHARGE'), receiver: col('RECEIVER'),
    remark: col('REMARK'), refNo: col('REF NO'), status: col('STATUS'), statusMsg: col('STATUS MESSAGE')
  };
  const rows = [];
  let skippedInternal = 0, skippedFailed = 0;
  for(let r=1; r<grid.length; r++){
    const row = grid[r]; if(!row || row.every(c=>c===null||c==='')) continue;
    const status = String(row[idx.status]||'').trim().toUpperCase();
    if(status !== 'SUCCESS'){ skippedFailed++; continue; }
    const service = String(row[idx.service]||'').trim().toUpperCase();
    if(service === 'SND_TENDE'){ skippedInternal++; continue; }
    const rawDate = row[idx.dateAppr] || row[idx.dateInit];
    const dateObj = rawDate instanceof Date ? rawDate : new Date(String(rawDate).split(' ')[0]);
    if(isNaN(dateObj)) { skippedFailed++; continue; }
    const tendeWallet = String(row[idx.account]||'').replace(/\s*\(KOC\d+\)/i,'').trim();
    const amount = Number(String(row[idx.amount]||'0').replace(/[^0-9.\-]/g,'')) || 0;
    const charges = Number(String(row[idx.charge]||'0').replace(/[^0-9.\-]/g,'')) || 0;
    rows.push({
      date: dateObj.toISOString().slice(0,10),
      txn_ref: String(row[idx.refNo]||'').trim(),
      account_used: service === 'SEND BANK' ? 'Bank Account' : 'M-Pesa Till',
      category: guessTendeCategory(row[idx.remark], tendeWallet),
      description: String(row[idx.remark]||''),
      paid_to: extractTendeVendor(row[idx.statusMsg], row[idx.remark], row[idx.receiver]),
      amount_kes: amount, charges_kes: charges, owner_funded: false
    });
  }
  return { rows, skippedInternal, skippedFailed };
}

async function handleExpenseImport(ev){
  const file = ev.target.files[0];
  if(!file) return;
  const statusEl = document.getElementById('import-status');
  if(statusEl) statusEl.innerHTML = `<span class="hint">Reading ${file.name}…</span>`;
  try{
    const data = await file.arrayBuffer();
    const wb = XLSX.read(data, {type:'array', cellDates:true});
    const wsName = wb.SheetNames.find(n=>/expense|tende/i.test(n)) || wb.SheetNames[0];
    const ws = wb.Sheets[wsName];
    const grid = XLSX.utils.sheet_to_json(ws, {header:1, raw:true, defval:null});

    // Raw Tende export — recognized by its exact column set, handled by a
    // dedicated parser above rather than the generic header-hunting logic
    // below (which is for the simplified, manually-prepared layout).
    const rawTende = parseRawTendeGrid(grid);
    if(rawTende){
      let imported=0, skippedDupe=0; const errors=[];
      if(rawTende.skippedInternal) errors.push(`${rawTende.skippedInternal} internal Tende wallet transfer(s) (SND_TENDE) correctly excluded — not real expenses.`);
      const seenRefs = new Set(state.expenses.map(e=>e.txn_ref.toLowerCase()));
      const newRows = [];
      for(const r of rawTende.rows){
        if(!r.txn_ref || seenRefs.has(r.txn_ref.toLowerCase())){
          skippedDupe++; continue;
        }
        newRows.push({ id:uid(), ...r });
        seenRefs.add(r.txn_ref.toLowerCase());
        imported++;
      }
      newRows.sort((a,b)=>a.date<b.date?-1:1);

      let confirmedRows = [];
      if(newRows.length){
        if(statusEl) statusEl.innerHTML = `<span class="hint">Saving ${newRows.length} rows…</span>`;
        try{
          const entries = newRows.map(CORE_ENTITY_CONFIG.expenses.toApi);
          const apiResult = await apiCreate('/api/expenses', { branch_id: state.branchId, entries });
          const insertedIds = new Set((apiResult.inserted||[]).map(x=>x.id));
          confirmedRows = newRows.filter(r=>insertedIds.has(r.id));
          for(const skip of (apiResult.skipped||[])){ skippedDupe++; errors.push(skip.reason || 'A row was skipped by the server.'); }
        }catch(err){
          importResult = {imported:0, skippedDupe, skippedInvalid:rawTende.skippedFailed, errors:[...errors, 'Save failed: '+err.message]};
          if(statusEl) statusEl.innerHTML=''; render(); ev.target.value=''; return;
        }
      }
      state.expenses = state.expenses.concat(confirmedRows);
      if(lastSynced) lastSynced.expenses = JSON.parse(JSON.stringify(state.expenses));
      importResult = { imported: confirmedRows.length, skippedDupe, skippedInvalid: rawTende.skippedFailed, errors };
      render();
      ev.target.value = '';
      return;
    }

    const wants = {
      date: /^date$/i,
      txn_ref: /txn.*ref|reference/i,
      account_used: /account/i,
      category: /categor/i,
      description: /descri/i,
      paid_to: /paid ?to/i,
      amount_kes: /^amount\b|amount.*kes/i,
      charges_kes: /charge/i,
      owner_funded: /owner.*funded|related.?party/i
    };

    let headerRowIdx = -1, headerMap = {};
    for(let r=0;r<Math.min(grid.length,25);r++){
      const row = grid[r]||[];
      const rowStr = row.map(c=>String(c||'').trim());
      const hasDate = rowStr.some(c=>/^date$/i.test(c));
      const hasAmount = rowStr.some(c=>/amount/i.test(c));
      if(hasDate && hasAmount){
        headerRowIdx = r;
        row.forEach((cell,ci)=>{
          const c = String(cell||'').trim();
          for(const [key,re] of Object.entries(wants)){
            if(re.test(c) && !(key in headerMap)) headerMap[key]=ci;
          }
        });
        break;
      }
    }
    if(headerRowIdx===-1){
      importResult = {imported:0, skippedDupe:0, skippedInvalid:0, errors:['Could not find a header row containing a "Date" column and an "Amount" column — check the file matches the expected layout.']};
      if(statusEl) statusEl.innerHTML='';
      render(); return;
    }

    let imported=0, skippedDupe=0, skippedInvalid=0; const errors=[];
    const seenRefs = new Set(state.expenses.map(e=>e.txn_ref.toLowerCase()));
    const newRows = [];
    for(let r=headerRowIdx+1;r<grid.length;r++){
      const row = grid[r]||[];
      if(row.every(c=>c===null||c==='')) continue;
      const rawDate = headerMap.date!=null ? row[headerMap.date] : null;
      const rawRef = headerMap.txn_ref!=null ? row[headerMap.txn_ref] : null;
      const rawAmount = headerMap.amount_kes!=null ? row[headerMap.amount_kes] : null;
      if(rawDate==null || rawAmount==null || rawRef==null || String(rawRef).trim()===''){
        skippedInvalid++; continue;
      }
      let dateObj = rawDate instanceof Date ? rawDate : new Date(rawDate);
      if(isNaN(dateObj)){ skippedInvalid++; continue; }
      const dateStr = dateObj.toISOString().slice(0,10);
      const txn_ref = String(rawRef).trim();
      if(seenRefs.has(txn_ref.toLowerCase())){
        skippedDupe++; errors.push(`Row ${r+1}: Txn Ref "${txn_ref}" already exists — skipped`); continue;
      }
      const amount = Number(String(rawAmount).replace(/[^0-9.\-]/g,'')) || 0;
      const charges = headerMap.charges_kes!=null ? (Number(String(row[headerMap.charges_kes]||'0').replace(/[^0-9.\-]/g,''))||0) : 0;
      const ownerRaw = headerMap.owner_funded!=null ? String(row[headerMap.owner_funded]||'').trim().toUpperCase() : '';
      newRows.push({
        id:uid(), date:dateStr, txn_ref,
        account_used: headerMap.account_used!=null && row[headerMap.account_used] ? row[headerMap.account_used] : 'Bank Account',
        category: headerMap.category!=null && row[headerMap.category] ? row[headerMap.category] : 'Other',
        description: headerMap.description!=null ? (row[headerMap.description]||'') : '',
        paid_to: headerMap.paid_to!=null ? (row[headerMap.paid_to]||'') : '',
        amount_kes: amount, charges_kes: charges,
        owner_funded: ownerRaw==='Y'||ownerRaw==='YES'||ownerRaw==='TRUE'
      });
      seenRefs.add(txn_ref.toLowerCase());
      imported++;
    }
    // Insert in date order, oldest first -- matches how the original spreadsheet was arranged
    newRows.sort((a,b)=>a.date<b.date?-1:1);

    // Send the whole batch through the bulk import endpoint rather than
    // letting the generic background sync create them one at a time — this
    // re-checks duplicates server-side too (catches anything imported by
    // someone else since this session loaded) and reports exactly what it
    // skipped and why.
    let confirmedRows = [];
    if(newRows.length){
      if(statusEl) statusEl.innerHTML = `<span class="hint">Saving ${newRows.length} rows…</span>`;
      try{
        const entries = newRows.map(CORE_ENTITY_CONFIG.expenses.toApi);
        const apiResult = await apiCreate('/api/expenses', { branch_id: state.branchId, entries });
        const insertedIds = new Set((apiResult.inserted||[]).map(x=>x.id));
        confirmedRows = newRows.filter(r=>insertedIds.has(r.id));
        for(const skip of (apiResult.skipped||[])){
          skippedDupe++;
          errors.push(skip.reason || 'A row was skipped by the server.');
        }
      }catch(err){
        importResult = {imported:0, skippedDupe, skippedInvalid, errors:[...errors, 'Save failed: '+err.message]};
        if(statusEl) statusEl.innerHTML='';
        render();
        ev.target.value = '';
        return;
      }
    }
    state.expenses = state.expenses.concat(confirmedRows);
    // Keep the sync snapshot in step so the debounced background save
    // doesn't try to re-create rows that are already persisted.
    if(lastSynced) lastSynced.expenses = JSON.parse(JSON.stringify(state.expenses));
    importResult = {imported: confirmedRows.length, skippedDupe, skippedInvalid, errors};
    render();
  } catch(err){
    importResult = {imported:0, skippedDupe:0, skippedInvalid:0, errors:['Could not read this file: '+err.message]};
    render();
  }
  ev.target.value = '';
}

/* ---------------- DEBT PAYOFF ---------------- */

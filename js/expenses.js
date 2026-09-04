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
          ${importResult.skippedFiltered ? `<div><span class="tag neutral">${importResult.skippedFiltered} skipped — internal Tende transfer</span></div>` : ''}
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

function parseTendeDate(value){
  if(value instanceof Date) return value;
  const raw = String(value || '').trim().split(' ')[0];
  const dmy = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/);
  if(dmy) return new Date(Number(dmy[3]), Number(dmy[2]) - 1, Number(dmy[1]), 12);
  return new Date(raw);
}

function tendeHeaderKey(value){
  return String(value || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function isInternalTendeTransfer(row, idx){
  const values = [idx.service, idx.account, idx.details, idx.receiver, idx.name, idx.otherParty, idx.remark]
    .map(column => String(row[column] || '').trim().toUpperCase()).filter(Boolean);
  const text = values.join(' ');
  return values.some(value => value === 'SND_TENDE') ||
    /WALLET\s*[- ]?TO\s*WALLET|INTERNAL\s+(TRANSFER|ACCOUNT)|ACCOUNT\s*[- ]?TO\s*ACCOUNT|OWN\s+ACCOUNT|T ENDE\s+TO\s+TENDE|TEND[E]?\s+TO\s+TEND[E]?|ORGANIZATION\s+SETTLEMENT\s+ACCOUNT|UTILITY\s+ACCOUNT\s+TO\s+ORGANIZATION/i.test(text);
}

// Detects and parses Happynet's raw Tende "payments report" export
// directly — no manual pre-processing into the simplified layout needed.
// Two things it deliberately does that a naive import wouldn't:
//   1. Drops SND_TENDE and other internal account-move rows — these are transfers between Happynet's own
//      Tende sub-wallets (Overall -> Payroll, -> Inventory, etc.), not
//      real money leaving the business. Importing them would double-count
//      every shilling: once as an internal transfer, again as the real
//      external payment it eventually funds.
//   2. Only imports successful/completed rows.
function parseRawTendeGrid(grid){
  let headerRow = -1;
  let header = [];
  for(let rowIndex = 0; rowIndex < Math.min(grid.length, 30); rowIndex++){
    const candidate = (grid[rowIndex] || []).map(tendeHeaderKey);
    const hasDate = candidate.includes('DATEINITIATED') || candidate.includes('COMPLETIONTIME');
    const hasRef = candidate.includes('REF') || candidate.includes('REFNO') || candidate.includes('RECEIPTNO');
    const hasPayment = candidate.includes('AMOUNT') || candidate.includes('WITHDRAWN');
    if(hasDate && hasRef && hasPayment && candidate.includes('STATUS')){
      headerRow = rowIndex;
      header = candidate;
      break;
    }
  }
  if(headerRow < 0) return null; // not this format — let the caller fall through
  const col = (...names) => {
    for(const name of names){
      const index = header.indexOf(name);
      if(index >= 0) return index;
    }
    return -1;
  };
  const idx = {
    dateInit: col('DATEINITIATED', 'COMPLETIONTIME', 'INITIATIONTIME'),
    dateAppr: col('DATEAPPROVED', 'COMPLETIONTIME'),
    account: col('ACCOUNT', 'ACNO'), service: col('SERVICE'),
    amount: col('AMOUNT', 'WITHDRAWN', 'PAIDIN'), charge: col('CHARGE'),
    receiver: col('RECEIVER', 'OTHERPARTYINFO'), name: col('NAME'),
    details: col('DETAILS'), otherParty: col('OTHERPARTYINFO'),
    remark: col('REMARK'), refNo: col('REFNO', 'REF', 'RECEIPTNO'),
    status: col('STATUS'), statusMsg: col('STATUSMESSAGE')
  };
  const rows = [];
  let skippedInternal = 0, skippedFailed = 0;
  for(let r=headerRow + 1; r<grid.length; r++){
    const row = grid[r]; if(!row || row.every(c=>c===null||c==='')) continue;
    const status = String(row[idx.status]||'').trim().toUpperCase();
    if(!['SUCCESS','COMPLETED','COMPLETE','POSTED','SETTLED'].includes(status)){ skippedFailed++; continue; }
    const service = String(row[idx.service]||'').trim().toUpperCase();
    if(isInternalTendeTransfer(row, idx)){ skippedInternal++; continue; }
    const rawDate = row[idx.dateAppr] || row[idx.dateInit];
    const dateObj = parseTendeDate(rawDate);
    if(isNaN(dateObj)) { skippedFailed++; continue; }
    const tendeWallet = String(row[idx.account]||'').replace(/\s*\(KOC\d+\)/i,'').trim();
    const amount = Number(String(row[idx.amount]||'0').replace(/[^0-9.\-]/g,'')) || 0;
    const charges = Number(String(row[idx.charge]||'0').replace(/[^0-9.\-]/g,'')) || 0;
    const remark = String(row[idx.remark] || row[idx.details] || '').trim();
    const receiver = String(row[idx.name] || row[idx.receiver] || '').trim();
    rows.push({
      date: dateObj.toISOString().slice(0,10),
      txn_ref: String(row[idx.refNo]||'').trim(),
      account_used: service === 'SEND BANK' ? 'Bank Account' : 'M-Pesa Till',
      category: guessTendeCategory(remark, tendeWallet),
      description: remark,
      paid_to: extractTendeVendor(row[idx.statusMsg], remark, receiver),
      amount_kes: Math.abs(amount), charges_kes: Math.abs(charges), owner_funded: false
    });
  }
  return { rows, skippedInternal, skippedFailed };
}

async function persistTendeExpenses(rows){
  const response = await apiFetch('/api/expenses', {
    method:'POST', headers:JSONH,
    body:JSON.stringify({
      branch_id:state.branchId,
      entries:rows.map(row => ({
        expense_date:row.date, txn_ref:row.txn_ref, account_name:row.account_used,
        category_name:row.category || 'Other', description:row.description || null,
        paid_to:row.paid_to || null, amount_kes:row.amount_kes,
        charges_kes:row.charges_kes || 0, owner_funded:false, source:'tende_import'
      }))
    })
  });
  const body = await safeParseJson(response);
  if(!response.ok) throw new Error(body.error || 'Could not import expenses.');
  return {
    insertedRows:(body.inserted || []).map((item, index) => ({ ...rows[index], id:item.id })),
    skippedDupe:(body.skipped || []).filter(item => String(item.reason || '').toLowerCase().includes('duplicate')).length,
    errors:(body.skipped || []).filter(item => !String(item.reason || '').toLowerCase().includes('duplicate')).map(item => item.reason)
  };
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
      if(rawTende.skippedInternal) errors.push(`${rawTende.skippedInternal} internal Tende account transfer(s) correctly excluded — not real expenses.`);
      const seenRefs = new Set(state.expenses.map(e=>String(e.txn_ref || '').toLowerCase()).filter(Boolean));
      const newRows = [];
      for(const r of rawTende.rows){
        const refKey = String(r.txn_ref || '').toLowerCase();
        if(!refKey || seenRefs.has(refKey)){
          skippedDupe++; continue;
        }
        newRows.push({ id:uid(), ...r });
        seenRefs.add(refKey);
        imported++;
      }
      newRows.sort((a,b)=>a.date<b.date?-1:1);

      let confirmedRows = [];
      if(newRows.length){
        if(statusEl) statusEl.innerHTML = `<span class="hint">Saving ${newRows.length} rows…</span>`;
        try{
          const result = await persistTendeExpenses(newRows);
          confirmedRows = result.insertedRows;
          skippedDupe += result.skippedDupe;
          errors.push(...result.errors);
        }catch(err){
          importResult = {imported:0, skippedDupe, skippedInvalid:rawTende.skippedFailed, errors:[...errors, 'Save failed: '+err.message]};
          if(statusEl) statusEl.innerHTML=''; render(); ev.target.value=''; return;
        }
      }
      state.expenses = state.expenses.concat(confirmedRows);
      if(lastSynced) lastSynced.expenses = JSON.parse(JSON.stringify(state.expenses));
      importResult = { imported: confirmedRows.length, skippedDupe, skippedInvalid: rawTende.skippedFailed, skippedFiltered: rawTende.skippedInternal, errors };
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
    const seenRefs = new Set(state.expenses.map(e=>String(e.txn_ref || '').toLowerCase()).filter(Boolean));
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
        const result = await persistTendeExpenses(newRows);
        confirmedRows = result.insertedRows;
        skippedDupe += result.skippedDupe;
        errors.push(...result.errors);
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

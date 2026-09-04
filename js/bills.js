/* ---------------- Suppliers & Bills (Accounts Payable) ---------------- */
let billsState = { loading:false, bills:null, suppliers:null, aging:null, error:null, formError:null, view:'bills', statement:null };

async function parseBillsResponse(response, fallbackMessage){
  const body = await safeParseJson(response);
  if(!response.ok){
    const message = body.error || fallbackMessage;
    if(/relation .* does not exist|function .* does not exist|column .* does not exist|accounts payable|v_hfms_ap_|bill/i.test(message)){
      throw new Error(`${message} Run supabase/hfms_foundation_fix_04_accounts_payable.sql against Supabase, then reload.`);
    }
    throw new Error(message);
  }
  return body;
}

async function loadBills(){
  billsState.loading = true; render();
  try{
    const [billsRes, suppliersRes, agingRes] = await Promise.all([
      apiFetch(`/api/bills?branch_id=${state.branchId}`, { method:'GET' }).then(r=>parseBillsResponse(r, 'Could not load bills.')),
      apiFetch(`/api/suppliers?branch_id=${state.branchId}`, { method:'GET' }).then(r=>parseBillsResponse(r, 'Could not load suppliers.')),
      apiFetch(`/api/bills?branch_id=${state.branchId}&action=aging`, { method:'GET' }).then(r=>parseBillsResponse(r, 'Could not load bill aging.'))
    ]);
    billsState.bills = billsRes.bills || [];
    billsState.suppliers = suppliersRes.suppliers || [];
    billsState.aging = agingRes.aging || [];
    billsState.error = null;
  }catch(e){
    billsState.error = e.message;
  }
  billsState.loading = false;
  render();
}
async function addSupplier(name, contact, kraPin){
  billsState.formError = null;
  try{
    const res = await apiFetch('/api/suppliers', { method:'POST', headers: JSONH, body: JSON.stringify({ branch_id: state.branchId, name, contact, kra_pin: kraPin || undefined }) });
    const body = await parseBillsResponse(res, 'Could not add supplier.');
    await loadBills();
  }catch(e){ billsState.formError = e.message; render(); }
}
async function loadSupplierStatement(supplierId){
  try{
    const [stmtRes, docsRes] = await Promise.all([
      apiFetch(`/api/suppliers?action=statement&supplier_id=${supplierId}`, { method:'GET' }).then(r=>parseBillsResponse(r, 'Could not load the supplier statement.')),
      apiFetch(`/api/suppliers?action=documents&supplier_id=${supplierId}`, { method:'GET' }).then(r=>parseBillsResponse(r, 'Could not load supplier documents.'))
    ]);
    const supplier = (billsState.suppliers||[]).find(s=>s.id===supplierId);
    billsState.statement = { supplierId, supplierName: supplier ? supplier.name : '', rows: stmtRes.statement || [], documents: docsRes.documents || [] };
  }catch(e){ billsState.statement = { supplierId, supplierName:'', rows:[], documents:[], error: e.message }; }
  render();
}
async function uploadSupplierDocument(supplierId, file){
  if(!file) return;
  try{
    const dataUrl = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result);
      reader.onerror = () => rej(new Error('Could not read that file.'));
      reader.readAsDataURL(file);
    });
    const base64 = dataUrl.split(',')[1] || '';
    const res = await apiFetch('/api/suppliers?action=upload-document', {
      method:'POST', headers: JSONH,
      body: JSON.stringify({ branch_id: state.branchId, supplier_id: supplierId, label: file.name, file_name: file.name, content_type: file.type, data_base64: base64 })
    });
    const body = await parseBillsResponse(res, 'Could not upload this document.');
    await loadSupplierStatement(supplierId);
  }catch(e){ showToast('Upload failed: ' + e.message, 'error'); }
}
function supplierStatementHtml(){
  const { supplierId, supplierName, rows, documents, error } = billsState.statement;
  return `
    <div style="margin-top:16px; padding-top:16px; border-top:1px solid var(--hair);">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
        <h3 style="margin:0;">Statement — ${supplierName}</h3>
        <button class="btn ghost sm" id="btn-close-statement">Close</button>
      </div>
      ${error ? `<div class="hint" style="color:#c0392b;">${error}</div>` : `
      <table>
        <thead><tr><th class="txt">Invoice</th><th>Date</th><th>Total</th><th>Paid</th><th>Outstanding</th><th class="txt">Status</th></tr></thead>
        <tbody>
          ${rows.length===0 ? `<tr class="empty-row"><td colspan="6">No bills for this supplier yet.</td></tr>` : rows.map(r=>`
            <tr><td class="txt">${r.invoice_number||'—'}</td><td>${r.invoice_date}</td><td>${KES0(r.total_kes)}</td><td>${KES0(r.paid_kes)}</td><td>${KES0(r.outstanding_kes)}</td><td class="txt">${r.status}</td></tr>
          `).join('')}
        </tbody>
      </table>
      <div style="margin-top:16px; padding-top:16px; border-top:1px solid var(--hair);">
        <h4 style="margin:0 0 8px;">Documents</h4>
        ${canWrite() ? `<input type="file" id="supplier-doc-upload" style="margin-bottom:10px;">` : ''}
        ${(documents||[]).length===0 ? `<span class="hint">No documents uploaded — contracts, KRA compliance certificates, agreements.</span>` : `
        <ul style="list-style:none; padding:0; margin:0; display:flex; flex-direction:column; gap:6px;">
          ${documents.map(d=>`<li style="display:flex; justify-content:space-between; align-items:center; font-size:13px;"><span>${ic('receipt',14)} ${d.label}</span>${d.url?`<a href="${d.url}" target="_blank" rel="noopener">View</a>`:'<span class="hint">Link expired — refresh</span>'}</li>`).join('')}
        </ul>`}
      </div>
      `}
    </div>
  `;
}
async function addBill(payload){
  billsState.formError = null;
  try{
    const res = await apiFetch('/api/bills', { method:'POST', headers: JSONH, body: JSON.stringify({ branch_id: state.branchId, ...payload }) });
    const body = await parseBillsResponse(res, 'Could not add bill.');
    await loadBills();
  }catch(e){ billsState.formError = e.message; render(); }
}
async function approveBill(id){
  if(!(await confirmDialog('Approve this bill? This posts it to the ledger as an expense against Accounts Payable.'))) return;
  try{
    const res = await apiFetch(`/api/bills?action=approve`, { method:'POST', headers: JSONH, body: JSON.stringify({ branch_id: state.branchId, id }) });
    const body = await parseBillsResponse(res, 'Could not approve bill.');
    await loadBills();
  }catch(e){ showToast('Could not approve: ' + e.message, 'error'); }
}
async function payBill(billId, total, outstanding){
  const amountStr = await promptDialog(`Payment amount (KES) — outstanding is ${outstanding}:`, outstanding);
  if(!amountStr) return;
  const amount = Number(amountStr);
  if(!amount || amount <= 0){ showToast('Enter a valid amount.', 'error'); return; }
  const account = await promptDialog(`Which account? (${ACCOUNTS.join(', ')})`, ACCOUNTS[0]);
  if(!account) return;
  try{
    const res = await apiFetch(`/api/bills?action=pay`, {
      method:'POST', headers: JSONH,
      body: JSON.stringify({ branch_id: state.branchId, bill_id: billId, payment_date: todayISO(), amount_kes: amount, account_name: account })
    });
    const body = await parseBillsResponse(res, 'Could not record payment.');
    await loadBills();
  }catch(e){ showToast('Could not record payment: ' + e.message, 'error'); }
}

function viewBills(){
  const { loading, bills, suppliers, aging, error, formError } = billsState;
  const agingTotals = { current:0, '1-30':0, '31-60':0, '61-90':0, '90+':0 };
  (aging||[]).forEach(a => { agingTotals[a.aging_bucket] = (agingTotals[a.aging_bucket]||0) + Number(a.outstanding_kes); });

  return `
    <div class="topbar"><div><h1>Suppliers &amp; Bills</h1><div class="sub">Accounts Payable — bill, approve, pay, track aging. Posts real double-entry to the ledger on approval and payment.</div></div></div>

    ${loading && !bills ? `<div class="card"><span class="hint">Loading…</span></div>` : ''}
    ${error ? `<div class="card"><div class="hint" style="color:#c0392b;">${error}</div></div>` : ''}
    ${formError ? `<div class="hint" style="color:#c0392b; margin-bottom:10px;">${formError}</div>` : ''}

    ${bills ? `
    <div class="grid kpi" style="grid-template-columns:repeat(5,1fr); margin-bottom:22px;">
      ${Object.entries(agingTotals).map(([bucket,total])=>`
        <div class="card kpi"><h3>${bucket==='current'?'Not Yet Due':bucket+' days'}</h3><div class="big" style="font-size:19px;">${KES0(total)}</div></div>
      `).join('')}
    </div>

    <div class="section-head"><h2>Suppliers</h2></div>
    <div class="card" style="margin-bottom:22px;">
      <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px;">
        ${(suppliers||[]).length ? suppliers.map(s=>`<span class="tag neutral" style="cursor:pointer;" data-view-statement="${s.id}">${s.name}${s.kra_pin?` · ${s.kra_pin}`:''}</span>`).join('') : `<span class="hint">No suppliers yet — add one below.</span>`}
      </div>
      ${canWrite() ? `
      <form id="form-add-supplier" style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end;">
        <div><label style="display:block; font-size:11.5px; font-weight:600; color:var(--muted); margin-bottom:4px;">Supplier name</label><input type="text" name="name" placeholder="e.g. Liquid Telecom" required></div>
        <div><label style="display:block; font-size:11.5px; font-weight:600; color:var(--muted); margin-bottom:4px;">Contact (optional)</label><input type="text" name="contact" placeholder="phone or email"></div>
        <div><label style="display:block; font-size:11.5px; font-weight:600; color:var(--muted); margin-bottom:4px;">KRA PIN (optional)</label><input type="text" name="kra_pin" placeholder="P0XXXXXXXXX"></div>
        <button class="btn ghost sm" type="submit">Add Supplier</button>
      </form>` : ''}
      ${billsState.statement ? supplierStatementHtml() : ''}
    </div>

    ${canWrite() ? `
    <div class="section-head"><h2>Log a bill</h2></div>
    <div class="form-card">
      <div style="margin-bottom:16px; padding-bottom:16px; border-bottom:1px solid var(--hair);">
        <label style="display:block; margin-bottom:6px;">Have a photo of the invoice? Extract the details automatically</label>
        <input type="file" id="doc-intel-upload-bill" accept="image/*">
        ${docIntelState.loading && docIntelState.context==='bill' ? `<div class="hint" style="margin-top:8px;">Reading the invoice…</div>` : ''}
        ${docIntelState.error && docIntelState.context==='bill' ? `<div class="hint" style="color:#c0392b; margin-top:8px;">${docIntelState.error}</div>` : ''}
        ${docIntelState.context==='bill' && docIntelState.result ? `<div class="hint" style="margin-top:8px;">${docIntelState.result.extracted ? `Extracted (confidence: ${docIntelState.result.confidence}) — fields below have been pre-filled. Check them before saving, especially Supplier and Tax.` : docIntelState.result.note}</div>` : ''}
      </div>
      <form id="form-add-bill">
        <div class="form-row">
          <div><label>Supplier</label><select name="supplier_id" required>${(suppliers||[]).map(s=>`<option value="${s.id}" ${matchSupplierByName(docIntelExtractedFor('bill')?.vendor, suppliers)===s.id?'selected':''}>${s.name}</option>`).join('')}</select>
            ${docIntelExtractedFor('bill')?.vendor && !matchSupplierByName(docIntelExtractedFor('bill')?.vendor, suppliers) ? `<div class="hint" style="margin-top:4px;">Detected vendor "${docIntelExtractedFor('bill').vendor}" doesn't match an existing supplier — add them first, or pick the closest match above.</div>` : ''}
          </div>
          <div><label>Invoice Number</label><input type="text" name="invoice_number" placeholder="optional"></div>
          <div><label>Invoice Date</label><input type="date" name="invoice_date" value="${docIntelExtractedFor('bill')?.date || todayISO()}" required></div>
          <div><label>Due Date</label><input type="date" name="due_date"></div>
        </div>
        <div class="form-row">
          <div><label>Category</label><select name="category_id">${CATS().map(c=>`<option ${docIntelExtractedFor('bill')?.suggested_category===c?'selected':''}>${c}</option>`).join('')}</select></div>
          <div><label>Subtotal (KES)</label><input type="number" name="subtotal_kes" min="0" value="${docIntelExtractedFor('bill')?.amount_kes || ''}" required></div>
          <div><label>Tax (KES)</label><input type="number" name="tax_kes" min="0" value="0"></div>
        </div>
        <button class="btn gold" type="submit" ${(suppliers||[]).length===0?'disabled title="Add a supplier first"':''}>Log Bill</button>
      </form>
    </div>` : ''}

    <div class="section-head"><h2>All bills</h2></div>
    <div class="table-wrap"><table>
      <thead><tr><th class="txt">Supplier</th><th class="txt">Invoice</th><th>Date</th><th>Due</th><th>Total</th><th>Paid</th><th>Outstanding</th><th class="txt">Status</th><th></th></tr></thead>
      <tbody>
        ${(bills||[]).length===0 ? `<tr class="empty-row"><td colspan="9">No bills logged yet.</td></tr>` : bills.map(b=>{
          const paid = (b.bill_payments||[]).reduce((s,p)=>s+Number(p.amount_kes),0);
          const outstanding = Number(b.total_kes) - paid;
          return `<tr>
            <td class="txt">${b.suppliers ? b.suppliers.name : ''}</td>
            <td class="txt">${b.invoice_number||'—'}</td>
            <td class="txt">${b.invoice_date}</td>
            <td class="txt">${b.due_date||'—'}</td>
            <td>${KES0(b.total_kes)}</td>
            <td>${KES0(paid)}</td>
            <td>${KES0(outstanding)}</td>
            <td class="txt"><span class="tag ${b.status==='paid'?'good':b.status==='draft'?'neutral':'alert'}">${b.status}</span></td>
            <td style="white-space:nowrap;">
              ${b.status==='draft' && canApprove() ? `<button class="btn ghost sm" data-approve-bill="${b.id}">Approve</button>` : ''}
              ${(b.status==='approved'||b.status==='partial') && canWrite() ? `<button class="btn ghost sm" data-pay-bill="${b.id}" data-bill-total="${b.total_kes}" data-bill-outstanding="${outstanding}">Record Payment</button>` : ''}
            </td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>
    ` : ''}
  `;
}

/* ---------------- Reconciliation ---------------- */

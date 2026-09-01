/* ---------------- Event wiring ---------------- */

function wireTab(){
  wirePaginationControls();
  wireSortableHeaders();
  document.querySelectorAll('[data-expense-checkbox]').forEach(cb=>cb.addEventListener('change', ()=>{
    const id = cb.dataset.expenseCheckbox;
    if(cb.checked) selectedExpenseIds.add(id); else selectedExpenseIds.delete(id);
    render();
  }));
  const selectAllPending = document.getElementById('select-all-pending');
  if(selectAllPending) selectAllPending.addEventListener('change', ()=>{
    const visiblePendingIds = Array.from(document.querySelectorAll('[data-expense-checkbox]')).map(cb=>cb.dataset.expenseCheckbox);
    if(selectAllPending.checked) visiblePendingIds.forEach(id=>selectedExpenseIds.add(id));
    else visiblePendingIds.forEach(id=>selectedExpenseIds.delete(id));
    render();
  });
  const btnBulkApprove = document.getElementById('btn-bulk-approve');
  if(btnBulkApprove) btnBulkApprove.addEventListener('click', ()=>withButtonLock(btnBulkApprove, ()=>bulkApproveExpenses(Array.from(selectedExpenseIds))));
  const btnBulkReject = document.getElementById('btn-bulk-reject');
  if(btnBulkReject) btnBulkReject.addEventListener('click', ()=>withButtonLock(btnBulkReject, ()=>bulkRejectExpenses(Array.from(selectedExpenseIds))));
  const btnBulkClear = document.getElementById('btn-bulk-clear');
  if(btnBulkClear) btnBulkClear.addEventListener('click', ()=>{ selectedExpenseIds.clear(); render(); });
  const auditFilter = document.getElementById('audit-filter-table');
  if(auditFilter) auditFilter.addEventListener('change', ()=>{ auditState.filterTable = auditFilter.value; loadAudit(auditFilter.value); });
  const btnRefreshSyncHealth = document.getElementById('btn-refresh-sync-health');
  if(btnRefreshSyncHealth) btnRefreshSyncHealth.addEventListener('click', loadSyncErrors);

  const btnScanAlerts = document.getElementById('btn-scan-alerts');
  if(btnScanAlerts) btnScanAlerts.addEventListener('click', scanForAlerts);
  document.querySelectorAll('[data-dismiss-alert]').forEach(b=>b.addEventListener('click',()=>dismissAlert(b.dataset.dismissAlert)));

  // Daily
  const fd = document.getElementById('form-daily');
  trackFormDirty(fd);
  if(fd) fd.addEventListener('submit', e => {
    e.preventDefault();
    clearFormDirty();
    const fdata = new FormData(fd);
    const date = fdata.get('date');
    const revenue_kes = Number(fdata.get('revenue_kes'));
    const notes = fdata.get('notes')||'';
    const errEl = document.getElementById('daily-err');
    if(state.closedMonths.includes(monthKey(date))){
      errEl.innerHTML = `<div class="err-msg">This date belongs to ${monthLabel(monthKey(date))}, which is already closed.</div>`; return;
    }
    const dupe = state.dailyRevenue.find(r=>r.date===date && r.id!==editingRevenueId);
    if(dupe){
      errEl.innerHTML = `<div class="err-msg">A revenue entry already exists for ${date}. Edit or delete it first — duplicates aren't allowed.</div>`; return;
    }
    if(editingRevenueId){
      const rec = state.dailyRevenue.find(r=>r.id===editingRevenueId);
      if(rec){ rec.date=date; rec.revenue_kes=revenue_kes; rec.notes=notes; }
      editingRevenueId = null;
    } else {
      state.dailyRevenue.push({id:uid(), date, revenue_kes, notes});
    }
    queueSave(); render();
  });
  document.querySelectorAll('[data-edit-revenue]').forEach(b=>b.addEventListener('click',()=>{
    editingRevenueId = b.dataset.editRevenue; render();
  }));
  document.querySelectorAll('[data-del-revenue]').forEach(b=>b.addEventListener('click',()=>{
    if(editingRevenueId===b.dataset.delRevenue) editingRevenueId=null;
    state.dailyRevenue = state.dailyRevenue.filter(r=>r.id!==b.dataset.delRevenue); queueSave(); render();
  }));
  const cancelDaily = document.getElementById('cancel-edit-daily');
  if(cancelDaily) cancelDaily.addEventListener('click', ()=>{ editingRevenueId=null; clearFormDirty(); render(); });

  // Expenses
  const docIntelUpload = document.getElementById('doc-intel-upload');
  if(docIntelUpload) docIntelUpload.addEventListener('change', (ev) => extractFromReceipt(ev.target.files[0], 'expense'));

  const fe = document.getElementById('form-expense');
  trackFormDirty(fe);
  if(fe) fe.addEventListener('submit', e => {
    e.preventDefault();
    clearFormDirty();
    docIntelState = { loading:false, result:null, error:null }; // clear so the next "log an expense" starts fresh
    const fdata = new FormData(fe);
    const date = fdata.get('date');
    const txn_ref = (fdata.get('txn_ref')||'').trim();
    const errEl = document.getElementById('expense-err');
    if(state.closedMonths.includes(monthKey(date))){
      errEl.innerHTML = `<div class="err-msg">This date belongs to ${monthLabel(monthKey(date))}, which is already closed.</div>`; return;
    }
    if(!txn_ref){ errEl.innerHTML = `<div class="err-msg">Txn Ref is required.</div>`; return; }
    const dupe = state.expenses.find(x=>x.txn_ref.toLowerCase()===txn_ref.toLowerCase() && x.id!==editingExpenseId);
    if(dupe){
      errEl.innerHTML = `<div class="err-msg">Txn Ref "${txn_ref}" already exists — duplicate rejected.</div>`; return;
    }
    const needsApprovalEl = fe.querySelector('[name=needs_approval]');
    const payload = {
      date, txn_ref, account_used:fdata.get('account_used'), category:fdata.get('category'),
      description:fdata.get('description')||'', paid_to:fdata.get('paid_to')||'',
      amount_kes:Number(fdata.get('amount_kes')), charges_kes:Number(fdata.get('charges_kes')||0),
      owner_funded: fe.querySelector('[name=owner_funded]').checked,
      status: needsApprovalEl && needsApprovalEl.checked ? 'pending_approval' : 'posted'
    };
    if(editingExpenseId){
      const rec = state.expenses.find(x=>x.id===editingExpenseId);
      if(rec) Object.assign(rec, payload);
      editingExpenseId = null;
    } else {
      state.expenses.push({id:uid(), ...payload});
    }
    queueSave(); render();
  });
  document.querySelectorAll('[data-edit-expense]').forEach(b=>b.addEventListener('click',()=>{
    editingExpenseId = b.dataset.editExpense; render();
  }));
  document.querySelectorAll('[data-del-expense]').forEach(b=>b.addEventListener('click',()=>{
    if(editingExpenseId===b.dataset.delExpense) editingExpenseId=null;
    state.expenses = state.expenses.filter(x=>x.id!==b.dataset.delExpense); queueSave(); render();
  }));
  document.querySelectorAll('[data-attach-expense]').forEach(b=>b.addEventListener('click',()=>{
    openAttachments('expense', b.dataset.attachExpense);
  }));
  wireAttachmentsPanel();
  const exportExpBtn = document.getElementById('btn-export-expenses-csv');
  if(exportExpBtn) exportExpBtn.addEventListener('click', exportExpensesCsv);
  const exportExpXlsxBtn = document.getElementById('btn-export-expenses-xlsx');
  if(exportExpXlsxBtn) exportExpXlsxBtn.addEventListener('click', exportExpensesXlsx);
  const exportRevBtn = document.getElementById('btn-export-revenue-csv');
  if(exportRevBtn) exportRevBtn.addEventListener('click', exportRevenueCsv);
  const assistantForm = document.getElementById('form-assistant');
  if(assistantForm) assistantForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = new FormData(assistantForm).get('question');
    if(q && q.trim()) askAssistant(q.trim());
    assistantForm.reset();
  });
  document.querySelectorAll('[data-track-followup]').forEach(b=>b.addEventListener('click',()=>trackFollowUp(Number(b.dataset.trackFollowup))));
  document.querySelectorAll('[data-followup-done]').forEach(b=>b.addEventListener('click',()=>resolveFollowUp(b.dataset.followupDone,'done')));
  document.querySelectorAll('[data-followup-dismiss]').forEach(b=>b.addEventListener('click',()=>resolveFollowUp(b.dataset.followupDismiss,'dismissed')));
  const cancelExpense = document.getElementById('cancel-edit-expense');
  if(cancelExpense) cancelExpense.addEventListener('click', ()=>{ editingExpenseId=null; clearFormDirty(); render(); });
  const addCat = document.getElementById('btn-add-category');
  if(addCat) addCat.addEventListener('click', async ()=>{
    const name = ((await promptDialog('New expense category name:'))||'').trim();
    if(!name) return;
    if(!state.categories) state.categories = DEFAULT_CATEGORIES.slice();
    if(!state.categories.some(c=>c.toLowerCase()===name.toLowerCase())) state.categories.push(name);
    queueSave(); render();
    setTimeout(()=>{ const sel = document.querySelector('[name=category]'); if(sel) sel.value = name; }, 0);
  });
  const fcat = document.getElementById('filter-category'); if(fcat) fcat.addEventListener('change', e=>{expenseFilters.category=e.target.value; render();});
  const facc = document.getElementById('filter-account'); if(facc) facc.addEventListener('change', e=>{expenseFilters.account=e.target.value; render();});
  const fown = document.getElementById('filter-owner'); if(fown) fown.addEventListener('change', e=>{expenseFilters.ownerFundedOnly=e.target.checked; render();});
  const fpending = document.getElementById('filter-pending'); if(fpending) fpending.addEventListener('change', e=>{expenseFilters.pendingOnly=e.target.checked; render();});
  document.querySelectorAll('[data-approve-expense]').forEach(b=>b.addEventListener('click',()=>approveExpense(b.dataset.approveExpense)));
  document.querySelectorAll('[data-reject-expense]').forEach(b=>b.addEventListener('click',()=>rejectExpense(b.dataset.rejectExpense)));
  const fileImport = document.getElementById('file-import');
  if(fileImport) fileImport.addEventListener('change', handleExpenseImport);
  const fileImportRevenue = document.getElementById('file-import-revenue');
  if(fileImportRevenue) fileImportRevenue.addEventListener('change', handleRevenueImport);

  // Loans
  const fl = document.getElementById('form-loan');
  trackFormDirty(fl);
  if(fl) fl.addEventListener('submit', e=>{
    e.preventDefault();
    clearFormDirty(); const fdata = new FormData(fl);
    const payload = {
      debt_name:fdata.get('debt_name'), lender:fdata.get('lender')||'',
      original_principal_kes:Number(fdata.get('original_principal_kes')),
      annual_interest_rate_pct:Number(fdata.get('annual_interest_rate_pct')||0),
      start_date:fdata.get('start_date')||'', min_monthly_payment_kes:Number(fdata.get('min_monthly_payment_kes')||0),
      status:fdata.get('status')
    };
    if(editingLoanId){
      // current_balance_kes deliberately omitted — it's auto-maintained by
      // the server from dedicated payments + matching Reimbursement
      // expenses now, not hand-edited here.
      const rec = state.loans.find(l=>l.id===editingLoanId);
      if(rec) Object.assign(rec, payload);
      editingLoanId = null;
    } else {
      const startingBalance = fdata.get('current_balance_kes');
      payload.current_balance_kes = startingBalance ? Number(startingBalance) : payload.original_principal_kes;
      state.loans.push({id:uid(), ...payload});
    }
    queueSave(); render();
  });
  document.querySelectorAll('[data-edit-loan]').forEach(b=>b.addEventListener('click',()=>{
    editingLoanId = b.dataset.editLoan; render();
  }));
  document.querySelectorAll('[data-del-loan]').forEach(b=>b.addEventListener('click',()=>{
    if(editingLoanId===b.dataset.delLoan) editingLoanId=null;
    state.loans = state.loans.filter(l=>l.id!==b.dataset.delLoan); queueSave(); render();
  }));
  const cancelLoan = document.getElementById('cancel-edit-loan');
  if(cancelLoan) cancelLoan.addEventListener('click', ()=>{ editingLoanId=null; render(); });

  const fp = document.getElementById('form-payment');
  trackFormDirty(fp);
  if(fp) fp.addEventListener('submit', e=>{
    e.preventDefault();
    clearFormDirty(); const fdata = new FormData(fp);
    const loan_id = fdata.get('loan_id'); if(!loan_id) return;
    const amount = Number(fdata.get('amount_kes'));
    const date = fdata.get('date');
    const note = fdata.get('note')||'';
    if(editingPaymentId){
      const rec = state.loanPayments.find(p=>p.id===editingPaymentId);
      if(rec){
        // reverse the old amount off the old loan's balance, then apply the new amount to the (possibly new) loan
        const oldLoan = state.loans.find(l=>l.id===rec.loan_id);
        if(oldLoan) oldLoan.current_balance_kes = Number(oldLoan.current_balance_kes) + Number(rec.amount_kes);
        rec.loan_id=loan_id; rec.date=date; rec.amount_kes=amount; rec.note=note;
        const newLoan = state.loans.find(l=>l.id===loan_id);
        if(newLoan){ newLoan.current_balance_kes = Math.max(0, Number(newLoan.current_balance_kes) - amount); newLoan.status = newLoan.current_balance_kes<=0 ? 'Paid Off' : 'Active'; }
      }
      editingPaymentId = null;
    } else {
      state.loanPayments.push({id:uid(), loan_id, date, amount_kes:amount, note});
      const loan = state.loans.find(l=>l.id===loan_id);
      if(loan){ loan.current_balance_kes = Math.max(0, Number(loan.current_balance_kes) - amount); if(loan.current_balance_kes<=0) loan.status='Paid Off'; }
    }
    queueSave(); render();
  });
  document.querySelectorAll('[data-edit-payment]').forEach(b=>b.addEventListener('click',()=>{
    editingPaymentId = b.dataset.editPayment; render();
  }));
  document.querySelectorAll('[data-del-payment]').forEach(b=>b.addEventListener('click',()=>{
    const p = state.loanPayments.find(x=>x.id===b.dataset.delPayment);
    if(p){
      const loan = state.loans.find(l=>l.id===p.loan_id);
      if(loan){ loan.current_balance_kes = Number(loan.current_balance_kes) + Number(p.amount_kes); loan.status='Active'; }
    }
    if(editingPaymentId===b.dataset.delPayment) editingPaymentId=null;
    state.loanPayments = state.loanPayments.filter(x=>x.id!==b.dataset.delPayment); queueSave(); render();
  }));
  const cancelPayment = document.getElementById('cancel-edit-payment');
  if(cancelPayment) cancelPayment.addEventListener('click', ()=>{ editingPaymentId=null; render(); });

  // Tax
  document.querySelectorAll('[data-tax-applicable]').forEach(cb=>cb.addEventListener('change',()=>{
    const t = state.taxObligations.find(x=>x.id===cb.dataset.taxApplicable); t.applicable = cb.checked; queueSave(); render();
  }));
  document.querySelectorAll('[data-tax-frequency]').forEach(el=>el.addEventListener('change',()=>{
    const t = state.taxObligations.find(x=>x.id===el.dataset.taxFrequency); t.frequency = el.value; queueSave(); render();
  }));
  document.querySelectorAll('[data-tax-dueday]').forEach(el=>el.addEventListener('change',()=>{
    const t = state.taxObligations.find(x=>x.id===el.dataset.taxDueday); t.due_day_of_month = Number(el.value); queueSave();
  }));
  document.querySelectorAll('[data-tax-manualdue]').forEach(el=>el.addEventListener('change',()=>{
    const t = state.taxObligations.find(x=>x.id===el.dataset.taxManualdue); t.manual_next_due_date = el.value; queueSave(); render();
  }));
  document.querySelectorAll('[data-tax-amount]').forEach(el=>el.addEventListener('change',()=>{
    const t = state.taxObligations.find(x=>x.id===el.dataset.taxAmount); t.estimated_amount_kes = Number(el.value); queueSave(); render();
  }));
  document.querySelectorAll('[data-tax-authority]').forEach(el=>el.addEventListener('change',()=>{
    const t = state.taxObligations.find(x=>x.id===el.dataset.taxAuthority); t.filing_authority = el.value; queueSave();
  }));
  document.querySelectorAll('[data-del-tax]').forEach(b=>b.addEventListener('click',()=>{
    state.taxObligations = state.taxObligations.filter(t=>t.id!==b.dataset.delTax); queueSave(); render();
  }));
  const addTax = document.getElementById('btn-add-tax');
  if(addTax) addTax.addEventListener('click', async ()=>{
    const name = await promptDialog('Custom tax type name:'); if(!name) return;
    state.taxObligations.push({id:uid(), tax_type:name, applicable:true, frequency:'Monthly', due_day_of_month:20, manual_next_due_date:'', estimated_amount_kes:0, filing_authority:'KRA', notes:''});
    queueSave(); render();
  });
  const btnLoadTaxIntel = document.getElementById('btn-load-tax-intel');
  if(btnLoadTaxIntel) btnLoadTaxIntel.addEventListener('click', loadTaxIntel);
  const formTaxPeriod = document.getElementById('form-tax-period');
  trackFormDirty(formTaxPeriod);
  if(formTaxPeriod) formTaxPeriod.addEventListener('submit', e=>{
    e.preventDefault();
    clearFormDirty();
    const fd = new FormData(formTaxPeriod);
    withSubmitLock(formTaxPeriod, ()=>createTaxPeriod(fd.get('tax_obligation_id'), fd.get('period_start'), fd.get('period_end'), Number(fd.get('amount_due_kes'))));
  });
  document.querySelectorAll('[data-file-period]').forEach(b=>b.addEventListener('click',()=>withButtonLock(b, ()=>fileTaxPeriod(b.dataset.filePeriod))));
  document.querySelectorAll('[data-pay-period]').forEach(b=>b.addEventListener('click',()=>withButtonLock(b, ()=>recordTaxPayment(b.dataset.payPeriod, b.dataset.periodRemaining))));

  // Dashboard close-month
  const btnClose = document.getElementById('btn-close-month');
  if(btnClose) btnClose.addEventListener('click', ()=>{ confirmCloseMonth = true; render(); });
  const btnCancel = document.getElementById('btn-cancel-close');
  if(btnCancel) btnCancel.addEventListener('click', ()=>{ confirmCloseMonth = false; render(); });
  const btnConfirm = document.getElementById('btn-confirm-close');
  if(btnConfirm) btnConfirm.addEventListener('click', doCloseMonth);
  const btnPrint = document.getElementById('btn-print-report');
  if(btnPrint) btnPrint.addEventListener('click', ()=> window.print());

  // Settings
  const fs = document.getElementById('form-settings');
  if(fs) fs.addEventListener('submit', e=>{
    e.preventDefault(); const fdata = new FormData(fs);
    const p = Number(fdata.get('pct_profit')), o=Number(fdata.get('pct_owner_debt')), t=Number(fdata.get('pct_tax')), x=Number(fdata.get('pct_opex'));
    const errEl = document.getElementById('settings-err');
    if(Math.round((p+o+t+x)*100)/100 !== 100){ errEl.innerHTML = `<div class="err-msg">Percentages must sum to exactly 100% (currently ${p+o+t+x}%).</div>`; return; }
    state.settings.pct_profit=p; state.settings.pct_owner_debt=o; state.settings.pct_tax=t; state.settings.pct_opex=x;
    state.settings.debt_paydown_split_pct = Number(fdata.get('debt_paydown_split_pct'));
    state.settings.monthly_revenue_target_kes = Number(fdata.get('monthly_revenue_target_kes'));
    state.settings.opening_opex_account_balance_kes = Number(fdata.get('opening_opex_account_balance_kes'));
    queueSave(); render();
  });
  document.querySelectorAll('[data-del-category]').forEach(b=>b.addEventListener('click',()=>{
    const name = b.dataset.delCategory;
    if(state.expenses.some(e=>e.category===name)){
      showToast(`Can't remove "${name}" — it's used by existing expenses. Recategorize those first.`, 'error');
      return;
    }
    state.categories = CATS().filter(c=>c!==name);
    queueSave(); render();
  }));
  const addCatSettings = document.getElementById('btn-add-category-settings');
  if(addCatSettings) addCatSettings.addEventListener('click', async ()=>{
    const name = ((await promptDialog('New expense category name:'))||'').trim();
    if(!name) return;
    if(!state.categories) state.categories = DEFAULT_CATEGORIES.slice();
    if(!state.categories.some(c=>c.toLowerCase()===name.toLowerCase())) state.categories.push(name);
    queueSave(); render();
  });
  const btnExport = document.getElementById('btn-export');
  if(btnExport) btnExport.addEventListener('click', ()=>{
    const blob = new Blob([JSON.stringify(state,null,2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'happynet-export.json'; a.click();
    URL.revokeObjectURL(url);
  });
}

/* ---------------- Auth / Boot ---------------- */

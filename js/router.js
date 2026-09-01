/* ---------------- Router / render ---------------- */

const TABS = [
  {id:'dashboard', label:'Dashboard', icon:'dashboard', section:'Core'},
  {id:'executive', label:'Executive Dashboard', icon:'target', headOfficeOnly:true, section:'Core'},

  {id:'daily', label:'Daily Entry', icon:'calendar', section:'Financial Data'},
  {id:'expenses', label:'Expenses', icon:'receipt', section:'Financial Data'},
  {id:'bills', label:'Suppliers & Bills', icon:'briefcase', section:'Financial Data'},
  {id:'debt', label:'Debt Payoff', icon:'trendDown', section:'Financial Data'},
  {id:'tax', label:'Tax Calendar', icon:'landmark', section:'Financial Data'},

  {id:'statements', label:'Financial Statements', icon:'pieChart', section:'Analysis & Reports'},
  {id:'archive', label:'Trend Archive', icon:'history', section:'Analysis & Reports'},
  {id:'reconcile', label:'Reconciliation', icon:'trendUp', section:'Analysis & Reports'},

  {id:'assistant', label:'AI Assistant', icon:'sparkles', section:'Intelligence'},

  {id:'staff', label:'Staff & Access', icon:'handshake', headOfficeOnly:true, section:'Administration'},
  {id:'audit', label:'Audit Log', icon:'history', headOfficeOnly:true, section:'Administration'},
  {id:'settings', label:'Settings', icon:'gear', section:'Administration'},
];
const TAB_SECTIONS = ['Core','Financial Data','Analysis & Reports','Intelligence','Administration'];
function visibleTabs(){ return TABS.filter(t => !t.headOfficeOnly || (state && state.isHeadOffice)); }
let activeTab = 'dashboard';
let flashError = '';
let confirmCloseMonth = false;

// Unsaved-changes tracking — deliberately scoped to the forms that
// represent real typed effort worth protecting (financial-record entry
// forms), not every checkbox/filter in the app. A form is marked dirty
// only on a genuine user 'input' event, never by programmatic value
// assignment (pre-filling from document intelligence, for instance,
// doesn't set the DOM value via a real input event, so it never
// falsely triggers this).
let formIsDirty = false;
function trackFormDirty(formEl){
  if(!formEl) return;
  formEl.addEventListener('input', () => { formIsDirty = true; }, { once: false });
}
function clearFormDirty(){ formIsDirty = false; }
window.addEventListener('beforeunload', (e) => {
  if(formIsDirty){ e.preventDefault(); e.returnValue = ''; }
});

function setTab(id){
  if(id === activeTab) return;
  if(formIsDirty){
    confirmDialog('You have unsaved changes on this page. Leave without saving?').then(ok => {
      if(ok){ formIsDirty = false; setTabConfirmed(id); }
    });
    return;
  }
  setTabConfirmed(id);
}
function setTabConfirmed(id){
  activeTab = id; flashError=''; render(); window.scrollTo(0,0);
  if(id==='dashboard' && !alertsState.alerts && !alertsState.loading) loadAlerts();
  if(id==='executive' && state.isHeadOffice && !executiveState.data && !executiveState.loading) loadExecutive();
  if(id==='executive' && state.isHeadOffice && !decisionQueueState.decisions) loadDecisionQueue();
  if(id==='staff' && state.isHeadOffice && !staffState.branches) loadStaffData();
  if(id==='audit' && state.isHeadOffice && !auditState.entries && !auditState.loading) loadAudit();
  if(id==='statements' && !statementsState.data && !statementsState.loading) loadStatements();
  if(id==='statements' && !periodsState.periods && !periodsState.loading) loadPeriods();
  if(id==='assistant' && !followUpsState.items && !followUpsState.loading) loadFollowUps();
  if(id==='bills' && !billsState.bills && !billsState.loading) loadBills();
  if(id==='reconcile' && !reconcileState.imports && !reconcileState.loading) loadImports();
}

function root(){ return document.getElementById('root'); }

let toasts = []; // {id, message, type:'success'|'error'|'info'}
let toastCounter = 0;
// The toast stack and dialogs render into their own root (#overlay-root,
// outside #root entirely), never through the app's main render() — that
// function tears down and rebuilds the whole current tab from its
// template on every call, which would silently wipe any live,
// uncommitted form input the person is still typing the instant a toast
// or dialog appears. renderOverlay() only ever touches #overlay-root.
function renderOverlay(){
  const el = document.getElementById('overlay-root');
  if(!el) return;
  el.innerHTML = toastAndDialogHtml();
  wireToastAndDialog();
  wirePalette();
}
function showToast(message, type){
  const id = ++toastCounter;
  toasts.push({ id, message, type: type || 'info' });
  renderOverlay();
  setTimeout(()=>{ toasts = toasts.filter(t=>t.id!==id); renderOverlay(); }, 5000);
}
function dismissToast(id){ toasts = toasts.filter(t=>t.id!==id); renderOverlay(); }

// Styled replacements for confirm()/prompt() — resolve like the native
// versions (confirm resolves true/false, prompt resolves a string or
// null), but render as a modal matching the rest of the app instead of a
// blocking, unstyled browser dialog.
let activeDialog = null; // {kind:'confirm'|'prompt', message, defaultValue, resolve}
function confirmDialog(message){
  return new Promise(resolve => {
    activeDialog = { kind:'confirm', message, resolve };
    renderOverlay();
  });
}
function promptDialog(message, defaultValue){
  return new Promise(resolve => {
    activeDialog = { kind:'prompt', message, defaultValue: defaultValue||'', resolve };
    renderOverlay();
  });
}
function resolveDialog(value){
  if(activeDialog){
    activeDialog.resolve(value);
    activeDialog = null;
    renderOverlay();
  }
}
function toastAndDialogHtml(){
  return `
    <div class="toast-stack no-print">
      ${toasts.map(t=>`<div class="toast toast-${t.type}"><span>${t.message}</span><button data-dismiss-toast="${t.id}">&times;</button></div>`).join('')}
    </div>
    ${activeDialog ? `
    <div class="modal-backdrop"><div class="modal" style="max-width:440px;">
      <p style="margin:0 0 16px; font-size:14.5px; line-height:1.5;">${activeDialog.message}</p>
      ${activeDialog.kind==='prompt' ? `<input type="text" id="dialog-input" value="${activeDialog.defaultValue}" style="margin-bottom:16px;" autofocus>` : ''}
      <div style="display:flex; gap:10px; justify-content:flex-end;">
        <button class="btn ghost" id="btn-dialog-cancel">Cancel</button>
        <button class="btn gold" id="btn-dialog-confirm">${activeDialog.kind==='prompt'?'Submit':'Confirm'}</button>
      </div>
    </div></div>` : ''}
    ${paletteOpen ? paletteHtml() : ''}
  `;
}
// Command palette — Cmd/Ctrl+K. Renders through the same independent
// overlay root as toasts/dialogs, for the exact reason discovered while
// building the unsaved-changes warning: anything shown through the main
// render() tears down and rebuilds the current tab from its template,
// silently wiping any live, uncommitted form input. Opening the palette
// must never do that, regardless of what the person was in the middle of
// typing when they hit the shortcut.
let paletteOpen = false, paletteQuery = '', paletteSelectedIndex = 0;
function paletteMatches(){
  const q = paletteQuery.trim().toLowerCase();
  const items = visibleTabs();
  if(!q) return items;
  return items.filter(t => t.label.toLowerCase().includes(q));
}
function openPalette(){
  paletteOpen = true; paletteQuery = ''; paletteSelectedIndex = 0;
  renderOverlay();
  setTimeout(()=>{ const el = document.getElementById('palette-input'); if(el) el.focus(); }, 0);
}
function closePalette(){ paletteOpen = false; renderOverlay(); }
function paletteHtml(){
  return `
    <div class="modal-backdrop" id="palette-backdrop" style="align-items:flex-start; padding-top:12vh;">
      <div class="modal" style="max-width:480px; padding:0; overflow:hidden;">
        <input type="text" id="palette-input" placeholder="Jump to a tab…" value="${paletteQuery}"
          style="border:none; border-bottom:1px solid var(--hair); border-radius:0; padding:16px 18px; font-size:15px;">
        <div id="palette-results" style="max-height:320px; overflow-y:auto; padding:6px;">${paletteResultsHtml()}</div>
        <div style="padding:8px 14px; border-top:1px solid var(--hair); font-size:11.5px; color:var(--muted); display:flex; gap:14px;">
          <span>&uarr;&darr; navigate</span><span>&crarr; select</span><span>esc close</span>
        </div>
      </div>
    </div>`;
}
function paletteResultsHtml(){
  const matches = paletteMatches();
  return matches.length===0 ? `<div style="padding:14px 12px; color:var(--muted); font-size:13.5px;">No matching tab.</div>` : matches.map((t,i)=>`
    <div data-palette-item="${t.id}" style="display:flex; align-items:center; gap:10px; padding:10px 12px; border-radius:8px; cursor:pointer; ${i===paletteSelectedIndex?'background:var(--neutral-soft);':''}">
      ${ic(t.icon,16)}<span>${t.label}</span>
    </div>`).join('');
}
// Re-renders ONLY the results list, never the palette's own <input> — the
// exact same lesson as the unsaved-changes fix, just discovered a second
// time inside the palette itself: regenerating the whole overlay on every
// keystroke destroys and recreates the focused input element, losing
// focus (and the cursor) after the very first character typed.
function updatePaletteResults(){
  const el = document.getElementById('palette-results');
  if(el){ el.innerHTML = paletteResultsHtml(); wirePaletteResultClicks(); }
}
function wirePaletteResultClicks(){
  document.querySelectorAll('[data-palette-item]').forEach(el=>el.addEventListener('click', ()=>{
    const id = el.dataset.paletteItem; closePalette(); setTab(id);
  }));
}
function wirePalette(){
  const input = document.getElementById('palette-input');
  if(input) input.addEventListener('input', ()=>{ paletteQuery = input.value; paletteSelectedIndex = 0; updatePaletteResults(); });
  wirePaletteResultClicks();
  const backdrop = document.getElementById('palette-backdrop');
  if(backdrop) backdrop.addEventListener('click', (e)=>{ if(e.target === backdrop) closePalette(); });
}
document.addEventListener('keydown', (e)=>{
  const isCmdK = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
  if(isCmdK){
    e.preventDefault();
    if(paletteOpen) closePalette(); else openPalette();
    return;
  }
  if(!paletteOpen) return;
  if(e.key === 'Escape'){ e.preventDefault(); closePalette(); }
  else if(e.key === 'ArrowDown'){ e.preventDefault(); paletteSelectedIndex = Math.min(paletteSelectedIndex+1, paletteMatches().length-1); updatePaletteResults(); }
  else if(e.key === 'ArrowUp'){ e.preventDefault(); paletteSelectedIndex = Math.max(paletteSelectedIndex-1, 0); updatePaletteResults(); }
  else if(e.key === 'Enter'){
    e.preventDefault();
    const matches = paletteMatches();
    const chosen = matches[paletteSelectedIndex];
    if(chosen){ closePalette(); setTab(chosen.id); }
  }
});
function wireToastAndDialog(){
  document.querySelectorAll('[data-dismiss-toast]').forEach(b=>b.addEventListener('click',()=>dismissToast(Number(b.dataset.dismissToast))));
  const btnCancel = document.getElementById('btn-dialog-cancel');
  if(btnCancel) btnCancel.addEventListener('click', ()=> resolveDialog(activeDialog.kind==='prompt' ? null : false));
  const btnConfirm = document.getElementById('btn-dialog-confirm');
  if(btnConfirm) btnConfirm.addEventListener('click', ()=>{
    if(activeDialog.kind==='prompt'){
      const input = document.getElementById('dialog-input');
      resolveDialog(input ? input.value : '');
    } else {
      resolveDialog(true);
    }
  });
  const dialogInput = document.getElementById('dialog-input');
  if(dialogInput) dialogInput.addEventListener('keydown', e=>{ if(e.key==='Enter'){ e.preventDefault(); btnConfirm.click(); } });
}

// Disables a form's submit button for the duration of an async operation
// — a purely mechanical safety net against double-submission (two fast
// clicks creating two financial records) that never touches what the
// operation itself does. Restoring the button's text/state in `finally`
// is mostly a formality (a subsequent render() typically replaces the DOM
// anyway), but covers the cases where it doesn't.
async function withSubmitLock(form, asyncFn){
  const btn = form.querySelector('button[type=submit]');
  const originalText = btn ? btn.innerHTML : null;
  if(btn){ btn.disabled = true; btn.innerHTML = 'Saving…'; }
  try{
    await asyncFn();
  } finally {
    if(btn && document.body.contains(btn)){ btn.disabled = false; btn.innerHTML = originalText; }
  }
}
// Same idea, for a standalone action button (Approve, Pay, Import) rather
// than a <form>'s submit button.
async function withButtonLock(btn, asyncFn){
  if(!btn){ await asyncFn(); return; }
  const originalText = btn.innerHTML;
  btn.disabled = true; btn.innerHTML = 'Working…';
  try{
    await asyncFn();
  } finally {
    if(document.body.contains(btn)){ btn.disabled = false; btn.innerHTML = originalText; }
  }
}

function render(){
  const r = root();
  let d = null;
  try{ d = dashboardData(); }catch(e){ d = null; }
  const tabs = visibleTabs();
  r.innerHTML = `
    <div class="app">
      <div class="sidebar no-print">
        <div class="brand">
          <div class="brand-mark">${ic('sparkles',18)}</div>
          <div class="brand-text">happy<span class="accent">net</span><span class="sublabel">Profit First</span></div>
        </div>
        <button id="btn-open-palette" style="all:unset; cursor:pointer; display:flex; align-items:center; justify-content:space-between; gap:8px; margin:0 6px 16px; padding:8px 12px; border-radius:8px; background:rgba(255,255,255,.06); color:#8C93A6; font-size:12.5px;">
          <span style="display:flex; align-items:center; gap:8px;">${ic('sparkles',13)} Jump to…</span>
          <span style="font-family:'IBM Plex Mono',monospace; font-size:11px; padding:2px 6px; border-radius:4px; background:rgba(255,255,255,.08);">⌘K</span>
        </button>

        ${state.allBranches && state.allBranches.length > 1 ? `
        <div class="branch-switch">
          <select id="branch-select">
            ${state.allBranches.map(b=>`<option value="${b.branch_id}" ${b.branch_id===state.branchId?'selected':''}>${b.name}</option>`).join('')}
          </select>
        </div>` : ''}

        <nav>${TAB_SECTIONS.map(section=>{
          const sectionTabs = tabs.filter(t=>t.section===section);
          if(!sectionTabs.length) return '';
          return `<div class="nav-section"><div class="nav-section-label">${section}</div>${sectionTabs.map(t=>`<button data-tab="${t.id}" class="${activeTab===t.id?'active':''}">${ic(t.icon,17)}<span>${t.label}</span>${t.id==='audit' && syncHealthState.count>0 ? `<span class="tag alert" style="margin-left:auto; padding:1px 7px;" title="${syncHealthState.count} unresolved ledger sync issue(s)">${syncHealthState.count}</span>` : ''}</button>`).join('')}</div>`;
        }).join('')}</nav>

        <div class="sidebar-widget">
          <div class="sidebar-widget-head"><span>${monthLabel(currentOpenMonth())}</span><span class="tag neutral" style="font-size:10px;">Open</span></div>
          ${d ? `
          <div class="mini-progress">
            <div class="mini-progress-row"><span>Revenue pace</span><b>${d.revenuePacePct.toFixed(0)}%</b></div>
            <div class="mini-progress-track"><div class="mini-progress-fill" style="width:${Math.min(100,d.revenuePacePct)}%; background:var(--gold);"></div></div>
            <div class="mini-progress-row" style="margin-top:9px;"><span>OpEx used</span><b>${d.opexPacePct.toFixed(0)}%</b></div>
            <div class="mini-progress-track"><div class="mini-progress-fill" style="width:${Math.min(100,d.opexPacePct)}%; background:${d.overspent?'var(--alert)':'var(--good)'};"></div></div>
          </div>` : ''}
        </div>

        <div class="sidebar-foot">
          <div id="save-badge" class="save-badge"></div>
          <div class="profile-chip">
            <div class="profile-avatar">${(currentUserEmail||'?').charAt(0).toUpperCase()}</div>
            <div class="profile-info">
              <div class="profile-email">${currentUserEmail||''}</div>
              <div class="profile-role">${state && state.role ? state.role.replace(/_/g,' ') : ''}</div>
            </div>
            <button id="btn-theme-toggle" title="${document.documentElement.getAttribute('data-theme')==='dark'?'Switch to light mode':'Switch to dark mode'}">${ic(document.documentElement.getAttribute('data-theme')==='dark'?'sun':'moon',16)}</button>
            <button id="btn-sign-out" title="Sign out">${ic('logout',16)}</button>
          </div>
        </div>
      </div>
      <div class="main" id="main"></div>
    </div>
    <div class="mobile-tabs no-print">${tabs.map(t=>`<button data-tab="${t.id}" class="${activeTab===t.id?'active':''}">${t.label}</button>`).join('')}</div>
  `;
  r.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', ()=>setTab(b.dataset.tab)));
  const branchSelect = document.getElementById('branch-select');
  if(branchSelect) branchSelect.addEventListener('change', ()=>{
    const newValue = branchSelect.value;
    if(formIsDirty){
      confirmDialog('You have unsaved changes on this page. Switch branches without saving?').then(ok=>{
        if(ok){ formIsDirty = false; switchBranch(newValue); }
        else { branchSelect.value = state.branchId; } // revert the dropdown — we're staying put
      });
    } else {
      switchBranch(newValue);
    }
  });
  const themeToggleBtn = document.getElementById('btn-theme-toggle');
  const btnOpenPalette = document.getElementById('btn-open-palette');
  if(btnOpenPalette) btnOpenPalette.addEventListener('click', openPalette);
  if(themeToggleBtn) themeToggleBtn.addEventListener('click', toggleTheme);
  const signOutBtn = document.getElementById('btn-sign-out');
  if(signOutBtn) signOutBtn.addEventListener('click', async ()=>{ await apiLogout(); location.reload(); });
  renderSaveBadge();
  renderMain();
}

// A broken view function shouldn't leave the whole tab blank with no way
// out — this catches it, logs the real error to the console (never
// swallowed), and shows a plain recovery option while the sidebar/nav
// stays fully usable so the person can switch to a different tab instead
// of being stuck.
function renderMain(){
  try{
    renderMainUnsafe();
  }catch(e){
    console.error('Error rendering the current tab:', e);
    const m = document.getElementById('main');
    if(m){
      m.innerHTML = `
        <div class="card" style="max-width:520px; margin-top:40px;">
          <h3 style="margin-top:0;">Something went wrong showing this page</h3>
          <p class="hint">The rest of the app is unaffected — try another tab from the sidebar, or reload.</p>
          <button class="btn gold" id="btn-error-reload" style="margin-top:10px;">Reload</button>
        </div>`;
      const btnReload = document.getElementById('btn-error-reload');
      if(btnReload) btnReload.addEventListener('click', ()=>location.reload());
    }
  }
}
function renderMainUnsafe(){
  const m = document.getElementById('main');
  if(activeTab==='dashboard') m.innerHTML = viewDashboard();
  if(activeTab==='daily') m.innerHTML = viewDaily();
  if(activeTab==='expenses') m.innerHTML = viewExpenses();
  if(activeTab==='debt') m.innerHTML = viewDebt();
  if(activeTab==='tax') m.innerHTML = viewTax();
  if(activeTab==='statements') m.innerHTML = viewStatements();
  if(activeTab==='bills') m.innerHTML = viewBills();
  if(activeTab==='reconcile') m.innerHTML = viewReconcile();
  if(activeTab==='archive') m.innerHTML = viewArchive();
  if(activeTab==='assistant') m.innerHTML = viewAssistant();
  if(activeTab==='executive') m.innerHTML = state.isHeadOffice ? viewExecutive() : viewDashboard();
  if(activeTab==='staff') m.innerHTML = state.isHeadOffice ? viewStaff() : viewDashboard();
  if(activeTab==='audit') m.innerHTML = state.isHeadOffice ? viewAudit() : viewDashboard();
  if(activeTab==='settings') m.innerHTML = viewSettings();
  wireTab();
  if(activeTab==='staff' && state.isHeadOffice) wireStaffTab();
  if(activeTab==='archive') drawArchiveCharts();
  if(activeTab==='archive'){
    const btnCompare = document.getElementById('btn-load-branch-compare');
    if(btnCompare) btnCompare.addEventListener('click', loadBranchCompare);
    const btnXlsx = document.getElementById('btn-export-archive-xlsx');
    if(btnXlsx) btnXlsx.addEventListener('click', exportArchiveXlsx);
  }
  if(activeTab==='statements'){
    const periodTypeSelect = document.getElementById('statements-period-type');
    if(periodTypeSelect) periodTypeSelect.addEventListener('change', ()=>{
      loadStatements(defaultPeriodFor(periodTypeSelect.value), periodTypeSelect.value, statementsState.compareEnabled);
    });
    const periodInput = document.getElementById('statements-period');
    if(periodInput) periodInput.addEventListener('change', ()=> loadStatements(periodInput.value, statementsState.periodType));
    const periodQuarter = document.getElementById('statements-period-quarter');
    const periodYear = document.getElementById('statements-period-year');
    const reloadQuarter = () => {
      if(periodQuarter && periodYear && periodYear.value) loadStatements(`${periodYear.value}-Q${periodQuarter.value}`, 'quarter');
    };
    if(periodQuarter) periodQuarter.addEventListener('change', reloadQuarter);
    if(periodYear) periodYear.addEventListener('change', reloadQuarter);
    const compareToggle = document.getElementById('statements-compare-toggle');
    if(compareToggle) compareToggle.addEventListener('change', ()=> loadStatements(statementsState.period, statementsState.periodType, compareToggle.checked));
    const btnLoadConsolidated = document.getElementById('btn-load-consolidated');
    if(btnLoadConsolidated) btnLoadConsolidated.addEventListener('click', ()=> loadConsolidated(statementsState.period, statementsState.periodType));
    const btnPdf = document.getElementById('btn-export-statements-pdf');
    if(btnPdf) btnPdf.addEventListener('click', ()=> downloadViaApi(`/api/financial-statements-export?branch_id=${state.branchId}&period=${statementsState.period}&period_type=${statementsState.periodType}&format=pdf`, `happynet-statements-${statementsState.period}.pdf`));
    const btnXls = document.getElementById('btn-export-statements-xls');
    if(btnXls) btnXls.addEventListener('click', ()=> downloadViaApi(`/api/financial-statements-export?branch_id=${state.branchId}&period=${statementsState.period}&period_type=${statementsState.periodType}&format=xls`, `happynet-statements-${statementsState.period}.xls`));
    const btnCsv = document.getElementById('btn-export-statements-csv');
    if(btnCsv) btnCsv.addEventListener('click', ()=> downloadViaApi(`/api/financial-statements-export?branch_id=${state.branchId}&period=${statementsState.period}&period_type=${statementsState.periodType}&format=csv`, `happynet-statements-${statementsState.period}.csv`));
    const btnClosePeriod = document.getElementById('btn-close-period');
    if(btnClosePeriod) btnClosePeriod.addEventListener('click', openClosePreflight);
    const btnCancelClose = document.getElementById('btn-cancel-close-period');
    if(btnCancelClose) btnCancelClose.addEventListener('click', closeClosePreflight);
    const btnConfirmClose = document.getElementById('btn-confirm-close-period');
    if(btnConfirmClose) btnConfirmClose.addEventListener('click', confirmClosePeriod);
    document.querySelectorAll('[data-reopen-period]').forEach(b=>b.addEventListener('click',()=>reopenPeriod(b.dataset.reopenPeriod)));
  }
  if(activeTab==='bills'){
    const formSupplier = document.getElementById('form-add-supplier');
    trackFormDirty(formSupplier);
    if(formSupplier) formSupplier.addEventListener('submit', e=>{
      e.preventDefault();
      clearFormDirty();
      const fd = new FormData(formSupplier);
      withSubmitLock(formSupplier, ()=>addSupplier(fd.get('name'), fd.get('contact'), fd.get('kra_pin')));
    });
    document.querySelectorAll('[data-view-statement]').forEach(el=>el.addEventListener('click',()=>loadSupplierStatement(el.dataset.viewStatement)));
    const btnCloseStatement = document.getElementById('btn-close-statement');
    if(btnCloseStatement) btnCloseStatement.addEventListener('click', ()=>{ billsState.statement=null; render(); });
    const supplierDocUpload = document.getElementById('supplier-doc-upload');
    if(supplierDocUpload) supplierDocUpload.addEventListener('change', (ev)=> uploadSupplierDocument(billsState.statement.supplierId, ev.target.files[0]));
    const formBill = document.getElementById('form-add-bill');
    trackFormDirty(formBill);
    if(formBill) formBill.addEventListener('submit', e=>{
      e.preventDefault();
      clearFormDirty();
      docIntelState = { loading:false, result:null, error:null, context:null }; // clear so the next "log a bill" starts fresh
      const fd = new FormData(formBill);
      withSubmitLock(formBill, ()=>addBill({
        supplier_id: fd.get('supplier_id'), invoice_number: fd.get('invoice_number'),
        invoice_date: fd.get('invoice_date'), due_date: fd.get('due_date') || null,
        category_name: fd.get('category_id'),
        subtotal_kes: Number(fd.get('subtotal_kes')), tax_kes: Number(fd.get('tax_kes')||0)
      }));
    });
    const docIntelUploadBill = document.getElementById('doc-intel-upload-bill');
    if(docIntelUploadBill) docIntelUploadBill.addEventListener('change', (ev) => extractFromReceipt(ev.target.files[0], 'bill'));
    document.querySelectorAll('[data-approve-bill]').forEach(b=>b.addEventListener('click',()=>withButtonLock(b, ()=>approveBill(b.dataset.approveBill))));
    document.querySelectorAll('[data-pay-bill]').forEach(b=>b.addEventListener('click',()=>withButtonLock(b, ()=>payBill(b.dataset.payBill, b.dataset.billTotal, b.dataset.billOutstanding))));
  }
  if(activeTab==='reconcile'){
    const statementDocUpload = document.getElementById('statement-doc-upload');
    if(statementDocUpload) statementDocUpload.addEventListener('change', (ev)=> extractStatementDocument(ev.target.files[0]));
    const btnCreate = document.getElementById('btn-create-import');
    if(btnCreate) btnCreate.addEventListener('click', ()=>{
      const label = document.getElementById('recon-label').value;
      const account = document.getElementById('recon-account').value;
      const start = document.getElementById('recon-start').value;
      const end = document.getElementById('recon-end').value;
      const text = document.getElementById('recon-lines').value;
      if(!label || !start || !end){ showToast('Label, period start, and period end are required.', 'error'); return; }
      statementExtractState = { loading:false, result:null, error:null }; // clear so the next import starts fresh
      withButtonLock(btnCreate, ()=>createImport(label, account, start, end, text));
    });
    document.querySelectorAll('[data-open-import]').forEach(b=>b.addEventListener('click',()=>openImport(b.dataset.openImport)));
    const btnBack = document.getElementById('btn-back-to-imports');
    if(btnBack) btnBack.addEventListener('click', ()=>{ reconcileState.current=null; reconcileState.lines=null; render(); });
    document.querySelectorAll('[data-match-line]').forEach(b=>b.addEventListener('click',()=>resolveLine(b.dataset.matchLine,'match',b.dataset.matchTxn)));
    document.querySelectorAll('[data-exclude-line]').forEach(b=>b.addEventListener('click',()=>resolveLine(b.dataset.excludeLine,'exclude')));
    const btnSubmit = document.getElementById('btn-submit-import');
    if(btnSubmit) btnSubmit.addEventListener('click', submitImport);
    const btnApprove = document.getElementById('btn-approve-import');
    if(btnApprove) btnApprove.addEventListener('click', approveImport);
  }
  const btnRunScenario = document.getElementById('btn-run-scenario');
  if(btnRunScenario) btnRunScenario.addEventListener('click', runScenario);

  const btnAddDecision = document.getElementById('btn-add-decision');
  if(btnAddDecision) btnAddDecision.addEventListener('click', ()=>openDecisionForm());
  document.querySelectorAll('[data-track-decision]').forEach(b=>b.addEventListener('click', ()=>{
    openDecisionForm({ title: b.dataset.riskMessage, priority: b.dataset.riskLevel === 'critical' ? 'critical' : 'high' });
  }));
  const btnCancelDecision = document.getElementById('btn-cancel-decision');
  if(btnCancelDecision) btnCancelDecision.addEventListener('click', closeDecisionForm);
  const formAddDecision = document.getElementById('form-add-decision');
  if(formAddDecision) formAddDecision.addEventListener('submit', e=>{
    e.preventDefault();
    const fd = new FormData(formAddDecision);
    addDecision({
      title: fd.get('title'), priority: fd.get('priority'), owner_name: fd.get('owner_name'),
      due_date: fd.get('due_date') || null, description: fd.get('description'),
      source: decisionQueueState.prefill ? 'risk_flag' : 'manual'
    });
  });
  document.querySelectorAll('[data-decision-status]').forEach(b=>b.addEventListener('click', ()=>setDecisionStatus(b.dataset.decisionStatus, b.dataset.newStatus)));
}

/* ---------------- DASHBOARD ---------------- */

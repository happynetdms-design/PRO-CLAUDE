const KES = n => 'KES ' + Math.round(n||0).toLocaleString('en-KE');
const KES0 = n => Math.round(n||0).toLocaleString('en-KE');
// Generic client-side pagination — keyed per table so each list (Expenses,
// Audit Log, etc.) remembers its own page independently. Deliberately
// simple: slice-after-everything-else, so it's applied only to what
// actually gets rendered in a table body, never to a total/sum that was
// already computed from the full filtered set beforehand.
const paginationState = {};
function getPagination(key, pageSize){
  if(!paginationState[key]) paginationState[key] = { page: 1, pageSize: pageSize || 25 };
  return paginationState[key];
}
function paginateRows(key, rows, pageSize){
  const p = getPagination(key, pageSize);
  const totalPages = Math.max(1, Math.ceil(rows.length / p.pageSize));
  if(p.page > totalPages) p.page = totalPages; // filters just narrowed the set — don't strand on an empty page
  const start = (p.page - 1) * p.pageSize;
  return { pageRows: rows.slice(start, start + p.pageSize), page: p.page, totalPages, totalCount: rows.length, start: rows.length ? start+1 : 0, end: Math.min(start + p.pageSize, rows.length) };
}
function paginationControlsHtml(key, info){
  if(info.totalCount === 0) return '';
  return `
    <div style="display:flex; align-items:center; justify-content:space-between; padding:10px 4px; font-size:12.5px; color:var(--muted);">
      <span>Showing ${info.start}–${info.end} of ${info.totalCount}</span>
      <div style="display:flex; gap:6px; align-items:center;">
        <button class="btn ghost sm" data-page-prev="${key}" ${info.page<=1?'disabled':''}>&larr; Prev</button>
        <span>Page ${info.page} of ${info.totalPages}</span>
        <button class="btn ghost sm" data-page-next="${key}" ${info.page>=info.totalPages?'disabled':''}>Next &rarr;</button>
      </div>
    </div>`;
}
function wirePaginationControls(){
  document.querySelectorAll('[data-page-prev]').forEach(b=>b.addEventListener('click', ()=>{
    const p = getPagination(b.dataset.pagePrev); if(p.page>1){ p.page--; render(); }
  }));
  document.querySelectorAll('[data-page-next]').forEach(b=>b.addEventListener('click', ()=>{
    const p = getPagination(b.dataset.pageNext); p.page++; render();
  }));
}
// Generic client-side table sorting — same "keyed per table" pattern as
// pagination, and deliberately composes with it: sort the full filtered
// set FIRST, then hand the result to paginateRows(), so sorting a column
// re-orders which rows land on which page rather than only sorting
// within a single visible page.
const sortState = {};
function getSort(key, defaultSortKey, defaultDir){
  if(!sortState[key]) sortState[key] = { sortKey: defaultSortKey, dir: defaultDir || 'asc' };
  return sortState[key];
}
function sortRows(key, rows, valueFn, defaultSortKey, defaultDir){
  const s = getSort(key, defaultSortKey, defaultDir);
  const sorted = rows.slice().sort((a,b)=>{
    const av = valueFn(a, s.sortKey), bv = valueFn(b, s.sortKey);
    if(av < bv) return s.dir === 'asc' ? -1 : 1;
    if(av > bv) return s.dir === 'asc' ? 1 : -1;
    return 0;
  });
  return sorted;
}
function sortableHeaderHtml(label, columnKey, tableKey){
  const s = getSort(tableKey);
  const active = s.sortKey === columnKey;
  const arrow = active ? (s.dir === 'asc' ? ' ▲' : ' ▼') : '';
  return `<th data-sort-header="${tableKey}" data-sort-key="${columnKey}" style="cursor:pointer; user-select:none;" title="Sort by ${label}">${label}${arrow}</th>`;
}
function wireSortableHeaders(){
  document.querySelectorAll('[data-sort-header]').forEach(th=>th.addEventListener('click', ()=>{
    const tableKey = th.dataset.sortHeader, columnKey = th.dataset.sortKey;
    const s = getSort(tableKey);
    if(s.sortKey === columnKey){ s.dir = s.dir === 'asc' ? 'desc' : 'asc'; }
    else { s.sortKey = columnKey; s.dir = 'asc'; }
    render();
  }));
}
const todayISO = () => new Date().toISOString().slice(0,10);
const monthKey = d => d.slice(0,7); // YYYY-MM from YYYY-MM-DD
const monthLabel = ym => { const [y,m]=ym.split('-').map(Number); return new Date(y,m-1,1).toLocaleString('en-US',{month:'long',year:'numeric'}); };
const daysInMonth = ym => { const [y,m]=ym.split('-').map(Number); return new Date(y,m,0).getDate(); };
// Real UUIDs now (previously a short random string) so a record's id never
// changes between being created locally and being persisted — the backend
// tables use uuid primary keys and accept a client-supplied one on create.
const uid = () => (crypto.randomUUID ? crypto.randomUUID() :
  'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random()*16|0, v = c==='x'?r:(r&0x3|0x8); return v.toString(16);
  }));

const DEFAULT_CATEGORIES = ['Inventory','Electricity','Internet & Bandwidth','Fuel','Payroll','Rent','Reimbursement','Commission','Transport','Repairs','Welfare','Office Supplies','Marketing','Other'];
// state.categories is the live, editable list (Settings > add/remove). This is a fallback getter.
function CATS(){ return (state && state.categories && state.categories.length) ? state.categories : DEFAULT_CATEGORIES; }
const ACCOUNTS = ['M-Pesa Till','Bank Account','Petty Cash','Owner Personal Wallet'];
const TAX_TYPES = ['VAT','PAYE','NSSF','SHIF','Withholding Tax','Turnover Tax','Installment Tax','Single Business Permit','NITA Levy'];

function defaultState(){
  const johnLoanId = uid(), saccoLoanId = uid();
  return {
    dailyRevenue: [
      {id:uid(), date:"2026-07-01", revenue_kes:43123.0, notes:""},
      {id:uid(), date:"2026-07-02", revenue_kes:22490.0, notes:""},
      {id:uid(), date:"2026-07-03", revenue_kes:28535.0, notes:""},
      {id:uid(), date:"2026-07-04", revenue_kes:35529.0, notes:""},
      {id:uid(), date:"2026-07-05", revenue_kes:40469.0, notes:""},
      {id:uid(), date:"2026-07-06", revenue_kes:35102.0, notes:""},
      {id:uid(), date:"2026-07-07", revenue_kes:37239.0, notes:""},
      {id:uid(), date:"2026-07-08", revenue_kes:46207.0, notes:""},
      {id:uid(), date:"2026-07-09", revenue_kes:29070.0, notes:""},
      {id:uid(), date:"2026-07-10", revenue_kes:23828.0, notes:""},
      {id:uid(), date:"2026-07-11", revenue_kes:25110.0, notes:""},
      {id:uid(), date:"2026-07-12", revenue_kes:23362.0, notes:""},
      {id:uid(), date:"2026-07-13", revenue_kes:33825.0, notes:""},
      {id:uid(), date:"2026-07-14", revenue_kes:31100.0, notes:""},
      {id:uid(), date:"2026-07-15", revenue_kes:21113.0, notes:""},
      {id:uid(), date:"2026-07-16", revenue_kes:20767.0, notes:""},
      {id:uid(), date:"2026-07-17", revenue_kes:33475.0, notes:""},
      {id:uid(), date:"2026-07-18", revenue_kes:34207.0, notes:""},
      {id:uid(), date:"2026-07-19", revenue_kes:31669.0, notes:""},
      {id:uid(), date:"2026-07-20", revenue_kes:29808.0, notes:""},
      {id:uid(), date:"2026-07-21", revenue_kes:21782.0, notes:""},
      {id:uid(), date:"2026-07-22", revenue_kes:26611.0, notes:""},
      {id:uid(), date:"2026-07-23", revenue_kes:62401.0, notes:""},
      {id:uid(), date:"2026-07-24", revenue_kes:29224.0, notes:""},
      {id:uid(), date:"2026-07-25", revenue_kes:24830.0, notes:""},
      {id:uid(), date:"2026-07-26", revenue_kes:28111.0, notes:""},
      {id:uid(), date:"2026-07-27", revenue_kes:25590.0, notes:""}
    ],
    expenses: [
      {id:uid(), date:"2026-07-01", txn_ref:"UG1KQA8LWO", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1300.0, charges_kes:20.0, owner_funded:false},
      {id:uid(), date:"2026-07-01", txn_ref:"UG1TC59C4P", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-01", txn_ref:"UG1RL9MHOQ", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:12000.0, charges_kes:60.0, owner_funded:false},
      {id:uid(), date:"2026-07-01", txn_ref:"UG1KQA7URE", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:2780.0, charges_kes:40.0, owner_funded:false},
      {id:uid(), date:"2026-07-01", txn_ref:"UG16C99G49", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:3600.0, charges_kes:40.0, owner_funded:false},
      {id:uid(), date:"2026-07-01", txn_ref:"UG16C98L8Y", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:20.0, owner_funded:false},
      {id:uid(), date:"2026-07-01", txn_ref:"UG1TC59AU4", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:63500.0, charges_kes:127.0, owner_funded:false},
      {id:uid(), date:"2026-07-01", txn_ref:"UG1TC59134", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-01", txn_ref:"UG17MA0F81", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:5000.0, charges_kes:40.0, owner_funded:false},
      {id:uid(), date:"2026-07-01", txn_ref:"UG1HR9WRIS", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:200.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-01", txn_ref:"UG1TC59BYI", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:60.0, charges_kes:3.0, owner_funded:false},
      {id:uid(), date:"2026-07-01", txn_ref:"UG1TC599Z5", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:60.0, charges_kes:3.0, owner_funded:false},
      {id:uid(), date:"2026-07-01", txn_ref:"UG16C98MIQ", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1010.0, charges_kes:20.0, owner_funded:false},
      {id:uid(), date:"2026-07-02", txn_ref:"UG2LA9OVWF", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:50.0, charges_kes:0.0, owner_funded:false},
      {id:uid(), date:"2026-07-02", txn_ref:"UG2KQACMF2", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1300.0, charges_kes:20.0, owner_funded:false},
      {id:uid(), date:"2026-07-02", txn_ref:"UG2TC5C74M", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-02", txn_ref:"UG28W9PR7B", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:12.0, owner_funded:false},
      {id:uid(), date:"2026-07-02", txn_ref:"UG2MJA9N42", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:2000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-02", txn_ref:"UG2LA9OUCT", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:60.0, charges_kes:0.0, owner_funded:false},
      {id:uid(), date:"2026-07-02", txn_ref:"UG3CEA6POQ", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:200.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-02", txn_ref:"UG36C9GDP3", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:100.0, charges_kes:0.0, owner_funded:false},
      {id:uid(), date:"2026-07-02", txn_ref:"UG2JCA370A", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:70.0, charges_kes:0.0, owner_funded:false},
      {id:uid(), date:"2026-07-03", txn_ref:"UG3TC5DU0T", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-03", txn_ref:"UG356A7KVT", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:300.0, charges_kes:0.0, owner_funded:false},
      {id:uid(), date:"2026-07-03", txn_ref:"UG3TC5DZIT", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:6700.0, charges_kes:66.0, owner_funded:false},
      {id:uid(), date:"2026-07-03", txn_ref:"UG3KQAGCLF", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:8130.0, charges_kes:55.0, owner_funded:false},
      {id:uid(), date:"2026-07-03", txn_ref:"UG36MAHH4Y", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:500.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-03", txn_ref:"UG3TC5DKCG", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-04", txn_ref:"UG4TC5G9TB", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:320.0, charges_kes:15.0, owner_funded:false},
      {id:uid(), date:"2026-07-04", txn_ref:"UG46C9MAT5", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1300.0, charges_kes:20.0, owner_funded:false},
      {id:uid(), date:"2026-07-04", txn_ref:"UG4TC5GB36", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1500.0, charges_kes:28.0, owner_funded:false},
      {id:uid(), date:"2026-07-04", txn_ref:"UG4TC5FT9D", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-04", txn_ref:"UG42ZACSPE", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:750.0, charges_kes:12.0, owner_funded:false},
      {id:uid(), date:"2026-07-04", txn_ref:"UG4TC5F76S", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:600.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-04", txn_ref:"UG4TC5GDH0", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:32.0, charges_kes:2.0, owner_funded:false},
      {id:uid(), date:"2026-07-05", txn_ref:"UG52ZAKXRT", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:500.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-05", txn_ref:"UG5TC5I9Q9", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:2000.0, charges_kes:35.0, owner_funded:false},
      {id:uid(), date:"2026-07-05", txn_ref:"UG5TC5I09S", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-05", txn_ref:"UG54HATEFC", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:3000.0, charges_kes:40.0, owner_funded:false},
      {id:uid(), date:"2026-07-05", txn_ref:"UG5LYA81GL", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1500.0, charges_kes:20.0, owner_funded:false},
      {id:uid(), date:"2026-07-06", txn_ref:"UG6TC5KYTJ", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-06", txn_ref:"UG6TC5KHH5", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-06", txn_ref:"UG656ALP5S", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:300.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-06", txn_ref:"UG66C9UAA8", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:400.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-06", txn_ref:"UG6TC5KHWF", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:300.0, charges_kes:3.0, owner_funded:false},
      {id:uid(), date:"2026-07-06", txn_ref:"UG6TC5JOZ0", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-06", txn_ref:"UG6TC5JB3B", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-06", txn_ref:"UG62ZAL49Y", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:12.0, owner_funded:false},
      {id:uid(), date:"2026-07-06", txn_ref:"UG6KLAGF24", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:4500.0, charges_kes:40.0, owner_funded:false},
      {id:uid(), date:"2026-07-06", txn_ref:"UG694ACF03", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:16000.0, charges_kes:60.0, owner_funded:false},
      {id:uid(), date:"2026-07-06", txn_ref:"UG64HATKHH", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:16000.0, charges_kes:60.0, owner_funded:false},
      {id:uid(), date:"2026-07-06", txn_ref:"UG6K1ABXQ8", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:14000.0, charges_kes:60.0, owner_funded:false},
      {id:uid(), date:"2026-07-07", txn_ref:"UG7RLACENM", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:200.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-07", txn_ref:"UG714AH4FY", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:5000.0, charges_kes:40.0, owner_funded:false},
      {id:uid(), date:"2026-07-07", txn_ref:"UG76C9X25L", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1630.0, charges_kes:30.0, owner_funded:false},
      {id:uid(), date:"2026-07-07", txn_ref:"UG7JSAAUO9", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:100.0, charges_kes:0.0, owner_funded:false},
      {id:uid(), date:"2026-07-07", txn_ref:"UG7MMALFMS", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:0.0, owner_funded:false},
      {id:uid(), date:"2026-07-07", txn_ref:"UG7FKALXII", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:3000.0, charges_kes:12.0, owner_funded:false},
      {id:uid(), date:"2026-07-07", txn_ref:"UG7A1ALE81", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:12.0, owner_funded:false},
      {id:uid(), date:"2026-07-07", txn_ref:"UG79DANW29", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:12.0, owner_funded:false},
      {id:uid(), date:"2026-07-08", txn_ref:"UG856AU9IU", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:16500.0, charges_kes:60.0, owner_funded:false},
      {id:uid(), date:"2026-07-08", txn_ref:"UG8ONB223I", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:2000.0, charges_kes:30.0, owner_funded:false},
      {id:uid(), date:"2026-07-08", txn_ref:"UG8R8AI4QN", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:30000.0, charges_kes:60.0, owner_funded:false},
      {id:uid(), date:"2026-07-08", txn_ref:"UG8KRAVSYC", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:150.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-08", txn_ref:"UG8LDA7UPN", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:100.0, charges_kes:0.0, owner_funded:false},
      {id:uid(), date:"2026-07-08", txn_ref:"UG8TC5O3TJ", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-08", txn_ref:"UG83TB0M9H", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:80.0, charges_kes:0.0, owner_funded:false},
      {id:uid(), date:"2026-07-09", txn_ref:"UG9KRAZQEA", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:500.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-09", txn_ref:"UG9TC5QOWC", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-09", txn_ref:"UG9TC5QPPX", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-09", txn_ref:"UG9TC5QPN3", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-09", txn_ref:"UG9KQB5NQG", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:3920.0, charges_kes:40.0, owner_funded:false},
      {id:uid(), date:"2026-07-10", txn_ref:"UGALYAPKU6", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:13500.0, charges_kes:60.0, owner_funded:false},
      {id:uid(), date:"2026-07-10", txn_ref:"UGALYAPS6W", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1500.0, charges_kes:20.0, owner_funded:false},
      {id:uid(), date:"2026-07-10", txn_ref:"UGALAAJWSB", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:21200.0, charges_kes:60.0, owner_funded:false},
      {id:uid(), date:"2026-07-10", txn_ref:"UGAOYAFVXE", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:900.0, charges_kes:12.0, owner_funded:false},
      {id:uid(), date:"2026-07-10", txn_ref:"UGATC5TFKQ", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-11", txn_ref:"UGB6CAD692", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:100.0, charges_kes:0.0, owner_funded:false},
      {id:uid(), date:"2026-07-11", txn_ref:"UGBTC5V46I", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:169.0, charges_kes:13.0, owner_funded:false},
      {id:uid(), date:"2026-07-11", txn_ref:"UGBF1B2UYP", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:3000.0, charges_kes:40.0, owner_funded:false},
      {id:uid(), date:"2026-07-11", txn_ref:"UGBTC5VH2R", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-11", txn_ref:"UGBTC5URNK", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-11", txn_ref:"UGBTC5UWM9", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:2000.0, charges_kes:35.0, owner_funded:false},
      {id:uid(), date:"2026-07-11", txn_ref:"UGBGVAGLAV", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:6025.0, charges_kes:55.0, owner_funded:false},
      {id:uid(), date:"2026-07-11", txn_ref:"UGBR8AXYTT", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:9000.0, charges_kes:55.0, owner_funded:false},
      {id:uid(), date:"2026-07-11", txn_ref:"201200572026071105260537B79867", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:11500.0, charges_kes:60.0, owner_funded:false},
      {id:uid(), date:"2026-07-11", txn_ref:"UGB2ZB9LDQ", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:100.0, charges_kes:0.0, owner_funded:false},
      {id:uid(), date:"2026-07-12", txn_ref:"UGCTC5WU03", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:500.0, charges_kes:15.0, owner_funded:false},
      {id:uid(), date:"2026-07-12", txn_ref:"UGCDWB37MW", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:3000.0, charges_kes:40.0, owner_funded:false},
      {id:uid(), date:"2026-07-13", txn_ref:"UGDCWBBRVN", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:50.0, charges_kes:0.0, owner_funded:false},
      {id:uid(), date:"2026-07-13", txn_ref:"UGDAOATT9C", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:150.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-13", txn_ref:"UGD9TB026D", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:200.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-13", txn_ref:"UGD56BDMTU", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:300.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-13", txn_ref:"UGDDKB0XLY", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:30.0, charges_kes:0.0, owner_funded:false},
      {id:uid(), date:"2026-07-13", txn_ref:"UGD57B8FQZ", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:30.0, charges_kes:0.0, owner_funded:false},
      {id:uid(), date:"2026-07-13", txn_ref:"UGD9RB3AK7", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:70.0, charges_kes:0.0, owner_funded:false},
      {id:uid(), date:"2026-07-13", txn_ref:"UGDTC5YPNA", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:105.0, charges_kes:13.0, owner_funded:false},
      {id:uid(), date:"2026-07-13", txn_ref:"UGDTC5ZW0J", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-13", txn_ref:"UGDTC5Z3UU", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:12.0, owner_funded:false},
      {id:uid(), date:"2026-07-13", txn_ref:"UGDK1B67F9", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:12.0, owner_funded:false},
      {id:uid(), date:"2026-07-13", txn_ref:"UGD14B5DWZ", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-13", txn_ref:"UGDTC5ZR8K", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:5800.0, charges_kes:66.0, owner_funded:false},
      {id:uid(), date:"2026-07-13", txn_ref:"UGDKQBN6IJ", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:3100.0, charges_kes:40.0, owner_funded:true},
      {id:uid(), date:"2026-07-13", txn_ref:"UGDTC5Z55T", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:60000.0, charges_kes:127.0, owner_funded:true},
      {id:uid(), date:"2026-07-13", txn_ref:"UGDK1B67F8", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:12.0, owner_funded:false},
      {id:uid(), date:"2026-07-14", txn_ref:"UGECSATGH7", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:200.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-14", txn_ref:"UGETC62D1Q", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-14", txn_ref:"UGEGIB8E6P", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:16500.0, charges_kes:60.0, owner_funded:false},
      {id:uid(), date:"2026-07-14", txn_ref:"UGEKQBQ98F", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:600.0, charges_kes:12.0, owner_funded:false},
      {id:uid(), date:"2026-07-14", txn_ref:"UGETC618E8", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:7900.0, charges_kes:66.0, owner_funded:false},
      {id:uid(), date:"2026-07-14", txn_ref:"UGEKQBPZGU", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1750.0, charges_kes:30.0, owner_funded:false},
      {id:uid(), date:"2026-07-14", txn_ref:"UGEONBQPIB", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:12.0, owner_funded:false},
      {id:uid(), date:"2026-07-15", txn_ref:"UGFR8BCIRY", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:420.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-15", txn_ref:"UGFLQB6XLG", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:200.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-15", txn_ref:"UGFHEBC4QD", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:30.0, charges_kes:0.0, owner_funded:false},
      {id:uid(), date:"2026-07-15", txn_ref:"UGFQBB3X5L", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:500.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-15", txn_ref:"UGFTC64INQ", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:600.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-15", txn_ref:"UGFTC645FH", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-15", txn_ref:"UGFTC641F9", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1500.0, charges_kes:28.0, owner_funded:false},
      {id:uid(), date:"2026-07-15", txn_ref:"201200032026071502240137FDDB79", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:4000.0, charges_kes:40.0, owner_funded:false},
      {id:uid(), date:"2026-07-15", txn_ref:"UGF94BF8ZD", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:400.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-15", txn_ref:"UGF56BKDYR", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:4000.0, charges_kes:40.0, owner_funded:false},
      {id:uid(), date:"2026-07-16", txn_ref:"UGGC8B86JW", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:100.0, charges_kes:0.0, owner_funded:false},
      {id:uid(), date:"2026-07-16", txn_ref:"UGG86BBKDK", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:100.0, charges_kes:0.0, owner_funded:false},
      {id:uid(), date:"2026-07-16", txn_ref:"UGGTC65S6M", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:120.0, charges_kes:13.0, owner_funded:false},
      {id:uid(), date:"2026-07-16", txn_ref:"UGGTC66KCI", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:900.0, charges_kes:0.0, owner_funded:false},
      {id:uid(), date:"2026-07-16", txn_ref:"UGGTC6654T", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:800.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-16", txn_ref:"UGGTC66683", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:660.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-16", txn_ref:"UGGKQ02KXB", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:400.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-16", txn_ref:"UGGKQ01RKX", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:5100.0, charges_kes:55.0, owner_funded:false},
      {id:uid(), date:"2026-07-16", txn_ref:"UGGTC65ISP", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:7200.0, charges_kes:60.0, owner_funded:false},
      {id:uid(), date:"2026-07-16", txn_ref:"UGGKQ01ED8", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:4370.0, charges_kes:40.0, owner_funded:false},
      {id:uid(), date:"2026-07-17", txn_ref:"UGHTC67Y03", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-17", txn_ref:"UGHTC68363", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1200.0, charges_kes:38.0, owner_funded:false},
      {id:uid(), date:"2026-07-17", txn_ref:"UGHTC688RE", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-17", txn_ref:"UGH1UBJG0Y", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:405.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-17", txn_ref:"UGHTC68MIW", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:100.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-17", txn_ref:"UGH56BU15X", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:4000.0, charges_kes:40.0, owner_funded:false},
      {id:uid(), date:"2026-07-17", txn_ref:"UGHTC696TE", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:600.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-17", txn_ref:"UGHAKBGHNW", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:10500.0, charges_kes:60.0, owner_funded:false},
      {id:uid(), date:"2026-07-18", txn_ref:"UGI5406Z32", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:3000.0, charges_kes:40.0, owner_funded:false},
      {id:uid(), date:"2026-07-18", txn_ref:"UGIKQ09KQU", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:2600.0, charges_kes:40.0, owner_funded:false},
      {id:uid(), date:"2026-07-18", txn_ref:"UGITC6A5EI", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:300.0, charges_kes:13.0, owner_funded:false},
      {id:uid(), date:"2026-07-18", txn_ref:"UGITC6A41Y", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:100.0, charges_kes:3.0, owner_funded:false},
      {id:uid(), date:"2026-07-18", txn_ref:"UGITC6A2RD", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:900.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-18", txn_ref:"UGITC6A77E", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:450.0, charges_kes:13.0, owner_funded:false},
      {id:uid(), date:"2026-07-18", txn_ref:"UGI6CB4V0X", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:100.0, charges_kes:0.0, owner_funded:false},
      {id:uid(), date:"2026-07-18", txn_ref:"UGITC6AC05", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:400.0, charges_kes:13.0, owner_funded:false},
      {id:uid(), date:"2026-07-18", txn_ref:"UGIM002D0D", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:12.0, owner_funded:false},
      {id:uid(), date:"2026-07-18", txn_ref:"UGITC6AGND", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:350.0, charges_kes:13.0, owner_funded:false},
      {id:uid(), date:"2026-07-18", txn_ref:"UGI4E0DJ7W", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:12.0, owner_funded:false},
      {id:uid(), date:"2026-07-18", txn_ref:"UGIILBOOUT", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:210.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-18", txn_ref:"UGI2Z03H5U", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:200.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-19", txn_ref:"UGJ2Z067CD", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:3750.0, charges_kes:40.0, owner_funded:false},
      {id:uid(), date:"2026-07-19", txn_ref:"201200572026071904100937J66C9A", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:2800.0, charges_kes:40.0, owner_funded:false},
      {id:uid(), date:"2026-07-19", txn_ref:"UGJTC6D3BD", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-19", txn_ref:"UGJTC6D9ZT", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:300.0, charges_kes:13.0, owner_funded:false},
      {id:uid(), date:"2026-07-20", txn_ref:"UGK3A05YFA", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:150.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-20", txn_ref:"UGKKQ0HPKO", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:2900.0, charges_kes:40.0, owner_funded:false},
      {id:uid(), date:"2026-07-20", txn_ref:"UGK6CBCCB8", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:4020.0, charges_kes:40.0, owner_funded:false},
      {id:uid(), date:"2026-07-20", txn_ref:"UGK540FM7X", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:300.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-20", txn_ref:"UGK14BWHLP", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1400.0, charges_kes:20.0, owner_funded:false},
      {id:uid(), date:"2026-07-20", txn_ref:"UGKTC6EHH2", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:600.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-20", txn_ref:"UGKTC6F7TE", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:50.0, charges_kes:3.0, owner_funded:false},
      {id:uid(), date:"2026-07-20", txn_ref:"UGKTC6F99A", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:50.0, charges_kes:3.0, owner_funded:false},
      {id:uid(), date:"2026-07-20", txn_ref:"UGKTC6FNJ0", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:180.0, charges_kes:13.0, owner_funded:false},
      {id:uid(), date:"2026-07-21", txn_ref:"UGL2Z0D5GQ", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:9389.0, charges_kes:55.0, owner_funded:false},
      {id:uid(), date:"2026-07-21", txn_ref:"UGL6CBFW2V", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:100.0, charges_kes:0.0, owner_funded:false},
      {id:uid(), date:"2026-07-21", txn_ref:"UGLKQ0LHNS", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:3600.0, charges_kes:40.0, owner_funded:false},
      {id:uid(), date:"2026-07-21", txn_ref:"UGLTC6GTF5", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:2000.0, charges_kes:35.0, owner_funded:false},
      {id:uid(), date:"2026-07-21", txn_ref:"UGLTC6GNH2", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:600.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-21", txn_ref:"UGLTC6GS5C", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1500.0, charges_kes:28.0, owner_funded:false},
      {id:uid(), date:"2026-07-21", txn_ref:"UGLFC0GLK8", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:400.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-21", txn_ref:"UGLTC6GW5M", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-21", txn_ref:"UGLR802JWH", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:3000.0, charges_kes:40.0, owner_funded:false},
      {id:uid(), date:"2026-07-21", txn_ref:"UGL8WBUTFR", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:400.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-22", txn_ref:"UGMOYBP99P", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:450.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-22", txn_ref:"UGMTC6J2WR", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:600.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-22", txn_ref:"UGMKI0NLR9", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:100.0, charges_kes:0.0, owner_funded:false},
      {id:uid(), date:"2026-07-22", txn_ref:"UGMTC6JKJ3", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:200.0, charges_kes:13.0, owner_funded:false},
      {id:uid(), date:"2026-07-22", txn_ref:"UGMTC6JKJC", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1800.0, charges_kes:35.0, owner_funded:false},
      {id:uid(), date:"2026-07-22", txn_ref:"UGM2S013H6", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:6000.0, charges_kes:55.0, owner_funded:false},
      {id:uid(), date:"2026-07-23", txn_ref:"UGN940BZK3", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:2000.0, charges_kes:30.0, owner_funded:false},
      {id:uid(), date:"2026-07-23", txn_ref:"UGN4H0UFQW", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:5500.0, charges_kes:55.0, owner_funded:false},
      {id:uid(), date:"2026-07-23", txn_ref:"UGN560K2B7", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:2500.0, charges_kes:30.0, owner_funded:false},
      {id:uid(), date:"2026-07-23", txn_ref:"UGNTC6LF0H", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-23", txn_ref:"UGNKZ0GI6V", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:30.0, charges_kes:0.0, owner_funded:false},
      {id:uid(), date:"2026-07-23", txn_ref:"UGNKQ0UM0R", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1300.0, charges_kes:20.0, owner_funded:false},
      {id:uid(), date:"2026-07-23", txn_ref:"UGNTC6MNTB", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:2000.0, charges_kes:35.0, owner_funded:false},
      {id:uid(), date:"2026-07-23", txn_ref:"UGNAT0B6IS", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:12.0, owner_funded:false},
      {id:uid(), date:"2026-07-24", txn_ref:"UGOTC6NMM7", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:600.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-24", txn_ref:"UGOTC6NO5A", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:600.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-24", txn_ref:"UGOKQ0XCD5", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:37500.0, charges_kes:68.0, owner_funded:false},
      {id:uid(), date:"2026-07-24", txn_ref:"UGOJV065EB", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:2560.0, charges_kes:40.0, owner_funded:false},
      {id:uid(), date:"2026-07-25", txn_ref:"R260725.0650.210002", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:5000.0, charges_kes:0.0, owner_funded:false},
      {id:uid(), date:"2026-07-25", txn_ref:"UGPTC6PQHF", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-25", txn_ref:"UGPTC6PQNY", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-25", txn_ref:"UGP560S4UP", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:200.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-25", txn_ref:"UGPKQ11KNE", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1380.0, charges_kes:20.0, owner_funded:false},
      {id:uid(), date:"2026-07-25", txn_ref:"UGPTC6PQ4C", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:300.0, charges_kes:13.0, owner_funded:false},
      {id:uid(), date:"2026-07-25", txn_ref:"UGPLQ0BX03", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:80.0, charges_kes:0.0, owner_funded:false},
      {id:uid(), date:"2026-07-25", txn_ref:"UGPD10DIXI", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:700.0, charges_kes:12.0, owner_funded:false},
      {id:uid(), date:"2026-07-25", txn_ref:"UGPTC6Q9XH", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:200.0, charges_kes:13.0, owner_funded:false},
      {id:uid(), date:"2026-07-25", txn_ref:"UGP560TMV1", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:300.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-25", txn_ref:"UGP140LEKU", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:900.0, charges_kes:12.0, owner_funded:false},
      {id:uid(), date:"2026-07-25", txn_ref:"UGPTC6QWFW", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1000.0, charges_kes:18.0, owner_funded:false},
      {id:uid(), date:"2026-07-25", txn_ref:"UGPMN0ABRN", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:30.0, charges_kes:0.0, owner_funded:false},
      {id:uid(), date:"2026-07-26", txn_ref:"201200572026072606570937QDBEAD", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:8000.0, charges_kes:60.0, owner_funded:false},
      {id:uid(), date:"2026-07-26", txn_ref:"UGQTC6STNA", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:500.0, charges_kes:13.0, owner_funded:false},
      {id:uid(), date:"2026-07-26", txn_ref:"UGQHB0SLWJ", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:150.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-27", txn_ref:"UGRLI0MZL7", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:260.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-27", txn_ref:"UGRTC6U360", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:500.0, charges_kes:13.0, owner_funded:false},
      {id:uid(), date:"2026-07-27", txn_ref:"UGRTC6UBAL", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:2000.0, charges_kes:35.0, owner_funded:false},
      {id:uid(), date:"2026-07-27", txn_ref:"UGR5610TS9", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:1500.0, charges_kes:20.0, owner_funded:false},
      {id:uid(), date:"2026-07-27", txn_ref:"UGRKQ19TM5", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:270.0, charges_kes:6.0, owner_funded:false},
      {id:uid(), date:"2026-07-27", txn_ref:"UGRTC6UAQK", account_used:"Bank Account", category:"Other", description:"Imported from Tende Expense Log", paid_to:"", amount_kes:450.0, charges_kes:13.0, owner_funded:false}
    ],
    loans: [
      {id:johnLoanId, debt_name:"John — Related Party Loan (Splicer & Inventory)", lender:"John (Director)", original_principal_kes:77600, annual_interest_rate_pct:0, start_date:"2026-07-13", min_monthly_payment_kes:0, current_balance_kes:51540, status:"ACTIVE"},
      {id:saccoLoanId, debt_name:"sacco loan", lender:"sacco", original_principal_kes:3000000, annual_interest_rate_pct:5, start_date:"2026-07-23", min_monthly_payment_kes:0, current_balance_kes:2977500, status:"ACTIVE"}
    ],
    loanPayments: [
      {id:uid(), loan_id:johnLoanId, date:"2026-07-18", amount_kes:18000, note:"Manual repayment"},
      {id:uid(), loan_id:saccoLoanId, date:"2026-07-23", amount_kes:22500, note:"Manual repayment (principal portion)"}
    ],
    taxObligations: TAX_TYPES.map(t => {
      const applicable = ["NSSF","SHIF","Installment Tax","NITA Levy"].includes(t);
      return {id:uid(), tax_type:t, applicable, frequency: t==="Installment Tax"?"Quarterly": t==="NITA Levy"?"Annual":"Monthly",
        due_day_of_month: t==="NSSF"||t==="SHIF"?9:20,
        manual_next_due_date: t==="Installment Tax"?"2026-09-20": t==="NITA Levy"?"2026-12-31":"",
        estimated_amount_kes:0, filing_authority: t==="NSSF"?"NSSF": t==="SHIF"?"SHA": t==="NITA Levy"?"NITA":"KRA iTax", notes:""};
    }),
    monthlyArchive: [],
    closedMonths: [],
    categories: DEFAULT_CATEGORIES.slice(),
    settings: {
      pct_profit: 5, pct_owner_debt: 20, pct_tax: 15, pct_opex: 60,
      debt_paydown_split_pct: 40,
      monthly_revenue_target_kes: 900000,
      opening_opex_account_balance_kes: 87300
    }
  };
}

let state = null;
let lastSynced = null; // last known-good server snapshot of the normalized entities, for diffing on save
let STORAGE_VERSION = null;
let saveTimer = null;
let saveStatus = 'idle'; // idle | saving | saved | error

// Which local array maps to which endpoint, and how a local record turns
// into the shape that endpoint expects. Client-generated uuid() ids are
// sent as-is on create, so a record's id is stable from the moment it's
// added in the UI — no server round trip needed before it can be
// edited/deleted again.
const CORE_ENTITY_CONFIG = {
  dailyRevenue: {
    path: '/api/revenue',
    toApi: r => ({ id:r.id, branch_id: state.branchId, entry_date:r.date, amount_kes:Number(r.revenue_kes)||0, notes:r.notes||null })
  },
  expenses: {
    path: '/api/expenses',
    toApi: e => ({ id:e.id, branch_id: state.branchId, expense_date:e.date, txn_ref:e.txn_ref||null,
      account_name:e.account_used||null, category_name:e.category||null,
      description:e.description||null, paid_to:e.paid_to||null,
      amount_kes:Number(e.amount_kes)||0, charges_kes:Number(e.charges_kes)||0, owner_funded:!!e.owner_funded,
      status:e.status||'posted' })
  },
  loans: {
    path: '/api/loans',
    toApi: l => ({ id:l.id, branch_id: state.branchId, debt_name:l.debt_name, lender:l.lender||null,
      original_principal_kes:Number(l.original_principal_kes)||0, current_balance_kes:Number(l.current_balance_kes)||0,
      annual_interest_rate_pct:Number(l.annual_interest_rate_pct)||0, start_date:l.start_date||null,
      min_monthly_payment_kes:Number(l.min_monthly_payment_kes)||0, status:l.status||'ACTIVE' })
  },
  // Balance math (loan.current_balance_kes) is computed client-side, same
  // as this app already did — syncing the 'loans' array separately carries
  // that updated balance server-side, so this endpoint doesn't touch it.
  loanPayments: {
    path: '/api/loan-payments',
    toApi: p => ({ id:p.id, branch_id: state.branchId, loan_id:p.loan_id, payment_date:p.date, amount_kes:Number(p.amount_kes)||0, note:p.note||null })
  },
  taxObligations: {
    path: '/api/tax',
    toApi: t => ({ id:t.id, branch_id: state.branchId, tax_type:t.tax_type, applicable:!!t.applicable,
      frequency:t.frequency, due_day_of_month:t.due_day_of_month||null, manual_next_due_date:t.manual_next_due_date||null,
      estimated_amount_kes:Number(t.estimated_amount_kes)||0, filing_authority:t.filing_authority||null, notes:t.notes||null })
  }
};

function snapshotCore(){
  const s = {};
  for(const key of Object.keys(CORE_ENTITY_CONFIG)) s[key] = JSON.parse(JSON.stringify(state[key] || []));
  s.settings = JSON.parse(JSON.stringify(state.settings));
  return s;
}

async function syncEntityArray(key){
  const cfg = CORE_ENTITY_CONFIG[key];
  const current = state[key] || [];
  const prior = (lastSynced && lastSynced[key]) || [];
  const priorById = new Map(prior.map(x=>[x.id,x]));
  const currentIds = new Set(current.map(x=>x.id));
  const ops = [];

  for(const rec of current){
    const before = priorById.get(rec.id);
    if(!before){
      ops.push(apiCreate(cfg.path, cfg.toApi(rec)));
    } else if(JSON.stringify(before) !== JSON.stringify(rec)){
      ops.push(apiUpdate(cfg.path, cfg.toApi(rec)));
    }
  }
  for(const rec of prior){
    if(!currentIds.has(rec.id)){
      ops.push(apiRemove(cfg.path, { branch_id: state.branchId, id: rec.id }));
    }
  }
  await Promise.all(ops);
}

async function syncSettings(){
  const s = state.settings;
  const before = lastSynced ? lastSynced.settings : null;
  if(before && JSON.stringify(before) === JSON.stringify(s)) return;
  await apiPutSettings({
    branch_id: state.branchId,
    pct_profit: s.pct_profit, pct_owner_debt: s.pct_owner_debt, pct_tax: s.pct_tax, pct_opex: s.pct_opex,
    debt_paydown_split_pct: s.debt_paydown_split_pct,
    monthly_revenue_target_kes: s.monthly_revenue_target_kes,
    opening_opex_account_balance_kes: s.opening_opex_account_balance_kes
  });
}

let availableBranches = [];

async function loadState(preferredBranchId){
  const me = await apiGetMe();
  currentUserEmail = me.user ? me.user.email : currentUserEmail; // always prefer the server-verified email over whatever the session object had
  if(!me.branches || me.branches.length === 0){
    throw new Error('Your account has no branch access yet — ask an admin to grant you access.');
  }
  availableBranches = me.branches;
  const lastUsed = localStorage.getItem('happynet_last_branch');
  const branch = availableBranches.find(b => b.branch_id === preferredBranchId)
    || availableBranches.find(b => b.branch_id === lastUsed)
    || availableBranches[0];
  const branchId = branch.branch_id;
  localStorage.setItem('happynet_last_branch', branchId);

  const [revRes, expRes, loanRes, payRes, taxRes, settingsRaw, miscData] = await Promise.all([
    apiList('/api/revenue', branchId),
    apiList('/api/expenses', branchId),
    apiList('/api/loans', branchId),
    apiList('/api/loan-payments', branchId),
    apiList('/api/tax', branchId),
    apiFetch('/api/settings?branch_id=' + branchId, { method:'GET' }).then(r => r.json()),
    apiGetBranchMisc(branchId)
  ]);

  const d = defaultState(); // used only as a fallback shape now, not seed data

  state = {
    branchId,
    role: branch.role,
    isHeadOffice: !!me.is_head_office,
    allBranches: availableBranches,
    dailyRevenue: (revRes.revenue || []).map(r => ({ id:r.id, date:r.entry_date, revenue_kes:Number(r.amount_kes), notes:r.notes || '' })),
    expenses: (expRes.expenses || []).map(e => ({
      id:e.id, date:e.expense_date, txn_ref:e.txn_ref || '',
      account_used: (e.financial_accounts && e.financial_accounts.name) || '',
      category: (e.categories && e.categories.name) || '',
      description:e.description || '', paid_to:e.paid_to || '',
      amount_kes:Number(e.amount_kes), charges_kes:Number(e.charges_kes || 0), owner_funded:!!e.owner_funded,
      status:e.status || 'posted'
    })),
    loans: (loanRes.loans || []).map(l => ({
      id:l.id, debt_name:l.debt_name, lender:l.lender || '',
      original_principal_kes:Number(l.original_principal_kes),
      annual_interest_rate_pct:Number(l.annual_interest_rate_pct || 0),
      start_date:l.start_date || '', min_monthly_payment_kes:Number(l.min_monthly_payment_kes || 0),
      current_balance_kes:Number(l.current_balance_kes), status:l.status || 'ACTIVE'
    })),
    loanPayments: (payRes.loan_payments || []).map(p => ({
      id:p.id, loan_id:p.loan_id, date:p.payment_date, amount_kes:Number(p.amount_kes), note:p.note || ''
    })),
    taxObligations: (taxRes.tax_obligations || []).map(t => ({
      id:t.id, tax_type:t.tax_type, applicable:!!t.applicable, frequency:t.frequency,
      due_day_of_month:t.due_day_of_month, manual_next_due_date:t.manual_next_due_date || '',
      estimated_amount_kes:Number(t.estimated_amount_kes || 0), filing_authority:t.filing_authority || '', notes:t.notes || ''
    })),
    monthlyArchive: (miscData && miscData.monthlyArchive) || [],
    closedMonths: (miscData && miscData.closedMonths) || [],
    categories: (miscData && miscData.categories && miscData.categories.length) ? miscData.categories : d.categories,
    settings: settingsRaw.settings ? {
      pct_profit:Number(settingsRaw.settings.pct_profit),
      pct_owner_debt:Number(settingsRaw.settings.pct_owner_debt),
      pct_tax:Number(settingsRaw.settings.pct_tax),
      pct_opex:Number(settingsRaw.settings.pct_opex),
      debt_paydown_split_pct:Number(settingsRaw.settings.debt_paydown_split_pct),
      monthly_revenue_target_kes:Number(settingsRaw.settings.monthly_revenue_target_kes || 0),
      opening_opex_account_balance_kes:Number(settingsRaw.settings.opening_opex_account_balance_kes || 0)
    } : d.settings
  };

  lastSynced = snapshotCore();
}

async function switchBranch(branchId){
  if(branchId === state.branchId) return;
  root().innerHTML = `<div class="loading-screen">Switching branch…</div>`;
  try{
    await loadState(branchId);
    activeTab = 'dashboard';
    render();
  }catch(e){
    renderLogin(e.message || 'Could not switch branches — please sign in again.');
  }
}

// Role gates, used throughout the UI to hide/disable actions someone's role
// can't perform — the API enforces this regardless, but showing a button
// that will just 403 is a bad experience, not real security.
function canWrite(){ return state.isHeadOffice || ['branch_manager','accountant'].includes(state.role); }
function canManageSettings(){ return state.isHeadOffice || state.role === 'branch_manager'; }
function canApprove(){ return state.isHeadOffice || state.role === 'branch_manager'; }
function readOnlyNotice(){
  return `<div class="hint" style="display:flex; align-items:center; gap:8px; padding:12px 14px; background:var(--neutral-soft); border-radius:10px; margin-bottom:16px;">${ic('lock',14)}Your role (${(state.role||'').replace(/_/g,' ')}) has read-only access here.</div>`;
}

function queueSave(){
  clearTimeout(saveTimer);
  saveStatus = 'saving'; renderSaveBadge();
  saveTimer = setTimeout(async () => {
    try{
      await Promise.all([
        syncEntityArray('dailyRevenue'),
        syncEntityArray('expenses'),
        syncEntityArray('loans'),
        syncEntityArray('loanPayments'),
        syncEntityArray('taxObligations'),
        syncSettings(),
        // Real per-branch home for these three — this is what the UI
        // actually reads back on next load (see apiGetBranchMisc above).
        apiSaveBranchMisc(state.branchId, {
          categories: state.categories, monthlyArchive: state.monthlyArchive, closedMonths: state.closedMonths
        }),
        // /api/state's POST fully REPLACES the stored blob rather than
        // merging — so this keeps writing the complete state (not just
        // categories/archive/closedMonths) to preserve app_state as a
        // whole-app mirror/rollback point. NOTE: app_state is a single
        // global row, not branch-scoped, so across multiple branches this
        // mirror only ever reflects whichever branch saved most recently —
        // it's a rollback safety net, not a per-branch source of truth.
        apiSaveState({
          dailyRevenue: state.dailyRevenue, expenses: state.expenses, loans: state.loans,
          loanPayments: state.loanPayments, taxObligations: state.taxObligations,
          settings: state.settings, categories: state.categories,
          monthlyArchive: state.monthlyArchive, closedMonths: state.closedMonths
        })
      ]);
      lastSynced = snapshotCore();
      saveStatus = 'saved';
    } catch(e){
      console.error('save failed', e);
      saveStatus = 'error';
    }
    renderSaveBadge();
  }, 600);
}

function renderSaveBadge(){
  const el = document.getElementById('save-badge');
  if(!el) return;
  const map = { idle:'', saving:'Saving…', saved:'Saved', error:'Save failed — check connection' };
  el.textContent = map[saveStatus] || '';
  el.className = 'save-badge ' + saveStatus;
}

/* ---------------- Derived / business logic ---------------- */

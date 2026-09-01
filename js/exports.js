/* ---------------- CSV export (Phase 5) ---------------- */
function csvEscape(v){
  const s = v===null||v===undefined ? '' : String(v);
  return /[",\n]/.test(s) ? '"' + s.replace(/"/g,'""') + '"' : s;
}
function toCsv(headers, rows){
  const lines = [headers.map(csvEscape).join(',')];
  for(const row of rows) lines.push(row.map(csvEscape).join(','));
  return lines.join('\r\n');
}
function downloadText(filename, text, mime){
  const blob = new Blob([text], { type: mime || 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
// For server-generated downloads (PDF/xls export) — plain <a href> links
// can't carry this app's Bearer auth token, so these go through apiFetch
// (which attaches it) and trigger the download from the resulting blob.
async function downloadViaApi(path, filename){
  try{
    const res = await apiFetch(path, { method:'GET' });
    if(!res.ok){ const body = await res.json().catch(()=>({})); throw new Error(body.error || 'Export failed.'); }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }catch(e){ showToast('Export failed: ' + e.message, 'error'); }
}
function exportExpensesCsv(){
  const rows = filteredExpenseRows();
  const csv = toCsv(
    ['Date','Txn Ref','Account','Category','Description','Paid To','Amount (KES)','Charges (KES)','Total (KES)','Owner Funded','Status'],
    rows.map(e => [e.date, e.txn_ref, e.account_used, e.category, e.description||'', e.paid_to||'',
      e.amount_kes, e.charges_kes, e.amount_kes+e.charges_kes, e.owner_funded ? 'Yes' : 'No', e.status])
  );
  downloadText(`happynet-expenses-${todayISO()}.csv`, csv);
}
function exportExpensesXlsx(){
  const rows = filteredExpenseRows();
  const sheetRows = rows.map(e => ({
    'Date': e.date, 'Txn Ref': e.txn_ref, 'Account': e.account_used, 'Category': e.category,
    'Description': e.description||'', 'Paid To': e.paid_to||'',
    'Amount (KES)': e.amount_kes, 'Charges (KES)': e.charges_kes, 'Total (KES)': e.amount_kes+e.charges_kes,
    'Owner Funded': e.owner_funded ? 'Yes' : 'No', 'Status': e.status
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows), 'Expenses');
  XLSX.writeFile(wb, `happynet-expenses-${todayISO()}.xlsx`);
}
function exportRevenueCsv(){
  const rows = state.dailyRevenue.slice().sort((a,b)=>a.date<b.date?-1:1);
  const csv = toCsv(
    ['Date','Revenue (KES)','Notes'],
    rows.map(r => [r.date, r.revenue_kes, r.notes||''])
  );
  downloadText(`happynet-revenue-${todayISO()}.csv`, csv);
}

/* ---------------- .xlsx export (Phase 5) — uses the SheetJS build already
   loaded for the Tende import parser, so no extra dependency. ---------------- */
function exportArchiveXlsx(){
  const rows = state.monthlyArchive.slice().sort((a,b)=>a.month<b.month?1:-1);
  const sheetRows = rows.map(a => ({
    'Month': a.month_label,
    'Revenue (KES)': a.total_revenue_kes,
    'Daily Avg (KES)': a.daily_avg_revenue_kes,
    'Profit (KES)': a.profit_reserved_kes,
    'Owner/Debt (KES)': a.owner_pay_allocated_kes,
    'Tax Reserve (KES)': a.tax_reserve_kes,
    'OpEx Budget (KES)': a.opex_budget_kes,
    'Actual OpEx (KES)': a.actual_opex_kes,
    'Variance (KES)': a.opex_budget_kes - a.actual_opex_kes,
    'OpEx Ratio %': Number(a.opex_ratio_pct.toFixed(1)),
    'Revenue Achievement %': Number(a.revenue_achievement_pct.toFixed(0))
  }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sheetRows), 'Trend Archive');
  XLSX.writeFile(wb, `happynet-trend-archive-${todayISO()}.xlsx`);
}


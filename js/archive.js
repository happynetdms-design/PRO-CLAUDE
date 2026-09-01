/* ---------------- TREND ARCHIVE ---------------- */

function viewArchive(){
  const rows = state.monthlyArchive.slice().sort((a,b)=>a.month<b.month?1:-1);
  return `
    <div class="topbar"><div><h1>Trend Archive</h1><div class="sub">One row per closed month. Read-only — created by "Close Month" on the Dashboard.</div></div>
      <div class="topbar-actions"><button class="btn ghost sm" id="btn-export-archive-xlsx">Export .xlsx</button></div>
    </div>

    <div class="chart-box"><h3>Revenue vs Net OpEx</h3><div class="chart-canvas-wrap"><canvas id="chart-rev-opex"></canvas></div></div>
    <div class="grid" style="grid-template-columns:1fr 1fr;">
      <div class="chart-box"><h3>OpEx Ratio %</h3><div class="chart-canvas-wrap"><canvas id="chart-opex-ratio"></canvas></div></div>
      <div class="chart-box"><h3>Revenue Achievement %</h3><div class="chart-canvas-wrap"><canvas id="chart-rev-achieve"></canvas></div></div>
    </div>

    <div class="section-head"><h2>Archived months — budget vs. actual</h2></div>
    <div class="table-wrap"><table>
      <thead><tr><th class="txt">Month</th><th>Revenue</th><th>Daily Avg</th><th>Profit</th><th>Owner/Debt</th><th>Tax Reserve</th><th>OpEx Budget</th><th>Actual OpEx</th><th>Variance</th><th>OpEx Ratio</th><th>Rev Achv.</th></tr></thead>
      <tbody>
        ${rows.length===0?`<tr class="empty-row"><td colspan="11">No months closed yet.</td></tr>`:rows.map(a=>{
          const variance = a.opex_budget_kes - a.actual_opex_kes;
          return `
          <tr>
            <td class="txt">${a.month_label}</td>
            <td>${KES0(a.total_revenue_kes)}</td><td>${KES0(a.daily_avg_revenue_kes)}</td>
            <td>${KES0(a.profit_reserved_kes)}</td><td>${KES0(a.owner_pay_allocated_kes)}</td>
            <td>${KES0(a.tax_reserve_kes)}</td><td>${KES0(a.opex_budget_kes)}</td><td>${KES0(a.actual_opex_kes)}</td>
            <td class="${variance<0?'neg':'pos'}">${variance<0?'-':'+'}${KES0(Math.abs(variance))}</td>
            <td>${a.opex_ratio_pct.toFixed(1)}%</td><td>${a.revenue_achievement_pct.toFixed(0)}%</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table></div>

    ${state.isHeadOffice && state.allBranches && state.allBranches.length > 1 ? `
    <div class="section-head"><h2>Branch comparison — current month</h2>
      <div class="toolbar"><span class="hint">${branchCompareState.loading ? 'Loading…' : ''}</span></div>
    </div>
    <div class="card">
      ${branchCompareState.error ? `<div class="hint" style="color:#c0392b;">${branchCompareState.error}</div>` : ''}
      ${branchCompareState.rows ? `
      <div class="table-wrap"><table>
        <thead><tr><th class="txt">Branch</th><th>Revenue (MTD)</th><th>Expenses (MTD)</th><th>Net</th></tr></thead>
        <tbody>
          ${branchCompareState.rows.map(r=>`
            <tr>
              <td class="txt">${r.name}${r.branch_id===state.branchId?' <span class="tag neutral">Current</span>':''}</td>
              <td>${KES0(r.revenue)}</td><td>${KES0(r.expenses)}</td>
              <td class="${r.revenue-r.expenses<0?'neg':'pos'}">${KES0(r.revenue-r.expenses)}</td>
            </tr>`).join('')}
        </tbody>
      </table></div>` : (branchCompareState.loading ? '' : `<button class="btn ghost sm" id="btn-load-branch-compare">Load comparison</button>`)}
    </div>` : ''}
  `;
}


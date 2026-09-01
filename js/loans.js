/* ---------------- DEBT PAYOFF ---------------- */

function viewDebt(){
  const s = loanSummary();
  const rows = state.loans.slice();
  const editing = editingLoanId ? state.loans.find(l=>l.id===editingLoanId) : null;
  const paymentRows = state.loanPayments.slice().sort((a,b)=>a.date<b.date?-1:1);
  const editingP = editingPaymentId ? state.loanPayments.find(p=>p.id===editingPaymentId) : null;
  const loanName = id => (state.loans.find(l=>l.id===id)||{}).debt_name || '(deleted loan)';
  return `
    <div class="topbar"><div><h1>Debt Payoff Tracker</h1><div class="sub">Loan register and paydown progress.</div></div></div>

    <div class="grid kpi">
      <div class="card kpi"><h3>Total Original Debt</h3><div class="big" style="font-size:22px;">${KES(s.totalOriginal)}</div></div>
      <div class="card kpi"><h3>Balance Remaining</h3><div class="big" style="font-size:22px;">${KES(s.totalBalance)}</div></div>
      <div class="card kpi"><h3>% Cleared</h3><div class="big" style="font-size:22px;">${s.pctCleared.toFixed(0)}%</div></div>
      <div class="card kpi"><h3>Available This Month</h3><div class="big" style="font-size:22px;">${KES(s.availableThisMonth)}</div><div class="foot">${state.settings.debt_paydown_split_pct}% of Owner Pay &amp; Debt bucket</div></div>
      <div class="card kpi"><h3>Avg Monthly Paydown</h3><div class="big" style="font-size:22px;">${KES(s.avgMonthly)}</div></div>
      <div class="card kpi"><h3>Projected Debt-Free</h3><div class="big" style="font-size:20px;">${s.projectedDate}</div></div>
    </div>

    <div class="section-head"><h2>Loan register</h2></div>
    <div class="hint" style="margin-bottom:12px;">${ic('lock',12)} Current Balance updates automatically — from dedicated payments logged below, or from any expense you log with category "Reimbursement" and Paid To matching the lender's name. Both count toward paying it down.</div>
    ${canWrite() ? `
    <div class="form-card">
      <h3>${editing ? `Editing "${editing.debt_name}"` : `Add a loan`}</h3>
      <form id="form-loan">
        <div class="form-row">
          <div><label>Debt Name</label><input type="text" name="debt_name" value="${editing?editing.debt_name:''}" required></div>
          <div><label>Lender</label><input type="text" name="lender" value="${editing?(editing.lender||''):''}"></div>
          <div><label>Original Principal</label><input type="number" name="original_principal_kes" min="0" value="${editing?editing.original_principal_kes:''}" required></div>
          <div><label>Current Balance</label>
            ${editing
              ? `<input type="number" value="${editing.current_balance_kes}" disabled title="Auto-calculated — edit this by logging a dedicated payment below, or an expense categorized Reimbursement with Paid To matching the lender name.">`
              : `<input type="number" name="current_balance_kes" min="0" value="${editing?editing.current_balance_kes:''}"><div class="hint" style="margin-top:4px;">Defaults to the full principal if left blank — only set this if the loan already had payments before being entered here. Kept in sync automatically afterward.</div>`}
          </div>
        </div>
        <div class="form-row">
          <div><label>Annual Interest %</label><input type="number" name="annual_interest_rate_pct" min="0" step="0.1" value="${editing?(editing.annual_interest_rate_pct||0):''}"></div>
          <div><label>Start Date</label><input type="date" name="start_date" value="${editing?(editing.start_date||''):''}"></div>
          <div><label>Min Monthly Payment</label><input type="number" name="min_monthly_payment_kes" min="0" value="${editing?(editing.min_monthly_payment_kes||0):''}"></div>
          <div><label>Status</label><select name="status"><option ${editing&&editing.status==='Active'?'selected':''}>Active</option><option ${editing&&editing.status==='Paid Off'?'selected':''}>Paid Off</option></select></div>
        </div>
        <button class="btn gold" type="submit">${editing?'Update Loan':'Add Loan'}</button>
        ${editing?`<button type="button" class="btn ghost" id="cancel-edit-loan">Cancel</button>`:''}
      </form>
    </div>` : readOnlyNotice()}

    <div class="table-wrap"><table>
      <thead><tr><th class="txt">Debt</th><th class="txt">Lender</th><th>Principal</th><th>Balance</th><th>Rate</th><th>Min Payment</th><th class="txt">Status</th><th></th></tr></thead>
      <tbody>
        ${rows.length===0?`<tr class="empty-row"><td colspan="8">No loans on file.</td></tr>`:rows.map(l=>`
          <tr>
            <td class="txt">${l.debt_name}</td><td class="txt">${l.lender||''}</td>
            <td>${KES0(l.original_principal_kes)}</td><td>${KES0(l.current_balance_kes)}</td>
            <td>${l.annual_interest_rate_pct||0}%</td><td>${KES0(l.min_monthly_payment_kes)}</td>
            <td class="txt"><span class="tag ${l.status==='Paid Off'?'good':'neutral'}">${l.status}</span></td>
            <td>${canWrite() ? `<button class="btn ghost sm" data-edit-loan="${l.id}">Edit</button> <button class="btn ghost sm" data-del-loan="${l.id}">Delete</button>` : '—'}</td>
          </tr>`).join('')}
      </tbody>
    </table></div>

    ${canWrite() ? `
    <div class="section-head"><h2>${editingP ? 'Editing loan payment' : 'Log a loan payment'}</h2></div>
    <div class="form-card">
      <form id="form-payment">
        <div class="form-row">
          <div><label>Loan</label><select name="loan_id">${state.loans.map(l=>`<option value="${l.id}" ${editingP&&editingP.loan_id===l.id?'selected':''}>${l.debt_name}</option>`).join('')||'<option value="">No loans yet</option>'}</select></div>
          <div><label>Date</label><input type="date" name="date" value="${editingP?editingP.date:todayISO()}"></div>
          <div><label>Amount (KES)</label><input type="number" name="amount_kes" min="0" value="${editingP?editingP.amount_kes:''}" required></div>
          <div><label>Note</label><input type="text" name="note" value="${editingP?(editingP.note||''):''}"></div>
        </div>
        <button class="btn gold" type="submit" ${state.loans.length===0?'disabled':''}>${editingP?'Update Payment':'Log Payment'}</button>
        ${editingP?`<button type="button" class="btn ghost" id="cancel-edit-payment">Cancel</button>`:''}
        <div class="sub" style="margin-top:8px;">${editingP?'Editing a payment automatically corrects the loan balance to reflect the new amount.':'Logging a payment reduces the loan balance immediately.'}</div>
      </form>
    </div>` : `<div class="section-head"><h2>Loan payments</h2></div>`}

    <div class="table-wrap"><table>
      <thead><tr><th>Date</th><th class="txt">Loan</th><th>Amount</th><th class="txt">Note</th><th></th></tr></thead>
      <tbody>
        ${paymentRows.length===0?`<tr class="empty-row"><td colspan="5">No payments logged yet.</td></tr>`:paymentRows.map(p=>`
          <tr>
            <td class="txt">${p.date}</td>
            <td class="txt">${loanName(p.loan_id)}</td>
            <td>${KES0(p.amount_kes)}</td>
            <td class="txt">${p.note||''}</td>
            <td>${canWrite() ? `<button class="btn ghost sm" data-edit-payment="${p.id}">Edit</button> <button class="btn ghost sm" data-del-payment="${p.id}">Delete</button>` : '—'}</td>
          </tr>`).join('')}
      </tbody>
    </table></div>
  `;
}

/* ---------------- TAX CALENDAR ---------------- */

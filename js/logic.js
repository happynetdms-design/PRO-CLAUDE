/* ---------------- Derived / business logic ---------------- */

function pf(revenue){
  const s = state.settings;
  return {
    profit: revenue * s.pct_profit/100,
    owner_debt: revenue * s.pct_owner_debt/100,
    tax: revenue * s.pct_tax/100,
    opex: revenue * s.pct_opex/100
  };
}

function currentOpenMonth(){
  const active = state.dailyRevenue
    .map(r => monthKey(r.date))
    .filter(m => !state.closedMonths.includes(m));
  if(active.length === 0) return monthKey(todayISO());
  return active.sort().slice(-1)[0];
}

function revenueForMonth(ym){ return state.dailyRevenue.filter(r => monthKey(r.date) === ym); }
function calendarDaysElapsed(ym){
  const [year, month] = ym.split('-').map(Number);
  const monthStart = new Date(year, month - 1, 1);
  const today = new Date();
  const currentMonthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  if(monthStart < currentMonthStart) return daysInMonth(ym);
  if(monthStart > currentMonthStart) return 0;
  return Math.min(today.getDate(), daysInMonth(ym));
}
// Pending-approval and rejected expenses are real rows (visible, editable,
// approvable) but shouldn't move any money total until a Branch Manager or
// Head Office approves them — this is the one place that filter needs to
// live, since every other total is built from these two functions.
function postedExpenses(){ return state.expenses.filter(e => e.status !== 'pending_approval' && e.status !== 'rejected'); }
function statusTag(status){
  if(status==='pending_approval') return `<span class="tag neutral" style="background:var(--tone-gold-soft); color:var(--gold-deep);">Pending</span>`;
  if(status==='rejected') return `<span class="tag alert">Rejected</span>`;
  return `<span class="tag good">Posted</span>`;
}
async function approveExpense(id){
  try{
    await apiUpdate('/api/expenses', { branch_id: state.branchId, id, status:'posted', approve:true });
    const rec = state.expenses.find(e=>e.id===id);
    if(rec) rec.status = 'posted';
    lastSynced.expenses = JSON.parse(JSON.stringify(state.expenses));
    render();
  }catch(e){ showToast('Could not approve: '+e.message, 'error'); }
}
async function rejectExpense(id){
  try{
    await apiUpdate('/api/expenses', { branch_id: state.branchId, id, status:'rejected' });
    const rec = state.expenses.find(e=>e.id===id);
    if(rec) rec.status = 'rejected';
    lastSynced.expenses = JSON.parse(JSON.stringify(state.expenses));
    render();
  }catch(e){ showToast('Could not reject: '+e.message, 'error'); }
}
function expensesForMonth(ym){ return postedExpenses().filter(e => monthKey(e.date) === ym); }

function grossExpenseOn(date){ return postedExpenses().filter(e=>e.date===date).reduce((s,e)=>s+e.amount_kes+e.charges_kes,0); }
function ownerFundedOn(date){ return postedExpenses().filter(e=>e.date===date && e.owner_funded).reduce((s,e)=>s+e.amount_kes+e.charges_kes,0); }
function netExpenseOn(date){ return grossExpenseOn(date) - ownerFundedOn(date); }

function monthTotals(ym){
  const revRows = revenueForMonth(ym);
  const expRows = expensesForMonth(ym);
  const totalRevenue = revRows.reduce((s,r)=>s+r.revenue_kes,0);
  const grossOpex = expRows.reduce((s,e)=>s+e.amount_kes+e.charges_kes,0);
  const ownerFunded = expRows.filter(e=>e.owner_funded).reduce((s,e)=>s+e.amount_kes+e.charges_kes,0);
  const netOpex = grossOpex - ownerFunded;
  const alloc = pf(totalRevenue);
  const daysElapsed = calendarDaysElapsed(ym);
  const dim = daysInMonth(ym);
  return { totalRevenue, grossOpex, ownerFunded, netOpex, alloc, daysElapsed, dim, revRows, expRows };
}

function dashboardData(){
  const ym = currentOpenMonth();
  const t = monthTotals(ym);
  const target = state.settings.monthly_revenue_target_kes;
  const paceTarget = target * (t.daysElapsed / t.dim);
  const revenuePacePct = paceTarget > 0 ? (t.totalRevenue / paceTarget) * 100 : 0;
  const opexPacePct = t.alloc.opex > 0 ? (t.netOpex / t.alloc.opex) * 100 : 0;
  const projRevenue = t.daysElapsed > 0 ? (t.totalRevenue / t.daysElapsed) * t.dim : 0;
  const projOpex = t.daysElapsed > 0 ? (t.netOpex / t.daysElapsed) * t.dim : 0;
  const overspent = t.netOpex > t.alloc.opex;
  const opexVariance = t.alloc.opex - t.netOpex;
  return { ym, ...t, target, revenuePacePct, opexPacePct, projRevenue, projOpex, overspent, opexVariance };
}

function narrativeText(d){
  const monthName = monthLabel(d.ym);
  const revStatus = d.revenuePacePct >= 100 ? 'ahead of pace' : d.revenuePacePct >= 85 ? 'close to pace' : 'behind pace';
  const opexStatus = d.overspent ? `overspent by ${KES(Math.abs(d.opexVariance))}` : `within budget with ${KES(d.opexVariance)} left`;
  const projLine = d.projRevenue >= d.target
    ? `If this pace holds, ${monthName} should close above the ${KES(d.target)} target.`
    : `If this pace holds, ${monthName} will land around ${KES(d.projRevenue)}, short of the ${KES(d.target)} target.`;
  return `Day ${d.daysElapsed} of ${d.dim} in ${monthName}: revenue is ${revStatus} at ${d.revenuePacePct.toFixed(0)}% of target pace, `+
    `and Operating Expenses are ${opexStatus} against the ${KES(d.alloc.opex)} allocated so far. ${projLine} `+
    `Projected month-end OpEx sits at ${KES(d.projOpex)}.`;
}

function signalLevel(pct){
  if(pct >= 100) return 4;
  if(pct >= 80) return 3;
  if(pct >= 50) return 2;
  return 1;
}

function loanSummary(){
  const totalOriginal = state.loans.reduce((s,l)=>s+Number(l.original_principal_kes||0),0);
  const totalBalance = state.loans.reduce((s,l)=>s+Number(l.current_balance_kes||0),0);
  const pctCleared = totalOriginal > 0 ? ((totalOriginal-totalBalance)/totalOriginal)*100 : 0;
  const ym = currentOpenMonth();
  const t = monthTotals(ym);
  const availableThisMonth = t.alloc.owner_debt * (state.settings.debt_paydown_split_pct/100);
  // average monthly paydown across months with payments
  const byMonth = {};
  state.loanPayments.forEach(p => { const m = monthKey(p.date); byMonth[m]=(byMonth[m]||0)+Number(p.amount_kes||0); });
  const months = Object.keys(byMonth);
  const avgMonthly = months.length ? Object.values(byMonth).reduce((a,b)=>a+b,0)/months.length : 0;
  let projectedDate = 'Not enough data yet';
  if(avgMonthly > 0 && totalBalance > 0){
    const monthsLeft = Math.ceil(totalBalance/avgMonthly);
    const d = new Date(); d.setMonth(d.getMonth()+monthsLeft);
    projectedDate = d.toLocaleString('en-US',{month:'long',year:'numeric'});
  } else if(totalBalance <= 0 && state.loans.length){
    projectedDate = 'Debt-free';
  }
  return { totalOriginal, totalBalance, pctCleared, availableThisMonth, avgMonthly, projectedDate };
}

/* ---------------- Router / render ---------------- */

/* ---------------- SETTINGS ---------------- */

function viewSettings(){
  const s = state.settings;
  const pctSum = Number(s.pct_profit)+Number(s.pct_owner_debt)+Number(s.pct_tax)+Number(s.pct_opex);
  return `
    <div class="topbar"><div><h1>Settings</h1><div class="sub">Allocation percentages must sum to 100%.</div></div></div>

    ${canManageSettings() ? `
    <div class="form-card">
      <h3>Profit First allocation</h3>
      <form id="form-settings">
        <div class="form-row">
          <div><label>Profit %</label><input type="number" name="pct_profit" min="0" max="100" step="0.5" value="${s.pct_profit}"></div>
          <div><label>Owner Pay &amp; Debt %</label><input type="number" name="pct_owner_debt" min="0" max="100" step="0.5" value="${s.pct_owner_debt}"></div>
          <div><label>Tax Reserve %</label><input type="number" name="pct_tax" min="0" max="100" step="0.5" value="${s.pct_tax}"></div>
          <div><label>OpEx %</label><input type="number" name="pct_opex" min="0" max="100" step="0.5" value="${s.pct_opex}"></div>
        </div>
        <div class="hint" style="margin-bottom:12px;">Current sum: <b>${pctSum}%</b> ${pctSum!==100?'— must equal 100% to save':''}</div>
        <div class="form-row">
          <div><label>Debt paydown split % (of Owner Pay &amp; Debt bucket)</label><input type="number" name="debt_paydown_split_pct" min="0" max="100" value="${s.debt_paydown_split_pct}"></div>
          <div><label>Monthly revenue target (KES)</label><input type="number" name="monthly_revenue_target_kes" min="0" value="${s.monthly_revenue_target_kes}"></div>
          <div><label>Opening OpEx account balance (KES)</label><input type="number" name="opening_opex_account_balance_kes" min="0" value="${s.opening_opex_account_balance_kes}"></div>
        </div>
        <button class="btn gold" type="submit">Save Settings</button>
        <div id="settings-err"></div>
      </form>
    </div>` : `
    <div class="form-card">
      <h3>Profit First allocation</h3>
      <div class="hint" style="display:flex; align-items:center; gap:8px; margin-bottom:14px;">${ic('lock',14)}Only Head Office or the Branch Manager can change this split.</div>
      <div class="form-row">
        <div><label>Profit %</label><div class="big" style="font-size:18px;">${s.pct_profit}%</div></div>
        <div><label>Owner Pay &amp; Debt %</label><div class="big" style="font-size:18px;">${s.pct_owner_debt}%</div></div>
        <div><label>Tax Reserve %</label><div class="big" style="font-size:18px;">${s.pct_tax}%</div></div>
        <div><label>OpEx %</label><div class="big" style="font-size:18px;">${s.pct_opex}%</div></div>
      </div>
    </div>`}

    <div class="section-head"><h2>Expense categories</h2></div>
    <div class="card">
      <div class="sub" style="margin-bottom:10px;">These appear in the category dropdown when logging or filtering expenses. Add or remove them to match how Happynet actually spends money.</div>
      <div style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
        ${CATS().map(c=>`<span class="tag neutral" style="gap:8px;">${c}${canWrite()?`<button type="button" data-del-category="${c}" style="all:unset; cursor:pointer; font-weight:700;">&times;</button>`:''}</span>`).join('')}
      </div>
      ${canWrite() ? `<button class="btn ghost sm" id="btn-add-category-settings">+ Add category</button>` : ''}
    </div>

    <div class="section-head"><h2>Data</h2></div>
    <div class="card" style="display:flex; gap:10px; flex-wrap:wrap; align-items:center;">
      <button class="btn ghost" id="btn-export">Export all data (JSON)</button>
      <span class="hint">Everything lives in one place — no duplicate copies to keep in sync.</span>
    </div>
  `;
}

/* ---------------- Event wiring ---------------- */

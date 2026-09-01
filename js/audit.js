/* ---------------- Audit Log ---------------- */
let auditState = { loading:false, entries:null, error:null, filterTable:'' };
let syncHealthState = { checked:false, count:0, errors:[], tables:[], tablesOk:0, tablesTotal:0 };

async function checkSyncHealth(){
  if(!state.isHeadOffice) return;
  try{
    const res = await apiFetch('/api/sync-health', { method:'GET' });
    if(!res.ok) return; // fail silent here too — this is a health check, not a critical path
    const body = await res.json();
    syncHealthState = { checked:true, count: body.count||0, errors: body.errors||[], tables: body.tables||[], tablesOk: body.tables_ok_count||0, tablesTotal: body.tables_total||0 };
  }catch(e){ /* silent — matches the sync itself: never let a health check disrupt anything */ }
  render();
}
async function loadSyncErrors(){
  try{
    const res = await apiFetch('/api/sync-health', { method:'GET' });
    const body = await res.json();
    if(res.ok) syncHealthState = { checked:true, count: body.count||0, errors: body.errors||[], tables: body.tables||[], tablesOk: body.tables_ok_count||0, tablesTotal: body.tables_total||0 };
  }catch(e){}
  render();
}

async function loadAudit(tableFilter){
  auditState.loading = true; render();
  try{
    let url = '/api/audit?limit=300';
    if(tableFilter) url += `&table_name=${encodeURIComponent(tableFilter)}`;
    const res = await apiFetch(url, { method:'GET' });
    const body = await res.json();
    if(!res.ok) throw new Error(body.error || 'Could not load the audit log.');
    auditState.entries = body.audit_log || [];
    auditState.error = null;
  }catch(e){ auditState.error = e.message; }
  auditState.loading = false;
  render();
}
function diffSummary(oldData, newData){
  if(!oldData) return 'Created';
  if(!newData) return 'Deleted';
  const changed = [];
  const keys = new Set([...Object.keys(oldData||{}), ...Object.keys(newData||{})]);
  for(const k of keys){
    if(['updated_at','created_at'].includes(k)) continue;
    const a = JSON.stringify(oldData[k]), b = JSON.stringify(newData[k]);
    if(a !== b) changed.push(`${k}: ${a} → ${b}`);
  }
  return changed.length ? changed.join('; ') : 'No field changes';
}

function viewAudit(){
  const { loading, error, filterTable } = auditState;
  const entries = auditState.entries ? sortRows('audit', auditState.entries, (row, key) => row[key], 'changed_at', 'desc') : null;
  const AUDIT_TABLES = ['revenue_entries','expenses','loans','bills','bill_payments','journal_entries','tax_periods','accounting_periods','bank_statement_imports','bank_statement_lines'];
  return `
    <div class="topbar"><div><h1>Audit Log</h1><div class="sub">Every tracked change across revenue, expenses, loans, bills, journal entries, tax periods, accounting period closes, and reconciliation — who, when, and what changed. Read-only, Head Office only.</div></div>
      <div class="topbar-actions">
        <select id="audit-filter-table">
          <option value="">All tables</option>
          ${AUDIT_TABLES.map(t=>`<option value="${t}" ${filterTable===t?'selected':''}>${t}</option>`).join('')}
        </select>
      </div>
    </div>

    <div class="section-head"><h2>Ledger sync health</h2>
      <div class="toolbar"><button class="btn ghost sm" id="btn-refresh-sync-health">Refresh</button></div>
    </div>
    <div class="card" style="margin-bottom:22px;">
      ${syncHealthState.count === 0 ? `<div style="display:flex; align-items:center; gap:10px;">${ic('trendUp',16)}<span>No sync failures recorded — the ledger is staying in sync with revenue, expenses, and loans as expected.</span></div>` : `
        <div class="hint" style="color:#c0392b; margin-bottom:12px;">${syncHealthState.count} sync failure(s) recorded. The ledger sync is deliberately fail-silent — these never blocked the original entry from saving — but the ledger may be missing or misrepresenting the rows below until this is investigated.</div>
        <table>
          <thead><tr><th>When</th><th class="txt">Source Table</th><th class="txt">Source Row</th><th class="txt">Error</th></tr></thead>
          <tbody>
            ${syncHealthState.errors.map(e=>`<tr><td class="txt">${new Date(e.occurred_at).toLocaleString()}</td><td class="txt">${e.source_table}</td><td class="txt" style="font-family:'IBM Plex Mono',monospace; font-size:11px;">${e.source_id}</td><td class="txt">${e.error_message}</td></tr>`).join('')}
          </tbody>
        </table>
      `}
    </div>

    ${syncHealthState.tables && syncHealthState.tables.length ? `
    <div class="section-head"><h2>Foundation SQL status</h2>
      <div class="toolbar"><span class="hint">${syncHealthState.tablesOk} of ${syncHealthState.tablesTotal} feature tables reachable</span></div>
    </div>
    <div class="card" style="margin-bottom:22px;">
      <div class="hint" style="margin-bottom:12px;">Confirms each table exists and is queryable — not that its logic is correct, just that the corresponding foundation-fix SQL file has actually been run on this Supabase project.</div>
      <table>
        <thead><tr><th class="txt">Table</th><th class="txt">Status</th><th class="txt">Needed SQL file</th></tr></thead>
        <tbody>
          ${syncHealthState.tables.map(t=>`<tr><td class="txt" style="font-family:'IBM Plex Mono',monospace; font-size:12px;">${t.table}</td><td class="txt"><span class="tag ${t.status==='ok'?'good':'alert'}">${t.status==='ok'?'Reachable':'Not set up'}</span></td><td class="txt" style="font-size:12px;">${t.status==='ok'?'—':t.file}</td></tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}

    ${loading ? `<div class="card"><span class="hint">Loading…</span></div>` : ''}
    ${error ? `<div class="card"><div class="hint" style="color:#c0392b;">${error}</div></div>` : ''}
    ${entries ? `
    <div class="table-wrap"><table>
      <thead><tr>${sortableHeaderHtml('When','changed_at','audit')}${sortableHeaderHtml('Table','table_name','audit')}${sortableHeaderHtml('Action','action','audit')}<th class="txt">Change</th></tr></thead>
      <tbody>
        ${(()=>{ const { pageRows } = paginateRows('audit', entries); return pageRows.length===0 ? `<tr class="empty-row"><td colspan="4">No audit entries yet.</td></tr>` : pageRows.map(e=>`
          <tr>
            <td class="txt">${new Date(e.changed_at).toLocaleString()}</td>
            <td class="txt">${e.table_name}</td>
            <td class="txt"><span class="tag ${e.action==='insert'?'good':e.action==='soft_delete'?'alert':'neutral'}" ${e.action==='status_change'?'style="background:var(--tone-gold-soft); color:var(--gold-deep);"':''}>${e.action}</span></td>
            <td class="txt" style="font-family:'IBM Plex Mono',monospace; font-size:11.5px;">${diffSummary(e.old_data, e.new_data)}</td>
          </tr>`).join(''); })()}
      </tbody>
    </table></div>
    ${paginationControlsHtml('audit', paginateRows('audit', entries))}
    ` : ''}
  `;
}

function viewStaff(){
  const { branches, grants, loading, error, formError } = staffState;
  return `
    <div class="topbar"><div><h1>Staff &amp; Access</h1><div class="sub">Visible to Head Office only — controls who can see which branch, and at what role.</div></div></div>

    <div class="section-head"><h2>Branches</h2></div>
    <div class="card" style="margin-bottom:22px;">
      ${loading && !branches ? `<span class="hint">Loading…</span>` : (branches && branches.length ? `
        <table style="margin-bottom:16px;"><thead><tr><th>Name</th><th>Code</th></tr></thead>
        <tbody>${branches.map(b=>`<tr><td>${b.name}</td><td class="txt">${b.code}</td></tr>`).join('')}</tbody></table>
      ` : `<div class="hint" style="margin-bottom:16px;">No branches yet.</div>`)}
      <form id="form-add-branch" style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end;">
        <div><label style="display:block; font-size:11.5px; font-weight:600; color:var(--muted); margin-bottom:4px;">Branch name</label><input type="text" name="name" placeholder="e.g. Kisumu Branch" required></div>
        <div><label style="display:block; font-size:11.5px; font-weight:600; color:var(--muted); margin-bottom:4px;">Code</label><input type="text" name="code" placeholder="e.g. kisumu" pattern="[a-z0-9-]+" required></div>
        <button class="btn gold" type="submit">Add Branch</button>
      </form>
    </div>

    <div class="section-head"><h2>Access grants</h2></div>
    <div class="card">
      ${error ? `<div class="hint" style="color:#c0392b; margin-bottom:12px;">${error}</div>` : ''}
      ${formError ? `<div class="hint" style="color:#c0392b; margin-bottom:12px;">${formError}</div>` : ''}
      ${loading && !grants ? `<span class="hint">Loading…</span>` : `
      <div class="table-wrap"><table>
        <thead><tr><th>Person</th><th>Branch</th><th>Role</th><th></th></tr></thead>
        <tbody>
          ${(grants||[]).length===0 ? `<tr class="empty-row"><td colspan="4">No access grants yet.</td></tr>` : (grants||[]).map(g=>`
            <tr>
              <td class="txt">${g.email || '(unknown)'}</td>
              <td class="txt">${g.branches ? g.branches.name : ''}</td>
              <td class="txt" style="text-transform:capitalize;">${g.role.replace(/_/g,' ')}</td>
              <td><button class="btn ghost sm" data-revoke-user="${g.user_id}" data-revoke-branch="${g.branch_id}">Revoke</button></td>
            </tr>`).join('')}
        </tbody>
      </table></div>`}

      <form id="form-grant-access" style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end; margin-top:18px; padding-top:18px; border-top:1px solid var(--hair);">
        <div><label style="display:block; font-size:11.5px; font-weight:600; color:var(--muted); margin-bottom:4px;">Email (must already have a Supabase account)</label><input type="email" name="email" placeholder="person@happynet.co.ke" required></div>
        <div><label style="display:block; font-size:11.5px; font-weight:600; color:var(--muted); margin-bottom:4px;">Branch</label>
          <select name="branch_id" required>${(branches||[]).map(b=>`<option value="${b.id}">${b.name}</option>`).join('')}</select>
        </div>
        <div><label style="display:block; font-size:11.5px; font-weight:600; color:var(--muted); margin-bottom:4px;">Role</label>
          <select name="role" required>${ROLE_OPTIONS.map(r=>`<option value="${r}">${r.replace(/_/g,' ')}</option>`).join('')}</select>
        </div>
        <button class="btn gold" type="submit">Grant Access</button>
      </form>
    </div>
  `;
}
function wireStaffTab(){
  const branchForm = document.getElementById('form-add-branch');
  if(branchForm) branchForm.addEventListener('submit', e=>{
    e.preventDefault();
    const fd = new FormData(branchForm);
    createBranch(fd.get('name'), fd.get('code'));
  });
  const grantForm = document.getElementById('form-grant-access');
  if(grantForm) grantForm.addEventListener('submit', e=>{
    e.preventDefault();
    const fd = new FormData(grantForm);
    grantAccess(fd.get('email'), fd.get('branch_id'), fd.get('role'));
  });
  document.querySelectorAll('[data-revoke-user]').forEach(b=>b.addEventListener('click', ()=>{
    revokeAccess(b.dataset.revokeUser, b.dataset.revokeBranch);
  }));
}




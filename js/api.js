/* ---------------- API layer ---------------- */
// Wraps fetch to /api/*: attaches the bearer token and retries once after a
// silent refresh if the token turned out to be expired.
async function apiFetch(path, options={}, _retried){
  const s = getSession();
  const headers = Object.assign({}, options.headers, { 'Authorization':'Bearer '+(s ? s.access_token : '') });
  const res = await fetch(path, Object.assign({}, options, { headers }));
  if(res.status === 401 && !_retried){
    const refreshed = await apiRefresh();
    if(refreshed) return apiFetch(path, options, true);
  }
  return res;
}

async function apiGetState(){
  const res = await apiFetch('/api/state', { method:'GET' });
  if(!res.ok) throw new Error('unauthorized');
  const body = await res.json();
  return body.data || {};
}

async function apiSaveState(data){
  const res = await apiFetch('/api/state', {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({ data })
  });
  if(!res.ok) throw new Error('save failed');
  return true;
}

// Per-branch home for categories/monthlyArchive/closedMonths — see
// supabase/branch_misc_state.sql for why this exists separately from
// apiGetState()/apiSaveState() above, which still hit the old single-row
// /api/state purely as a whole-app mirror/rollback point.
async function apiGetBranchMisc(branchId){
  const res = await apiFetch('/api/branch-state?branch_id=' + branchId, { method:'GET' });
  if(!res.ok) throw new Error('Could not load branch data.');
  const body = await res.json();
  return body.data || {};
}
async function apiSaveBranchMisc(branchId, data){
  const res = await apiFetch('/api/branch-state', {
    method:'POST', headers: JSONH,
    body: JSON.stringify({ branch_id: branchId, data })
  });
  if(!res.ok) throw new Error('Could not save branch data.');
  return true;
}

/* ---------------- Phase 3: per-resource API (revenue, expenses, loans,
   loan payments, tax, settings). /api/state is kept ONLY for the pieces
   that aren't normalized tables yet: categories, monthlyArchive,
   closedMonths. Everything money-related below goes through its own
   RBAC-checked, audited endpoint. ---------------- */

async function apiGetMe(){
  const res = await apiFetch('/api/me', { method:'GET' });
  if(!res.ok) throw new Error('Could not load your access.');
  return res.json();
}

const JSONH = { 'Content-Type':'application/json' };

async function apiList(path, branchId, extraQuery){
  const qs = new URLSearchParams(Object.assign({ branch_id: branchId }, extraQuery||{}));
  const res = await apiFetch(path + '?' + qs.toString(), { method:'GET' });
  if(!res.ok) throw new Error('Failed to load ' + path);
  return res.json();
}
async function apiCreate(path, body){
  const res = await apiFetch(path, { method:'POST', headers: JSONH, body: JSON.stringify(body) });
  if(!res.ok){ const b = await res.json().catch(()=>({})); throw new Error(b.error || ('Create failed: ' + path)); }
  return res.json();
}
async function apiUpdate(path, body){
  const res = await apiFetch(path, { method:'PATCH', headers: JSONH, body: JSON.stringify(body) });
  if(!res.ok){ const b = await res.json().catch(()=>({})); throw new Error(b.error || ('Update failed: ' + path)); }
  return res.json();
}
async function apiRemove(path, body){
  const res = await apiFetch(path, { method:'DELETE', headers: JSONH, body: JSON.stringify(body) });
  if(!res.ok){ const b = await res.json().catch(()=>({})); throw new Error(b.error || ('Delete failed: ' + path)); }
  return res.json();
}
async function apiPutSettings(body){
  const res = await apiFetch('/api/settings', { method:'PUT', headers: JSONH, body: JSON.stringify(body) });
  if(!res.ok){ const b = await res.json().catch(()=>({})); throw new Error(b.error || 'Settings update failed'); }
  return res.json();
}


/* ---------------- Staff & Access (Phase 3 completion) ---------------- */
const ROLE_OPTIONS = ['owner','finance_manager','accountant','branch_manager','auditor','viewer'];
let staffState = { branches:null, grants:null, loading:false, error:null, formError:null };

function normalizeBranchList(branches){
  if(!Array.isArray(branches)) return [];
  return branches
    .map(branch => {
      const id = branch && (branch.id || branch.branch_id || branch.uuid || null);
      const branchId = branch && (branch.branch_id || branch.id || branch.uuid || null);
      return {
        ...branch,
        id,
        branch_id: branchId,
        name: branch && (branch.name || branch.branch_name || 'Unnamed branch'),
        code: branch && (branch.code || '')
      };
    })
    .filter(branch => !!(branch.id || branch.branch_id));
}

async function loadStaffData(){
  staffState.loading = true; staffState.error = null; render();
  try{
    const [branchesRes, staffRes] = await Promise.all([
      apiFetch('/api/branches', { method:'GET' }).then(safeParseJson),
      apiFetch('/api/staff', { method:'GET' }).then(safeParseJson)
    ]);

    const apiBranches = normalizeBranchList(branchesRes && branchesRes.branches);
    const stateBranches = normalizeBranchList(state && state.allBranches);
    const branches = apiBranches.length ? apiBranches : stateBranches;

    staffState.branches = branches;
    staffState.grants = Array.isArray(staffRes && staffRes.grants) ? staffRes.grants : [];
    if(!branches.length && !(staffRes && Array.isArray(staffRes.grants) && staffRes.grants.length)){
      staffState.error = branchesRes && branchesRes.error ? branchesRes.error : null;
    }
  }catch(e){
    staffState.error = e.message.includes('SUPABASE_SERVICE_ROLE_KEY')
      ? 'Local API is missing SUPABASE_SERVICE_ROLE_KEY. Add the server-only key to .env.local and restart Vite.'
      : e.message;
  }
  staffState.loading = false;
  render();
}
async function createBranch(name, code){
  staffState.formError = null;
  try{
    const res = await apiFetch('/api/branches', { method:'POST', headers: JSONH, body: JSON.stringify({ name, code }) });
    const body = await safeParseJson(res);
    if(!res.ok) throw new Error(body.error || 'Could not create that branch.');
    await loadStaffData();
    await loadState(state.branchId); // refresh state.allBranches so the switcher picks it up
    render();
  }catch(e){
    staffState.formError = e.message.includes('SUPABASE_SERVICE_ROLE_KEY')
      ? 'Local API is missing SUPABASE_SERVICE_ROLE_KEY. Add the server-only key to .env.local and restart Vite.'
      : e.message;
    render();
  }
}
async function grantAccess(email, branchId, role){
  staffState.formError = null;
  try{
    const res = await apiFetch('/api/staff', { method:'POST', headers: JSONH, body: JSON.stringify({ email, branch_id: branchId, role }) });
    const body = await safeParseJson(res);
    if(!res.ok) throw new Error(body.error || 'Could not grant access.');
    await loadStaffData();
  }catch(e){
    staffState.formError = e.message.includes('SUPABASE_SERVICE_ROLE_KEY')
      ? 'Local API is missing SUPABASE_SERVICE_ROLE_KEY. Add the server-only key to .env.local and restart Vite.'
      : e.message;
    render();
  }
}
async function revokeAccess(userId, branchId){
  if(!(await confirmDialog('Revoke this person\'s access to this branch?'))) return;
  try{
    const res = await apiFetch('/api/staff', { method:'DELETE', headers: JSONH, body: JSON.stringify({ user_id: userId, branch_id: branchId }) });
    const body = await safeParseJson(res);
    if(!res.ok) throw new Error(body.error || 'Could not revoke access.');
    await loadStaffData();
  }catch(e){
    staffState.error = e.message; render();
  }
}


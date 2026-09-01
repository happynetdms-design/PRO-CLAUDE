/* ---------------- API layer (Direct Supabase Migration) ---------------- */

const JSONH = { 'Content-Type': 'application/json' };

// Safe JSON parser that handles HTML error responses (e.g., from misconfigured routing)
async function safeParseJson(response){
  const text = await response.text();
  if(!text) return {};
  try {
    return JSON.parse(text);
  } catch(e) {
    if(text.trim().startsWith('<')){
      throw new Error('Server returned an error page instead of JSON. Check API routing and function deployment.');
    }
    throw new Error('Invalid JSON response from server.');
  }
}

// Shared authenticated transport for feature endpoints that still run on
// Netlify (AI, reconciliation, statements, and other server-side workflows).
// Login itself is handled by js/services/auth.js; this helper only forwards
// the already-authenticated Supabase access token.
async function apiFetch(path, options = {}, retried = false){
  const session = getSession();
  const headers = new Headers(options.headers || {});
  if(!headers.has('Authorization')){
    const token = session && (session.access_token || session.token);
    if(token) headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(path, { ...options, headers });
  if(response.status === 401 && !retried && typeof apiRefresh === 'function'){
    if(await apiRefresh()) return apiFetch(path, options, true);
  }
  return response;
}

// 1. Session & Access
async function apiGetMe() {
  const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
  if (authError || !user) return {
    user: null,
    is_head_office: false,
    access_pending: true,
    suggested_branch: null,
    branches: []
  };

  try {
    const access = await resolveUserAccess(user);
    const accessData = access.grants[0];

    return {
      user: {
        ...user,
        ...(accessData || {})
      },
      is_head_office: access.grants.some(grant => grant.role === 'owner' || grant.role === 'finance_manager'),
      access_pending: access.pending,
      suggested_branch: access.suggestedBranch || null,
      branches: access.grants
    };
  } catch (error) {
    const message = String(error && error.message || '').toLowerCase();
    if (message.includes('could not load your access') || message.includes('could not validate your branch access') || message.includes('no branch access')) {
      return {
        user: { ...user },
        is_head_office: false,
        access_pending: true,
        suggested_branch: null,
        branches: []
      };
    }
    throw error;
  }
}

// 2. Global State Mirror (api/state replacement)
async function apiGetState() {
  const { data, error } = await supabaseClient
    .from('app_state')
    .select('data')
    .eq('id', 'happynet')
    .maybeSingle();

  if (error) throw new Error('unauthorized');
  return data?.data || {};
}

async function apiSaveState(data) {
  const { error } = await supabaseClient
    .from('app_state')
    .upsert({ id: 'happynet', data, updated_at: new Date().toISOString() });

  if (error) throw new Error('save failed');
  return true;
}

// 3. Branch Misc State (api/branch-state replacement)
async function apiGetBranchMisc(branchId) {
  const { data, error } = await supabaseClient
    .from('branch_misc_state')
    .select('data')
    .eq('branch_id', branchId)
    .maybeSingle();

  if (error) throw new Error('Could not load branch data.');
  return data?.data || {};
}

async function apiSaveBranchMisc(branchId, data) {
  const { error } = await supabaseClient
    .from('branch_misc_state')
    .upsert({ branch_id: branchId, data, updated_at: new Date().toISOString() }, { onConflict: 'branch_id' });

  if (error) throw new Error('Could not save branch data.');
  return true;
}

// 4. Generic CRUD Helper Wrappers (Mapped paths -> Supabase tables)
function getTableName(path) {
  const endpoint = path.replace(/^\/?(api\/)?/, '').split('?')[0];
  return {
    revenue:'revenue_entries',
    'loan-payments':'loan_payments',
    tax:'tax_obligations'
  }[endpoint] || endpoint;
}

function getResponseKey(path){
  const endpoint = path.replace(/^\/?(api\/)?/, '').split('?')[0];
  return { revenue:'revenue', expenses:'expenses', loans:'loans', 'loan-payments':'loan_payments', tax:'tax_obligations' }[endpoint] || endpoint;
}

async function apiList(path, branchId, extraQuery = {}) {
  const table = getTableName(path);
  let query = table === 'loan_payments'
    ? supabaseClient.from(table).select('*, loans!inner(branch_id)')
    : supabaseClient.from(table).select('*');

  if (branchId){
    query = table === 'loan_payments'
      ? query.eq('loans.branch_id', branchId)
      : query.eq('branch_id', branchId);
  }
  
  Object.keys(extraQuery).forEach(key => {
    query = query.eq(key, extraQuery[key]);
  });

  const { data, error } = await query;
  if (error) throw new Error('Failed to load ' + path);
  
  // Wrap array response inside { data: [...] } to match legacy API parser structures
  return { [getResponseKey(path)]: data || [], data: data || [] };
}

async function apiCreate(path, body) {
  const table = getTableName(path);
  const { data, error } = await supabaseClient
    .from(table)
    .insert(body)
    .select()
    .single();

  if (error) throw new Error(error.message || ('Create failed: ' + path));
  return { data };
}

async function apiUpdate(path, body) {
  const table = getTableName(path);
  if (!body.id) throw new Error('Update requires an id field');

  const { data, error } = await supabaseClient
    .from(table)
    .update(body)
    .eq('id', body.id)
    .select()
    .single();

  if (error) throw new Error(error.message || ('Update failed: ' + path));
  return { data };
}

async function apiRemove(path, body) {
  const table = getTableName(path);
  if (!body.id) throw new Error('Delete requires an id field');

  const { error } = await supabaseClient
    .from(table)
    .delete()
    .eq('id', body.id);

  if (error) throw new Error(error.message || ('Delete failed: ' + path));
  return { success: true };
}

async function apiPutSettings(body) {
  const { data, error } = await supabaseClient
    .from('profit_first_settings')
    .upsert(body, { onConflict:'branch_id' })
    .select()
    .single();
  if (error) throw new Error(error.message || 'Settings update failed');
  return { settings:data };
}

async function apiGetSettings(branchId){
  const { data, error } = await supabaseClient
    .from('profit_first_settings')
    .select('*')
    .eq('branch_id', branchId)
    .maybeSingle();
  if(error) throw new Error('Could not load settings.');
  return { settings:data };
}
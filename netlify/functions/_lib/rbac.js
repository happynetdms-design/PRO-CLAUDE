// Role-based access control for Netlify Functions.
//
// The database RLS policies (Phase 1 schema) are a second line of defense.
// The primary enforcement happens HERE, in application code, because every
// function talks to Postgres through the service_role key and therefore
// bypasses RLS entirely. If you forget to call requireBranchAccess() in a
// new endpoint, that endpoint has no access control. Treat this file as
// load-bearing.

const WRITE_ROLES = ['owner', 'finance_manager', 'branch_manager', 'accountant'];
const READ_ROLES  = ['owner', 'finance_manager', 'branch_manager', 'accountant', 'auditor', 'viewer'];
const ROLE_PERMISSIONS = {
  owner: ['read', 'write', 'approve', 'settings', 'periods', 'administration'],
  finance_manager: ['read', 'write', 'approve', 'settings', 'periods', 'administration'],
  branch_manager: ['read', 'write', 'approve', 'settings', 'periods'],
  accountant: ['read', 'write'],
  auditor: ['read'],
  viewer: ['read']
};

// Loads every branch this user has been granted, plus whether they're
// Head Office (owner/finance_manager — implicitly see every branch).
async function getAccess(admin, userId){
  const { data, error } = await admin
    .from('user_branch_access')
    .select('branch_id, role, branches(name, code)')
    .eq('user_id', userId);

  if(error) throw new Error(error.message);

  const grants = data || [];
  const isHeadOffice = grants.some(g => g.role === 'owner' || g.role === 'finance_manager');
  const byBranch = new Map(grants.map(g => [g.branch_id, g.role]));

  return { isHeadOffice, byBranch, grants };
}

// Returns the effective role a user has on a branch, resolving Head Office
// as an implicit 'owner'-equivalent even if their only grant row is on a
// different branch (Head Office roles are meant to be company-wide).
function roleOnBranch(access, branchId){
  if(access.isHeadOffice) return access.byBranch.get(branchId) || 'owner';
  return access.byBranch.get(branchId) || null;
}

function canRead(access, branchId){
  if(access.isHeadOffice) return true;
  const role = access.byBranch.get(branchId);
  return !!role && READ_ROLES.includes(role);
}

function canWrite(access, branchId){
  if(access.isHeadOffice) return true;
  const role = access.byBranch.get(branchId);
  return roleAllows(role, 'write');
}

function roleAllows(role, permission){
  return !!ROLE_PERMISSIONS[role] && ROLE_PERMISSIONS[role].includes(permission);
}

function canApprove(access, branchId){
  if(access.isHeadOffice) return true;
  return roleAllows(access.byBranch.get(branchId), 'approve');
}

function canAdminister(access){
  return access.isHeadOffice;
}

// One-stop helper for endpoints: validates the session token, loads the
// caller's access grants, confirms they can act on the given branch_id at
// the required level, and returns everything the handler needs.
//
//   const ctx = await requireBranchAccess(event, { requireUser, branchId, write:true });
//   if(ctx.error) return json(ctx.status, { error: ctx.error });
//
async function requireBranchAccess(event, requireUser, admin, branchId, { write = false } = {}){
  const { user, error } = await requireUser(event);
  if(error) return { error, status: 401 };
  if(!branchId) return { error: 'branch_id is required.', status: 400 };

  const access = await getAccess(admin, user.id);
  const allowed = write ? canWrite(access, branchId) : canRead(access, branchId);
  if(!allowed) return { error: 'You do not have access to this branch.', status: 403 };

  return { user, access, role: roleOnBranch(access, branchId), status: 200 };
}

module.exports = { getAccess, roleOnBranch, roleAllows, canRead, canWrite, canApprove, canAdminister, requireBranchAccess, WRITE_ROLES, READ_ROLES, ROLE_PERMISSIONS };

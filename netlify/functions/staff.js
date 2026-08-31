// Staff & Access management — Head Office only (owner/finance_manager).
// There's no public sign-up (see supabase/hfms_schema_v2.sql's header
// comment) — staff accounts are still created manually in the Supabase
// dashboard. This endpoint only manages which BRANCH and ROLE an already-
// created account gets, via user_branch_access.
const { requireUser, adminClient, json } = require('./_lib/supabase');
const { getAccess } = require('./_lib/rbac');

const VALID_ROLES = ['owner', 'finance_manager', 'accountant', 'branch_manager', 'auditor', 'viewer'];

// supabase-js's admin API doesn't expose "get user by email" directly —
// only listUsers() (paginated) and getUserById(). Fine for a small team;
// would need a smarter lookup at real scale.
async function findUserByEmail(admin, email){
  let page = 1;
  const perPage = 200;
  while(true){
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if(error) throw new Error(error.message);
    const match = data.users.find(u => u.email && u.email.toLowerCase() === email.toLowerCase());
    if(match) return match;
    if(data.users.length < perPage) return null; // last page, no match
    page++;
  }
}

exports.handler = async (event) => {
  const admin = adminClient();
  const method = event.httpMethod;

  const { user, error } = await requireUser(event);
  if(error) return json(401, { error });

  try{
    const access = await getAccess(admin, user.id);
    if(!access.isHeadOffice) return json(403, { error: 'Staff & Access is visible to Head Office roles only.' });

    if(method === 'GET'){
      const { data, error: dbErr } = await admin
        .from('user_branch_access')
        .select('user_id, branch_id, role, granted_at, branches(name, code)')
        .order('granted_at', { ascending: false });
      if(dbErr) return json(500, { error: dbErr.message });

      // Resolve each user_id to an email — small team, fine to do one at a time.
      const uniqueIds = [...new Set(data.map(r => r.user_id))];
      const emailById = {};
      for(const id of uniqueIds){
        try{
          const { data: u } = await admin.auth.admin.getUserById(id);
          emailById[id] = u && u.user ? u.user.email : null;
        }catch(e){ emailById[id] = null; }
      }

      return json(200, { grants: data.map(r => ({ ...r, email: emailById[r.user_id] })) });
    }

    if(method === 'POST'){
      let body;
      try{ body = JSON.parse(event.body || '{}'); }
      catch(e){ return json(400, { error: 'Invalid JSON body.' }); }
      const { email, branch_id, role } = body;
      if(!email || !branch_id || !role) return json(400, { error: 'email, branch_id and role are required.' });
      if(!VALID_ROLES.includes(role)) return json(400, { error: `role must be one of: ${VALID_ROLES.join(', ')}.` });

      const matchedUser = await findUserByEmail(admin, email);
      if(!matchedUser) return json(404, { error: `No account exists for ${email} yet — create it in Supabase → Authentication → Users first.` });

      const { data: grant, error: grantErr } = await admin
        .from('user_branch_access')
        .upsert({ user_id: matchedUser.id, branch_id, role, granted_by: user.id }, { onConflict: 'user_id,branch_id' })
        .select().maybeSingle();
      if(grantErr) return json(500, { error: grantErr.message });
      return json(201, { grant: { ...grant, email: matchedUser.email } });
    }

    if(method === 'DELETE'){
      let body;
      try{ body = JSON.parse(event.body || '{}'); }
      catch(e){ return json(400, { error: 'Invalid JSON body.' }); }
      if(!body.user_id || !body.branch_id) return json(400, { error: 'user_id and branch_id are required.' });
      if(body.user_id === user.id) return json(400, { error: "You can't revoke your own access." });

      const { error: delErr } = await admin
        .from('user_branch_access').delete().eq('user_id', body.user_id).eq('branch_id', body.branch_id);
      if(delErr) return json(500, { error: delErr.message });
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed.' });
  }catch(e){
    console.error('staff error', e);
    return json(500, { error: 'Unexpected error handling staff access.' });
  }
};

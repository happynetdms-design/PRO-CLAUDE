const { requireUser, adminClient, json } = require('./_lib/supabase');
const { getAccess } = require('./_lib/rbac');

exports.handler = async (event) => {
  if(event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed.' });

  const { user, admin, error } = await requireUser(event);
  if(error) return json(401, { error });

  try{
    const access = await getAccess(admin, user.id);

    const { data: profile } = await admin
      .from('user_profiles')
      .select('full_name')
      .eq('user_id', user.id)
      .maybeSingle();

    return json(200, {
      user: { id: user.id, email: user.email, full_name: profile ? profile.full_name : null },
      is_head_office: access.isHeadOffice,
      branches: access.grants.map(g => ({
        branch_id: g.branch_id,
        name: g.branches ? g.branches.name : null,
        code: g.branches ? g.branches.code : null,
        role: g.role
      }))
    });
  }catch(e){
    console.error('me error', e);
    return json(500, { error: 'Unexpected error loading your access.' });
  }
};

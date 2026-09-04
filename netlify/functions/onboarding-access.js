const { requireUser, adminClient, json } = require('./_lib/supabase');
const { ensureDefaultAccess } = require('./_lib/onboarding');

exports.handler = async (event) => {
  if(event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
  const { user, error } = await requireUser(event);
  if(error) return json(401, { error });

  try{
    const result = await ensureDefaultAccess(adminClient(), user.id);
    return json(200, result);
  }catch(e){
    console.error('onboarding access error', e);
    return json(500, { error:'Unexpected error provisioning default access.' });
  }
};
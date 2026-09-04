async function ensureDefaultAccess(admin, userId){
  let { data: company, error: companyErr } = await admin
    .from('companies').select('id').order('created_at', { ascending:true }).limit(1).maybeSingle();
  if(companyErr) throw companyErr;
  if(!company){
    const result = await admin.from('companies').insert({ name:'Happynet Internet Services' }).select('id').maybeSingle();
    if(result.error) throw result.error;
    company = result.data;
  }

  let { data: branch, error: branchErr } = await admin
    .from('branches').select('id, name, code').eq('company_id', company.id).eq('code', 'main').eq('is_active', true).maybeSingle();
  if(branchErr) throw branchErr;
  if(!branch){
    const result = await admin.from('branches')
      .insert({ company_id:company.id, name:'Main Branch', code:'main', is_active:true })
      .select('id, name, code').maybeSingle();
    if(result.error && result.error.code !== '23505') throw result.error;
    const existing = await admin.from('branches')
      .select('id, name, code').eq('company_id', company.id).eq('code', 'main').eq('is_active', true).maybeSingle();
    if(existing.error) throw existing.error;
    branch = existing.data;
  }
  if(!branch) throw new Error('Main Branch is unavailable.');

  const result = await admin.from('user_branch_access').upsert({
    user_id:userId, branch_id:branch.id, role:'viewer', granted_by:null
  }, { onConflict:'user_id,branch_id' }).select('branch_id, role').maybeSingle();
  if(result.error) throw result.error;
  return { grant:result.data, branch };
}

module.exports = { ensureDefaultAccess };
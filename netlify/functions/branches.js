const { requireUser, adminClient, json } = require('./_lib/supabase');
const { getAccess } = require('./_lib/rbac');

// New branches always get the same starter accounts as the very first
// branch did during the Phase 1 migration, so a new branch is immediately
// usable without a manual setup step in Supabase.
const DEFAULT_ACCOUNTS = [
  { name: 'M-Pesa Till', kind: 'mobile_money' },
  { name: 'Bank Account', kind: 'bank' },
  { name: 'Petty Cash', kind: 'cash' },
  { name: 'Owner Personal Wallet', kind: 'owner_wallet' }
];

exports.handler = async (event) => {
  const admin = adminClient();
  const method = event.httpMethod;

  const { user, error } = await requireUser(event);
  if(error) return json(401, { error });

  try{
    const access = await getAccess(admin, user.id);

    if(method === 'GET'){
      if(access.isHeadOffice){
        const { data, error: dbErr } = await admin
          .from('branches').select('id, name, code, is_active').eq('is_active', true).order('name');
        if(dbErr) return json(500, { error: dbErr.message });
        return json(200, { branches: data });
      }
      const branchIds = [...access.byBranch.keys()];
      if(branchIds.length === 0) return json(200, { branches: [] });
      const { data, error: dbErr } = await admin
        .from('branches').select('id, name, code, is_active').in('id', branchIds).eq('is_active', true).order('name');
      if(dbErr) return json(500, { error: dbErr.message });
      return json(200, { branches: data });
    }

    if(method === 'POST'){
      if(!access.isHeadOffice) return json(403, { error: 'Only Head Office can create a new branch.' });
      let body;
      try{ body = JSON.parse(event.body || '{}'); }
      catch(e){ return json(400, { error: 'Invalid JSON body.' }); }
      if(!body.name || !body.code) return json(400, { error: 'name and code are required.' });
      if(!/^[a-z0-9-]+$/.test(body.code)) return json(400, { error: 'code must be lowercase letters, numbers, and hyphens only.' });

      const { data: company } = await admin.from('companies').select('id').limit(1).maybeSingle();
      if(!company) return json(500, { error: 'No company row found — was the Phase 1 migration ever run?' });

      const { data: branch, error: branchErr } = await admin
        .from('branches').insert({ company_id: company.id, name: body.name, code: body.code })
        .select().maybeSingle();
      if(branchErr){
        if(branchErr.code === '23505') return json(409, { error: `A branch with code "${body.code}" already exists.` });
        return json(500, { error: branchErr.message });
      }

      await admin.from('financial_accounts').insert(DEFAULT_ACCOUNTS.map(a => ({ branch_id: branch.id, ...a })));
      await admin.from('profit_first_settings').insert({ branch_id: branch.id });

      // Whoever created the branch gets owner-equivalent access to it too,
      // even though Head Office already sees every branch implicitly — this
      // makes the grant explicit and visible in the Staff & Access list.
      await admin.from('user_branch_access').insert({ user_id: user.id, branch_id: branch.id, role: 'owner', granted_by: user.id });

      return json(201, { branch });
    }

    return json(405, { error: 'Method not allowed.' });
  }catch(e){
    console.error('branches error', e);
    return json(500, { error: 'Unexpected error handling branches.' });
  }
};

// Reconciliation — import a bank/mobile-money statement as parsed rows,
// auto-match against the ledger, resolve the rest manually. Never writes
// to financial_transactions or the journal — reconciliation proves the
// ledger is right, it doesn't change it.
const { requireUser, adminClient, json } = require('./_lib/supabase');
const { requireBranchAccess } = require('./_lib/rbac');

exports.handler = async (event) => {
  const admin = adminClient();
  const method = event.httpMethod;
  const action = (event.queryStringParameters || {}).action;

  let body = {};
  if(method !== 'GET'){
    try{ body = JSON.parse(event.body || '{}'); }
    catch(e){ return json(400, { error: 'Invalid JSON body.' }); }
  }
  const branchId = method === 'GET' ? (event.queryStringParameters || {}).branch_id : body.branch_id;

  const ctx = await requireBranchAccess(event, requireUser, admin, branchId, { write: method !== 'GET' });
  if(ctx.error) return json(ctx.status, { error: ctx.error });

  try{
    if(method === 'GET'){
      const importId = (event.queryStringParameters || {}).import_id;
      if(importId){
        const [{ data: lines, error: linesErr }, { data: suggestions }] = await Promise.all([
          admin.from('bank_statement_lines').select('*').eq('import_id', importId).order('line_date'),
          admin.from('v_hfms_reconciliation_suggestions').select('*').eq('import_id', importId)
        ]);
        if(linesErr) return json(500, { error: linesErr.message });
        return json(200, { lines, suggestions: suggestions || [] });
      }
      const { data, error } = await admin.from('bank_statement_imports').select('*, financial_accounts(name)').eq('branch_id', branchId).order('imported_at', { ascending: false });
      if(error) return json(500, { error: error.message });
      return json(200, { imports: data });
    }

    if(method === 'POST' && action === 'create'){
      const { label, period_start, period_end, account_name, lines } = body;
      if(!label || !period_start || !period_end || !Array.isArray(lines) || lines.length === 0){
        return json(400, { error: 'label, period_start, period_end, and at least one line are required.' });
      }
      let account_id = null;
      if(account_name){
        const { data: acc } = await admin.from('financial_accounts').select('id').eq('branch_id', branchId).eq('name', account_name).maybeSingle();
        account_id = acc ? acc.id : null;
      }
      const { data: imp, error: impErr } = await admin
        .from('bank_statement_imports')
        .insert({ branch_id: branchId, account_id, label, period_start, period_end, imported_by: ctx.user.id })
        .select().maybeSingle();
      if(impErr) return json(500, { error: impErr.message });

      // direction comes from the sign of amount_kes if not given explicitly
      // (positive = inflow/deposit, negative = outflow/withdrawal) — matches
      // how a plain-text pasted statement most naturally reads.
      const linePayload = lines.map(l => ({
        import_id: imp.id, line_date: l.date, description: l.description || null,
        amount_kes: Math.abs(Number(l.amount_kes)),
        direction: l.direction || (Number(l.amount_kes) >= 0 ? 'inflow' : 'outflow'),
        external_ref: l.external_ref || null
      })).filter(l => l.amount_kes > 0 && (l.direction === 'inflow' || l.direction === 'outflow'));

      if(linePayload.length === 0) return json(400, { error: 'No valid lines after parsing — check the amount/direction values.' });

      const { error: lineErr } = await admin.from('bank_statement_lines').insert(linePayload);
      if(lineErr) return json(500, { error: lineErr.message });

      const { data: matchedCount, error: matchErr } = await admin.rpc('hfms_auto_match_statement', { p_import_id: imp.id });
      if(matchErr) return json(500, { error: 'Import succeeded but auto-matching failed: ' + matchErr.message });

      return json(201, { import: imp, lines_added: linePayload.length, auto_matched: matchedCount });
    }

    if(method === 'POST' && action === 'rematch'){
      if(!body.import_id) return json(400, { error: 'import_id is required.' });
      const { data: matchedCount, error } = await admin.rpc('hfms_auto_match_statement', { p_import_id: body.import_id });
      if(error) return json(500, { error: error.message });
      return json(200, { auto_matched: matchedCount });
    }

    if(method === 'POST' && action === 'resolve'){
      const { line_id, resolution, matched_transaction_id, note } = body; // resolution: 'match' | 'exclude'
      if(!line_id || !resolution) return json(400, { error: 'line_id and resolution are required.' });
      const patch = { resolved_by: ctx.user.id, resolved_at: new Date().toISOString(), resolution_note: note || null };
      if(resolution === 'match'){
        if(!matched_transaction_id) return json(400, { error: 'matched_transaction_id is required to manually match a line.' });
        patch.match_status = 'matched'; patch.matched_transaction_id = matched_transaction_id; patch.match_confidence = 'manual';
      } else if(resolution === 'exclude'){
        patch.match_status = 'excluded';
      } else {
        return json(400, { error: "resolution must be 'match' or 'exclude'." });
      }
      const { data, error } = await admin.from('bank_statement_lines').update(patch).eq('id', line_id).select().maybeSingle();
      if(error) return json(500, { error: error.message });
      return json(200, { line: data });
    }

    if(method === 'POST' && action === 'submit'){
      if(!body.import_id) return json(400, { error: 'import_id is required.' });
      const { count: unmatched } = await admin.from('bank_statement_lines').select('id', { count: 'exact', head: true })
        .eq('import_id', body.import_id).eq('match_status', 'unmatched');
      if(unmatched > 0) return json(400, { error: `${unmatched} line(s) still unmatched — resolve or exclude every line before submitting.` });
      const { error } = await admin.from('bank_statement_imports').update({ status: 'submitted' }).eq('id', body.import_id);
      if(error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }

    if(method === 'POST' && action === 'approve'){
      if(!ctx.access.isHeadOffice && ctx.role !== 'branch_manager'){
        return json(403, { error: 'Only Head Office or the Branch Manager can approve a reconciliation.' });
      }
      if(!body.import_id) return json(400, { error: 'import_id is required.' });
      const { error } = await admin.from('bank_statement_imports')
        .update({ status: 'approved', approved_by: ctx.user.id, approved_at: new Date().toISOString() })
        .eq('id', body.import_id);
      if(error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed.' });
  }catch(e){
    console.error('reconciliation error', e);
    return json(500, { error: 'Unexpected error handling reconciliation.' });
  }
};

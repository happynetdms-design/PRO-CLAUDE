const { requireUser, adminClient, json } = require('./_lib/supabase');
const { requireBranchAccess } = require('./_lib/rbac');

exports.handler = async (event) => {
  const admin = adminClient();
  const method = event.httpMethod;

  let body = {};
  if(method !== 'GET'){
    try{ body = JSON.parse(event.body || '{}'); }
    catch(e){ return json(400, { error: 'Invalid JSON body.' }); }
  }
  const branchId = method === 'GET' ? (event.queryStringParameters || {}).branch_id : body.branch_id;

  const ctx = await requireBranchAccess(event, requireUser, admin, branchId, { write: method !== 'GET' });
  if(ctx.error) return json(ctx.status, { error: ctx.error });

  try{
    if(method === 'GET' && (event.queryStringParameters||{}).action === 'statement'){
      const supplierId = event.queryStringParameters.supplier_id;
      if(!supplierId) return json(400, { error: 'supplier_id is required.' });
      const { data, error } = await admin.from('v_hfms_supplier_statement').select('*').eq('supplier_id', supplierId).order('invoice_date');
      if(error) return json(500, { error: error.message });
      return json(200, { statement: data });
    }

    if(method === 'GET' && (event.queryStringParameters||{}).action === 'documents'){
      const supplierId = event.queryStringParameters.supplier_id;
      if(!supplierId) return json(400, { error: 'supplier_id is required.' });
      const { data, error } = await admin.from('supplier_documents').select('*').eq('supplier_id', supplierId).order('uploaded_at', { ascending: false });
      if(error) return json(500, { error: error.message });
      const withUrls = await Promise.all((data||[]).map(async d => {
        const { data: signed } = await admin.storage.from('receipts').createSignedUrl(d.storage_path, 300);
        return { ...d, url: signed ? signed.signedUrl : null };
      }));
      return json(200, { documents: withUrls });
    }

    if(method === 'POST' && (event.queryStringParameters||{}).action === 'upload-document'){
      const { supplier_id, label, file_name, content_type, data_base64 } = body;
      if(!supplier_id || !file_name || !data_base64) return json(400, { error: 'supplier_id, file_name, and data_base64 are required.' });
      let buffer;
      try{ buffer = Buffer.from(data_base64, 'base64'); }
      catch(e){ return json(400, { error: 'data_base64 is not valid base64.' }); }
      const safeName = file_name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `${branchId}/supplier_documents/${supplier_id}/${Date.now()}-${safeName}`;
      const { error: uploadErr } = await admin.storage.from('receipts').upload(storagePath, buffer, { contentType: content_type || 'application/octet-stream' });
      if(uploadErr) return json(500, { error: uploadErr.message });
      const { data, error } = await admin.from('supplier_documents')
        .insert({ supplier_id, label: label || file_name, storage_path: storagePath, uploaded_by: ctx.user.id })
        .select().maybeSingle();
      if(error) return json(500, { error: error.message });
      return json(201, { document: data });
    }

    if(method === 'GET'){
      const { data, error } = await admin.from('suppliers').select('*').eq('branch_id', branchId).order('name');
      if(error) return json(500, { error: error.message });
      return json(200, { suppliers: data });
    }

    if(method === 'POST'){
      if(!body.name) return json(400, { error: 'name is required.' });
      const payload = { branch_id: branchId, name: body.name, contact: body.contact || null, notes: body.notes || null };
      // kra_pin only exists after hfms_foundation_fix_10_supplier_fields.sql
      // has been run — only include it if the caller actually sent one, so
      // supplier creation keeps working on a database that hasn't run that
      // file yet (an unconditional key here would break every insert with
      // "column kra_pin does not exist").
      if(body.kra_pin !== undefined) payload.kra_pin = body.kra_pin || null;
      const { data, error } = await admin.from('suppliers').insert(payload).select().maybeSingle();
      if(error){
        if(error.code === '23505') return json(409, { error: `A supplier named "${body.name}" already exists on this branch.` });
        return json(500, { error: error.message });
      }
      return json(201, { supplier: data });
    }

    if(method === 'PATCH'){
      if(!body.id) return json(400, { error: 'id is required.' });
      const updatable = ['name', 'contact', 'notes', 'kra_pin', 'is_active'];
      const patch = {};
      for(const k of updatable) if(body[k] !== undefined) patch[k] = body[k];
      const { data, error } = await admin.from('suppliers').update(patch).eq('id', body.id).eq('branch_id', branchId).select().maybeSingle();
      if(error) return json(500, { error: error.message });
      if(!data) return json(404, { error: 'Supplier not found on this branch.' });
      return json(200, { supplier: data });
    }

    return json(405, { error: 'Method not allowed.' });
  }catch(e){
    console.error('suppliers error', e);
    return json(500, { error: 'Unexpected error handling suppliers.' });
  }
};

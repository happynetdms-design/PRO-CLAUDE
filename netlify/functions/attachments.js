// Receipt/invoice attachments. Files travel as base64 in the JSON body
// (simplest thing that works within a Netlify Function's request size
// limit — fine for typical phone-photo receipts, not built for huge PDFs).
//
// entity_type is one of: 'expense' | 'revenue_entry' | 'loan'. Every
// operation first confirms the referenced entity actually belongs to the
// caller's branch, so someone can't attach a file to, or read attachments
// from, a record outside branches they have access to.
const { requireUser, adminClient, json } = require('./_lib/supabase');
const { requireBranchAccess } = require('./_lib/rbac');

const ENTITY_TABLES = {
  expense: 'expenses',
  revenue_entry: 'revenue_entries',
  loan: 'loans'
};
const SIGNED_URL_TTL_SECONDS = 300;
const MAX_BASE64_BYTES = 8 * 1024 * 1024; // ~6MB file after base64 overhead — keeps us under typical function payload limits

async function entityBelongsToBranch(admin, entityType, entityId, branchId){
  const table = ENTITY_TABLES[entityType];
  if(!table) return false;
  const { data } = await admin.from(table).select('id').eq('id', entityId).eq('branch_id', branchId).maybeSingle();
  return !!data;
}

exports.handler = async (event) => {
  const admin = adminClient();
  const method = event.httpMethod;

  let body = {};
  if(method !== 'GET'){
    try{ body = JSON.parse(event.body || '{}'); }
    catch(e){ return json(400, { error: 'Invalid JSON body.' }); }
  }
  const branchId = method === 'GET'
    ? (event.queryStringParameters || {}).branch_id
    : body.branch_id;

  const ctx = await requireBranchAccess(event, requireUser, admin, branchId, { write: method !== 'GET' });
  if(ctx.error) return json(ctx.status, { error: ctx.error });

  try{
    if(method === 'GET'){
      const { entity_type, entity_id } = event.queryStringParameters || {};
      if(!entity_type || !entity_id) return json(400, { error: 'entity_type and entity_id are required.' });
      if(!(await entityBelongsToBranch(admin, entity_type, entity_id, branchId))){
        return json(404, { error: 'Record not found on this branch.' });
      }

      const { data, error } = await admin
        .from('attachments').select('*')
        .eq('entity_type', entity_type).eq('entity_id', entity_id)
        .order('uploaded_at', { ascending: false });
      if(error) return json(500, { error: error.message });

      const withUrls = await Promise.all((data || []).map(async a => {
        const { data: signed } = await admin.storage.from('receipts')
          .createSignedUrl(a.storage_path, SIGNED_URL_TTL_SECONDS);
        return { ...a, url: signed ? signed.signedUrl : null };
      }));
      return json(200, { attachments: withUrls });
    }

    if(method === 'POST'){
      const { entity_type, entity_id, file_name, content_type, data_base64 } = body;
      if(!entity_type || !entity_id || !file_name || !data_base64){
        return json(400, { error: 'entity_type, entity_id, file_name and data_base64 are required.' });
      }
      if(!ENTITY_TABLES[entity_type]) return json(400, { error: `entity_type must be one of: ${Object.keys(ENTITY_TABLES).join(', ')}.` });
      if(data_base64.length > MAX_BASE64_BYTES) return json(413, { error: 'File is too large.' });
      if(!(await entityBelongsToBranch(admin, entity_type, entity_id, branchId))){
        return json(404, { error: 'Record not found on this branch.' });
      }

      let buffer;
      try{ buffer = Buffer.from(data_base64, 'base64'); }
      catch(e){ return json(400, { error: 'data_base64 is not valid base64.' }); }

      const safeName = file_name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `${branchId}/${entity_type}/${entity_id}/${Date.now()}-${safeName}`;

      const { error: uploadErr } = await admin.storage.from('receipts')
        .upload(storagePath, buffer, { contentType: content_type || 'application/octet-stream' });
      if(uploadErr) return json(500, { error: uploadErr.message });

      const { data: attachment, error: dbErr } = await admin
        .from('attachments')
        .insert({ entity_type, entity_id, storage_path: storagePath, uploaded_by: ctx.user.id })
        .select().maybeSingle();
      if(dbErr) return json(500, { error: dbErr.message });

      const { data: signed } = await admin.storage.from('receipts').createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);
      return json(201, { attachment: { ...attachment, url: signed ? signed.signedUrl : null } });
    }

    if(method === 'DELETE'){
      if(!body.id) return json(400, { error: 'id is required.' });
      const { data: attachment } = await admin.from('attachments').select('*').eq('id', body.id).maybeSingle();
      if(!attachment) return json(404, { error: 'Attachment not found.' });
      if(!(await entityBelongsToBranch(admin, attachment.entity_type, attachment.entity_id, branchId))){
        return json(404, { error: 'Attachment not found on this branch.' });
      }

      await admin.storage.from('receipts').remove([attachment.storage_path]);
      const { error } = await admin.from('attachments').delete().eq('id', body.id);
      if(error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }

    return json(405, { error: 'Method not allowed.' });
  }catch(e){
    console.error('attachments error', e);
    return json(500, { error: 'Unexpected error handling attachments.' });
  }
};

// Document intelligence — extracts structured fields (vendor, date,
// amount, suggested category) from a photo of a receipt or invoice using
// Claude's vision API. This is held for human review; it never creates an
// expense or bill on its own. Reuses the 'receipts' Storage bucket
// already created in Phase 4 — no new bucket needed.
const { requireUser, adminClient, json } = require('./_lib/supabase');
const { requireBranchAccess } = require('./_lib/rbac');

const MODEL = 'claude-sonnet-4-20250514';
const MAX_BASE64_BYTES = 8 * 1024 * 1024;

// A model's text output can never be trusted to parse as JSON just
// because it was asked to — strip common wrapping (markdown code fences)
// and fail closed (return null, not throw) if it still doesn't parse.
// A failed extraction should degrade to "enter this manually," never crash.
function parseExtractionJson(text){
  if(!text) return null;
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if(fenceMatch) cleaned = fenceMatch[1].trim();
  try{
    const parsed = JSON.parse(cleaned);
    if(typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    return parsed;
  }catch(e){
    return null;
  }
}

const EXTRACTION_PROMPT = `Look at this receipt or invoice image. Extract these fields and respond with ONLY a JSON object, nothing else — no markdown fences, no explanation:
{
  "vendor": "the business/supplier name, or null if not legible",
  "date": "YYYY-MM-DD, or null if not legible",
  "amount_kes": a number (the total amount, no currency symbol or commas), or null if not legible,
  "description": "a short one-line description of what this appears to be for",
  "suggested_category": "your best guess at an expense category (e.g. Fuel, Internet & Bandwidth, Office Supplies, Repairs), or null if unclear",
  "confidence": "high", "medium", or "low" — how confident you are in the extracted fields overall
}
If the image isn't a receipt or invoice, or is unreadable, set confidence to "low" and fill fields with null where you can't read them. Never guess at a number you can't actually see — use null instead.`;

exports.handler = async (event) => {
  const admin = adminClient();
  const method = event.httpMethod;

  let body = {};
  if(method !== 'GET'){
    try{ body = JSON.parse(event.body || '{}'); }
    catch(e){ return json(400, { error: 'Invalid JSON body.' }); }
  }
  const branchId = method === 'GET' ? (event.queryStringParameters || {}).branch_id : body.branch_id;
  const action = (event.queryStringParameters || {}).action || body.action;

  const ctx = await requireBranchAccess(event, requireUser, admin, branchId, { write: method !== 'GET' });
  if(ctx.error) return json(ctx.status, { error: ctx.error });

  try{
    if(method === 'GET'){
      const { data, error } = await admin.from('document_intelligence_queue').select('*')
        .eq('branch_id', branchId).order('created_at', { ascending: false }).limit(50);
      if(error) return json(500, { error: error.message });
      return json(200, { queue: data });
    }

    if(method === 'POST' && action === 'resolve'){
      const { id, status } = body;
      if(!id || !['used','rejected'].includes(status)) return json(400, { error: "id and status ('used' or 'rejected') are required." });
      const { error } = await admin.from('document_intelligence_queue')
        .update({ status, resolved_by: ctx.user.id, resolved_at: new Date().toISOString() })
        .eq('id', id).eq('branch_id', branchId);
      if(error) return json(500, { error: error.message });
      return json(200, { ok: true });
    }

    if(method === 'POST'){ // extract
      const { file_name, content_type, data_base64, document_type } = body;
      if(!file_name || !data_base64) return json(400, { error: 'file_name and data_base64 are required.' });
      if(data_base64.length > MAX_BASE64_BYTES) return json(413, { error: 'File is too large.' });
      if(!process.env.ANTHROPIC_API_KEY){
        return json(500, { error: 'Document intelligence is not configured — ANTHROPIC_API_KEY is missing from this site\'s environment variables.' });
      }

      let buffer;
      try{ buffer = Buffer.from(data_base64, 'base64'); }
      catch(e){ return json(400, { error: 'data_base64 is not valid base64.' }); }

      const safeName = file_name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const storagePath = `${branchId}/document_intelligence/${Date.now()}-${safeName}`;
      const { error: uploadErr } = await admin.storage.from('receipts')
        .upload(storagePath, buffer, { contentType: content_type || 'image/jpeg' });
      if(uploadErr) return json(500, { error: uploadErr.message });

      const mediaType = (content_type && content_type.startsWith('image/')) ? content_type : 'image/jpeg';
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: 512,
          messages: [{
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: mediaType, data: data_base64 } },
              { type: 'text', text: EXTRACTION_PROMPT }
            ]
          }]
        })
      });

      let extracted = null, confidence = 'failed';
      if(res.ok){
        const data = await res.json();
        const text = (data.content || []).filter(b=>b.type==='text').map(b=>b.text).join('\n');
        extracted = parseExtractionJson(text);
        confidence = extracted ? (extracted.confidence || 'medium') : 'failed';
      } else {
        console.error('Anthropic API error during extraction', res.status, await res.text());
      }

      const { data: queueRow, error: queueErr } = await admin.from('document_intelligence_queue')
        .insert({
          branch_id: branchId, uploaded_by: ctx.user.id, document_type: document_type || 'receipt',
          storage_path: storagePath, extracted_data: extracted, confidence
        })
        .select().maybeSingle();
      if(queueErr) return json(500, { error: queueErr.message });

      const { data: signed } = await admin.storage.from('receipts').createSignedUrl(storagePath, 300);
      return json(201, {
        queue_id: queueRow.id, extracted, confidence,
        image_url: signed ? signed.signedUrl : null,
        note: extracted ? null : 'Could not extract structured data from this image — enter the details manually.'
      });
    }

    return json(405, { error: 'Method not allowed.' });
  }catch(e){
    console.error('document-intelligence error', e);
    return json(500, { error: 'Unexpected error processing the document.' });
  }
};

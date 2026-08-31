// Extracts transaction rows from a photo or PDF of a bank/mobile-money
// statement, using Claude's vision API — same technique as
// document-intelligence.js, extended to multiple rows instead of one
// receipt's few fields.
//
// HONESTY NOTE, worth reading before trusting this in production: unlike
// the Tende and Organization Utility CSV parsers elsewhere in this app —
// which were built and proven against real exported files, with exact
// totals matching to the shilling — this has NOT been tested against a
// real bank statement document. It's built with the same defensive
// discipline (strict JSON-only prompt, fenced-JSON stripping, fail-closed
// on anything that doesn't parse, never invents a number it can't read),
// but a dense statement table is a harder extraction problem than a
// single receipt, and confidence in this should stay lower until it's
// been run against an actual statement and checked against that
// statement's own reported totals — the same standard the CSV parsers
// were held to.
//
// This never imports anything on its own. The extracted rows are
// returned for the person to review and edit, then fed into the existing
// reconciliation import (the same pasted-lines format, same auto-match,
// same human-approval workflow already proven in
// hfms_foundation_fix_05_reconciliation.sql) — never a separate, unproven
// import path.
const { requireUser, adminClient, json } = require('./_lib/supabase');
const { requireBranchAccess } = require('./_lib/rbac');

const MODEL = 'claude-sonnet-5';
const MAX_BASE64_BYTES = 15 * 1024 * 1024;
const MAX_ROWS = 200;

function parseExtractionJson(text){
  if(!text) return null;
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if(fenceMatch) cleaned = fenceMatch[1].trim();
  try{
    const parsed = JSON.parse(cleaned);
    if(typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return null;
    if(!Array.isArray(parsed.transactions)) return null;
    return parsed;
  }catch(e){
    return null;
  }
}

// Defensive row validation — a model can return syntactically valid JSON
// full of semantically broken rows. Every row is checked individually; a
// bad row is dropped, not defaulted to a guessed value, and reported so
// the person knows some rows need manual entry instead of vanishing.
function sanitizeRows(rawRows){
  const rows = [], dropped = [];
  for(const r of (rawRows || []).slice(0, MAX_ROWS)){
    const date = typeof r.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(r.date) ? r.date : null;
    const amount = Number(r.amount_kes);
    const direction = r.direction === 'inflow' || r.direction === 'outflow' ? r.direction : null;
    if(!date || !isFinite(amount) || amount <= 0 || !direction){
      dropped.push(r);
      continue;
    }
    rows.push({ date, amount_kes: amount, direction, description: typeof r.description === 'string' ? r.description.slice(0,200) : '' });
  }
  return { rows, dropped };
}

const EXTRACTION_PROMPT = `Look at this bank or mobile-money statement (photo or PDF page). Extract every transaction row you can clearly read and respond with ONLY a JSON object, nothing else — no markdown fences, no explanation:
{
  "transactions": [
    { "date": "YYYY-MM-DD", "description": "short description from the statement", "amount_kes": a positive number with no currency symbol or commas, "direction": "inflow" or "outflow" }
  ],
  "confidence": "high", "medium", or "low" — how confident you are in the extraction overall,
  "statement_total_paid_in": a number if the statement shows its own total deposits, else null,
  "statement_total_withdrawn": a number if the statement shows its own total withdrawals, else null
}
Rules:
- Only include a row if you can clearly read its date, amount, and whether it's money in or out. Skip anything you can't read confidently — do not guess.
- "direction" is "inflow" for money received/deposited, "outflow" for money sent/withdrawn/paid.
- If the statement shows its own printed totals, include them in statement_total_paid_in/statement_total_withdrawn so the extraction can be checked against them — include it whenever visible.
- If this isn't a financial statement, or is entirely unreadable, return an empty transactions array and confidence "low".`;

exports.handler = async (event) => {
  if(event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
  const admin = adminClient();

  let body;
  try{ body = JSON.parse(event.body || '{}'); }
  catch(e){ return json(400, { error: 'Invalid JSON body.' }); }

  const { branch_id: branchId, file_name, content_type, data_base64 } = body;
  const ctx = await requireBranchAccess(event, requireUser, admin, branchId, { write: false });
  if(ctx.error) return json(ctx.status, { error: ctx.error });

  if(!file_name || !data_base64) return json(400, { error: 'file_name and data_base64 are required.' });
  if(data_base64.length > MAX_BASE64_BYTES) return json(413, { error: 'File is too large.' });
  if(!process.env.ANTHROPIC_API_KEY){
    return json(500, { error: 'Statement extraction is not configured — ANTHROPIC_API_KEY is missing from this site\'s environment variables.' });
  }

  const isPdf = content_type === 'application/pdf' || /\.pdf$/i.test(file_name);
  const mediaType = isPdf ? 'application/pdf' : ((content_type && content_type.startsWith('image/')) ? content_type : 'image/jpeg');
  const contentBlock = isPdf
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: data_base64 } }
    : { type: 'image', source: { type: 'base64', media_type: mediaType, data: data_base64 } };

  try{
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        messages: [{ role: 'user', content: [contentBlock, { type: 'text', text: EXTRACTION_PROMPT }] }]
      })
    });

    if(!res.ok){
      const errText = await res.text();
      console.error('Anthropic API error during statement extraction', res.status, errText);
      return json(502, { error: 'Could not read this statement — the extraction service is temporarily unavailable.' });
    }

    const data = await res.json();
    const text = (data.content || []).filter(b=>b.type==='text').map(b=>b.text).join('\n');
    const parsed = parseExtractionJson(text);

    if(!parsed){
      return json(200, { rows: [], dropped_count: 0, confidence: 'failed', note: 'Could not extract structured data from this document — enter the statement lines manually instead.' });
    }

    const { rows, dropped } = sanitizeRows(parsed.transactions);

    return json(200, {
      rows, dropped_count: dropped.length,
      confidence: parsed.confidence || 'medium',
      statement_total_paid_in: parsed.statement_total_paid_in ?? null,
      statement_total_withdrawn: parsed.statement_total_withdrawn ?? null,
      note: rows.length === 0 ? 'No rows could be confidently extracted — enter the statement lines manually instead.' : null
    });
  }catch(e){
    console.error('statement-extraction error', e);
    return json(500, { error: 'Unexpected error processing the statement.' });
  }
};

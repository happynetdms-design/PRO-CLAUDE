/* ---------------- AI Assistant (Phase 6) ---------------- */
// Every answer is generated server-side from a fresh pull of this branch's
// actual data (see netlify/functions/ai-assistant.js) — nothing here sends
// raw financial records to the model from the browser, only the question
// and a short rolling history for follow-up context.
let assistantMessages = []; // {role:'user'|'assistant', content}
let assistantLoading = false;
let assistantError = null;
let assistantConversationId = null;
let docIntelState = { loading:false, result:null, error:null, context:null };

// context: 'expense' | 'bill' — keeps a receipt extracted while on one
// form from ever showing up pre-filling the other after switching tabs.
async function extractFromReceipt(file, context){
  if(!file) return;
  docIntelState = { loading:true, result:null, error:null, context };
  render();
  try{
    const dataUrl = await new Promise((res, rej) => {
      const reader = new FileReader();
      reader.onload = () => res(reader.result);
      reader.onerror = () => rej(new Error('Could not read that file.'));
      reader.readAsDataURL(file);
    });
    const base64 = dataUrl.split(',')[1] || '';
    const res = await apiFetch('/api/document-intelligence', {
      method:'POST', headers: JSONH,
      body: JSON.stringify({ branch_id: state.branchId, file_name: file.name, content_type: file.type || 'image/jpeg', data_base64: base64, document_type: context === 'bill' ? 'invoice' : 'receipt' })
    });
    const body = await safeParseJson(res);
    if(!res.ok) throw new Error(body.error || 'Could not read this document.');
    docIntelState.result = body;
  }catch(e){
    docIntelState.error = e.message;
  }
  docIntelState.loading = false;
  render();
}
// Best-effort: does the extracted vendor name match an existing supplier?
// Never auto-creates a supplier from an OCR guess — just pre-selects one
// if there's a confident match, otherwise leaves it for the person to pick
// or add.
function matchSupplierByName(vendorName, suppliers){
  if(!vendorName || !suppliers) return null;
  const v = vendorName.toLowerCase().trim();
  const exact = suppliers.find(s => s.name.toLowerCase().trim() === v);
  if(exact) return exact.id;
  const partial = suppliers.find(s => v.includes(s.name.toLowerCase().trim()) || s.name.toLowerCase().includes(v));
  return partial ? partial.id : null;
}
// Only returns an extraction if it was made for THIS form — switching
// tabs after extracting on one form never leaks a stale result into the
// other's fields.
function docIntelExtractedFor(context){
  return docIntelState.context === context ? (docIntelState.result?.extracted || null) : null;
}
let followUpsState = { loading:false, items:null, error:null };

async function loadFollowUps(){
  followUpsState.loading = true; render();
  try{
    const res = await apiFetch(`/api/ai-followups?branch_id=${state.branchId}`, { method:'GET' });
    const body = await safeParseJson(res);
    if(!res.ok) throw new Error(body.error || 'Could not load follow-ups.');
    followUpsState.items = body.follow_ups || [];
    followUpsState.error = null;
  }catch(e){ followUpsState.error = e.message; }
  followUpsState.loading = false;
  render();
}
async function trackFollowUp(messageIndex){
  const msg = assistantMessages[messageIndex];
  if(!msg) return;
  try{
    const res = await apiFetch('/api/ai-followups', { method:'POST', headers: JSONH, body: JSON.stringify({ branch_id: state.branchId, description: msg.content }) });
    const body = await safeParseJson(res);
    if(!res.ok) throw new Error(body.error || 'Could not track this.');
    await loadFollowUps();
  }catch(e){ showToast(e.message, 'error'); }
}
async function resolveFollowUp(id, status){
  try{
    const res = await apiFetch('/api/ai-followups', { method:'PATCH', headers: JSONH, body: JSON.stringify({ branch_id: state.branchId, id, status }) });
    const body = await safeParseJson(res);
    if(!res.ok) throw new Error(body.error || 'Could not update.');
    await loadFollowUps();
  }catch(e){ showToast(e.message, 'error'); }
}

function viewAssistant(){
  return `
    <div class="topbar"><div><h1>AI Assistant</h1><div class="sub">Answers come only from your actual Happynet data — ledger, loans, tax, and Profit First included — and it'll say so if something isn't available yet, rather than guess.</div></div></div>
    <div class="card" style="max-width:820px; margin-bottom:20px;">
      <div id="assistant-thread" style="display:flex; flex-direction:column; gap:12px; min-height:120px; margin-bottom:14px;">
        ${assistantMessages.length===0 ? `<div class="hint">Try: "How did expenses change last month?" or "Are we on track for the OpEx budget this month?"</div>` : ''}
        ${assistantMessages.map((m,i) => `
          <div style="align-self:${m.role==='user'?'flex-end':'flex-start'}; max-width:85%;">
            <div style="font-size:11px; color:var(--muted); margin-bottom:2px; text-transform:uppercase; letter-spacing:.04em;">${m.role==='user'?'You':'Assistant'}</div>
            <div style="white-space:pre-wrap; background:${m.role==='user'?'var(--gold-soft,#f4ecd8)':'#f4f4f2'}; border-radius:10px; padding:10px 13px; font-size:14px; line-height:1.5;">${m.content}</div>
            ${m.role==='assistant' && canWrite() ? `<button class="btn ghost sm" style="margin-top:4px;" data-track-followup="${i}">${ic('lock',12)} Track this</button>` : ''}
          </div>`).join('')}
        ${assistantLoading ? `<div class="hint">Thinking…</div>` : ''}
        ${assistantError ? `<div class="hint" style="color:#c0392b;">${assistantError}</div>` : ''}
      </div>
      <form id="form-assistant" style="display:flex; gap:8px;">
        <input type="text" name="question" placeholder="Ask about revenue, expenses, loans, tax…" style="flex:1;" ${assistantLoading?'disabled':''} required>
        <button class="btn gold" type="submit" ${assistantLoading?'disabled':''}>Ask</button>
      </form>
    </div>

    <div class="section-head"><h2>Follow-ups</h2>
      <div class="toolbar"><span class="hint">Recommendations you've chosen to track — a person decides what's worth acting on, not the AI.</span></div>
    </div>
    <div class="card" style="max-width:820px;">
      ${followUpsState.error ? `<div class="hint" style="color:#c0392b;">${followUpsState.error}</div>` : ''}
      ${(followUpsState.items||[]).filter(f=>f.status==='open').length===0 ? `<span class="hint">Nothing tracked yet.</span>` : `
      <div style="display:flex; flex-direction:column; gap:8px;">
        ${followUpsState.items.filter(f=>f.status==='open').map(f=>`
          <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:10px; padding:10px 0; border-bottom:1px solid var(--hair);">
            <div style="font-size:13.5px; white-space:pre-wrap;">${f.description}</div>
            <div style="display:flex; gap:6px; flex-shrink:0;">
              <button class="btn ghost sm" data-followup-done="${f.id}">Done</button>
              <button class="btn ghost sm" data-followup-dismiss="${f.id}">Dismiss</button>
            </div>
          </div>`).join('')}
      </div>`}
    </div>
  `;
}
async function askAssistant(question){
  assistantMessages.push({ role:'user', content: question });
  assistantLoading = true; assistantError = null; render();
  try{
    const res = await apiFetch('/api/ai-assistant', {
      method:'POST', headers: JSONH,
      body: JSON.stringify({
        branch_id: state.branchId, question,
        history: assistantMessages.slice(-13, -1), // exclude the question just pushed; server also caps this
        conversation_id: assistantConversationId
      })
    });
    const body = await safeParseJson(res);
    if(!res.ok) throw new Error(body.error || 'The assistant could not answer that.');
    assistantMessages.push({ role:'assistant', content: body.answer });
    if(body.conversation_id) assistantConversationId = body.conversation_id;
  }catch(e){
    assistantError = e.message;
  }
  assistantLoading = false;
  render();
  const thread = document.getElementById('assistant-thread');
  if(thread) thread.scrollTop = thread.scrollHeight;
}


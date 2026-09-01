/* ---------------- Receipts / attachments (Phase 4) ---------------- */
let attachmentsState = { targetType:null, targetId:null, items:null, loading:false, error:null };

async function openAttachments(entityType, entityId){
  attachmentsState = { targetType: entityType, targetId: entityId, items: null, loading: true, error: null };
  render();
  try{
    const res = await apiList('/api/attachments', state.branchId, { entity_type: entityType, entity_id: entityId });
    attachmentsState.items = res.attachments || [];
  }catch(e){
    attachmentsState.items = [];
    attachmentsState.error = e.message;
  }
  attachmentsState.loading = false;
  render();
}
function closeAttachments(){
  attachmentsState = { targetType:null, targetId:null, items:null, loading:false, error:null };
  render();
}
async function uploadAttachment(entityType, entityId, file){
  if(!file) return;
  const dataUrl = await new Promise((res, rej) => {
    const reader = new FileReader();
    reader.onload = () => res(reader.result);
    reader.onerror = () => rej(new Error('Could not read that file.'));
    reader.readAsDataURL(file);
  });
  const base64 = dataUrl.split(',')[1] || '';
  attachmentsState.loading = true; render();
  try{
    await apiCreate('/api/attachments', {
      branch_id: state.branchId, entity_type: entityType, entity_id: entityId,
      file_name: file.name, content_type: file.type || 'application/octet-stream', data_base64: base64
    });
    await openAttachments(entityType, entityId); // refresh the list with the new file included
  }catch(e){
    attachmentsState.loading = false;
    attachmentsState.error = e.message;
    render();
  }
}
async function deleteAttachment(id){
  attachmentsState.loading = true; render();
  try{
    await apiRemove('/api/attachments', { branch_id: state.branchId, id });
    await openAttachments(attachmentsState.targetType, attachmentsState.targetId);
  }catch(e){
    attachmentsState.loading = false;
    attachmentsState.error = e.message;
    render();
  }
}
function attachmentsPanelHtml(){
  if(!attachmentsState.targetId) return '';
  const { items, loading, error } = attachmentsState;
  return `<div class="panel" style="margin:10px 0;">
    <div class="section-head"><h3 style="margin:0;">Receipts / attachments</h3><button class="btn ghost sm" data-close-attachments>Close</button></div>
    ${error ? `<div class="hint" style="color:#c0392b;">${error}</div>` : ''}
    ${loading ? '<span class="hint">Working…</span>' :
      (items && items.length
        ? items.map(a => `<div class="item"><a href="${a.url || '#'}" target="_blank" rel="noopener">${(a.storage_path||'').split('/').pop()}</a> ${canWrite() ? `<button class="btn ghost sm" data-del-attachment="${a.id}">Remove</button>` : ''}</div>`).join('')
        : '<span class="hint">No attachments yet.</span>')}
    ${canWrite() ? `<div style="margin-top:8px;"><input type="file" id="attachment-file-input" accept="image/*,.pdf"></div>` : ''}
  </div>`;
}
function wireAttachmentsPanel(){
  const closeBtn = document.querySelector('[data-close-attachments]');
  if(closeBtn) closeBtn.addEventListener('click', closeAttachments);
  document.querySelectorAll('[data-del-attachment]').forEach(b => b.addEventListener('click', () => {
    deleteAttachment(b.dataset.delAttachment);
  }));
  const fileInput = document.getElementById('attachment-file-input');
  if(fileInput) fileInput.addEventListener('change', (ev) => {
    uploadAttachment(attachmentsState.targetType, attachmentsState.targetId, ev.target.files[0]);
  });
}


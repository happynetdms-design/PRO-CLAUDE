const { requireUser, adminClient, json } = require('./_lib/supabase');
const { requireBranchAccess } = require('./_lib/rbac');

function isoDate(d){ return d.toISOString().slice(0,10); }
function addDays(date, days){ const d=new Date(date); d.setDate(d.getDate()+days); return d; }
function startOfMonth(s){ const d=s?new Date(`${s}-01T00:00:00`):new Date(); return new Date(d.getFullYear(),d.getMonth(),1); }
function endOfMonth(d){ return new Date(d.getFullYear(),d.getMonth()+1,0); }
function dueForRule(periodEnd, rule){
  const p=new Date(`${periodEnd}T00:00:00`); const r=(rule||'').toLowerCase();
  if(r.includes('20th day of following month')) return isoDate(new Date(p.getFullYear(),p.getMonth()+1,20));
  if(r.includes('9th day of following month')) return isoDate(new Date(p.getFullYear(),p.getMonth()+1,9));
  if(r.includes('30th day of fourth month')) return isoDate(new Date(p.getFullYear(),p.getMonth()+4,30));
  return null;
}
function daysUntil(s){ if(!s)return null; const a=new Date(); const b=new Date(`${s}T00:00:00`); return Math.ceil((b-new Date(a.getFullYear(),a.getMonth(),a.getDate()))/86400000); }
function status(period){
  const today=new Date();
  const due=period.payment_due_date||period.filing_due_date;
  const days=daysUntil(due);
  const paid=Number(period.amount_paid_kes||0), dueAmt=Number(period.amount_due_kes||0);
  if(period.payment_status==='paid' && ['filed','nil','not_applicable'].includes(period.filing_status)) return {label:'Compliant',severity:'good',days};
  if(due && days<0) return {label:'Overdue',severity:'critical',days};
  if(due && days<=7) return {label:'Due within 7 days',severity:'warning',days};
  if(due && days<=30) return {label:'Due within 30 days',severity:'info',days};
  if(dueAmt>paid) return {label:'Unpaid / Open',severity:'warning',days};
  return {label:'On track',severity:'good',days};
}

exports.handler = async (event) => {
  const admin=adminClient();
  const method=event.httpMethod;
  let body={}; try{ if(method!=='GET') body=JSON.parse(event.body||'{}'); }catch(e){return json(400,{error:'Invalid JSON body.'});}
  const params=event.queryStringParameters||{};
  const branchId=method==='GET'?params.branch_id:body.branch_id;
  const ctx=await requireBranchAccess(event,requireUser,admin,branchId,{write:method!=='GET'});
  if(ctx.error)return json(ctx.status,{error:ctx.error});
  try{
    if(method==='GET'){
      const {data:obs,error:oe}=await admin.from('tax_obligations').select('*').eq('branch_id',branchId).order('tax_type');
      if(oe)return json(500,{error:oe.message});
      const {data:periods,error:pe}=await admin.from('tax_periods').select('*, tax_obligations(tax_type,filing_authority)').eq('branch_id',branchId).order('payment_due_date',{ascending:true,nullsFirst:false});
      if(pe)return json(500,{error:pe.message});
      const {data:rules,error:re}=await admin.from('tax_deadline_rules').select('*').eq('active',true).order('tax_type');
      if(re)return json(500,{error:re.message});
      const {data:profile}=await admin.from('tax_profile').select('*').eq('branch_id',branchId).maybeSingle();
      const enriched=(periods||[]).map(p=>({...p,compliance:status(p)}));
      const open=enriched.filter(p=>Number(p.amount_due_kes||0)>Number(p.amount_paid_kes||0));
      const overdue=enriched.filter(p=>p.compliance.severity==='critical');
      const due30=enriched.filter(p=>p.compliance.days!==null&&p.compliance.days>=0&&p.compliance.days<=30);
      const totalDue=open.reduce((s,p)=>s+Math.max(0,Number(p.amount_due_kes||0)-Number(p.amount_paid_kes||0)),0);
      const due30Amt=due30.reduce((s,p)=>s+Math.max(0,Number(p.amount_due_kes||0)-Number(p.amount_paid_kes||0)),0);
      const overdueAmt=overdue.reduce((s,p)=>s+Math.max(0,Number(p.amount_due_kes||0)-Number(p.amount_paid_kes||0)),0);
      return json(200,{obligations:obs||[],periods:enriched,rules:rules||[],profile:profile||null,summary:{openCount:open.length,overdueCount:overdue.length,due30Count:due30.length,outstandingKes:totalDue,due30Kes:due30Amt,overdueKes:overdueAmt,tccStatus:profile?.tcc_status||'unknown',tccExpiry:profile?.tcc_expiry_date||null}});
    }
    if(method==='POST'){
      const action=body.action;
      if(action==='period'){
        if(!body.tax_obligation_id||!body.period_start||!body.period_end)return json(400,{error:'tax_obligation_id, period_start and period_end are required.'});
        const {data:ob}=await admin.from('tax_obligations').select('tax_type,filing_authority,frequency,due_day_of_month,manual_next_due_date').eq('id',body.tax_obligation_id).eq('branch_id',branchId).maybeSingle();
        if(!ob)return json(404,{error:'Tax obligation not found.'});
        const {data:rules}=await admin.from('tax_deadline_rules').select('*').eq('tax_type',ob.tax_type).eq('active',true).limit(1);
        const rule=rules?.[0];
        const filingDue=body.filing_due_date||ob.manual_next_due_date|| (rule?dueForRule(body.period_end,rule.filing_due_rule):null);
        const paymentDue=body.payment_due_date||ob.manual_next_due_date|| (rule?dueForRule(body.period_end,rule.due_rule):null);
        const payload={branch_id:branchId,tax_obligation_id:body.tax_obligation_id,period_start:body.period_start,period_end:body.period_end,filing_due_date:filingDue,payment_due_date:paymentDue,amount_due_kes:Number(body.amount_due_kes||0),filing_status:body.filing_status||'not_due',notes:body.notes||null,created_by:ctx.user.id};
        const {data,error}=await admin.from('tax_periods').upsert(payload,{onConflict:'tax_obligation_id,period_start,period_end'}).select().single();
        if(error)return json(500,{error:error.message});
        return json(201,{period:data});
      }
      if(action==='file'){
        if(!body.tax_period_id)return json(400,{error:'tax_period_id is required.'});
        const patch={filing_status:body.filing_status||'filed',filed_at:body.filed_at||new Date().toISOString(),filing_reference:body.filing_reference||null,notes:body.notes||null,updated_at:new Date().toISOString()};
        const {data,error}=await admin.from('tax_periods').update(patch).eq('id',body.tax_period_id).eq('branch_id',branchId).select().single();
        if(error)return json(500,{error:error.message}); if(!data)return json(404,{error:'Tax period not found.'});
        await admin.from('tax_compliance_events').insert({branch_id:branchId,tax_period_id:data.id,event_type:'filing_status_changed',new_value:patch,reason:body.reason||'Tax filing status updated.',actor_id:ctx.user.id});
        return json(200,{period:data});
      }
      if(action==='payment'){
        if(!body.tax_period_id||body.amount_kes===undefined||!body.payment_date)return json(400,{error:'tax_period_id, amount_kes and payment_date are required.'});
        const {data:p}=await admin.from('tax_periods').select('*').eq('id',body.tax_period_id).eq('branch_id',branchId).maybeSingle();
        if(!p)return json(404,{error:'Tax period not found.'});
        const amount=Number(body.amount_kes); if(amount<=0)return json(400,{error:'Payment amount must be positive.'});
        const {data:pay,error:payErr}=await admin.from('tax_payments').insert({tax_obligation_id:p.tax_obligation_id,payment_date:body.payment_date,amount_kes:amount,reference:body.reference||null,created_by:ctx.user.id}).select().single();
        if(payErr)return json(500,{error:payErr.message});
        const newPaid=Number(p.amount_paid_kes||0)+amount; const due=Number(p.amount_due_kes||0);
        const paymentStatus=newPaid>due&&due>0?'overpaid':newPaid>=due&&due>0?'paid':newPaid>0?'partially_paid':'unpaid';
        const {data:updated,error}=await admin.from('tax_periods').update({amount_paid_kes:newPaid,payment_status:paymentStatus,payment_reference:body.reference||p.payment_reference,updated_at:new Date().toISOString()}).eq('id',p.id).select().single();
        if(error)return json(500,{error:error.message});
        await admin.from('tax_compliance_events').insert({branch_id:branchId,tax_period_id:p.id,event_type:'tax_payment_recorded',previous_value:{amount_paid_kes:p.amount_paid_kes,payment_status:p.payment_status},new_value:{amount_paid_kes:newPaid,payment_status:paymentStatus},reason:body.reason||'Tax payment recorded.',actor_id:ctx.user.id});
        return json(201,{payment:pay,period:updated});
      }
      if(action==='profile'){
        const patch={branch_id:branchId,...body}; delete patch.action; delete patch.branch_id; patch.updated_by=ctx.user.id; patch.updated_at=new Date().toISOString();
        const {data,error}=await admin.from('tax_profile').upsert(patch,{onConflict:'branch_id'}).select().single();
        if(error)return json(500,{error:error.message}); return json(200,{profile:data});
      }
      if(action==='evidence'){
        if(!body.tax_period_id||!body.evidence_type)return json(400,{error:'tax_period_id and evidence_type are required.'});
        const {data:p}=await admin.from('tax_periods').select('id').eq('id',body.tax_period_id).eq('branch_id',branchId).maybeSingle();
        if(!p)return json(404,{error:'Tax period not found.'});
        const {data,error}=await admin.from('tax_evidence').insert({tax_period_id:p.id,evidence_type:body.evidence_type,reference:body.reference||null,storage_path:body.storage_path||null,notes:body.notes||null,uploaded_by:ctx.user.id}).select().single();
        if(error)return json(500,{error:error.message}); return json(201,{evidence:data});
      }
      return json(400,{error:'Unknown tax intelligence action.'});
    }
    return json(405,{error:'Method not allowed.'});
  }catch(e){console.error(e);return json(500,{error:'Unexpected tax intelligence error.'});}
};

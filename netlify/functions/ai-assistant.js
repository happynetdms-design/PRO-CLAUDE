// AI Financial Assistant — upgraded to ground on the full ledger built
// this session (cash position, AP, Profit First allocations), with
// persistent conversation history. Still strictly read-only/advisory:
// it never proposes or executes an action. That's a real feature in its
// own right (propose -> human approves -> something executes) and
// deserves to be built deliberately if it's ever wanted, not bolted on
// here — see hfms_foundation_fix_07_ai_conversations.sql for the reasoning.
//
// Every number the model can reference is pulled from the database right
// here and handed over as a compact JSON summary — the model is told to
// answer only from that data, and each optional data source degrades
// gracefully (an omitted section, not a crash) if its table hasn't been
// created yet on this branch's Supabase project.
const { requireUser, adminClient, json } = require('./_lib/supabase');
const { requireBranchAccess } = require('./_lib/rbac');

const MODEL = 'claude-sonnet-5';
const MAX_HISTORY_TURNS = 6;

function monthKey(dateStr){ return (dateStr || '').slice(0, 7); }

// Optional data sources (from the foundation-fix SQL files) shouldn't
// break the whole assistant if that particular file hasn't been run yet
// on this branch — each one fails independently and is simply omitted.
async function safe(promise){
  try{ const { data, error } = await promise; if(error) return null; return data; }
  catch(e){ return null; }
}

async function buildFinancialSummary(admin, branchId){
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const cutoff = sixMonthsAgo.toISOString().slice(0, 10);

  const [revenue, expenses, loans, taxObligations, settings, ledgerAllTime, apAging, recentAllocations] = await Promise.all([
    safe(admin.from('revenue_entries').select('entry_date, amount_kes').eq('branch_id', branchId).eq('is_deleted', false).gte('entry_date', cutoff)),
    safe(admin.from('expenses').select('expense_date, amount_kes, charges_kes, category_id, categories(name), owner_funded').eq('branch_id', branchId).eq('is_deleted', false).gte('expense_date', cutoff)),
    safe(admin.from('loans').select('debt_name, lender, current_balance_kes, min_monthly_payment_kes, status').eq('branch_id', branchId).eq('is_deleted', false)),
    safe(admin.from('tax_obligations').select('tax_type, applicable, frequency, manual_next_due_date, estimated_amount_kes').eq('branch_id', branchId)),
    safe(admin.from('profit_first_settings').select('*').eq('branch_id', branchId).maybeSingle().then(r=>({data:[r.data],error:r.error}))),
    safe(admin.from('financial_transactions').select('direction, net_amount_kes').eq('branch_id', branchId).eq('is_deleted', false)),
    safe(admin.from('v_hfms_ap_aging').select('outstanding_kes, aging_bucket').eq('branch_id', branchId)),
    safe(admin.from('allocations').select('period, bucket, amount_kes, approved_at').eq('branch_id', branchId).order('period', { ascending: false }).limit(8))
  ]);

  const revenueByMonth = {};
  for(const r of (revenue || [])){
    const m = monthKey(r.entry_date);
    revenueByMonth[m] = (revenueByMonth[m] || 0) + Number(r.amount_kes);
  }
  const expenseByMonth = {};
  const expenseByCategory = {};
  let ownerFundedTotal = 0;
  for(const e of (expenses || [])){
    const m = monthKey(e.expense_date);
    const total = Number(e.amount_kes) + Number(e.charges_kes || 0);
    expenseByMonth[m] = (expenseByMonth[m] || 0) + total;
    const cat = (e.categories && e.categories.name) || 'Uncategorized';
    expenseByCategory[cat] = (expenseByCategory[cat] || 0) + total;
    if(e.owner_funded) ownerFundedTotal += total;
  }

  const summary = {
    as_of: new Date().toISOString().slice(0, 10),
    period_covered: `${cutoff} to today`,
    monthly_revenue_kes: revenueByMonth,
    monthly_expenses_kes: expenseByMonth,
    expenses_by_category_kes: expenseByCategory,
    owner_funded_expenses_kes_total: ownerFundedTotal,
    loans: (loans || []).map(l => ({
      name: l.debt_name, lender: l.lender, balance_kes: Number(l.current_balance_kes),
      min_monthly_payment_kes: Number(l.min_monthly_payment_kes), status: l.status
    })),
    tax_obligations: (taxObligations || []).filter(t => t.applicable).map(t => ({
      type: t.tax_type, frequency: t.frequency, next_due: t.manual_next_due_date, estimated_kes: Number(t.estimated_amount_kes)
    })),
    profit_first_settings: settings && settings[0] ? {
      profit_pct: Number(settings[0].pct_profit), owner_pay_debt_pct: Number(settings[0].pct_owner_debt),
      tax_pct: Number(settings[0].pct_tax), opex_pct: Number(settings[0].pct_opex),
      monthly_revenue_target_kes: Number(settings[0].monthly_revenue_target_kes)
    } : null
  };

  // Optional, ledger-derived sections — each omitted (not erroring) if that
  // foundation-fix file hasn't been run against this branch's database yet.
  if(ledgerAllTime){
    summary.cash_position_kes = ledgerAllTime.reduce((s,t)=>s+Number(t.net_amount_kes)*(t.direction==='inflow'?1:-1), 0);
  }
  if(apAging){
    summary.accounts_payable = {
      outstanding_kes: apAging.reduce((s,a)=>s+Number(a.outstanding_kes),0),
      overdue_kes: apAging.filter(a=>a.aging_bucket!=='current').reduce((s,a)=>s+Number(a.outstanding_kes),0)
    };
  }
  if(recentAllocations && recentAllocations.length){
    summary.recent_profit_first_allocations = recentAllocations.map(a => ({
      period: a.period, bucket: a.bucket, amount_kes: Number(a.amount_kes), approved: !!a.approved_at
    }));
  }

  return summary;
}

const SYSTEM_PROMPT = `You are Happynet's financial assistant, built on top of its Profit First dashboard and ledger.

Rules you must follow:
1. Answer ONLY using the JSON financial summary provided in each message. Never invent, estimate, or assume a number that isn't in that data. If a section (like accounts_payable or cash_position_kes) is missing from the summary, that data isn't available yet — say so, don't guess at it.
2. Label every substantive claim with one of these, inline: FACT (a number straight from the data), CALCULATION (arithmetic you derived from the data), FORECAST (forward-looking — always state your assumptions), RECOMMENDATION (an action management could consider), or RISK (a concern worth flagging). Keep the labels light — a word in brackets is enough, not a heading for every sentence.
3. Money that came from the owner/director (loans, e.g. "John") is owner financing, never revenue — and repaying that loan is not an operating expense. Keep this distinction sharp in any answer that touches loans or cash.
4. Money allocated under Profit First (profit reserve, tax reserve, owner pay) is reserved, not ordinary spendable operating cash — don't suggest spending it as if it were.
5. Keep answers concise and concrete — use actual KES figures from the data, not vague language.
6. You are not a licensed accountant or financial advisor; for tax filing specifics or legal obligations, say the user should confirm with KRA or their accountant.
7. You cannot take any action — you can only explain, calculate, and advise. If asked to do something (post a transaction, approve a bill, close a period), say that's outside what you can do here and point to the right tab in the app.`;

exports.handler = async (event) => {
  if(event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed.' });
  const admin = adminClient();

  let body;
  try{ body = JSON.parse(event.body || '{}'); }
  catch(e){ return json(400, { error: 'Invalid JSON body.' }); }

  const { branch_id: branchId, question, history } = body;
  const ctx = await requireBranchAccess(event, requireUser, admin, branchId, { write: false });
  if(ctx.error) return json(ctx.status, { error: ctx.error });

  if(!question || !question.trim()) return json(400, { error: 'question is required.' });
  if(!process.env.ANTHROPIC_API_KEY){
    return json(500, { error: 'AI assistant is not configured — ANTHROPIC_API_KEY is missing from this site\'s environment variables.' });
  }

  try{
    const summary = await buildFinancialSummary(admin, branchId);

    // Persistent conversation history — best-effort; if ai_conversations
    // hasn't been created yet (foundation-fix 07 not run), the assistant
    // still works, it just won't remember across page reloads.
    let conversationId = body.conversation_id || null;
    if(!conversationId){
      const { data: conv } = await admin.from('ai_conversations')
        .insert({ branch_id: branchId, user_id: ctx.user.id, title: question.slice(0, 100) })
        .select().maybeSingle().then(r=>r).catch(()=>({data:null}));
      conversationId = conv ? conv.id : null;
    }
    if(conversationId){
      await admin.from('ai_messages').insert({ conversation_id: conversationId, role: 'user', content: question }).catch(()=>{});
    }

    const trimmedHistory = Array.isArray(history) ? history.slice(-MAX_HISTORY_TURNS) : [];
    const messages = [
      ...trimmedHistory.filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string'),
      { role: 'user', content: `Financial data summary (JSON):\n${JSON.stringify(summary)}\n\nQuestion: ${question}` }
    ];

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages
      })
    });

    if(!res.ok){
      const errBody = await res.text();
      console.error('Anthropic API error', res.status, errBody);
      return json(502, { error: 'The AI assistant is temporarily unavailable.' });
    }

    const data = await res.json();
    const answer = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');

    if(conversationId){
      await admin.from('ai_messages').insert({ conversation_id: conversationId, role: 'assistant', content: answer }).catch(()=>{});
      await admin.from('ai_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId).catch(()=>{});
    }

    return json(200, { answer, data_as_of: summary.as_of, conversation_id: conversationId });
  }catch(e){
    console.error('ai-assistant error', e);
    return json(500, { error: 'Unexpected error running the assistant.' });
  }
};

// AI Financial Assistant — deliberately limited to revenue, expenses,
// ledger accounts, and audit history, with
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

const MODEL = 'claude-sonnet-4-20250514';
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

  const [revenue, expenses, accounts, ledgerEntries, auditRows] = await Promise.all([
    safe(admin.from('revenue_entries').select('entry_date, amount_kes').eq('branch_id', branchId).eq('is_deleted', false).gte('entry_date', cutoff)),
    safe(admin.from('expenses').select('expense_date, amount_kes, charges_kes, category_id, categories(name), owner_funded').eq('branch_id', branchId).eq('is_deleted', false).gte('expense_date', cutoff)),
    safe(admin.from('chart_of_accounts').select('code, name, account_type, is_active').eq('branch_id', branchId).order('code')),
    safe(admin.from('financial_transactions').select('transaction_date, transaction_type, direction, net_amount_kes, description').eq('branch_id', branchId).eq('is_deleted', false).gte('transaction_date', cutoff)),
    safe(admin.from('audit_log').select('table_name, action, changed_at, changed_by, old_data, new_data').in('table_name', ['revenue_entries','expenses']).order('changed_at', { ascending:false }).limit(300))
  ]);
  const auditLog = (auditRows || []).filter(a =>
    (a.new_data && a.new_data.branch_id === branchId) || (a.old_data && a.old_data.branch_id === branchId)
  );

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
    accounts: accounts || [],
    ledger_transactions: ledgerEntries || [],
    audit: (auditLog || []).map(a => ({ table:a.table_name, action:a.action, changed_at:a.changed_at, changed_by:a.changed_by }))
  };

  return summary;
}

const SYSTEM_PROMPT = `You are Happynet's financial assistant, limited to revenue, expenses, financial ledger accounts, ledger transactions, and audit history.

Rules you must follow:
1. Answer ONLY using the JSON financial summary provided in each message. Never invent, estimate, or assume a number that isn't in that data. If requested information is outside revenue, expenses, accounts, ledger, or audit history, say it is outside your current scope.
2. Label every substantive claim with one of these, inline: FACT (a number straight from the data), CALCULATION (arithmetic you derived from the data), FORECAST (forward-looking — always state your assumptions), RECOMMENDATION (an action management could consider), or RISK (a concern worth flagging). Keep the labels light — a word in brackets is enough, not a heading for every sentence.
3. Keep answers concise and concrete — use actual KES figures from the data, not vague language.
4. You are not a licensed accountant or financial advisor.
5. You cannot take any action — you can only explain and calculate. If asked to change data, point to the relevant app tab.`;

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
      await admin.from('ai_messages')
        .insert({ conversation_id: conversationId, role: 'user', content: question })
        .then(()=>{})
        .catch(()=>{});
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
      if(res.status === 400 && /credit balance is too low|purchase credits|plans & billing/i.test(errBody)){
        return json(502, { error: 'The AI assistant is configured, but the Anthropic account needs credits before it can answer.' });
      }
      return json(502, { error: 'The AI assistant is temporarily unavailable.' });
    }

    const data = await res.json();
    const answer = Array.isArray(data.content)
      ? data.content.filter(b => b && b.type === 'text').map(b => b.text).join('\n')
      : '';
    if(!answer) return json(502, { error: 'The AI assistant returned an empty response.' });

    if(conversationId){
      await admin.from('ai_messages')
        .insert({ conversation_id: conversationId, role: 'assistant', content: answer })
        .then(()=>{})
        .catch(()=>{});
      await admin.from('ai_conversations')
        .update({ updated_at: new Date().toISOString() })
        .eq('id', conversationId)
        .then(()=>{})
        .catch(()=>{});
    }

    return json(200, { answer, data_as_of: summary.as_of, conversation_id: conversationId });
  }catch(e){
    console.error('ai-assistant error', e);
    return json(500, { error: 'Unexpected error running the assistant.' });
  }
};

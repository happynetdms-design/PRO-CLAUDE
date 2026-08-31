-- ============================================================================
-- HFMS Foundation Fix, part 9 — formal period-close journal entries
-- ----------------------------------------------------------------------------
-- Run this AFTER hfms_foundation_fix_01/02/03.sql (needs the ledger,
-- journal posting, and accounting_periods).
--
-- WHAT THIS CHANGES
-- Update 2 of this build deliberately simplified the Balance Sheet:
-- instead of formal closing entries, it showed cumulative Revenue minus
-- Expense as a single "Current Earnings" line. That was an honest
-- simplification, not a shortcut nobody was told about — but "advanced
-- financial system" means doing this properly now: a real closing entry
-- that zeros out the period's Revenue and Expense accounts and moves the
-- net result into Retained Earnings (3100), the way actual double-entry
-- accounting works.
--
-- After this runs, financial-statements.js's "Current Earnings" line
-- keeps working exactly as before with NO code changes needed — it's
-- still cumulative Revenue minus Expense, but once a period is closed
-- with a real closing entry, that period's revenue/expense accounts net
-- to zero (closed), so "Current Earnings" naturally comes to reflect only
-- the UNCLOSED period's activity, while Retained Earnings correctly
-- accumulates every closed period's result. That's exactly how it's
-- supposed to work — no redesign needed, just the missing entry.
-- ============================================================================

create or replace function public.hfms_close_period_with_entries(p_branch uuid, p_start date, p_end date, p_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_unbalanced numeric;
  v_revenue_total numeric;
  v_expense_total numeric;
  v_net numeric;
  v_je_id uuid;
  v_retained_earnings_id uuid;
  v_period_id uuid;
  acct record;
begin
  if exists (select 1 from public.accounting_periods where branch_id = p_branch and period_start = p_start and period_end = p_end and status = 'closed') then
    raise exception 'This period is already closed.';
  end if;

  -- Same integrity check hfms_close_period already used — refuse to close
  -- on top of a ledger that doesn't balance.
  select coalesce(sum(jl.debit_kes - jl.credit_kes), 0) into v_unbalanced
  from public.journal_lines jl join public.journal_entries je on je.id = jl.journal_entry_id
  where je.branch_id = p_branch and je.status = 'posted';
  if abs(v_unbalanced) > 0.01 then
    raise exception 'Cannot close: the ledger does not currently balance (off by %). Fix that first.', v_unbalanced;
  end if;

  select coalesce(sum(jl.credit_kes - jl.debit_kes), 0) into v_revenue_total
  from public.journal_lines jl join public.journal_entries je on je.id = jl.journal_entry_id join public.chart_of_accounts coa on coa.id = jl.account_id
  where je.branch_id = p_branch and je.status = 'posted' and coa.account_type = 'revenue' and je.entry_date between p_start and p_end;

  select coalesce(sum(jl.debit_kes - jl.credit_kes), 0) into v_expense_total
  from public.journal_lines jl join public.journal_entries je on je.id = jl.journal_entry_id join public.chart_of_accounts coa on coa.id = jl.account_id
  where je.branch_id = p_branch and je.status = 'posted' and coa.account_type = 'expense' and je.entry_date between p_start and p_end;

  v_net := v_revenue_total - v_expense_total;

  -- Nothing to close (no revenue/expense activity this period) — still
  -- record the period as closed, just without a zero-value journal entry.
  if v_revenue_total = 0 and v_expense_total = 0 then
    insert into public.accounting_periods (branch_id, period_start, period_end, status, closed_by, closed_at)
    values (p_branch, p_start, p_end, 'closed', p_user, now())
    returning id into v_period_id;
    return null;
  end if;

  select id into v_retained_earnings_id from public.chart_of_accounts where branch_id = p_branch and code = '3100';
  if v_retained_earnings_id is null then
    raise exception 'No Retained Earnings account (code 3100) found for this branch — run hfms_seed_chart_of_accounts(branch_id) from hfms_foundation_fix_00_ledger_core.sql first.';
  end if;

  insert into public.journal_entries (branch_id, entry_date, description, source_type, source_id, status, posted_at)
  values (p_branch, p_end, format('Period close: %s to %s', p_start, p_end), 'period_close', gen_random_uuid(), 'posted', now())
  returning id into v_je_id;

  -- Zero every revenue account that had activity this period: debit each
  -- by its period credit balance.
  for acct in
    select coa.id as account_id, coalesce(sum(jl.credit_kes - jl.debit_kes), 0) as bal
    from public.chart_of_accounts coa
    join public.journal_lines jl on jl.account_id = coa.id
    join public.journal_entries je on je.id = jl.journal_entry_id
    where coa.branch_id = p_branch and coa.account_type = 'revenue' and je.status = 'posted' and je.entry_date between p_start and p_end
    group by coa.id having coalesce(sum(jl.credit_kes - jl.debit_kes), 0) <> 0
  loop
    insert into public.journal_lines (journal_entry_id, account_id, debit_kes, credit_kes) values (v_je_id, acct.account_id, acct.bal, 0);
  end loop;

  -- Zero every expense account that had activity this period: credit each
  -- by its period debit balance.
  for acct in
    select coa.id as account_id, coalesce(sum(jl.debit_kes - jl.credit_kes), 0) as bal
    from public.chart_of_accounts coa
    join public.journal_lines jl on jl.account_id = coa.id
    join public.journal_entries je on je.id = jl.journal_entry_id
    where coa.branch_id = p_branch and coa.account_type = 'expense' and je.status = 'posted' and je.entry_date between p_start and p_end
    group by coa.id having coalesce(sum(jl.debit_kes - jl.credit_kes), 0) <> 0
  loop
    insert into public.journal_lines (journal_entry_id, account_id, debit_kes, credit_kes) values (v_je_id, acct.account_id, 0, acct.bal);
  end loop;

  -- Net result moves to Retained Earnings: a profit credits it (increases
  -- equity), a loss debits it (decreases equity).
  if v_net >= 0 then
    insert into public.journal_lines (journal_entry_id, account_id, debit_kes, credit_kes) values (v_je_id, v_retained_earnings_id, 0, v_net);
  else
    insert into public.journal_lines (journal_entry_id, account_id, debit_kes, credit_kes) values (v_je_id, v_retained_earnings_id, abs(v_net), 0);
  end if;

  insert into public.accounting_periods (branch_id, period_start, period_end, status, closed_by, closed_at)
  values (p_branch, p_start, p_end, 'closed', p_user, now())
  returning id into v_period_id;

  return v_je_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- VERIFICATION
-- ----------------------------------------------------------------------------
-- After closing a period, the trial balance must still balance (it's
-- structurally guaranteed by construction — see scripts/verify_period_close.js
-- for the proof — but confirm here against real data too):
-- select sum(total_debit_kes)-sum(total_credit_kes) from v_hfms_trial_balance;
--
-- Retained Earnings should now hold the closed period's net result:
-- select total_debit_kes, total_credit_kes from v_hfms_trial_balance where code='3100';

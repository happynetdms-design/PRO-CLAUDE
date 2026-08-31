-- ============================================================================
-- HFMS Foundation Fix, part 3 — accounting periods, done at the right layer
-- ----------------------------------------------------------------------------
-- Run this AFTER hfms_foundation_fix_00_ledger_core.sql and both
-- hfms_foundation_fix_01/02.sql files.
--
-- CONTEXT
-- An earlier design considered enforcing closed periods with a trigger
-- directly on financial_transactions, raising an exception on insert/
-- update/delete once a period closes. That was never actually built —
-- the DROP TRIGGER IF EXISTS below is a safe no-op confirming it stays
-- that way. "Closed" means "the JOURNAL is locked," not "the raw
-- transaction record can't exist" — recording what happened and posting
-- it to a locked ledger period are different concerns, and only the
-- latter should ever refuse. That's what hfms_post_one_transaction()
-- already does (hfms_foundation_fix_02): it checks hfms_period_is_closed()
-- and simply skips posting, gracefully, rather than raising into the
-- middle of an ordinary revenue/expense entry. This file's job is just
-- the two functions that actually close and reopen a period.
-- ============================================================================

drop trigger if exists trg_hfms_closed_period_financial_tx on public.financial_transactions;

-- ----------------------------------------------------------------------------
-- Close a period: locks journal posting for every date in range, and
-- (for STATED, deliberate honesty) does NOT retroactively unpost anything
-- already posted before the close — closing a period is a going-forward
-- lock, not a purge.
-- ----------------------------------------------------------------------------
create or replace function public.hfms_close_period(p_branch uuid, p_start date, p_end date, p_user uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_unbalanced numeric;
begin
  -- Refuse to close a period where the trial balance doesn't balance —
  -- closing on top of a known error just locks the mistake in.
  select coalesce(sum(jl.debit_kes - jl.credit_kes), 0) into v_unbalanced
  from public.journal_lines jl join public.journal_entries je on je.id = jl.journal_entry_id
  where je.branch_id = p_branch and je.status = 'posted';
  if abs(v_unbalanced) > 0.01 then
    raise exception 'Cannot close: the ledger does not currently balance (off by %). Fix that first.', v_unbalanced;
  end if;

  insert into public.accounting_periods (branch_id, period_start, period_end, status, closed_by, closed_at)
  values (p_branch, p_start, p_end, 'closed', p_user, now())
  on conflict (branch_id, period_start, period_end) do update
    set status = 'closed', closed_by = p_user, closed_at = now(), reopened_by = null, reopened_at = null
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.hfms_reopen_period(p_branch uuid, p_period_id uuid, p_user uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'A reason is required to reopen a closed period.';
  end if;
  update public.accounting_periods
    set status = 'reopened', reopened_by = p_user, reopened_at = now(), reason = p_reason
    where id = p_period_id and branch_id = p_branch;
end;
$$;

-- ----------------------------------------------------------------------------
-- VERIFICATION
-- ----------------------------------------------------------------------------
-- select * from accounting_periods where branch_id = '<your branch id>';
-- Confirm the old trigger is gone:
-- select tgname from pg_trigger where tgrelid = 'public.financial_transactions'::regclass;
--   (trg_hfms_closed_period_financial_tx should NOT appear; trg_sync_* triggers
--    from hfms_foundation_fix_01 don't live on this table, they live on the
--    source tables, so you won't see those here either — that's correct.)

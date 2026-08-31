-- ============================================================================
-- HFMS Foundation Fix, part 2 — on-demand journal posting
-- ----------------------------------------------------------------------------
-- Run this AFTER hfms_foundation_fix_01_ledger_sync.sql.
--
-- WHY THIS IS A FUNCTION YOU CALL, NOT A TRIGGER THAT FIRES AUTOMATICALLY
-- The tempting design is a trigger on financial_transactions that posts to
-- journal_entries the instant a row appears — but that chains three tables
-- of triggers deep off a single revenue_entries insert. A bug anywhere in
-- that chain throws an exception inside the SAME transaction as an
-- ordinary daily revenue entry, and Postgres rolls the whole thing back.
-- On a live app people are using right now, "logging today's revenue
-- occasionally fails for reasons no one can see" is a much worse outcome
-- than "the trial balance is a few minutes stale." So posting is instead a
-- function you (or a scheduled job, later) call explicitly. It only ever
-- touches journal_entries/journal_lines — financial_transactions and every
-- table before it in the chain are read-only from its point of view.
--
-- THE ACCOUNTING LOGIC
--   revenue              -> Dr Cash/Mobile Money        Cr Revenue
--   expense (cash-paid)  -> Dr Operating Expense (+Charges)  Cr Cash/Mobile Money
--   expense (owner-funded)-> Dr Operating Expense (+Charges)  Cr Owner Loan Payable
--     (an owner-funded expense is a real cost with no company cash outflow —
--      economically the owner just lent the company that amount, matching
--      this app's own dashboard math, which already excludes owner-funded
--      amounts from "net OpEx")
--   owner_loan_funding    -> Dr Cash/Mobile Money        Cr Owner Loan Payable
--   owner_loan_repayment  -> Dr Owner Loan Payable        Cr Cash/Mobile Money
-- Every posting is two or more lines that sum to zero (debits = credits) by
-- construction — see the verification queries at the bottom for proof this
-- holds across everything posted, not just in theory.
-- ============================================================================

create or replace function public.hfms_coa_id(p_branch uuid, p_code text)
returns uuid language sql stable security definer set search_path = public as $$
  select id from public.chart_of_accounts where branch_id = p_branch and code = p_code limit 1;
$$;

-- Posts (or re-posts) ONE financial_transactions row. Returns the new
-- journal_entries.id, or null if nothing was posted (deleted/excluded row,
-- or a transaction_type this function doesn't know how to post yet).
create or replace function public.hfms_post_one_transaction(p_ft_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  ft record;
  v_cash_code text;
  v_cash_id uuid;
  v_je_id uuid;
  v_owner_funded boolean;
  v_existing_je uuid;
begin
  select * into ft from public.financial_transactions where id = p_ft_id;
  if not found then return null; end if;

  -- An edit or delete supersedes any existing posting for this row — void
  -- it first (never delete a journal entry outright; see the reversal
  -- pattern journal.js already uses for manual entries).
  select id into v_existing_je from public.journal_entries
    where source_type = 'financial_transaction' and source_id = ft.id and status = 'posted';
  if v_existing_je is not null then
    update public.journal_entries set status = 'void', voided_at = now(),
      void_reason = 'Superseded by re-posting the source transaction'
      where id = v_existing_je;
  end if;

  if ft.is_deleted or ft.classification_status <> 'classified' or ft.net_amount_kes <= 0 then
    return null;
  end if;
  if public.hfms_period_is_closed(ft.branch_id, ft.transaction_date) then
    -- Don't post into a closed period silently — leave it unposted so a
    -- human notices, rather than raising and risking a caller's transaction.
    return null;
  end if;

  if ft.account_id is not null then
    select case when fa.kind = 'bank' then '1000' else '1100' end into v_cash_code
    from public.financial_accounts fa where fa.id = ft.account_id;
  end if;
  v_cash_code := coalesce(v_cash_code, '1100');
  v_cash_id := public.hfms_coa_id(ft.branch_id, v_cash_code);
  v_owner_funded := coalesce((ft.raw_data->>'owner_funded')::boolean, false);

  if ft.transaction_type not in ('revenue','expense','owner_loan_funding','owner_loan_repayment') then
    return null; -- no posting rule yet for this type — don't guess
  end if;

  insert into public.journal_entries (branch_id, entry_date, description, source_type, source_id, status, posted_at)
  values (ft.branch_id, ft.transaction_date, coalesce(ft.description, initcap(ft.transaction_type)),
          'financial_transaction', ft.id, 'posted', now())
  returning id into v_je_id;

  if ft.transaction_type = 'revenue' then
    insert into public.journal_lines (journal_entry_id, account_id, debit_kes, credit_kes) values
      (v_je_id, v_cash_id, ft.net_amount_kes, 0),
      (v_je_id, public.hfms_coa_id(ft.branch_id,'4000'), 0, ft.net_amount_kes);

  elsif ft.transaction_type = 'expense' then
    insert into public.journal_lines (journal_entry_id, account_id, debit_kes, credit_kes) values
      (v_je_id, public.hfms_coa_id(ft.branch_id,'5000'), ft.gross_amount_kes, 0);
    if coalesce(ft.charges_kes,0) > 0 then
      insert into public.journal_lines (journal_entry_id, account_id, debit_kes, credit_kes) values
        (v_je_id, public.hfms_coa_id(ft.branch_id,'5100'), ft.charges_kes, 0);
    end if;
    if v_owner_funded then
      insert into public.journal_lines (journal_entry_id, account_id, debit_kes, credit_kes) values
        (v_je_id, public.hfms_coa_id(ft.branch_id,'2200'), 0, ft.net_amount_kes);
    else
      insert into public.journal_lines (journal_entry_id, account_id, debit_kes, credit_kes) values
        (v_je_id, v_cash_id, 0, ft.net_amount_kes);
    end if;

  elsif ft.transaction_type = 'owner_loan_funding' then
    insert into public.journal_lines (journal_entry_id, account_id, debit_kes, credit_kes) values
      (v_je_id, v_cash_id, ft.net_amount_kes, 0),
      (v_je_id, public.hfms_coa_id(ft.branch_id,'2200'), 0, ft.net_amount_kes);

  elsif ft.transaction_type = 'owner_loan_repayment' then
    insert into public.journal_lines (journal_entry_id, account_id, debit_kes, credit_kes) values
      (v_je_id, public.hfms_coa_id(ft.branch_id,'2200'), ft.net_amount_kes, 0),
      (v_je_id, v_cash_id, 0, ft.net_amount_kes);
  end if;

  return v_je_id;
end;
$$;

-- Posts everything not yet posted. Call this after the backfill, and
-- periodically afterward (manually for now — a scheduled job is future
-- work, not built here). Returns how many entries it created.
create or replace function public.hfms_post_all_unposted_transactions()
returns integer language plpgsql security definer set search_path = public as $$
declare
  ft_id uuid;
  v_count integer := 0;
begin
  for ft_id in
    select ft.id from public.financial_transactions ft
    where ft.is_deleted = false and ft.classification_status = 'classified'
      and not exists (
        select 1 from public.journal_entries je
        where je.source_type = 'financial_transaction' and je.source_id = ft.id and je.status = 'posted'
      )
  loop
    if public.hfms_post_one_transaction(ft_id) is not null then
      v_count := v_count + 1;
    end if;
  end loop;
  return v_count;
end;
$$;

-- ----------------------------------------------------------------------------
-- RUN THIS to actually post everything the backfill created:
-- ----------------------------------------------------------------------------
select public.hfms_post_all_unposted_transactions() as entries_posted;

-- ----------------------------------------------------------------------------
-- VERIFICATION — this is the one that actually proves the books balance.
-- Run it after posting. total_debit and total_credit MUST be equal, to the
-- cent. If they're not, something above has a bug — stop and investigate
-- before trusting any report built on this ledger.
-- ----------------------------------------------------------------------------
select
  sum(total_debit_kes) as total_debit,
  sum(total_credit_kes) as total_credit,
  sum(total_debit_kes) - sum(total_credit_kes) as difference_should_be_zero
from public.v_hfms_trial_balance;

-- Per-branch breakdown of the same check:
-- select branch_id, sum(total_debit_kes) debit, sum(total_credit_kes) credit,
--        sum(total_debit_kes)-sum(total_credit_kes) as difference
-- from public.v_hfms_trial_balance group by branch_id;

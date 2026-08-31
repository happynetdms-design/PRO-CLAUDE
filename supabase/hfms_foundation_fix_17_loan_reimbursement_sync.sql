-- ============================================================================
-- HFMS Foundation Fix, part 17 — dual-path loan repayment reconciliation
-- ----------------------------------------------------------------------------
-- Run this AFTER hfms_schema_v2.sql.
--
-- THE GAP THIS CLOSES
-- Tracing Happynet's actual live spreadsheet formula-by-formula revealed a
-- real mechanic the app didn't have: repaying a related-party loan (e.g.
-- John's) counts through TWO paths in the real business, not one —
--   1. A dedicated payment logged directly against the loan (what the app
--      already had, via loan_payments), AND
--   2. An ordinary expense categorized "Reimbursement" where the vendor
--      (Paid To) matches the lender's name — logged as a normal expense,
--      with no separate loan-payment entry needed.
-- The real sheet's Current Balance formula sums BOTH sources. The app's
-- current_balance_kes only ever reflected path 1. This closes that gap by
-- recomputing the balance from BOTH sources whenever either changes,
-- matching the sheet's behavior exactly rather than approximating it.
--
-- WHY RECOMPUTE-FROM-SCRATCH, NOT INCREMENTAL ADJUSTMENT
-- The same principle used throughout this build (the ledger sync, the
-- trial balance): incrementally adding/subtracting on every insert/edit/
-- delete is exactly the kind of logic that drifts over time from a single
-- missed edge case. Recomputing the whole balance from its two real
-- sources every time is slower but can't drift — it's always exactly
-- "principal minus everything that actually reduced it," full stop.
-- ============================================================================

create or replace function public.hfms_recompute_loan_balance(p_loan_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_loan record;
  v_dedicated_payments numeric(14,2);
  v_reimbursement_expenses numeric(14,2);
begin
  select * into v_loan from public.loans where id = p_loan_id;
  if not found then return; end if;

  select coalesce(sum(amount_kes), 0) into v_dedicated_payments
  from public.loan_payments where loan_id = p_loan_id;

  -- Matches the sheet's wildcard pattern (Paid To contains the lender's
  -- name, case-insensitive) — deliberately loose, same as the formula it
  -- replicates, not an exact-match lookup.
  v_reimbursement_expenses := 0;
  if v_loan.lender is not null and trim(v_loan.lender) <> '' then
    select coalesce(sum(amount_kes + coalesce(charges_kes,0)), 0) into v_reimbursement_expenses
    from public.expenses
    where branch_id = v_loan.branch_id
      and is_deleted = false
      and status <> 'rejected'
      and lower(category) = 'reimbursement'
      and paid_to ilike '%' || v_loan.lender || '%';
  end if;

  update public.loans set
    current_balance_kes = greatest(0, v_loan.original_principal_kes - v_dedicated_payments - v_reimbursement_expenses),
    status = case
      when v_loan.original_principal_kes - v_dedicated_payments - v_reimbursement_expenses <= 0 then 'PAID_OFF'
      else 'ACTIVE'
    end
  where id = p_loan_id;
end;
$$;

-- Recomputes every loan on a branch — used for the one-time backfill when
-- this migration first runs, and safe to call anytime as a manual "resync".
create or replace function public.hfms_recompute_all_loan_balances(p_branch_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_loan_id uuid;
begin
  for v_loan_id in select id from public.loans where branch_id = p_branch_id and is_deleted = false loop
    perform public.hfms_recompute_loan_balance(v_loan_id);
  end loop;
end;
$$;

-- Fires whenever an expense that could plausibly be a Reimbursement changes
-- — recomputes every loan on the branch that could be affected (covers the
-- case where an edit moves an expense INTO or OUT OF being a match, e.g.
-- category or paid_to changed, or the lender name itself is edited later).
create or replace function public.hfms_sync_expense_reimbursement()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_branch_id uuid;
  v_loan_id uuid;
begin
  v_branch_id := coalesce(new.branch_id, old.branch_id);
  for v_loan_id in select id from public.loans where branch_id = v_branch_id and is_deleted = false loop
    perform public.hfms_recompute_loan_balance(v_loan_id);
  end loop;
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_expense_reimbursement_sync on public.expenses;
create trigger trg_expense_reimbursement_sync
  after insert or update on public.expenses
  for each row execute function public.hfms_sync_expense_reimbursement();

-- A dedicated loan_payments entry needs the same treatment — logging or
-- removing one should also recompute the balance it affects.
create or replace function public.hfms_sync_loan_payment()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.hfms_recompute_loan_balance(coalesce(new.loan_id, old.loan_id));
  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_loan_payment_sync on public.loan_payments;
create trigger trg_loan_payment_sync
  after insert or update or delete on public.loan_payments
  for each row execute function public.hfms_sync_loan_payment();

-- ----------------------------------------------------------------------------
-- ONE-TIME BACKFILL — run once after this file, per branch, so existing
-- loans immediately reflect any historical Reimbursement expenses that
-- were never counted before this migration existed.
-- ----------------------------------------------------------------------------
-- select public.hfms_recompute_all_loan_balances('<branch id>');

-- ----------------------------------------------------------------------------
-- VERIFICATION
-- ----------------------------------------------------------------------------
-- select debt_name, lender, original_principal_kes, current_balance_kes, status from loans;
-- Log a test expense: category='Reimbursement', paid_to containing a lender's name,
-- then re-select — current_balance_kes should drop by that expense's total automatically.

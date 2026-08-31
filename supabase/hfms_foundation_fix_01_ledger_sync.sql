-- ============================================================================
-- HFMS Foundation Fix — makes financial_transactions genuinely true
-- ----------------------------------------------------------------------------
-- Run this AFTER: hfms_schema_v2.sql, hfms_foundation_fix_00_ledger_core.sql
-- (the ledger + chart of accounts tables must already exist).
--
-- THE PROBLEM THIS FIXES
-- financial_transactions was designed with revenue_entry_id / expense_id
-- foreign keys pointing back at your real, live tables — it was clearly
-- meant to be a derived ledger, not a competing one. But nothing in the
-- uploaded build ever wrote to it from revenue.js or expenses.js, and
-- nothing backfilled your existing history into it. Two of the new
-- functions (loan-payments.js, import-financials.js) DID write to it
-- directly, which is exactly how you get silent double-posting and two
-- disagreeing sources of truth.
--
-- THE FIX
-- Triggers on the tables you actually use (revenue_entries, expenses,
-- loans, loan_payments) keep financial_transactions in sync automatically.
-- Your working, tested endpoint files (revenue.js, expenses.js, loans.js,
-- loan-payments.js — the ORIGINAL ones, not the rewritten ones from the
-- uploaded zip) are untouched. Nobody has to remember to dual-write
-- anywhere. The database guarantees consistency, not application code
-- discipline.
--
-- WHAT THIS DOES NOT DO
-- It does not touch revenue_entries, expenses, loans, or loan_payments.
-- Those remain exactly as they are — still the tables your live app reads
-- and writes through the endpoints already deployed. This only ever
-- inserts into the NEW tables (financial_transactions, journal_entries,
-- journal_lines), which are currently empty and unused.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. SYNC: revenue_entries -> financial_transactions
-- ----------------------------------------------------------------------------
-- SAFETY: wrapped in EXCEPTION so a bug here can NEVER block an ordinary
-- revenue entry from saving. If the sync fails, it's logged to
-- hfms_sync_errors and the original write still succeeds — a wrong or
-- missing ledger row is a much smaller problem than blocking daily data
-- entry on your live, already-in-use app.
create table if not exists public.hfms_sync_errors (
  id bigint generated always as identity primary key,
  source_table text not null,
  source_id uuid not null,
  error_message text not null,
  occurred_at timestamptz not null default now()
);

create or replace function public.hfms_sync_revenue_to_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or tg_op = 'UPDATE' then
    insert into public.financial_transactions (
      branch_id, transaction_date, transaction_type, direction,
      gross_amount_kes, net_amount_kes, revenue_entry_id,
      source_system, source_ref, description, classification_status, is_deleted
    ) values (
      new.branch_id, new.entry_date, 'revenue', 'inflow',
      new.amount_kes, new.amount_kes, new.id,
      'revenue_entries', new.id::text, new.notes, 'classified', new.is_deleted
    )
    on conflict (branch_id, source_system, source_ref) do update set
      transaction_date = excluded.transaction_date,
      gross_amount_kes = excluded.gross_amount_kes,
      net_amount_kes   = excluded.net_amount_kes,
      description      = excluded.description,
      is_deleted       = excluded.is_deleted,
      updated_at       = now();
  end if;
  return new;
exception when others then
  insert into public.hfms_sync_errors(source_table, source_id, error_message)
    values ('revenue_entries', new.id, sqlerrm);
  return new;
end;
$$;

drop trigger if exists trg_sync_revenue_to_ledger on public.revenue_entries;
create trigger trg_sync_revenue_to_ledger
  after insert or update on public.revenue_entries
  for each row execute function public.hfms_sync_revenue_to_ledger();

-- ----------------------------------------------------------------------------
-- 2. SYNC: expenses -> financial_transactions
-- ----------------------------------------------------------------------------
-- Owner-funded expenses (paid personally, not from the OpEx account) are a
-- real cost to the business but didn't use company cash — economically the
-- owner has just lent the company that amount. Tagged in raw_data so the
-- journal-posting step below can credit Owner Loan Payable instead of Cash,
-- matching how this app's own dashboard math already excludes owner-funded
-- amounts from "net OpEx" (see netExpenseOn() in index.html).
create or replace function public.hfms_sync_expense_to_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or tg_op = 'UPDATE' then
    insert into public.financial_transactions (
      branch_id, transaction_date, transaction_type, direction,
      gross_amount_kes, charges_kes, net_amount_kes,
      account_id, category_id, expense_id,
      source_system, source_ref, external_ref, counterparty, description,
      classification_status, raw_data, is_deleted
    ) values (
      new.branch_id, new.expense_date, 'expense', 'outflow',
      new.amount_kes, coalesce(new.charges_kes,0), new.amount_kes + coalesce(new.charges_kes,0),
      new.account_id, new.category_id, new.id,
      'expenses', new.id::text, new.txn_ref, new.paid_to, new.description,
      case when new.status = 'pending_approval' then 'review'
           when new.status = 'rejected' then 'excluded'
           else 'classified' end,
      jsonb_build_object('owner_funded', new.owner_funded, 'status', new.status),
      new.is_deleted
    )
    on conflict (branch_id, source_system, source_ref) do update set
      transaction_date     = excluded.transaction_date,
      gross_amount_kes     = excluded.gross_amount_kes,
      charges_kes          = excluded.charges_kes,
      net_amount_kes       = excluded.net_amount_kes,
      account_id           = excluded.account_id,
      category_id          = excluded.category_id,
      counterparty          = excluded.counterparty,
      description          = excluded.description,
      classification_status = excluded.classification_status,
      raw_data              = excluded.raw_data,
      is_deleted            = excluded.is_deleted,
      updated_at             = now();
  end if;
  return new;
exception when others then
  insert into public.hfms_sync_errors(source_table, source_id, error_message)
    values ('expenses', new.id, sqlerrm);
  return new;
end;
$$;

drop trigger if exists trg_sync_expense_to_ledger on public.expenses;
create trigger trg_sync_expense_to_ledger
  after insert or update on public.expenses
  for each row execute function public.hfms_sync_expense_to_ledger();

-- ----------------------------------------------------------------------------
-- 3. SYNC: loans -> financial_transactions (original funding, posted once)
-- ----------------------------------------------------------------------------
-- A loan's original_principal_kes is the funding event (e.g. John putting
-- money into the business). Only posts once per loan, at start_date — later
-- edits to a loan record (interest rate, min payment) don't re-trigger this.
create or replace function public.hfms_sync_loan_funding_to_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.financial_transactions (
      branch_id, transaction_date, transaction_type, direction,
      gross_amount_kes, net_amount_kes, loan_id,
      source_system, source_ref, counterparty, description, classification_status
    ) values (
      new.branch_id, coalesce(new.start_date, current_date), 'owner_loan_funding', 'inflow',
      new.original_principal_kes, new.original_principal_kes, new.id,
      'loans', new.id::text, new.lender, 'Loan funding: ' || new.debt_name, 'classified'
    )
    on conflict (branch_id, source_system, source_ref) do nothing;
  end if;
  return new;
exception when others then
  insert into public.hfms_sync_errors(source_table, source_id, error_message)
    values ('loans', new.id, sqlerrm);
  return new;
end;
$$;

drop trigger if exists trg_sync_loan_funding_to_ledger on public.loans;
create trigger trg_sync_loan_funding_to_ledger
  after insert on public.loans
  for each row execute function public.hfms_sync_loan_funding_to_ledger();

-- ----------------------------------------------------------------------------
-- 4. SYNC: loan_payments -> financial_transactions
-- ----------------------------------------------------------------------------
create or replace function public.hfms_sync_loan_payment_to_ledger()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_branch_id uuid;
begin
  select branch_id into v_branch_id from public.loans where id = new.loan_id;
  if tg_op = 'INSERT' or tg_op = 'UPDATE' then
    insert into public.financial_transactions (
      branch_id, transaction_date, transaction_type, direction,
      gross_amount_kes, net_amount_kes, loan_id,
      source_system, source_ref, description, classification_status, is_deleted
    ) values (
      v_branch_id, new.payment_date, 'owner_loan_repayment', 'outflow',
      new.amount_kes, new.amount_kes, new.loan_id,
      'loan_payments', new.id::text, coalesce(new.note, 'Loan repayment'), 'classified',
      coalesce(new.is_deleted, false)
    )
    on conflict (branch_id, source_system, source_ref) do update set
      transaction_date = excluded.transaction_date,
      gross_amount_kes = excluded.gross_amount_kes,
      net_amount_kes   = excluded.net_amount_kes,
      description      = excluded.description,
      is_deleted       = excluded.is_deleted,
      updated_at       = now();
  end if;
  return new;
exception when others then
  insert into public.hfms_sync_errors(source_table, source_id, error_message)
    values ('loan_payments', new.id, sqlerrm);
  return new;
end;
$$;

drop trigger if exists trg_sync_loan_payment_to_ledger on public.loan_payments;
create trigger trg_sync_loan_payment_to_ledger
  after insert or update on public.loan_payments
  for each row execute function public.hfms_sync_loan_payment_to_ledger();

-- ----------------------------------------------------------------------------
-- 5. ONE-TIME BACKFILL — populate financial_transactions from everything
--    that already existed before these triggers were created. Safe to
--    re-run: every insert above is already ON CONFLICT DO UPDATE/NOTHING.
-- ----------------------------------------------------------------------------
insert into public.financial_transactions (
  branch_id, transaction_date, transaction_type, direction,
  gross_amount_kes, net_amount_kes, revenue_entry_id,
  source_system, source_ref, description, classification_status, is_deleted
)
select branch_id, entry_date, 'revenue', 'inflow', amount_kes, amount_kes, id,
       'revenue_entries', id::text, notes, 'classified', is_deleted
from public.revenue_entries
on conflict (branch_id, source_system, source_ref) do nothing;

insert into public.financial_transactions (
  branch_id, transaction_date, transaction_type, direction,
  gross_amount_kes, charges_kes, net_amount_kes, account_id, category_id, expense_id,
  source_system, source_ref, external_ref, counterparty, description,
  classification_status, raw_data, is_deleted
)
select branch_id, expense_date, 'expense', 'outflow', amount_kes, coalesce(charges_kes,0),
       amount_kes + coalesce(charges_kes,0), account_id, category_id, id,
       'expenses', id::text, txn_ref, paid_to, description,
       case when status = 'pending_approval' then 'review' when status = 'rejected' then 'excluded' else 'classified' end,
       jsonb_build_object('owner_funded', owner_funded, 'status', status), is_deleted
from public.expenses
on conflict (branch_id, source_system, source_ref) do nothing;

insert into public.financial_transactions (
  branch_id, transaction_date, transaction_type, direction,
  gross_amount_kes, net_amount_kes, loan_id, source_system, source_ref, counterparty, description, classification_status
)
select branch_id, coalesce(start_date, created_at::date), 'owner_loan_funding', 'inflow',
       original_principal_kes, original_principal_kes, id, 'loans', id::text, lender,
       'Loan funding: ' || debt_name, 'classified'
from public.loans
on conflict (branch_id, source_system, source_ref) do nothing;

insert into public.financial_transactions (
  branch_id, transaction_date, transaction_type, direction,
  gross_amount_kes, net_amount_kes, loan_id, source_system, source_ref, description, classification_status, is_deleted
)
select l.branch_id, lp.payment_date, 'owner_loan_repayment', 'outflow',
       lp.amount_kes, lp.amount_kes, lp.loan_id, 'loan_payments', lp.id::text,
       coalesce(lp.note, 'Loan repayment'), 'classified', coalesce(lp.is_deleted, false)
from public.loan_payments lp join public.loans l on l.id = lp.loan_id
on conflict (branch_id, source_system, source_ref) do nothing;

-- ----------------------------------------------------------------------------
-- VERIFICATION — run these and compare against your actual dashboard numbers
-- BEFORE trusting anything built on financial_transactions (trial balance,
-- P&L, executive dashboards). If these don't match, stop and investigate —
-- don't proceed to journal posting until they do.
-- ----------------------------------------------------------------------------
-- select (select coalesce(sum(amount_kes),0) from revenue_entries where is_deleted=false) as source_revenue_total,
--        (select coalesce(sum(net_amount_kes),0) from financial_transactions where transaction_type='revenue' and is_deleted=false) as ledger_revenue_total;
--
-- select (select coalesce(sum(amount_kes+coalesce(charges_kes,0)),0) from expenses where is_deleted=false) as source_expense_total,
--        (select coalesce(sum(net_amount_kes),0) from financial_transactions where transaction_type='expense' and is_deleted=false) as ledger_expense_total;
--
-- select count(*) from financial_transactions; -- should be > 0 after backfill if you have any history at all
-- select count(*) from hfms_sync_errors; -- should be 0 — investigate any row here before trusting the ledger

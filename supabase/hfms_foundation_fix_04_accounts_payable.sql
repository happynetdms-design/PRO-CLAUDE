-- ============================================================================
-- HFMS Foundation Fix, part 4 — Accounts Payable (built from scratch)
-- ----------------------------------------------------------------------------
-- Run this AFTER hfms_schema_v2.sql and hfms_foundation_fix_01/02.sql.
--
-- WHY THIS IS "FROM SCRATCH" AND NOT ADAPTED FROM THE UPLOADED ZIP
-- docs/HFMS_MASTER_IMPLEMENTATION_STATUS.md describes a full
-- "Supplier -> Bill -> Approval -> Accounts Payable -> Payment -> Ledger
-- -> Reconciliation" lifecycle under Phase 18. There is no bills table,
-- no accounts_payable table, and no posting logic anywhere in the 24
-- phase SQL files. That part of the narrative was never actually built —
-- worth knowing generally about how much of that document to trust.
--
-- Uses the suppliers table already in your live schema (hfms_schema_v2.sql)
-- — unchanged, still populated by nothing yet until this is wired up.
--
-- POSTING LOGIC (same "function you call, not a trigger" safety pattern
-- as the rest of the ledger — see hfms_foundation_fix_02 for why)
--   Bill approved -> Dr Operating Expense (5000)   Cr Accounts Payable (2000)
--   Bill paid     -> Dr Accounts Payable (2000)     Cr Cash/Mobile Money
-- ============================================================================

create table if not exists public.bills (
  id             uuid primary key default gen_random_uuid(),
  branch_id      uuid not null references public.branches(id) on delete cascade,
  supplier_id    uuid not null references public.suppliers(id),
  invoice_number text,
  invoice_date   date not null,
  due_date       date,
  category_id    uuid references public.categories(id),
  subtotal_kes   numeric(14,2) not null check (subtotal_kes >= 0),
  tax_kes        numeric(14,2) not null default 0 check (tax_kes >= 0),
  total_kes      numeric(14,2) not null check (total_kes >= 0),
  status         text not null default 'draft' check (status in ('draft','approved','partial','paid','void')),
  notes          text,
  is_deleted     boolean not null default false,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  approved_by    uuid references auth.users(id),
  approved_at    timestamptz,
  -- Duplicate-invoice protection, same pattern as expenses.txn_ref.
  unique (branch_id, supplier_id, invoice_number)
);

create table if not exists public.bill_payments (
  id           uuid primary key default gen_random_uuid(),
  bill_id      uuid not null references public.bills(id) on delete cascade,
  payment_date date not null,
  amount_kes   numeric(14,2) not null check (amount_kes > 0),
  account_id   uuid references public.financial_accounts(id),
  reference    text,
  is_deleted   boolean not null default false,
  created_by   uuid references auth.users(id),
  created_at   timestamptz not null default now()
);

create index if not exists idx_bills_branch_status on public.bills(branch_id, status) where is_deleted = false;
create index if not exists idx_bill_payments_bill on public.bill_payments(bill_id);

alter table public.bills enable row level security;
alter table public.bill_payments enable row level security;

drop policy if exists "bills read" on public.bills;
create policy "bills read" on public.bills for select to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]));
drop policy if exists "bills write" on public.bills;
create policy "bills write" on public.bills for all to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]))
  with check (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]));

drop policy if exists "bill payments read" on public.bill_payments;
create policy "bill payments read" on public.bill_payments for select to authenticated
  using (exists (select 1 from public.bills b where b.id = bill_payments.bill_id
    and (public.is_head_office() or public.has_branch_role(b.branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]))));
drop policy if exists "bill payments write" on public.bill_payments;
create policy "bill payments write" on public.bill_payments for all to authenticated
  using (exists (select 1 from public.bills b where b.id = bill_payments.bill_id
    and (public.is_head_office() or public.has_branch_role(b.branch_id, array['branch_manager','accountant']::public.user_role[]))))
  with check (exists (select 1 from public.bills b where b.id = bill_payments.bill_id
    and (public.is_head_office() or public.has_branch_role(b.branch_id, array['branch_manager','accountant']::public.user_role[]))));

-- ----------------------------------------------------------------------------
-- Posting: bill approval
-- ----------------------------------------------------------------------------
create or replace function public.hfms_post_bill_approval(p_bill_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  b record;
  v_je_id uuid;
begin
  select * into b from public.bills where id = p_bill_id;
  if not found then raise exception 'Bill not found.'; end if;
  if public.hfms_period_is_closed(b.branch_id, b.invoice_date) then
    raise exception 'Cannot approve — the accounting period for % is closed.', b.invoice_date;
  end if;

  insert into public.journal_entries (branch_id, entry_date, description, source_type, source_id, status, posted_at)
  values (b.branch_id, b.invoice_date, 'Bill approved: ' || coalesce(b.invoice_number, p_bill_id::text),
          'bill', b.id, 'posted', now())
  returning id into v_je_id;

  insert into public.journal_lines (journal_entry_id, account_id, debit_kes, credit_kes) values
    (v_je_id, public.hfms_coa_id(b.branch_id, '5000'), b.total_kes, 0),
    (v_je_id, public.hfms_coa_id(b.branch_id, '2000'), 0, b.total_kes);

  update public.bills set status = 'approved' where id = p_bill_id;
  return v_je_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- Posting: bill payment (also updates the bill's status based on how much
-- has been paid so far — paid in full, partially, or still unpaid)
-- ----------------------------------------------------------------------------
create or replace function public.hfms_post_bill_payment(p_payment_id uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  p record;
  b record;
  v_cash_code text;
  v_cash_id uuid;
  v_je_id uuid;
  v_total_paid numeric;
begin
  select * into p from public.bill_payments where id = p_payment_id;
  if not found then raise exception 'Payment not found.'; end if;
  select * into b from public.bills where id = p.bill_id;
  if b.status not in ('approved','partial') then
    raise exception 'Only an approved bill can be paid (current status: %).', b.status;
  end if;
  if public.hfms_period_is_closed(b.branch_id, p.payment_date) then
    raise exception 'Cannot post — the accounting period for % is closed.', p.payment_date;
  end if;

  select case when fa.kind = 'bank' then '1000' else '1100' end into v_cash_code
    from public.financial_accounts fa where fa.id = p.account_id;
  v_cash_code := coalesce(v_cash_code, '1100');
  v_cash_id := public.hfms_coa_id(b.branch_id, v_cash_code);

  insert into public.journal_entries (branch_id, entry_date, description, source_type, source_id, status, posted_at)
  values (b.branch_id, p.payment_date, 'Payment: ' || coalesce(b.invoice_number, b.id::text),
          'bill_payment', p.id, 'posted', now())
  returning id into v_je_id;

  insert into public.journal_lines (journal_entry_id, account_id, debit_kes, credit_kes) values
    (v_je_id, public.hfms_coa_id(b.branch_id, '2000'), p.amount_kes, 0),
    (v_je_id, v_cash_id, 0, p.amount_kes);

  select coalesce(sum(amount_kes),0) into v_total_paid from public.bill_payments
    where bill_id = b.id and is_deleted = false;
  update public.bills set status = case
      when v_total_paid >= total_kes then 'paid'
      when v_total_paid > 0 then 'partial'
      else 'approved'
    end
    where id = b.id;

  return v_je_id;
end;
$$;

-- ----------------------------------------------------------------------------
-- AP Aging — current / 1-30 / 31-60 / 61-90 / 90+, standard buckets, based
-- on days past due_date (or invoice_date if no due_date set).
-- ----------------------------------------------------------------------------
create or replace view public.v_hfms_ap_aging as
select
  b.id, b.branch_id, b.supplier_id, s.name as supplier_name, b.invoice_number,
  b.invoice_date, b.due_date, b.total_kes,
  coalesce((select sum(amount_kes) from public.bill_payments bp where bp.bill_id = b.id and bp.is_deleted = false), 0) as paid_kes,
  b.total_kes - coalesce((select sum(amount_kes) from public.bill_payments bp where bp.bill_id = b.id and bp.is_deleted = false), 0) as outstanding_kes,
  greatest(0, current_date - coalesce(b.due_date, b.invoice_date)) as days_overdue,
  case
    when greatest(0, current_date - coalesce(b.due_date, b.invoice_date)) = 0 then 'current'
    when greatest(0, current_date - coalesce(b.due_date, b.invoice_date)) <= 30 then '1-30'
    when greatest(0, current_date - coalesce(b.due_date, b.invoice_date)) <= 60 then '31-60'
    when greatest(0, current_date - coalesce(b.due_date, b.invoice_date)) <= 90 then '61-90'
    else '90+'
  end as aging_bucket
from public.bills b
join public.suppliers s on s.id = b.supplier_id
where b.is_deleted = false and b.status in ('approved','partial');

-- ----------------------------------------------------------------------------
-- VERIFICATION
-- ----------------------------------------------------------------------------
-- select * from v_hfms_ap_aging where branch_id = '<your branch id>';
-- select sum(total_debit_kes)-sum(total_credit_kes) from v_hfms_trial_balance; -- still must be 0 after bills post

-- ============================================================================
-- HFMS Foundation Fix, part 0 — the core double-entry ledger schema
-- ----------------------------------------------------------------------------
-- Run this AFTER hfms_schema_v2.sql, BEFORE hfms_foundation_fix_02 onward.
--
-- WHY THIS FILE EXISTS
-- Earlier work building this system referenced chart_of_accounts,
-- journal_entries, journal_lines, accounting_periods, hfms_period_is_closed(),
-- and the v_hfms_trial_balance view constantly — hfms_foundation_fix_02, 03,
-- 04, and 09 all assume they already exist, and executive-dashboard.js,
-- automation.js, and accounting-periods.js all query them directly. They
-- were described at the time as "adopted from the uploaded phase files,"
-- but those files were never actually saved into this deploy folder — only
-- referenced. That means every one of those foundation-fix files and
-- functions has been resting on tables that were never created. This file
-- is that missing foundation, reconstructed precisely from how every
-- dependent file actually uses them (exact column names, exact account
-- codes: 1000/1100 cash, 2000 AP, 2200 owner loan, 3100 retained earnings,
-- 4000 revenue, 5000/5100 expense) rather than a fresh guess at the schema.
-- ============================================================================

create table if not exists public.chart_of_accounts (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references public.branches(id) on delete cascade,
  code          text not null,
  name          text not null,
  account_type  text not null check (account_type in ('asset','liability','equity','revenue','expense')),
  is_active     boolean not null default true,
  created_at    timestamptz not null default now(),
  unique (branch_id, code)
);

create table if not exists public.journal_entries (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references public.branches(id) on delete cascade,
  entry_date    date not null,
  description   text,
  source_type   text,              -- 'financial_transaction' | 'bill' | 'bill_payment' | 'period_close' | 'manual'
  source_id     uuid,
  status        text not null default 'posted' check (status in ('posted','void')),
  posted_at     timestamptz,
  voided_at     timestamptz,
  void_reason   text,
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now()
);
create index if not exists idx_journal_entries_branch_date on public.journal_entries(branch_id, entry_date);
create index if not exists idx_journal_entries_source on public.journal_entries(source_type, source_id);

create table if not exists public.journal_lines (
  id                uuid primary key default gen_random_uuid(),
  journal_entry_id  uuid not null references public.journal_entries(id) on delete cascade,
  account_id        uuid not null references public.chart_of_accounts(id),
  debit_kes         numeric(14,2) not null default 0 check (debit_kes >= 0),
  credit_kes        numeric(14,2) not null default 0 check (credit_kes >= 0)
);
create index if not exists idx_journal_lines_entry on public.journal_lines(journal_entry_id);
create index if not exists idx_journal_lines_account on public.journal_lines(account_id);

create table if not exists public.accounting_periods (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references public.branches(id) on delete cascade,
  period_start  date not null,
  period_end    date not null,
  status        text not null default 'closed' check (status in ('open','closed','reopened')),
  closed_by     uuid references auth.users(id),
  closed_at     timestamptz,
  reopened_by   uuid references auth.users(id),
  reopened_at   timestamptz,
  reason        text,              -- required when reopening (see hfms_reopen_period)
  unique (branch_id, period_start, period_end)
);

-- A date is "in a closed period" if any accounting_periods row covering it
-- has status = 'closed' (a 'reopened' period is, by definition, open again
-- for posting until it's closed a second time).
create or replace function public.hfms_period_is_closed(p_branch uuid, p_date date)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.accounting_periods
    where branch_id = p_branch and status = 'closed'
      and p_date between period_start and period_end
  );
$$;

-- Every branch's running balance per account, from posted journal lines
-- only — this is what "the trial balance" means everywhere else in this
-- system references it (accounting-periods.js's pre-close check,
-- automation.js's imbalance alert, executive-dashboard.js's ledger
-- integrity badge).
create or replace view public.v_hfms_trial_balance as
select
  coa.branch_id,
  coa.id as account_id,
  coa.code,
  coa.name,
  coa.account_type,
  coalesce(sum(jl.debit_kes), 0) as total_debit_kes,
  coalesce(sum(jl.credit_kes), 0) as total_credit_kes,
  coalesce(sum(jl.debit_kes), 0) - coalesce(sum(jl.credit_kes), 0) as balance_kes
from public.chart_of_accounts coa
left join public.journal_lines jl on jl.account_id = coa.id
join public.journal_entries je on je.id = jl.journal_entry_id and je.status = 'posted'
group by coa.branch_id, coa.id, coa.code, coa.name, coa.account_type;

-- ----------------------------------------------------------------------------
-- RLS — same branch-role pattern as every other financial table in this app.
-- ----------------------------------------------------------------------------
alter table public.chart_of_accounts enable row level security;
alter table public.journal_entries enable row level security;
alter table public.journal_lines enable row level security;
alter table public.accounting_periods enable row level security;

drop policy if exists "coa read" on public.chart_of_accounts;
create policy "coa read" on public.chart_of_accounts for select to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]));

drop policy if exists "journal_entries read" on public.journal_entries;
create policy "journal_entries read" on public.journal_entries for select to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]));

drop policy if exists "journal_lines read" on public.journal_lines;
create policy "journal_lines read" on public.journal_lines for select to authenticated
  using (exists (select 1 from public.journal_entries je where je.id = journal_lines.journal_entry_id
    and (public.is_head_office() or public.has_branch_role(je.branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]))));

drop policy if exists "accounting_periods read" on public.accounting_periods;
create policy "accounting_periods read" on public.accounting_periods for select to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]));
-- No client-side write policies on any of these four — every write goes
-- through the security-definer posting functions (hfms_post_one_transaction,
-- hfms_close_period, etc.), which run with elevated privilege after their
-- own checks. Nothing should ever INSERT/UPDATE these tables directly.

-- ----------------------------------------------------------------------------
-- SEED: the standard chart of accounts, one branch at a time. Every code
-- referenced anywhere else in this system is included — nothing here is
-- decorative.
-- ----------------------------------------------------------------------------
create or replace function public.hfms_seed_chart_of_accounts(p_branch uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  insert into public.chart_of_accounts (branch_id, code, name, account_type) values
    (p_branch, '1000', 'Bank Account', 'asset'),
    (p_branch, '1100', 'Mobile Money / Cash', 'asset'),
    (p_branch, '2000', 'Accounts Payable', 'liability'),
    (p_branch, '2200', 'Owner Loan Payable', 'liability'),
    (p_branch, '3100', 'Retained Earnings', 'equity'),
    (p_branch, '4000', 'Revenue', 'revenue'),
    (p_branch, '5000', 'Operating Expenses', 'expense'),
    (p_branch, '5100', 'Bank & Transaction Charges', 'expense')
  on conflict (branch_id, code) do nothing;
end;
$$;

-- ----------------------------------------------------------------------------
-- VERIFICATION
-- ----------------------------------------------------------------------------
-- Run once per existing branch after this file:
-- select public.hfms_seed_chart_of_accounts('<branch id>');
-- select * from chart_of_accounts where branch_id = '<branch id>' order by code;
--   -- should show all 8 rows above.
-- select public.hfms_period_is_closed('<branch id>', current_date);
--   -- should return false on a fresh branch (nothing closed yet).
-- select * from v_hfms_trial_balance where branch_id = '<branch id>';
--   -- should show all 8 accounts with zero balances until transactions are posted.

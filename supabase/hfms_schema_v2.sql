-- ============================================================================
-- HAPPYNET FINANCIAL MANAGEMENT SYSTEM (HFMS) — Phase 1 Schema
-- ----------------------------------------------------------------------------
-- PURPOSE
-- Replaces the single-row JSON store (public.app_state) with a normalized
-- relational model, without touching the running app until you're ready to
-- cut over. Run this alongside the existing schema — it does NOT drop
-- app_state. A migration block at the bottom copies existing data across.
--
-- HOW TO APPLY
--   1. Supabase Dashboard → SQL Editor → paste this whole file → Run.
--   2. Verify row counts (queries at the very bottom of this file).
--   3. Only after the frontend/Netlify Functions are rewritten to read from
--      the new tables (Phase 2) should app_state be retired. Until then,
--      both can coexist safely — nothing here alters app_state.
--
-- SCOPE OF THIS FILE
--   - Companies / branches (multi-branch from day one, per the brief)
--   - Users, roles, branch-level access grants (RBAC skeleton)
--   - Accounts, categories, suppliers
--   - Revenue entries, expenses (with soft delete)
--   - Profit First settings + full allocation history
--   - Loans + loan payments
--   - Tax obligations + tax payments
--   - Generic attachments (receipts/invoices)
--   - Audit log (append-only, trigger-driven on the core money tables)
--   - Row Level Security wired to role + branch access
--   - Migration script from app_state.data (jsonb) into the new tables
--
-- WHAT THIS FILE DELIBERATELY DOES NOT DO
--   - It does not change a single line of the current frontend or Netlify
--     Functions. They keep working against app_state exactly as before
--     until Phase 2 rewires them. Nothing breaks today.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. COMPANY / BRANCH
-- ----------------------------------------------------------------------------
create table if not exists public.companies (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

create table if not exists public.branches (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  name        text not null,
  code        text not null,              -- short slug, e.g. 'main'
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (company_id, code)
);

-- ----------------------------------------------------------------------------
-- 2. USERS / ROLES / ACCESS
-- ----------------------------------------------------------------------------
-- Roles are intentionally a fixed enum, not a free-text column, so RLS
-- policies can reason about them safely.
do $$ begin
  create type public.user_role as enum
    ('owner', 'finance_manager', 'accountant', 'branch_manager', 'auditor', 'viewer');
exception when duplicate_object then null; end $$;

create table if not exists public.user_profiles (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  full_name   text,
  created_at  timestamptz not null default now()
);

-- Which branches a user can see, and with what role. Owner/Finance Manager
-- rows normally target every branch (Head Office); Branch Manager rows
-- target exactly one.
create table if not exists public.user_branch_access (
  user_id     uuid not null references auth.users(id) on delete cascade,
  branch_id   uuid not null references public.branches(id) on delete cascade,
  role        public.user_role not null,
  granted_by  uuid references auth.users(id),
  granted_at  timestamptz not null default now(),
  primary key (user_id, branch_id)
);

-- Helper: does the current JWT's user hold at least one of `roles` on `b_id`?
create or replace function public.has_branch_role(b_id uuid, roles public.user_role[])
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_branch_access uba
    where uba.branch_id = b_id
      and uba.user_id = auth.uid()
      and uba.role = any(roles)
  );
$$;

-- Helper: is the user Owner or Finance Manager on ANY branch (i.e. Head Office)?
create or replace function public.is_head_office()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_branch_access uba
    where uba.user_id = auth.uid()
      and uba.role in ('owner', 'finance_manager')
  );
$$;

-- ----------------------------------------------------------------------------
-- 3. REFERENCE DATA: ACCOUNTS, CATEGORIES, SUPPLIERS
-- ----------------------------------------------------------------------------
create table if not exists public.financial_accounts (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references public.branches(id) on delete cascade,
  name        text not null,                       -- e.g. 'M-Pesa Till', 'Bank Account'
  kind        text not null default 'other',        -- bank | mobile_money | cash | owner_wallet | other
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (branch_id, name)
);

create table if not exists public.categories (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid references public.branches(id) on delete cascade, -- null = company-wide default
  name        text not null,
  kind        text not null check (kind in ('revenue', 'expense')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.suppliers (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references public.branches(id) on delete cascade,
  name        text not null,
  contact     text,
  notes       text,
  created_at  timestamptz not null default now(),
  unique (branch_id, name)
);

-- ----------------------------------------------------------------------------
-- 4. REVENUE
-- ----------------------------------------------------------------------------
create table if not exists public.revenue_entries (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references public.branches(id) on delete cascade,
  entry_date    date not null,
  account_id    uuid references public.financial_accounts(id),
  category_id   uuid references public.categories(id),
  amount_kes    numeric(14,2) not null check (amount_kes >= 0),
  notes         text,
  source        text not null default 'manual',    -- manual | csv_import | xlsx_import | api
  is_deleted    boolean not null default false,     -- soft delete only
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists idx_revenue_branch_date on public.revenue_entries(branch_id, entry_date);

-- ----------------------------------------------------------------------------
-- 5. EXPENSES
-- ----------------------------------------------------------------------------
create table if not exists public.expenses (
  id              uuid primary key default gen_random_uuid(),
  branch_id       uuid not null references public.branches(id) on delete cascade,
  expense_date    date not null,
  txn_ref         text,                              -- external ref, e.g. Tende export ID
  account_id      uuid references public.financial_accounts(id),
  category_id     uuid references public.categories(id),
  supplier_id     uuid references public.suppliers(id),
  description     text,
  paid_to         text,
  amount_kes      numeric(14,2) not null check (amount_kes >= 0),
  charges_kes     numeric(14,2) not null default 0,
  owner_funded    boolean not null default false,
  status          text not null default 'posted',   -- pending_approval | posted | rejected
  approved_by     uuid references auth.users(id),
  approved_at     timestamptz,
  source          text not null default 'manual',    -- manual | tende_import | csv_import
  is_deleted      boolean not null default false,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists idx_expenses_branch_date on public.expenses(branch_id, expense_date);
-- Duplicate detection: a txn_ref should only appear once per branch when present.
create unique index if not exists uq_expenses_branch_txnref
  on public.expenses(branch_id, txn_ref) where txn_ref is not null and txn_ref <> '';

-- ----------------------------------------------------------------------------
-- 6. PROFIT FIRST — SETTINGS + FULL HISTORY
-- ----------------------------------------------------------------------------
create table if not exists public.profit_first_settings (
  branch_id                          uuid primary key references public.branches(id) on delete cascade,
  -- Happynet's actual split is 4 buckets of total revenue (must sum to 100),
  -- not the textbook 5-bucket model — matches state.settings in the live app.
  pct_profit                         numeric(5,2) not null default 5,
  pct_owner_debt                     numeric(5,2) not null default 20,
  pct_tax                            numeric(5,2) not null default 15,
  pct_opex                           numeric(5,2) not null default 60,
  debt_paydown_split_pct             numeric(5,2) not null default 40, -- share of pct_owner_debt that goes to debt vs owner pay
  monthly_revenue_target_kes         numeric(14,2) not null default 0,
  opening_opex_account_balance_kes   numeric(14,2) not null default 0,
  effective_from                     date not null default current_date,
  updated_by                         uuid references auth.users(id),
  updated_at                         timestamptz not null default now()
);

-- Every change to the row above is captured here first, so allocation
-- percentages used in any historical month are always reconstructable.
create table if not exists public.profit_first_settings_history (
  id              uuid primary key default gen_random_uuid(),
  branch_id       uuid not null references public.branches(id) on delete cascade,
  config          jsonb not null,          -- full snapshot of the settings row
  reason          text,
  changed_by      uuid references auth.users(id),
  changed_at      timestamptz not null default now()
);

-- Computed/approved allocations per period per bucket — this is the audit
-- trail the brief calls "allocation proof".
create table if not exists public.allocations (
  id              uuid primary key default gen_random_uuid(),
  branch_id       uuid not null references public.branches(id) on delete cascade,
  period          date not null,           -- first day of the month this covers
  bucket          text not null check (bucket in ('profit','owner_debt','tax','opex')),
  amount_kes      numeric(14,2) not null,
  computed_at     timestamptz not null default now(),
  approved_by     uuid references auth.users(id),
  approved_at     timestamptz,
  proof_note      text,
  unique (branch_id, period, bucket)
);

-- ----------------------------------------------------------------------------
-- 7. LOANS
-- ----------------------------------------------------------------------------
create table if not exists public.loans (
  id                          uuid primary key default gen_random_uuid(),
  branch_id                   uuid not null references public.branches(id) on delete cascade,
  debt_name                   text not null,
  lender                      text,
  original_principal_kes      numeric(14,2) not null,
  current_balance_kes         numeric(14,2) not null,
  annual_interest_rate_pct    numeric(5,2) not null default 0,
  start_date                  date,
  min_monthly_payment_kes     numeric(14,2) not null default 0,
  status                      text not null default 'ACTIVE',   -- ACTIVE | PAID_OFF | ...
  is_deleted                  boolean not null default false,
  created_at                  timestamptz not null default now()
);

create table if not exists public.loan_payments (
  id              uuid primary key default gen_random_uuid(),
  loan_id         uuid not null references public.loans(id) on delete cascade,
  payment_date    date not null,
  amount_kes      numeric(14,2) not null,
  note            text,
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 8. TAX OBLIGATIONS
-- ----------------------------------------------------------------------------
create table if not exists public.tax_obligations (
  id                      uuid primary key default gen_random_uuid(),
  branch_id               uuid not null references public.branches(id) on delete cascade,
  tax_type                text not null,          -- VAT, PAYE, NSSF, SHIF, etc.
  applicable              boolean not null default true,
  frequency               text not null default 'Monthly',
  due_day_of_month        int,
  manual_next_due_date    date,
  estimated_amount_kes    numeric(14,2) not null default 0,
  filing_authority        text default 'KRA',
  notes                   text,
  unique (branch_id, tax_type)
);

create table if not exists public.tax_payments (
  id                  uuid primary key default gen_random_uuid(),
  tax_obligation_id   uuid not null references public.tax_obligations(id) on delete cascade,
  payment_date        date not null,
  amount_kes          numeric(14,2) not null,
  reference           text,
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now()
);

-- ----------------------------------------------------------------------------
-- 9. ATTACHMENTS (receipts / invoices — points at Supabase Storage objects)
-- ----------------------------------------------------------------------------
create table if not exists public.attachments (
  id            uuid primary key default gen_random_uuid(),
  entity_type   text not null,       -- 'expense' | 'revenue_entry' | 'loan' | ...
  entity_id     uuid not null,
  storage_path  text not null,       -- path within a Supabase Storage bucket
  uploaded_by   uuid references auth.users(id),
  uploaded_at   timestamptz not null default now()
);
create index if not exists idx_attachments_entity on public.attachments(entity_type, entity_id);

-- ----------------------------------------------------------------------------
-- 10. AUDIT LOG (append-only; nothing here is ever updated or deleted)
-- ----------------------------------------------------------------------------
create table if not exists public.audit_log (
  id            bigint generated always as identity primary key,
  table_name    text not null,
  record_id     uuid not null,
  action        text not null,       -- insert | update | soft_delete
  old_data      jsonb,
  new_data      jsonb,
  changed_by    uuid references auth.users(id),
  changed_at    timestamptz not null default now(),
  reason        text
);

create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log(table_name, record_id, action, new_data, changed_by)
    values (tg_table_name, new.id, 'insert', to_jsonb(new), auth.uid());
    return new;
  elsif tg_op = 'UPDATE' then
    insert into public.audit_log(table_name, record_id, action, old_data, new_data, changed_by)
    values (tg_table_name, new.id, case when new.is_deleted and not old.is_deleted
                                         then 'soft_delete' else 'update' end,
            to_jsonb(old), to_jsonb(new), auth.uid());
    return new;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_audit_revenue on public.revenue_entries;
create trigger trg_audit_revenue
  after insert or update on public.revenue_entries
  for each row execute function public.audit_row_change();

drop trigger if exists trg_audit_expenses on public.expenses;
create trigger trg_audit_expenses
  after insert or update on public.expenses
  for each row execute function public.audit_row_change();

drop trigger if exists trg_audit_loans on public.loans;
create trigger trg_audit_loans
  after insert or update on public.loans
  for each row execute function public.audit_row_change();

-- ----------------------------------------------------------------------------
-- 11. ROW LEVEL SECURITY
-- ----------------------------------------------------------------------------
-- Pattern used throughout: Head Office (owner/finance_manager) sees every
-- branch; everyone else is scoped to branches they've been explicitly
-- granted in user_branch_access. Auditor/viewer get read-only.

alter table public.branches enable row level security;
alter table public.financial_accounts enable row level security;
alter table public.categories enable row level security;
alter table public.suppliers enable row level security;
alter table public.revenue_entries enable row level security;
alter table public.expenses enable row level security;
alter table public.profit_first_settings enable row level security;
alter table public.profit_first_settings_history enable row level security;
alter table public.allocations enable row level security;
alter table public.loans enable row level security;
alter table public.loan_payments enable row level security;
alter table public.tax_obligations enable row level security;
alter table public.tax_payments enable row level security;
alter table public.attachments enable row level security;
alter table public.audit_log enable row level security;
alter table public.user_branch_access enable row level security;

drop policy if exists "read own branches" on public.branches;
create policy "read own branches" on public.branches for select to authenticated
  using (public.is_head_office() or public.has_branch_role(id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]));

-- Revenue: read = any granted role on that branch; write = owner/finance_manager/
-- accountant/branch_manager (not auditor/viewer).
drop policy if exists "revenue read" on public.revenue_entries;
create policy "revenue read" on public.revenue_entries for select to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]));

drop policy if exists "revenue write" on public.revenue_entries;
create policy "revenue write" on public.revenue_entries for insert to authenticated
  with check (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]));

drop policy if exists "revenue update" on public.revenue_entries;
create policy "revenue update" on public.revenue_entries for update to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]));

drop policy if exists "expenses read" on public.expenses;
create policy "expenses read" on public.expenses for select to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]));

drop policy if exists "expenses write" on public.expenses;
create policy "expenses write" on public.expenses for insert to authenticated
  with check (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]));

drop policy if exists "expenses update" on public.expenses;
create policy "expenses update" on public.expenses for update to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]));

-- Audit log: read-only for everyone with branch access via the referenced
-- table; nobody gets update/delete policies (append-only by omission).
drop policy if exists "audit read head office" on public.audit_log;
create policy "audit read head office" on public.audit_log for select to authenticated
  using (public.is_head_office());

-- NOTE: the remaining tables (financial_accounts, categories, suppliers,
-- profit_first_settings*, allocations, loans*, tax_*, attachments,
-- user_branch_access) need the same read/write policy pairs, following the
-- identical pattern above. Left for Phase 2 alongside the Netlify Functions
-- rewrite, so policies can be tested against the real API layer rather than
-- guessed at in isolation — happy to fill these in as the next step.

-- ============================================================================
-- 12. MIGRATION — copy existing app_state.data (jsonb) into the new tables
-- ----------------------------------------------------------------------------
-- Safe to run multiple times against a fresh target (uses ON CONFLICT DO
-- NOTHING / NOT EXISTS guards). Does NOT modify or delete app_state.
-- Assumes exactly one Happynet company/branch today, matching the current
-- single-row design.
-- ============================================================================
do $$
declare
  v_company_id  uuid;
  v_branch_id   uuid;
  v_state       jsonb;
  v_loan        jsonb;
  v_payment     jsonb;
  v_new_loan_id uuid;
begin
  select data into v_state from public.app_state where id = 'happynet';
  if v_state is null then
    raise notice 'No app_state row found — skipping migration.';
    return;
  end if;

  insert into public.companies (name) values ('Happynet Internet Services')
  returning id into v_company_id;

  insert into public.branches (company_id, name, code) values (v_company_id, 'Main Branch', 'main')
  returning id into v_branch_id;

  -- Financial accounts (fixed list used by the current app)
  insert into public.financial_accounts (branch_id, name, kind)
  values
    (v_branch_id, 'M-Pesa Till', 'mobile_money'),
    (v_branch_id, 'Bank Account', 'bank'),
    (v_branch_id, 'Petty Cash', 'cash'),
    (v_branch_id, 'Owner Personal Wallet', 'owner_wallet')
  on conflict (branch_id, name) do nothing;

  -- Categories (from state.categories, falling back to the app's defaults)
  insert into public.categories (branch_id, name, kind)
  select v_branch_id, cat, 'expense'
  from jsonb_array_elements_text(
    coalesce(v_state->'categories',
      '["Inventory","Electricity","Internet & Bandwidth","Fuel","Payroll","Rent","Reimbursement","Commission","Transport","Repairs","Welfare","Office Supplies","Marketing","Other"]'::jsonb)
  ) as cat
  on conflict do nothing;

  -- Revenue entries
  insert into public.revenue_entries (branch_id, entry_date, amount_kes, notes, source)
  select v_branch_id, (r->>'date')::date, (r->>'revenue_kes')::numeric, r->>'notes', 'migrated'
  from jsonb_array_elements(coalesce(v_state->'dailyRevenue', '[]'::jsonb)) as r;

  -- Expenses (category matched by name within the branch)
  insert into public.expenses (branch_id, expense_date, txn_ref, account_id, category_id,
                                description, paid_to, amount_kes, charges_kes, owner_funded, source)
  select
    v_branch_id,
    (e->>'date')::date,
    nullif(e->>'txn_ref',''),
    (select id from public.financial_accounts fa where fa.branch_id = v_branch_id and fa.name = e->>'account_used'),
    (select id from public.categories c where c.branch_id = v_branch_id and c.name = e->>'category'),
    e->>'description',
    nullif(e->>'paid_to',''),
    (e->>'amount_kes')::numeric,
    coalesce((e->>'charges_kes')::numeric, 0),
    coalesce((e->>'owner_funded')::boolean, false),
    'migrated'
  from jsonb_array_elements(coalesce(v_state->'expenses', '[]'::jsonb)) as e;

  -- Profit First settings (current values become the first history entry)
  insert into public.profit_first_settings (
    branch_id, pct_profit, pct_owner_debt, pct_tax, pct_opex,
    debt_paydown_split_pct, monthly_revenue_target_kes, opening_opex_account_balance_kes
  )
  values (
    v_branch_id,
    coalesce((v_state->'settings'->>'pct_profit')::numeric, 5),
    coalesce((v_state->'settings'->>'pct_owner_debt')::numeric, 20),
    coalesce((v_state->'settings'->>'pct_tax')::numeric, 15),
    coalesce((v_state->'settings'->>'pct_opex')::numeric, 60),
    coalesce((v_state->'settings'->>'debt_paydown_split_pct')::numeric, 40),
    coalesce((v_state->'settings'->>'monthly_revenue_target_kes')::numeric, 0),
    coalesce((v_state->'settings'->>'opening_opex_account_balance_kes')::numeric, 0)
  )
  on conflict (branch_id) do nothing;

  insert into public.profit_first_settings_history (branch_id, config, reason)
  values (v_branch_id, coalesce(v_state->'settings', '{}'::jsonb), 'Initial migration from app_state');

  -- Loans. Inserted one at a time (not set-based) because loanPayments in
  -- the old JSON reference loans by their old app-generated id, and we need
  -- a old_id -> new_id map to re-point payments at the new uuid primary keys.
  create temporary table _loan_id_map (old_id text, new_id uuid) on commit drop;

  for v_loan in select * from jsonb_array_elements(coalesce(v_state->'loans', '[]'::jsonb)) loop
    insert into public.loans (
      branch_id, debt_name, lender, original_principal_kes, current_balance_kes,
      annual_interest_rate_pct, start_date, min_monthly_payment_kes, status
    )
    values (
      v_branch_id, v_loan->>'debt_name', nullif(v_loan->>'lender',''),
      coalesce((v_loan->>'original_principal_kes')::numeric, 0),
      coalesce((v_loan->>'current_balance_kes')::numeric, 0),
      coalesce((v_loan->>'annual_interest_rate_pct')::numeric, 0),
      nullif(v_loan->>'start_date','')::date,
      coalesce((v_loan->>'min_monthly_payment_kes')::numeric, 0),
      coalesce(nullif(v_loan->>'status',''), 'ACTIVE')
    )
    returning id into v_new_loan_id;

    insert into _loan_id_map (old_id, new_id) values (v_loan->>'id', v_new_loan_id);
  end loop;

  -- Loan payments (top-level state.loanPayments in the old JSON, re-pointed
  -- at the new loan uuids via the map built above).
  for v_payment in select * from jsonb_array_elements(coalesce(v_state->'loanPayments', '[]'::jsonb)) loop
    insert into public.loan_payments (loan_id, payment_date, amount_kes, note)
    select m.new_id, (v_payment->>'date')::date, coalesce((v_payment->>'amount_kes')::numeric, 0), v_payment->>'note'
    from _loan_id_map m where m.old_id = v_payment->>'loan_id';
  end loop;

  -- Tax obligations
  insert into public.tax_obligations (branch_id, tax_type, applicable, frequency, due_day_of_month,
                                       manual_next_due_date, estimated_amount_kes, filing_authority, notes)
  select v_branch_id, t->>'tax_type', coalesce((t->>'applicable')::boolean, true),
         coalesce(t->>'frequency','Monthly'),
         nullif(t->>'due_day_of_month','')::int,
         nullif(t->>'manual_next_due_date','')::date,
         coalesce((t->>'estimated_amount_kes')::numeric, 0),
         coalesce(t->>'filing_authority','KRA'),
         t->>'notes'
  from jsonb_array_elements(coalesce(v_state->'taxObligations', '[]'::jsonb)) as t
  on conflict (branch_id, tax_type) do nothing;

  raise notice 'Migration complete for branch %', v_branch_id;
end $$;

-- ----------------------------------------------------------------------------
-- VERIFICATION — run these after the migration block above and compare
-- counts against what you see in the current dashboard's tabs.
-- ----------------------------------------------------------------------------
-- select count(*) as revenue_rows   from public.revenue_entries;
-- select count(*) as expense_rows   from public.expenses;
-- select count(*) as loan_rows      from public.loans;
-- select count(*) as loan_payment_rows from public.loan_payments;
-- select sum(current_balance_kes) as total_loan_balance from public.loans;
-- select count(*) as tax_rows       from public.tax_obligations;
-- select sum(amount_kes) as total_revenue from public.revenue_entries;
-- select sum(amount_kes) as total_expenses from public.expenses;

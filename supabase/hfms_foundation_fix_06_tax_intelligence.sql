-- ============================================================================
-- HFMS Foundation Fix, part 6 — Tax Intelligence (adopted from the uploaded
-- zip's phase21, with one real bug fixed)
-- ----------------------------------------------------------------------------
-- Run this AFTER hfms_foundation_fix_01/02.sql.
--
-- THE BUG FIXED: every RLS policy in the original file referenced a table
-- called "branch_members" — which does not exist anywhere in this project
-- (yours or the uploaded zip's other 23 phase files). Every "create
-- policy" statement referencing it would fail outright, aborting the
-- script. Replaced with this project's actual RBAC helpers
-- (has_branch_role / is_head_office), same pattern used everywhere else.
--
-- OTHERWISE ADOPTED AS-IS — this table design and the real KRA deadline
-- citations below (VAT, PAYE, Withholding Tax, Turnover Tax, Corporation
-- Tax, Installment Tax, with source URLs) are genuinely good and worth
-- keeping. Ties into tax_obligations and tax_payments, both of which
-- already exist in your live schema from Phase 1.
-- ============================================================================
-- Additive migration. Does not invent liabilities or tax rates.

create table if not exists public.tax_deadline_rules (
  id uuid primary key default gen_random_uuid(),
  tax_type text not null,
  jurisdiction text not null default 'Kenya',
  frequency text not null,
  due_rule text not null,
  filing_due_rule text,
  authority text not null default 'KRA',
  source_url text,
  source_note text,
  effective_from date,
  effective_to date,
  verified_at timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index if not exists uq_tax_deadline_rules_active
on public.tax_deadline_rules(tax_type, jurisdiction, frequency, due_rule)
where active = true;

create table if not exists public.tax_periods (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  tax_obligation_id uuid not null references public.tax_obligations(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  filing_due_date date,
  payment_due_date date,
  amount_due_kes numeric(14,2) not null default 0,
  amount_paid_kes numeric(14,2) not null default 0,
  filing_status text not null default 'not_due' check (filing_status in ('not_due','draft','ready','filed','amended','nil','not_applicable')),
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid','partially_paid','paid','overpaid','not_applicable')),
  filed_at timestamptz,
  filing_reference text,
  payment_reference text,
  notes text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(tax_obligation_id, period_start, period_end)
);

create table if not exists public.tax_evidence (
  id uuid primary key default gen_random_uuid(),
  tax_period_id uuid not null references public.tax_periods(id) on delete cascade,
  evidence_type text not null check (evidence_type in ('return_acknowledgement','payment_slip','payment_receipt','withholding_certificate','tcc','assessment','other')),
  reference text,
  storage_path text,
  notes text,
  uploaded_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.tax_compliance_events (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  tax_period_id uuid references public.tax_periods(id) on delete set null,
  event_type text not null,
  previous_value jsonb,
  new_value jsonb,
  reason text,
  actor_id uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists public.tax_profile (
  branch_id uuid primary key references public.branches(id) on delete cascade,
  taxpayer_name text,
  kra_pin text,
  accounting_year_end_month int not null default 12 check (accounting_year_end_month between 1 and 12),
  tcc_status text not null default 'unknown' check (tcc_status in ('unknown','valid','expiring','expired','not_available')),
  tcc_expiry_date date,
  last_tcc_check_date date,
  etims_compliant boolean,
  vat_registered boolean,
  tax_agent_name text,
  tax_agent_contact text,
  notes text,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

-- Seed only authoritative, rule-level deadlines. Rates and liabilities remain configurable.
insert into public.tax_deadline_rules (tax_type, frequency, due_rule, filing_due_rule, authority, source_url, source_note, verified_at)
select * from (values
 ('VAT','Monthly','20th day of following month','20th day of following month','KRA','https://www.kra.go.ke/individual/filing-paying/types-of-taxes/value-added-tax','KRA states VAT return and payment are due on or before the 20th day of the following month.',now()),
 ('PAYE','Monthly','9th day of following month','9th day of following month','KRA','https://www.kra.go.ke/individual/filing-paying/types-of-taxes/paye','KRA states PAYE filing and payment are due on or before the 9th day of the following month.',now()),
 ('Withholding Tax','Transaction','Within 5 working days after deduction','Within 5 working days after deduction','KRA','https://www.kra.go.ke/individual/filing-paying/types-of-taxes/individual-withholding-tax','KRA states withholding tax is remitted within five working days after deduction.',now()),
 ('Turnover Tax','Monthly','20th day of following month','20th day of following month','KRA','https://www.kra.go.ke/images/publications/English-Service-charter-April-2026.pdf','KRA 2025/26 service charter lists monthly filing/payment due on or before the 20th of the following month.',now()),
 ('Corporation Tax','Annual','Balance payment: 30th day of fourth month after accounting period; return: within six months','Within six months from accounting period end','KRA','https://www.kra.go.ke/images/publications/English-Service-charter-April-2026.pdf','KRA 2025/26 service charter deadline summary.',now()),
 ('Installment Tax','Quarterly','20th day of the fourth, sixth, ninth and twelfth month of financial year','Quarterly','KRA','https://www.kra.go.ke/images/publications/English-Service-charter-April-2026.pdf','KRA 2025/26 service charter deadline summary.',now())
) as v(tax_type,frequency,due_rule,filing_due_rule,authority,source_url,source_note,verified_at)
where not exists (
  select 1 from public.tax_deadline_rules r where r.tax_type=v.tax_type and r.frequency=v.frequency and r.due_rule=v.due_rule and r.active=true
);

create index if not exists idx_tax_periods_branch_dates on public.tax_periods(branch_id, period_end);
create index if not exists idx_tax_periods_due on public.tax_periods(payment_due_date, filing_due_date);
create index if not exists idx_tax_events_branch on public.tax_compliance_events(branch_id, created_at desc);

alter table public.tax_periods enable row level security;
alter table public.tax_evidence enable row level security;
alter table public.tax_compliance_events enable row level security;
alter table public.tax_profile enable row level security;
alter table public.tax_deadline_rules enable row level security;

-- Backend functions use explicit branch authorization (requireBranchAccess
-- in tax-intelligence.js); these policies protect direct client access too,
-- using this project's actual RBAC helpers.
drop policy if exists "tax periods read" on public.tax_periods;
create policy "tax periods read" on public.tax_periods for select to authenticated
using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]));
drop policy if exists "tax periods write" on public.tax_periods;
create policy "tax periods write" on public.tax_periods for all to authenticated
using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]))
with check (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]));

drop policy if exists "tax evidence read" on public.tax_evidence;
create policy "tax evidence read" on public.tax_evidence for select to authenticated
using (exists (select 1 from public.tax_periods p where p.id = tax_evidence.tax_period_id
  and (public.is_head_office() or public.has_branch_role(p.branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]))));
drop policy if exists "tax evidence write" on public.tax_evidence;
create policy "tax evidence write" on public.tax_evidence for all to authenticated
using (exists (select 1 from public.tax_periods p where p.id = tax_evidence.tax_period_id
  and (public.is_head_office() or public.has_branch_role(p.branch_id, array['branch_manager','accountant']::public.user_role[]))))
with check (exists (select 1 from public.tax_periods p where p.id = tax_evidence.tax_period_id
  and (public.is_head_office() or public.has_branch_role(p.branch_id, array['branch_manager','accountant']::public.user_role[]))));

drop policy if exists "tax profile read" on public.tax_profile;
create policy "tax profile read" on public.tax_profile for select to authenticated
using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]));
drop policy if exists "tax profile write" on public.tax_profile;
create policy "tax profile write" on public.tax_profile for all to authenticated
using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]))
with check (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]));

drop policy if exists "tax deadline rules read" on public.tax_deadline_rules;
create policy "tax deadline rules read" on public.tax_deadline_rules for select to authenticated using (true);

drop policy if exists "tax events read" on public.tax_compliance_events;
create policy "tax events read" on public.tax_compliance_events for select to authenticated
using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]));

comment on table public.tax_periods is 'Tax liabilities/filing periods. Amounts are entered or produced by controlled calculations; HFMS does not invent tax liabilities.';
comment on table public.tax_deadline_rules is 'Configurable tax deadline rules with authoritative source references. Verify before relying on legal deadlines.';

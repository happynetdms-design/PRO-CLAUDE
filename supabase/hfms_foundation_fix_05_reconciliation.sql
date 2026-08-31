-- ============================================================================
-- HFMS Foundation Fix, part 5 — Reconciliation (built clean, not adapted)
-- ----------------------------------------------------------------------------
-- Run this AFTER hfms_foundation_fix_01/02.sql.
--
-- WHY THIS IS BUILT FROM SCRATCH
-- The uploaded zip defines "cash_reconciliations" TWICE, identically named,
-- in both hfms_phase8_production_core.sql and hfms_phase10_enterprise.sql
-- — both `create table if not exists`, so whichever runs first silently
-- wins and the other definition is simply never applied, with no warning.
-- It also defines two different, disconnected matching tables against the
-- same parent (`reconciliation_matches` in phase10, `hfms_reconciliation_matches`
-- in phase14) — two matching systems for one reconciliation that are
-- guaranteed to disagree with each other over time. Neither is safe to
-- build on. This is a single, clean design instead.
--
-- WHAT THIS DOES
-- Lets someone import a bank/mobile-money statement (as parsed rows, not a
-- file — the app already has a working CSV/xlsx parser for Tende imports;
-- this reuses that pattern client-side rather than parsing files server-
-- side) and matches each line against your ledger (financial_transactions)
-- by amount, direction, and exact date. Exact matches are auto-matched
-- with high confidence. Everything else is left for a human to resolve —
-- this never guesses on your behalf, and it never writes to the ledger;
-- reconciliation only ever marks statement lines as matched or excluded,
-- consistent with the principle that reconciliation proves the ledger is
-- right, it doesn't change it.
-- ============================================================================

create table if not exists public.bank_statement_imports (
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid not null references public.branches(id) on delete cascade,
  account_id   uuid references public.financial_accounts(id),
  label        text not null,
  period_start date not null,
  period_end   date not null,
  status       text not null default 'in_progress' check (status in ('in_progress','submitted','approved')),
  imported_by  uuid references auth.users(id),
  imported_at  timestamptz not null default now(),
  approved_by  uuid references auth.users(id),
  approved_at  timestamptz
);

create table if not exists public.bank_statement_lines (
  id                     uuid primary key default gen_random_uuid(),
  import_id              uuid not null references public.bank_statement_imports(id) on delete cascade,
  line_date              date not null,
  description            text,
  amount_kes             numeric(14,2) not null check (amount_kes > 0),
  direction              text not null check (direction in ('inflow','outflow')),
  external_ref           text,
  match_status           text not null default 'unmatched' check (match_status in ('unmatched','matched','excluded')),
  matched_transaction_id uuid references public.financial_transactions(id),
  match_confidence       text check (match_confidence in ('exact','manual')),
  resolved_by            uuid references auth.users(id),
  resolved_at            timestamptz,
  resolution_note        text
);

create index if not exists idx_bsl_import on public.bank_statement_lines(import_id);
create index if not exists idx_bsl_status on public.bank_statement_lines(match_status);

alter table public.bank_statement_imports enable row level security;
alter table public.bank_statement_lines enable row level security;

drop policy if exists "bsi read" on public.bank_statement_imports;
create policy "bsi read" on public.bank_statement_imports for select to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]));
drop policy if exists "bsi write" on public.bank_statement_imports;
create policy "bsi write" on public.bank_statement_imports for all to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]))
  with check (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]));

drop policy if exists "bsl read" on public.bank_statement_lines;
create policy "bsl read" on public.bank_statement_lines for select to authenticated
  using (exists (select 1 from public.bank_statement_imports i where i.id = bank_statement_lines.import_id
    and (public.is_head_office() or public.has_branch_role(i.branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]))));
drop policy if exists "bsl write" on public.bank_statement_lines;
create policy "bsl write" on public.bank_statement_lines for all to authenticated
  using (exists (select 1 from public.bank_statement_imports i where i.id = bank_statement_lines.import_id
    and (public.is_head_office() or public.has_branch_role(i.branch_id, array['branch_manager','accountant']::public.user_role[]))))
  with check (exists (select 1 from public.bank_statement_imports i where i.id = bank_statement_lines.import_id
    and (public.is_head_office() or public.has_branch_role(i.branch_id, array['branch_manager','accountant']::public.user_role[]))));

-- ----------------------------------------------------------------------------
-- Auto-match: exact same date, same amount, same direction, on an
-- unmatched ledger transaction for the same branch, not already claimed
-- by another statement line. Deliberately conservative — anything else is
-- surfaced as a SUGGESTION (view below) for a human to confirm, never
-- auto-applied, because guessing wrong on reconciliation is worse than
-- leaving a line unmatched.
-- ----------------------------------------------------------------------------
create or replace function public.hfms_auto_match_statement(p_import_id uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  v_branch_id uuid;
  v_matched integer := 0;
  line record;
  ft_id uuid;
begin
  select branch_id into v_branch_id from public.bank_statement_imports where id = p_import_id;

  for line in
    select * from public.bank_statement_lines
    where import_id = p_import_id and match_status = 'unmatched'
  loop
    select ft.id into ft_id
    from public.financial_transactions ft
    where ft.branch_id = v_branch_id
      and ft.is_deleted = false
      and ft.transaction_date = line.line_date
      and ft.net_amount_kes = line.amount_kes
      and ft.direction = line.direction
      and not exists (
        select 1 from public.bank_statement_lines other
        where other.matched_transaction_id = ft.id and other.match_status = 'matched'
      )
    limit 1;

    if ft_id is not null then
      update public.bank_statement_lines
        set match_status = 'matched', matched_transaction_id = ft_id, match_confidence = 'exact'
        where id = line.id;
      v_matched := v_matched + 1;
    end if;
  end loop;

  return v_matched;
end;
$$;

-- Suggestions for anything still unmatched: same amount + direction, date
-- within 3 days either way. Shown to a human to confirm or reject.
create or replace view public.v_hfms_reconciliation_suggestions as
select
  bsl.id as statement_line_id, bsl.import_id, bsl.line_date, bsl.amount_kes, bsl.direction, bsl.description,
  ft.id as suggested_transaction_id, ft.transaction_date, ft.description as ledger_description,
  abs(bsl.line_date - ft.transaction_date) as days_apart
from public.bank_statement_lines bsl
join public.bank_statement_imports bsi on bsi.id = bsl.import_id
join public.financial_transactions ft
  on ft.branch_id = bsi.branch_id
  and ft.is_deleted = false
  and ft.net_amount_kes = bsl.amount_kes
  and ft.direction = bsl.direction
  and abs(bsl.line_date - ft.transaction_date) <= 3
where bsl.match_status = 'unmatched';

-- ----------------------------------------------------------------------------
-- VERIFICATION
-- ----------------------------------------------------------------------------
-- select match_status, count(*) from bank_statement_lines where import_id = '<id>' group by match_status;
-- select * from v_hfms_reconciliation_suggestions where import_id = '<id>';

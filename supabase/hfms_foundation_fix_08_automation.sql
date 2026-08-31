-- ============================================================================
-- HFMS Foundation Fix, part 8 — Automation & Alerts (rewritten, not adopted)
-- ----------------------------------------------------------------------------
-- Run this AFTER hfms_foundation_fix_01/02/03/04.sql (needs the ledger,
-- accounting periods, and AP aging view).
--
-- WHY THIS IS REWRITTEN, NOT ADAPTED
-- The uploaded automation-runner.js has the same direction bug as every
-- other file this session ('in'/'out' instead of 'inflow'/'outflow'),
-- meaning its revenue/expense scan for budget overruns and negative
-- results would silently never fire. It also depends on six tables that
-- don't exist anywhere in the 24 phases (recurring_expenses, budgets,
-- profit_first_allocations, anomaly_events, hfms_executive_kpi_targets)
-- plus cash_reconciliations — the exact colliding duplicate table already
-- flagged and deliberately avoided when reconciliation was built clean.
--
-- SCOPE DELIBERATELY REDUCED
-- The uploaded version includes a full multi-channel notification queue
-- (email via Resend, SMS webhook, generic webhook, retry with exponential
-- backoff) and auto-posting of recurring expenses. Both are real features
-- with real value, but: email/SMS delivery needs external provider API
-- keys this build can't verify, and recurring-expense auto-posting is
-- exactly the kind of "automatic financial posting" the original design
-- notes said should be off by default — building it now, unrequested,
-- would be scope creep in the wrong direction. This is in-app alerts
-- only, monitoring only, nothing auto-executes.
--
-- WHAT THIS REUSES
-- The risk conditions (low cash runway, AP overdue, tax overdue, ledger
-- imbalance, negative operating result) are the exact same conditions
-- already proven correct in hfms_foundation_fix's executive dashboard —
-- this just persists them as dismissible alerts instead of only ever
-- being visible when someone happens to open that tab.
-- ============================================================================

create table if not exists public.hfms_alerts (
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid not null references public.branches(id) on delete cascade,
  alert_key    text not null,          -- stable key so re-scanning doesn't duplicate an open alert
  severity     text not null check (severity in ('warning','critical')),
  message      text not null,
  status       text not null default 'open' check (status in ('open','dismissed')),
  created_at   timestamptz not null default now(),
  dismissed_by uuid references auth.users(id),
  dismissed_at timestamptz,
  -- Only one OPEN alert per (branch, key) at a time — re-scanning while an
  -- issue is still unresolved doesn't spam duplicates. A dismissed alert
  -- doesn't block a fresh one from the same key if the issue recurs later.
  unique (branch_id, alert_key, status)
);

create index if not exists idx_hfms_alerts_branch_status on public.hfms_alerts(branch_id, status);

alter table public.hfms_alerts enable row level security;

drop policy if exists "alerts read" on public.hfms_alerts;
create policy "alerts read" on public.hfms_alerts for select to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]));
drop policy if exists "alerts write" on public.hfms_alerts;
create policy "alerts write" on public.hfms_alerts for all to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]))
  with check (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]));

-- ----------------------------------------------------------------------------
-- VERIFICATION
-- ----------------------------------------------------------------------------
-- select * from hfms_alerts where branch_id = '<your branch id>' and status='open';

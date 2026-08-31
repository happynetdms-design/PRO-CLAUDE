-- ============================================================================
-- HFMS Foundation Fix, part 15 — management decision queue
-- ----------------------------------------------------------------------------
-- Run this AFTER hfms_foundation_fix_01/02.sql.
--
-- WHAT THIS ADDS
-- The Executive Dashboard already flags risks (low cash, overdue AP, a
-- ledger imbalance) — but a flag that disappears the moment its
-- underlying number improves isn't the same as a management decision with
-- an owner and a deadline. This is that: priority, owner, due date,
-- status — the fuller tracking the original brief asked for, distinct
-- from (and building on) the Executive Dashboard's risk flags.
-- ============================================================================

create table if not exists public.management_decisions (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references public.branches(id) on delete cascade,
  title         text not null,
  description   text,
  priority      text not null default 'medium' check (priority in ('low','medium','high','critical')),
  owner_name    text,
  due_date      date,
  status        text not null default 'open' check (status in ('open','in_progress','done','dismissed')),
  source        text not null default 'manual' check (source in ('manual','risk_flag')),
  created_by    uuid references auth.users(id),
  created_at    timestamptz not null default now(),
  resolved_by   uuid references auth.users(id),
  resolved_at   timestamptz
);

create index if not exists idx_management_decisions_branch_status on public.management_decisions(branch_id, status);

alter table public.management_decisions enable row level security;

drop policy if exists "decisions read" on public.management_decisions;
create policy "decisions read" on public.management_decisions for select to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]));
drop policy if exists "decisions write" on public.management_decisions;
create policy "decisions write" on public.management_decisions for all to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]))
  with check (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]));

-- ----------------------------------------------------------------------------
-- VERIFICATION
-- ----------------------------------------------------------------------------
-- select * from management_decisions where branch_id = '<your branch id>' and status in ('open','in_progress') order by priority, due_date;

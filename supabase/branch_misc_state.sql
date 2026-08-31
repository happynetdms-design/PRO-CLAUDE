-- ============================================================================
-- Run once in Supabase SQL Editor, after hfms_schema_v2.sql.
--
-- WHY THIS EXISTS: multi-branch support (Phase 3) added real branches, but
-- categories/monthlyArchive/closedMonths were left riding on the original
-- single-row app_state table (id always 'happynet') because they never got
-- normalized tables of their own. That table has no branch_id — so as soon
-- as a second branch existed, both branches would silently share the same
-- categories, archive, and closed-months list. This fixes that by giving
-- those three fields a proper per-branch home.
--
-- app_state itself is untouched — it keeps mirroring the full state on
-- every save exactly as before, as a whole-app rollback point.
-- ============================================================================

create table if not exists public.branch_misc_state (
  branch_id   uuid primary key references public.branches(id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,   -- { categories: [...], monthlyArchive: [...], closedMonths: [...] }
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users(id)
);

comment on table public.branch_misc_state is
  'Per-branch home for the fields that never got their own normalized table (categories, monthlyArchive, closedMonths). Superset app_state stays as the whole-app mirror.';

create or replace function public.touch_branch_misc_state()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(new.updated_by, auth.uid());
  return new;
end;
$$;

drop trigger if exists trg_touch_branch_misc_state on public.branch_misc_state;
create trigger trg_touch_branch_misc_state
  before insert or update on public.branch_misc_state
  for each row execute function public.touch_branch_misc_state();

alter table public.branch_misc_state enable row level security;

drop policy if exists "misc read" on public.branch_misc_state;
create policy "misc read" on public.branch_misc_state for select to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]));

drop policy if exists "misc write" on public.branch_misc_state;
create policy "misc write" on public.branch_misc_state for all to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]))
  with check (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]));

-- ----------------------------------------------------------------------------
-- One-time backfill: copy the current (pre-multi-branch) app_state.data's
-- categories/monthlyArchive/closedMonths into the first branch, so nothing
-- that was already there gets lost. Safe to re-run — ON CONFLICT DO NOTHING.
-- ----------------------------------------------------------------------------
do $$
declare
  v_state jsonb;
  v_branch_id uuid;
begin
  select data into v_state from public.app_state where id = 'happynet';
  select id into v_branch_id from public.branches where code = 'main';
  if v_state is not null and v_branch_id is not null then
    insert into public.branch_misc_state (branch_id, data)
    values (v_branch_id, jsonb_build_object(
      'categories', coalesce(v_state->'categories', '[]'::jsonb),
      'monthlyArchive', coalesce(v_state->'monthlyArchive', '[]'::jsonb),
      'closedMonths', coalesce(v_state->'closedMonths', '[]'::jsonb)
    ))
    on conflict (branch_id) do nothing;
  end if;
end $$;

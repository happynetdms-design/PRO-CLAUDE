-- ============================================================================
-- HAPPYNET PROFIT FIRST DASHBOARD — Supabase schema
-- ----------------------------------------------------------------------------
-- Run this once in Supabase → SQL Editor (or via `supabase db push`).
--
-- Design: Happynet is one company with one branch, so the whole dashboard
-- (daily revenue, expenses, loans, tax obligations, settings, archive) is
-- stored as a single JSON document in one row. This mirrors exactly what the
-- dashboard already keeps in memory, so the front end needs almost no
-- reshaping — it just reads/writes this one row on load/save.
--
-- Access control: there is no public sign-up. You create each staff member
-- as a Supabase Auth user yourself (Dashboard → Authentication → Users →
-- Add user, or the Admin API). The browser never talks to Supabase directly
-- — every read/write goes through Netlify Functions, which validate the
-- caller's session token and then use the service_role key (server-side
-- only) to read/write this table. Row Level Security below is kept as a
-- second line of defense in case the anon key is ever used directly.
-- ============================================================================

create extension if not exists pgcrypto;

create table if not exists public.app_state (
  id           text primary key,             -- always 'happynet' — one company, one branch
  data         jsonb not null default '{}'::jsonb,
  updated_at   timestamptz not null default now(),
  updated_by   uuid references auth.users(id)
);

comment on table public.app_state is
  'Single-row JSON store for the Happynet Profit First dashboard (revenue, expenses, loans, tax, settings, archive, categories).';

-- Keep updated_at fresh automatically. updated_by is normally set explicitly
-- by the Netlify Function (which already validated the user's token), since
-- writes go through the service_role key and auth.uid() is not available in
-- that context. If a row is ever written directly as an authenticated user
-- (bypassing the function), fall back to auth.uid().
create or replace function public.touch_app_state()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(new.updated_by, auth.uid());
  return new;
end;
$$;

drop trigger if exists trg_touch_app_state on public.app_state;
create trigger trg_touch_app_state
  before insert or update on public.app_state
  for each row execute function public.touch_app_state();

-- ----------------------------------------------------------------------------
-- Row Level Security
-- ----------------------------------------------------------------------------
alter table public.app_state enable row level security;

drop policy if exists "authenticated can read app_state" on public.app_state;
create policy "authenticated can read app_state"
  on public.app_state for select
  to authenticated
  using (true);

drop policy if exists "authenticated can insert app_state" on public.app_state;
create policy "authenticated can insert app_state"
  on public.app_state for insert
  to authenticated
  with check (true);

drop policy if exists "authenticated can update app_state" on public.app_state;
create policy "authenticated can update app_state"
  on public.app_state for update
  to authenticated
  using (true)
  with check (true);

-- No delete policy on purpose — nobody should be able to wipe the row from
-- the browser. Deletions, if ever needed, happen from the Supabase dashboard.

-- ----------------------------------------------------------------------------
-- Seed the single row so the very first load is an UPDATE, not a race to
-- INSERT between two staff members opening the dashboard at the same time.
-- The app also does this defensively on first load, but seeding here is
-- cheap insurance. Starts empty; the app's own default settings (the
-- Profit First 5/20/15/60 split, targets, opening balance) get written in
-- on first save from the browser.
-- ----------------------------------------------------------------------------
insert into public.app_state (id, data)
values ('happynet', '{}'::jsonb)
on conflict (id) do nothing;

-- ============================================================================
-- OPTIONAL: simple audit trail of every save, in case you ever want a
-- history of who changed what and when. Not required for the app to run —
-- skip this section if you don't want it. If you do want it, uncomment and
-- also add a matching insert in the app's queueSave() function.
-- ============================================================================
-- create table if not exists public.app_state_history (
--   id           bigint generated always as identity primary key,
--   data         jsonb not null,
--   saved_at     timestamptz not null default now(),
--   saved_by     uuid references auth.users(id)
-- );
-- alter table public.app_state_history enable row level security;
-- create policy "authenticated can read history" on public.app_state_history
--   for select to authenticated using (true);
-- create policy "authenticated can insert history" on public.app_state_history
--   for insert to authenticated with check (true);

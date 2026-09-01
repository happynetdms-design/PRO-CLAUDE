-- Happynet Supabase Auth repair
-- Run in the Supabase SQL Editor as the postgres/database owner role.
-- This script is intentionally scoped to the known bootstrap user.

create extension if not exists pgcrypto;

-- Remove common application-created auth triggers that can make GoTrue fail
-- while it queries auth.users. Built-in Supabase triggers are not matched.
do $$
declare
  trigger_row record;
  function_row record;
begin
  for trigger_row in
    select n.nspname as schema_name, c.relname as table_name, t.tgname as trigger_name
    from pg_trigger t
    join pg_class c on c.oid = t.tgrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'auth'
      and c.relname = 'users'
      and not t.tgisinternal
      and lower(t.tgname) ~ '(on_auth_user_created|handle_new_user|new_user)'
  loop
    execute format('drop trigger if exists %I on %I.%I cascade',
      trigger_row.trigger_name, trigger_row.schema_name, trigger_row.table_name);
  end loop;

  for function_row in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'auth')
      and lower(p.proname) in ('on_auth_user_created', 'handle_new_user')
  loop
    execute format('drop function if exists %s cascade', function_row.signature);
  end loop;
end $$;

-- Purge the known user. Foreign keys with on delete cascade remove stale
-- profile/access rows belonging to this identity.
delete from auth.users
where lower(email) = lower('admin@happy.com')
  or id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

do $$
declare
  target_user_id constant uuid := 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';
  target_branch_id uuid;
begin
  select id into target_branch_id
  from public.branches
  where coalesce(is_active, true)
  order by created_at nulls first, id
  limit 1;

  if target_branch_id is null then
    raise exception 'Auth repair stopped: no active row exists in public.branches.';
  end if;

  insert into auth.users (
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at
  ) values (
    target_user_id,
    'authenticated',
    'authenticated',
    'admin@happy.com',
    crypt('12345678', gen_salt('bf')),
    now(),
    now(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    '{"full_name":"Admin"}'::jsonb,
    now(),
    now()
  )
  on conflict (id) do update set
    aud = excluded.aud,
    role = excluded.role,
    email = excluded.email,
    encrypted_password = excluded.encrypted_password,
    email_confirmed_at = excluded.email_confirmed_at,
    confirmed_at = excluded.confirmed_at,
    raw_app_meta_data = excluded.raw_app_meta_data,
    raw_user_meta_data = excluded.raw_user_meta_data,
    updated_at = excluded.updated_at,
    deleted_at = null;

  insert into public.user_profiles (user_id, full_name)
  values (target_user_id, 'Admin')
  on conflict (user_id) do update set full_name = excluded.full_name;

  insert into public.user_branch_access (user_id, branch_id, role, granted_by)
  values (target_user_id, target_branch_id, 'owner'::public.user_role, null)
  on conflict (user_id, branch_id) do update set role = excluded.role;

  raise notice 'Repaired admin@happy.com and granted owner access to branch %', target_branch_id;
end $$;

-- These are object privileges, not an RLS bypass. The existing RLS policies
-- still control which rows an anonymous/authenticated JWT may use.
grant all privileges on table public.user_branch_access to anon, authenticated;
grant all privileges on table public.branches to anon, authenticated;

drop policy if exists "direct auth read own access" on public.user_branch_access;
create policy "direct auth read own access"
  on public.user_branch_access for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists "direct auth read active branches" on public.branches;
create policy "direct auth read active branches"
  on public.branches for select
  to authenticated
  using (is_active = true);

-- Diagnostic result: both checks should return one row.
select u.id, u.email, u.email_confirmed_at, uba.branch_id, uba.role
from auth.users u
left join public.user_branch_access uba on uba.user_id = u.id
where u.id = 'a1b2c3d4-e5f6-7890-abcd-ef1234567890';

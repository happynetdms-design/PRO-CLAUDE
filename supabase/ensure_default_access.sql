-- Happynet onboarding access automation
-- Run in Supabase SQL Editor as the database owner.
-- Assigns only viewer access; elevated roles remain an explicit admin action.

create or replace function public.ensure_default_branch_access()
returns table (branch_id uuid, role public.user_role, provisioned boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid := auth.uid();
  company_id uuid;
  default_branch_id uuid;
  existing_branch_id uuid;
  existing_role public.user_role;
begin
  if current_user_id is null then
    raise exception 'Authentication is required.' using errcode = '28000';
  end if;

  select uba.branch_id, uba.role
    into existing_branch_id, existing_role
  from public.user_branch_access uba
  where uba.user_id = current_user_id
  order by uba.granted_at, uba.branch_id
  limit 1;

  if existing_branch_id is not null then
    return query select existing_branch_id, existing_role, false;
    return;
  end if;

  select id into company_id
  from public.companies
  order by created_at asc, id asc
  limit 1;

  if company_id is null then
    insert into public.companies (name)
    values ('Happynet Internet Services')
    returning id into company_id;
  end if;

  select b.id into default_branch_id
  from public.branches b
  where b.company_id = company_id
    and b.code = 'main'
  order by b.created_at asc, b.id asc
  limit 1;

  if default_branch_id is null then
    insert into public.branches (company_id, name, code, is_active)
    values (company_id, 'Main Branch', 'main', true)
    on conflict (company_id, code) do nothing
    returning id into default_branch_id;
  end if;

  if default_branch_id is null then
    select b.id into default_branch_id
    from public.branches b
    where b.company_id = company_id
      and b.code = 'main'
      and coalesce(b.is_active, true)
    order by b.created_at asc, b.id asc
    limit 1;
  end if;

  if default_branch_id is null then
    select b.id into default_branch_id
    from public.branches b
    where coalesce(b.is_active, true)
    order by b.created_at asc, b.id asc
    limit 1;
  end if;

  if default_branch_id is null then
    raise exception 'No active branch is configured yet.' using errcode = 'P0002';
  end if;

  insert into public.user_branch_access (user_id, branch_id, role, granted_by)
  values (current_user_id, default_branch_id, 'viewer'::public.user_role, null)
  on conflict (user_id, branch_id) do nothing;

  return query
    select uba.branch_id, uba.role, true
    from public.user_branch_access uba
    where uba.user_id = current_user_id
      and uba.branch_id = default_branch_id
    limit 1;
end;
$$;

revoke all on function public.ensure_default_branch_access() from public, anon;
grant execute on function public.ensure_default_branch_access() to authenticated;

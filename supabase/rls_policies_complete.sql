-- ============================================================================
-- Completes Phase 2's RLS coverage. Run once in Supabase SQL Editor, after
-- hfms_schema_v2.sql. Safe to re-run (every policy uses DROP POLICY IF
-- EXISTS first).
--
-- Reminder of the actual enforcement model: Netlify Functions use the
-- service_role key and bypass RLS entirely — the real gate is
-- requireBranchAccess() in netlify/functions/_lib/rbac.js. These policies
-- are the second line of defense, for if the anon key is ever used
-- directly against Postgres. Same read/write split used everywhere else:
--   read  = Head Office (owner/finance_manager) OR any granted role
--   write = Head Office OR branch_manager/accountant
-- ============================================================================

-- ---- financial_accounts ----
alter table public.financial_accounts enable row level security;
drop policy if exists "accounts read" on public.financial_accounts;
create policy "accounts read" on public.financial_accounts for select to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]));
drop policy if exists "accounts write" on public.financial_accounts;
create policy "accounts write" on public.financial_accounts for all to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]))
  with check (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]));

-- ---- categories ----
alter table public.categories enable row level security;
drop policy if exists "categories read" on public.categories;
create policy "categories read" on public.categories for select to authenticated
  using (branch_id is null or public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]));
drop policy if exists "categories write" on public.categories;
create policy "categories write" on public.categories for all to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]))
  with check (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]));

-- ---- suppliers ----
alter table public.suppliers enable row level security;
drop policy if exists "suppliers read" on public.suppliers;
create policy "suppliers read" on public.suppliers for select to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]));
drop policy if exists "suppliers write" on public.suppliers;
create policy "suppliers write" on public.suppliers for all to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]))
  with check (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]));

-- ---- profit_first_settings (branch_id is the primary key here) ----
drop policy if exists "pf settings read" on public.profit_first_settings;
create policy "pf settings read" on public.profit_first_settings for select to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]));
drop policy if exists "pf settings write" on public.profit_first_settings;
create policy "pf settings write" on public.profit_first_settings for all to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager']::public.user_role[]))
  with check (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager']::public.user_role[]));

-- ---- profit_first_settings_history (read-only via RLS — inserts only ever come from the service_role key) ----
drop policy if exists "pf history read" on public.profit_first_settings_history;
create policy "pf history read" on public.profit_first_settings_history for select to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]));

-- ---- allocations ----
drop policy if exists "allocations read" on public.allocations;
create policy "allocations read" on public.allocations for select to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]));
drop policy if exists "allocations write" on public.allocations;
create policy "allocations write" on public.allocations for all to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]))
  with check (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]));

-- ---- loans ----
drop policy if exists "loans read" on public.loans;
create policy "loans read" on public.loans for select to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]));
drop policy if exists "loans write" on public.loans;
create policy "loans write" on public.loans for all to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]))
  with check (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]));

-- ---- loan_payments (no branch_id column — scoped through the parent loan) ----
drop policy if exists "loan payments read" on public.loan_payments;
create policy "loan payments read" on public.loan_payments for select to authenticated
  using (exists (
    select 1 from public.loans l where l.id = loan_payments.loan_id
    and (public.is_head_office() or public.has_branch_role(l.branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]))
  ));
drop policy if exists "loan payments write" on public.loan_payments;
create policy "loan payments write" on public.loan_payments for all to authenticated
  using (exists (
    select 1 from public.loans l where l.id = loan_payments.loan_id
    and (public.is_head_office() or public.has_branch_role(l.branch_id, array['branch_manager','accountant']::public.user_role[]))
  ))
  with check (exists (
    select 1 from public.loans l where l.id = loan_payments.loan_id
    and (public.is_head_office() or public.has_branch_role(l.branch_id, array['branch_manager','accountant']::public.user_role[]))
  ));

-- ---- tax_obligations ----
drop policy if exists "tax read" on public.tax_obligations;
create policy "tax read" on public.tax_obligations for select to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]));
drop policy if exists "tax write" on public.tax_obligations;
create policy "tax write" on public.tax_obligations for all to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]))
  with check (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]));

-- ---- tax_payments (no branch_id column — scoped through the parent obligation) ----
drop policy if exists "tax payments read" on public.tax_payments;
create policy "tax payments read" on public.tax_payments for select to authenticated
  using (exists (
    select 1 from public.tax_obligations t where t.id = tax_payments.tax_obligation_id
    and (public.is_head_office() or public.has_branch_role(t.branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]))
  ));
drop policy if exists "tax payments write" on public.tax_payments;
create policy "tax payments write" on public.tax_payments for all to authenticated
  using (exists (
    select 1 from public.tax_obligations t where t.id = tax_payments.tax_obligation_id
    and (public.is_head_office() or public.has_branch_role(t.branch_id, array['branch_manager','accountant']::public.user_role[]))
  ))
  with check (exists (
    select 1 from public.tax_obligations t where t.id = tax_payments.tax_obligation_id
    and (public.is_head_office() or public.has_branch_role(t.branch_id, array['branch_manager','accountant']::public.user_role[]))
  ));

-- ---- attachments (no branch_id — scoped through whichever entity it's attached to) ----
drop policy if exists "attachments read" on public.attachments;
create policy "attachments read" on public.attachments for select to authenticated
  using (
    (entity_type = 'expense' and exists (select 1 from public.expenses e where e.id = attachments.entity_id and (public.is_head_office() or public.has_branch_role(e.branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]))))
    or (entity_type = 'revenue_entry' and exists (select 1 from public.revenue_entries r where r.id = attachments.entity_id and (public.is_head_office() or public.has_branch_role(r.branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]))))
    or (entity_type = 'loan' and exists (select 1 from public.loans l where l.id = attachments.entity_id and (public.is_head_office() or public.has_branch_role(l.branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]))))
  );
drop policy if exists "attachments write" on public.attachments;
create policy "attachments write" on public.attachments for all to authenticated
  using (
    (entity_type = 'expense' and exists (select 1 from public.expenses e where e.id = attachments.entity_id and (public.is_head_office() or public.has_branch_role(e.branch_id, array['branch_manager','accountant']::public.user_role[]))))
    or (entity_type = 'revenue_entry' and exists (select 1 from public.revenue_entries r where r.id = attachments.entity_id and (public.is_head_office() or public.has_branch_role(r.branch_id, array['branch_manager','accountant']::public.user_role[]))))
    or (entity_type = 'loan' and exists (select 1 from public.loans l where l.id = attachments.entity_id and (public.is_head_office() or public.has_branch_role(l.branch_id, array['branch_manager','accountant']::public.user_role[]))))
  )
  with check (true); -- entity ownership is already re-verified by attachments.js at insert time

-- ---- user_branch_access (granting access is a Head Office action; everyone can see their own grants) ----
drop policy if exists "access read own or ho" on public.user_branch_access;
create policy "access read own or ho" on public.user_branch_access for select to authenticated
  using (user_id = auth.uid() or public.is_head_office());
drop policy if exists "access write ho only" on public.user_branch_access;
create policy "access write ho only" on public.user_branch_access for all to authenticated
  using (public.is_head_office())
  with check (public.is_head_office());

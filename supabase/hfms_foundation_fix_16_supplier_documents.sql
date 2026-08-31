-- ============================================================================
-- HFMS Foundation Fix, part 16 — supplier documents (contracts, KRA
-- certificates, agreements)
-- ----------------------------------------------------------------------------
-- Run this AFTER hfms_foundation_fix_04_accounts_payable.sql and
-- storage_setup.sql (reuses the 'receipts' Storage bucket from Phase 4 —
-- no new bucket needed, same pattern as document_intelligence_queue).
--
-- Supplier records already have name/contact/KRA PIN. What was still
-- missing: nowhere to attach a contract, a KRA compliance certificate, a
-- signed agreement — anything beyond the bill/payment history already
-- visible in v_hfms_supplier_statement. This adds that, plain and simple.
-- ============================================================================

create table if not exists public.supplier_documents (
  id           uuid primary key default gen_random_uuid(),
  supplier_id  uuid not null references public.suppliers(id) on delete cascade,
  label        text not null,
  storage_path text not null,
  uploaded_by  uuid references auth.users(id),
  uploaded_at  timestamptz not null default now()
);

create index if not exists idx_supplier_documents_supplier on public.supplier_documents(supplier_id);

alter table public.supplier_documents enable row level security;

drop policy if exists "supplier documents read" on public.supplier_documents;
create policy "supplier documents read" on public.supplier_documents for select to authenticated
  using (exists (select 1 from public.suppliers s where s.id = supplier_documents.supplier_id
    and (public.is_head_office() or public.has_branch_role(s.branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]))));
drop policy if exists "supplier documents write" on public.supplier_documents;
create policy "supplier documents write" on public.supplier_documents for all to authenticated
  using (exists (select 1 from public.suppliers s where s.id = supplier_documents.supplier_id
    and (public.is_head_office() or public.has_branch_role(s.branch_id, array['branch_manager','accountant']::public.user_role[]))))
  with check (exists (select 1 from public.suppliers s where s.id = supplier_documents.supplier_id
    and (public.is_head_office() or public.has_branch_role(s.branch_id, array['branch_manager','accountant']::public.user_role[]))));

-- ----------------------------------------------------------------------------
-- VERIFICATION
-- ----------------------------------------------------------------------------
-- select * from supplier_documents where supplier_id = '<a supplier id>';

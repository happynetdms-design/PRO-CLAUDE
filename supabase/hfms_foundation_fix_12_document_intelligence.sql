-- ============================================================================
-- HFMS Foundation Fix, part 12 — document intelligence (receipt/invoice
-- extraction), built fresh — the uploaded zip only had the table schema,
-- no actual extraction function anywhere in any of the 24 phases
-- ----------------------------------------------------------------------------
-- Run this AFTER hfms_foundation_fix_01/02.sql and storage_setup.sql (the
-- receipts Storage bucket from Phase 4 already exists — this reuses it
-- rather than creating a second one).
--
-- WHAT THIS DOES
-- Lets someone upload a photo of a receipt or invoice; the server sends
-- it to Claude's vision API (same ANTHROPIC_API_KEY already configured
-- for the AI Assistant — no new external service needed) and asks for
-- structured fields back: vendor, date, amount, a suggested category.
-- That extraction is held for review — it never auto-creates an expense
-- or a bill. A human looks at the extracted fields, corrects anything
-- wrong, and uses them to fill in the real expense/bill form themselves.
-- Same "AI never executes" principle as the rest of this build.
-- ============================================================================

create table if not exists public.document_intelligence_queue (
  id             uuid primary key default gen_random_uuid(),
  branch_id      uuid not null references public.branches(id) on delete cascade,
  uploaded_by    uuid references auth.users(id),
  document_type  text not null default 'receipt' check (document_type in ('receipt','invoice','other')),
  storage_path   text not null,
  extracted_data jsonb,
  confidence     text check (confidence in ('high','medium','low','failed')),
  status         text not null default 'review' check (status in ('review','used','rejected')),
  created_at     timestamptz not null default now(),
  resolved_by    uuid references auth.users(id),
  resolved_at    timestamptz
);

create index if not exists idx_doc_intel_branch_status on public.document_intelligence_queue(branch_id, status);

alter table public.document_intelligence_queue enable row level security;

drop policy if exists "doc intel read" on public.document_intelligence_queue;
create policy "doc intel read" on public.document_intelligence_queue for select to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]));
drop policy if exists "doc intel write" on public.document_intelligence_queue;
create policy "doc intel write" on public.document_intelligence_queue for all to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]))
  with check (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]));

-- ----------------------------------------------------------------------------
-- VERIFICATION
-- ----------------------------------------------------------------------------
-- select * from document_intelligence_queue where branch_id = '<your branch id>' order by created_at desc;

-- ============================================================================
-- Run once in Supabase SQL Editor, after hfms_schema_v2.sql.
-- Creates the private Storage bucket the new /api/attachments endpoint uses
-- for receipt/invoice uploads.
-- ============================================================================

insert into storage.buckets (id, name, public)
values ('receipts', 'receipts', false)
on conflict (id) do nothing;

-- Netlify Functions use the service_role key, which bypasses Storage RLS
-- entirely — same as every other table in this project. These policies are
-- defense-in-depth only, in case the anon key is ever used directly against
-- Storage. All real access control (which branch, which role) happens in
-- netlify/functions/attachments.js.
drop policy if exists "authenticated can read receipts" on storage.objects;
create policy "authenticated can read receipts" on storage.objects
  for select to authenticated using (bucket_id = 'receipts');

drop policy if exists "authenticated can upload receipts" on storage.objects;
create policy "authenticated can upload receipts" on storage.objects
  for insert to authenticated with check (bucket_id = 'receipts');

drop policy if exists "authenticated can delete receipts" on storage.objects;
create policy "authenticated can delete receipts" on storage.objects
  for delete to authenticated using (bucket_id = 'receipts');

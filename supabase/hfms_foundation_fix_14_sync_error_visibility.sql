-- ============================================================================
-- HFMS Foundation Fix, part 14 — making silent ledger sync failures visible
-- ----------------------------------------------------------------------------
-- Run this AFTER hfms_foundation_fix_01_ledger_sync.sql.
--
-- THE GAP THIS CLOSES
-- hfms_sync_errors was deliberately fail-silent by design — a bug in the
-- ledger sync should never be able to block an ordinary revenue or
-- expense entry from saving (see hfms_foundation_fix_01's own comments).
-- That was the right call. But "silent" has meant genuinely invisible
-- since the day it was built: no RLS, no UI, nothing surfacing it except
-- someone manually querying the table in the Supabase dashboard. A sync
-- failure could sit there indefinitely with the ledger quietly drifting
-- from the source tables and nobody would know.
--
-- This adds RLS (Head Office visibility, matching the audit log) and
-- pairs with a new dashboard.js endpoint + a status indicator wired into
-- the app shell — not buried in a tab nobody opens, but visible from
-- wherever someone already is.
-- ============================================================================

alter table public.hfms_sync_errors enable row level security;

drop policy if exists "sync errors read" on public.hfms_sync_errors;
create policy "sync errors read" on public.hfms_sync_errors for select to authenticated
  using (public.is_head_office());
-- No write policy — only the sync trigger functions (running as
-- security definer, which bypasses RLS) ever insert here. Nobody should
-- be able to insert or edit these directly, including Head Office.

-- ----------------------------------------------------------------------------
-- VERIFICATION
-- ----------------------------------------------------------------------------
-- select * from hfms_sync_errors order by occurred_at desc limit 20;

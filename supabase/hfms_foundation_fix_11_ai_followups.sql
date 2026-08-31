-- ============================================================================
-- HFMS Foundation Fix, part 11 — AI follow-up tracking (the safe version of
-- an "action-proposal workflow")
-- ----------------------------------------------------------------------------
-- Run this AFTER hfms_foundation_fix_07_ai_conversations.sql.
--
-- WHY THIS IS NOT WHAT THE UPLOADED ZIP CALLED "AI ACTION REQUESTS"
-- The uploaded zip's design has the AI emit structured action proposals
-- (action_type, target_id) that a human then approves and something
-- executes. That requires the model to reliably output exact record IDs
-- and action types in a parseable format from free-text conversation —
-- fragile in exactly the way this whole build has been catching:
-- something that looks like a real workflow but breaks the first time the
-- model phrases an answer slightly differently, or references the wrong
-- record.
--
-- This is deliberately simpler and safer: when the assistant makes a
-- recommendation worth acting on, a HUMAN (not the AI, not any parsing of
-- the AI's text) clicks "Track this" on that message. It becomes a
-- plain follow-up item — reviewed, dismissed, or marked done by a person.
-- The AI never proposes a structured action, never references a specific
-- record it might get wrong, and never gets anywhere near executing
-- anything. The follow-up just links back to the conversation for
-- context.
-- ============================================================================

create table if not exists public.ai_follow_ups (
  id              uuid primary key default gen_random_uuid(),
  branch_id       uuid not null references public.branches(id) on delete cascade,
  message_id      uuid references public.ai_messages(id) on delete set null,
  description     text not null,        -- the assistant's message text, or a human-edited summary of it
  status          text not null default 'open' check (status in ('open','done','dismissed')),
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  resolved_by     uuid references auth.users(id),
  resolved_at     timestamptz
);

create index if not exists idx_ai_follow_ups_branch_status on public.ai_follow_ups(branch_id, status);

alter table public.ai_follow_ups enable row level security;

drop policy if exists "ai follow ups read" on public.ai_follow_ups;
create policy "ai follow ups read" on public.ai_follow_ups for select to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant','auditor','viewer']::public.user_role[]));
drop policy if exists "ai follow ups write" on public.ai_follow_ups;
create policy "ai follow ups write" on public.ai_follow_ups for all to authenticated
  using (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]))
  with check (public.is_head_office() or public.has_branch_role(branch_id, array['branch_manager','accountant']::public.user_role[]));

-- ----------------------------------------------------------------------------
-- VERIFICATION
-- ----------------------------------------------------------------------------
-- select * from ai_follow_ups where branch_id = '<your branch id>' and status='open';

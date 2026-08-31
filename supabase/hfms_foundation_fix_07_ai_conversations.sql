-- ============================================================================
-- HFMS Foundation Fix, part 7 — persistent AI conversation history
-- ----------------------------------------------------------------------------
-- Run this AFTER hfms_foundation_fix_01/02.sql.
--
-- ADOPTED FROM the uploaded zip's phase15, with real fixes:
--  - Added proper foreign keys (branch_id -> branches(id), user_id ->
--    auth.users(id)) — the original left these as plain uuid with no
--    referential integrity at all.
--  - Added RLS policies using this project's actual RBAC helpers — the
--    original had NO RLS policies on these tables whatsoever (not even
--    the wrong ones; just none). Netlify Functions still do their own
--    branch authorization regardless (same as everywhere else), but this
--    closes the gap for direct client access.
--
-- NOT adopted: ai_action_requests / financial_recommendations / a
-- proposed-action execution workflow. That's a real feature (AI proposes
-- a change, a human approves, something executes it) and deserves to be
-- built deliberately if it's ever wanted — not bolted on as a side effect
-- of upgrading the assistant's data grounding. The AI stays strictly
-- read-only/advisory, consistent with how it already worked.
-- ============================================================================

create table if not exists public.ai_conversations (
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references public.branches(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text,
  status     text not null default 'active' check (status in ('active','archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.ai_conversations(id) on delete cascade,
  role            text not null check (role in ('user','assistant')),
  content         text not null,
  classification  text check (classification in ('FACT','CALCULATION','FORECAST','RECOMMENDATION','RISK')),
  citations       jsonb not null default '[]'::jsonb,
  created_at      timestamptz not null default now()
);

create index if not exists idx_ai_conversations_branch on public.ai_conversations(branch_id, updated_at desc);
create index if not exists idx_ai_messages_conversation on public.ai_messages(conversation_id, created_at);

alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;

-- A conversation belongs to the person who started it (not shared across
-- the whole branch) — Head Office can see everything, same pattern as
-- the audit log.
drop policy if exists "ai conversations read" on public.ai_conversations;
create policy "ai conversations read" on public.ai_conversations for select to authenticated
  using (user_id = auth.uid() or public.is_head_office());
drop policy if exists "ai conversations write" on public.ai_conversations;
create policy "ai conversations write" on public.ai_conversations for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "ai messages read" on public.ai_messages;
create policy "ai messages read" on public.ai_messages for select to authenticated
  using (exists (select 1 from public.ai_conversations c where c.id = ai_messages.conversation_id
    and (c.user_id = auth.uid() or public.is_head_office())));
drop policy if exists "ai messages write" on public.ai_messages;
create policy "ai messages write" on public.ai_messages for all to authenticated
  using (exists (select 1 from public.ai_conversations c where c.id = ai_messages.conversation_id and c.user_id = auth.uid()))
  with check (exists (select 1 from public.ai_conversations c where c.id = ai_messages.conversation_id and c.user_id = auth.uid()));

-- ----------------------------------------------------------------------------
-- VERIFICATION
-- ----------------------------------------------------------------------------
-- select * from ai_conversations where branch_id = '<your branch id>';

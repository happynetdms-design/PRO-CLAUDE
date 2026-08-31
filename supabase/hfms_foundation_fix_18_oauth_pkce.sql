-- ============================================================================
-- HFMS Foundation Fix, part 18 — server-side PKCE state for Google sign-in
-- ----------------------------------------------------------------------------
-- Run this AFTER hfms_schema_v2.sql.
--
-- WHY THIS EXISTS
-- Google's OAuth flow uses PKCE: a code_verifier generated when the flow
-- STARTS has to be presented again when it's exchanged for a session at
-- the END. Normally a browser-based Supabase client stores that verifier
-- in localStorage between those two steps. This app deliberately never
-- puts a Supabase key in the browser, so both steps run as separate,
-- stateless Netlify Functions instead — with no shared memory between
-- them. This table is the bridge: the verifier is stashed here, keyed by
-- a random `state` value that Google/Supabase echoes back on the
-- callback, so the callback function can look it up.
-- Entries are short-lived (an OAuth flow completes in seconds, not
-- hours) and single-use — deleted the moment they're consumed, and any
-- left over from an abandoned flow are harmless, unguessable, single-use
-- values, but still cleaned up periodically since nothing else does.
-- ============================================================================

create table if not exists public.oauth_pkce_state (
  state         text primary key,
  code_verifier text not null,
  created_at    timestamptz not null default now()
);

alter table public.oauth_pkce_state enable row level security;
-- No policies at all — this table is only ever touched by the admin
-- (service_role) client from within the OAuth Netlify Functions, never
-- queried directly by an authenticated user.

-- ----------------------------------------------------------------------------
-- VERIFICATION
-- ----------------------------------------------------------------------------
-- select count(*) from oauth_pkce_state; -- should stay near zero in steady state
-- delete from oauth_pkce_state where created_at < now() - interval '10 minutes'; -- manual cleanup if ever needed

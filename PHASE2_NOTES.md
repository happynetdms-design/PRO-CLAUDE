# Phase 2 — API layer + RBAC (added on top of the existing app)

## What changed
Nothing about the currently-deployed app was touched: `index.html`, `login.js`,
`logout.js`, `refresh.js`, and `state.js` are byte-for-byte what you already
had. The dashboard keeps working against `app_state` exactly as before.

Added alongside it:
- `netlify/functions/_lib/rbac.js` — the access-control engine every new
  endpoint below calls before touching data.
- `netlify/functions/me.js` — call this right after login to learn who the
  user is and which branches/roles they hold.
- `netlify/functions/branches.js` — list branches the caller can see.
- `netlify/functions/revenue.js`, `expenses.js`, `loans.js`,
  `loan-payments.js`, `tax.js`, `tax-payments.js`, `settings.js`,
  `allocations.js`, `audit.js` — REST-style CRUD against the Phase 1 schema
  (`supabase/hfms_schema_v2.sql`), each one scoped to whatever branch the
  request specifies and the caller is actually allowed to touch.

All of these read `branch_id` from the query string on GET requests and from
the JSON body on POST/PATCH/DELETE. None of them are wired into the UI yet —
that's Phase 3.

## One-time setup before any of this is usable
1. Run `supabase/hfms_schema_v2.sql` in the Supabase SQL editor if you
   haven't already (it's safe to re-run; see comments at the top of that
   file).
2. For every staff member, add a row so they can actually see a branch:

   ```sql
   insert into public.user_branch_access (user_id, branch_id, role)
   values (
     '<their auth.users id>',
     (select id from public.branches where code = 'main'),
     'accountant'   -- or owner / finance_manager / branch_manager / auditor / viewer
   );
   ```

   Without a row here (or a `owner`/`finance_manager` grant on *any* branch,
   which counts as Head Office and sees everything), every new endpoint
   returns 403.

## Why enforcement lives in the function code, not just Postgres
These functions use the `service_role` key, same as `state.js` always has —
that bypasses Row Level Security entirely. The RLS policies in the schema
are a real second line of defense, but the actual gate is
`requireBranchAccess()` in `_lib/rbac.js`. Any new endpoint that skips
calling it has no access control, full stop.

## What's still pending (Phase 3+)
- The frontend still calls `/api/state`. Rewiring `index.html` to call these
  new per-resource endpoints — and building the branch switcher, role-aware
  UI, and login flow calling `/api/me` — is Phase 3.
- CSV/Tende bulk-import parsing (turning an uploaded file into the
  `entries[]` array `expenses.js` already accepts) isn't built yet.
- Receipt/invoice upload (the `attachments` table exists; no Storage bucket
  or upload endpoint yet).
- PDF/Excel report generation and the AI assistant are Phases 5–6.

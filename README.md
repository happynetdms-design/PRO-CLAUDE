# Happynet Finance Management System (HFMS)

A full financial operating system for Happynet Internet Services LLP, built
on the Profit First allocation model (Profit 5% / Owner Pay & Debt 20% /
Tax Reserve 15% / Operating Expenses 60%) — verified against the business's
actual live spreadsheet and real Tende/M-Pesa exports throughout development,
not just designed against a spec.

**This README reflects the system as it actually stands.** Earlier docs in
this folder (`PHASE2_NOTES.md`, `PHASE3_NOTES.md`, `UPLOADED_MERGE_ANALYSIS.md`)
are historical working notes from early in the build and are kept for
reference, but this file is the current, authoritative picture.

## Architecture

Single-file frontend (`index.html`) on Netlify, all auth and data access
routed through Netlify Functions, storage and auth on Supabase. **The
browser never talks to Supabase directly and never holds a Supabase key** —
every request goes `browser → Netlify Function → Supabase`. The one
deliberate, carefully-built exception is Google sign-in, which still never
exposes a key to the browser — see `netlify/functions/google-oauth-start.js`'s
comments for exactly how.

```
happynet-finance/
├── index.html                    The whole app — every tab, every view
├── netlify.toml                  Build, functions, /api/* routing, security headers
├── package.json                  Dependency for the functions (@supabase/supabase-js)
├── favicon.svg
├── netlify/functions/            40 functions — one file per API concern
│   └── _lib/
│       ├── supabase.js            anonClient() / adminClient() / requireUser()
│       └── rbac.js                requireBranchAccess() — every function's permission check
├── supabase/                     23 SQL files — see Deployment Order below
└── scripts/                      21 verification scripts (node scripts/verify_*.js)
```

## Deployment order

Run these in Supabase → SQL Editor, in exactly this order. Each file's own
header comment states its real dependencies; this list matches those.

1. `hfms_schema_v2.sql` — companies, branches, users, revenue/expenses/loans, RBAC roles
2. `storage_setup.sql` — the `receipts` bucket (used by document intelligence and supplier documents)
3. `rls_policies_complete.sql` — row-level security for the base schema
4. `branch_misc_state.sql` — per-branch misc state (Profit First settings history, etc.)
5. `hfms_foundation_fix_00_ledger_core.sql` — **chart of accounts, journal entries/lines, accounting periods, the trial balance view.** Referenced constantly by everything below; run this before fix_02 or later steps will fail outright.
6. `hfms_foundation_fix_01_ledger_sync.sql` through `_18_oauth_pkce.sql`, **in numeric order** — each is self-contained with its own "why" and its own verification queries in a trailing comment block.
7. Per branch, once: `select public.hfms_seed_chart_of_accounts('<branch id>');` then `select public.hfms_post_all_unposted_transactions();`
8. Confirm: `select sum(total_debit_kes) - sum(total_credit_kes) from v_hfms_trial_balance;` — must equal `0`.

`schema.sql` (a single legacy `app_state` table) is kept only for
backward compatibility with `state.js`, an early-build endpoint some
tooling may still reference — it is not part of the current data model.

## Environment variables (Netlify site settings)

- `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
- `ANTHROPIC_API_KEY` — powers the AI Assistant, document intelligence (receipt/invoice/statement extraction), and the dashboard narrative
- Google sign-in additionally requires the Google provider configured under Supabase → Authentication → Providers, with `https://<your-site>/api/google-oauth-callback` added as an authorized redirect URL (see that function's header comment)

## What's built

**Core financial engine:** the original revenue/expense/Profit First log, plus
a real double-entry ledger (chart of accounts, journal posting, trial
balance), Accounts Payable (bills → approval → payment, dual-path loan
reimbursement reconciliation), tax intelligence with KRA deadline tracking,
bank/mobile-money reconciliation (manual paste or photo/PDF extraction),
accounting period close with a real pre-close checklist, quarterly/annual/
consolidated multi-branch statements, and a management decision queue.

**Data entry:** the Tende raw CSV and Organization Utility statement import
directly — no manual pre-processing — with internal wallet transfers
correctly excluded from expenses (proven against real exports, not assumed).

**Trust & operations:** an audit trail across every financial table, live
foundation-SQL health checks (which tables are actually reachable, not just
present in a file), automated alerts, AI-assisted document extraction with
defensive parsing throughout (never invents a number it can't read).

**Interface:** dark mode, sectioned keyboard-navigable sidebar with visible
focus states, a command palette (⌘K), toast notifications and styled
dialogs (no native browser popups anywhere in the authenticated app), table
sorting/pagination, bulk actions, double-submit protection on every
financial-record form, an unsaved-changes guard, and a global error
boundary so a broken tab never takes down the whole app.

**Auth:** email/password, Google OAuth (manually implemented PKCE — see
below), self-service account creation (creates a real, authenticatable
identity with zero data access until a Head Office admin grants it via
Staff & Access), and a complete forgot-password flow including the part
that's easy to half-build and ship broken: actually setting the new
password when the person clicks the email link.

## What's deliberately not built

Each of these was a considered decision, not an oversight — see the
relevant function or conversation history for the reasoning:
- Email/SMS alert delivery (alerts are in-app only)
- Recurring-expense auto-posting
- Any AI action that executes on its own — every AI suggestion is a
  pre-filled form a person still has to submit, or a follow-up someone
  has to act on
- Rate limiting on auth endpoints (Supabase's own defaults apply; no
  additional layer built here)

## Verification

Every non-trivial piece of logic in this system has a matching script in
`scripts/` that proves it — real numbers, real edge cases, run with plain
`node`, no test framework needed:

```
for f in scripts/verify_*.js; do node "$f" || echo "FAILED: $f"; done
```

All 21 currently pass. **None of this has been run against a live
Supabase/Postgres instance yet** — every script verifies the logic in
isolation (the same math, the same control flow, run directly), and the
handful of full end-to-end tests in this project's history used a local
mock server, not production infrastructure. That's the one honest gap
between "thoroughly verified" and "battle-tested": the first real deploy
is still this system's actual first contact with live Postgres.

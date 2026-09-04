# Phase 3 — frontend rewired onto the normalized tables

## What changed in index.html
Only the persistence layer. Every render function, form handler, chart, the
Tende import parser, the narrative generator — all untouched. Three things
changed underneath them:

1. `uid()` now generates a real UUID (`crypto.randomUUID()`) instead of a
   short random string, so a record's id is stable from creation through
   being saved — no server round trip needed before the UI can reference it
   again.
2. `loadState()` now calls `/api/me` to find your branch, then loads
   revenue/expenses/loans/loan payments/tax/settings from their own
   endpoints in parallel and reshapes each into the exact same object shape
   the app already used (`dailyRevenue`, `expenses`, `loans`, etc.) — every
   downstream function keeps working unmodified.
3. `queueSave()` now diffs each array against the last-synced snapshot and
   sends only what changed (create/update/delete) to the matching endpoint,
   instead of POSTing the entire blob to `/api/state`.

## Design decisions worth knowing about
- **Accounts and categories are still plain text**, not managed entities —
  that's how the app actually uses them (`account_used`, `category` as
  strings). `expenses.js` resolves a category name to a row on the fly
  (creating one if it's new); accounts are matched against the fixed
  4-account list seeded during migration.
- **Loan balance math stays client-side**, exactly as it already was — when
  a payment is added/edited/deleted, the app adjusts `loan.current_balance_kes`
  in memory, and that change rides along in the normal `loans` sync. There's
  no separate atomic balance-adjustment call.
- **`app_state` (the old blob) is kept as a live mirror**, not retired.
  Every save still writes the full current state there too, purely as a
  rollback point — `/api/state`'s POST replaces the whole blob rather than
  merging, so writing only the leftover fields would have quietly erased the
  old backup. The UI no longer *reads* from `app_state` for money data,
  only for `categories`/`monthlyArchive`/`closedMonths`, which don't have
  normalized tables yet.

## What I could NOT verify
I don't have a live Supabase/Netlify environment to test this against — the
JS syntax checks out cleanly, but the actual round trip (auth token
handling, RLS, real Postgres responses) has not been exercised. Please treat
this as a strong first draft, not a verified build.

## Recommended rollout (don't push straight to production)
1. Deploy this to a **Netlify preview/branch deploy**, not your primary
   production URL, if your Netlify plan supports it (a new site pointed at
   the same Supabase project also works — just don't overwrite the live one
   yet).
2. Log in as yourself and check the Revenue tab first — it's the simplest
   entity, easiest to sanity check numbers against what you already know.
3. Add one test revenue entry, refresh the page, confirm it's still there
   (proves create + reload works). Edit it, refresh again. Delete it,
   refresh again.
4. Repeat for Expenses (including a small Tende-style import if you can),
   then Loans + a loan payment, then Tax, then Settings.
5. Only once all of that looks right, point your real Netlify site at this
   deploy. Nothing is destructive up to that point — `app_state` is
   untouched as your rollback path the whole time.

## Phase 4, first slice: Tende import now saves through the batch endpoint
`handleExpenseImport()` still parses the file and pre-checks duplicates
against what's already loaded, exactly as before. The difference: instead of
pushing new rows into `state.expenses` and letting the generic background
sync create them one at a time, it now sends the whole batch to
`/api/expenses` in one call. That gets you two things the old path didn't:
a server-side duplicate check (catches a `txn_ref` someone else imported
since this session loaded, not just ones already in your local memory), and
an exact per-row reason for anything skipped, shown in the same import
summary the UI already displays.

Receipt/invoice uploads and an approvals UI (the `expenses.status` field and
`approve` flag already exist server-side) are the next slice of Phase 4 —
not built yet, and still untested end-to-end like everything else here.

## Phase 4, second slice: receipt/invoice uploads
New: `netlify/functions/attachments.js` (upload/list/delete) and
`supabase/storage_setup.sql` (creates the private `receipts` Storage bucket
— **run this in Supabase before deploying**, it's separate from the main
schema file). Files travel as base64 in the JSON body, which is simplest
within a Netlify Function's payload limit — fine for a phone photo of a
receipt, not meant for large PDFs (capped at ~6MB).

UI hook: a 📎 button on each expense row opens a small panel (upload +
list + remove) above the expenses table. This is deliberately the only tab
wired up so far — same pattern would extend to Revenue and Loans rows later
if useful, but wasn't worth guessing at until the expense one's been tried.

Every attachment operation re-confirms the entity (expense/revenue
entry/loan) actually belongs to the caller's branch before touching
anything, so this can't be used to read or attach files across branches.

Approvals UI is still the one piece of the original Phase 4 scope not
started.

## Phase 5, first slice: CSV export + printable monthly report
- "Export CSV" buttons on Revenue and Expenses export exactly what's
  currently on screen (respecting the active filters on Expenses) — no new
  library, plain browser `Blob`/download.
- "Print Monthly Report" on the Dashboard uses the browser's native
  print/Save-as-PDF, with a print stylesheet that hides the sidebar, nav,
  and every form/button, leaving just the KPI cards, the plain-English
  narrative, and the Profit First split. This is the same approach a normal
  webpage uses for "printer-friendly" — nothing new to test beyond opening
  the print dialog and checking it looks right.

Not done: true `.xlsx` export (would need pulling in a library like
SheetJS — CSV opens fine in Excel already, so I held off until you tell me
that's actually needed), and no AI assistant yet. Given how much is already
sitting untested, I'd stop and verify before either of those.

## Phase 6: AI Financial Assistant
New: `netlify/functions/ai-assistant.js` + an "AI Assistant" tab (simple
chat UI). Design choices worth knowing:

- **The model never sees raw database rows or freeform access to your
  data.** Each request, the function itself pulls a compact 6-month summary
  (revenue and expenses by month, expenses by category, loan balances, tax
  obligations, current Profit First split) straight from Postgres, and that
  JSON is the *only* financial information handed to the model. The system
  prompt explicitly forbids inventing numbers and requires predictions/
  recommendations to be labeled as such, separate from facts.
- Read-only (`write:false` in the RBAC check) — the assistant can't create,
  edit, or delete anything.
- **Requires a Netlify environment variable: `ANTHROPIC_API_KEY`.** Without
  it, the endpoint returns a clear error rather than failing silently. Get
  a key from the Anthropic Console and add it under Site settings →
  Environment variables.
- Uses `claude-sonnet-4-20250514`. Cost is per-request (a handful of cents at most,
  given the small summary) — worth knowing if the tab gets used a lot.
- Conversation history is kept in the browser tab only (not persisted) and
  capped server-side, so a long back-and-forth doesn't balloon the request.
- `netlify.toml` now pins `NODE_VERSION = "20"` so the function's native
  `fetch()` call is guaranteed available.

This is the last item from the original brief's scope. Like everything
above, it's unverified against a live deploy — the "1 + 1" of testing this
one specifically is: ask it something you already know the answer to (e.g.
"what's total revenue this month"), and check the number against the
Dashboard tab.

## Completing everything (Phase 2 RLS, Phase 3 multi-branch, Phase 4 approvals, Phase 5 reports)

**New SQL — run these in Supabase before deploying this zip:**
1. `supabase/rls_policies_complete.sql` — finishes the RLS coverage that was
   left as a sketch (now every table has real policies, not just revenue
   and expenses).
2. `supabase/branch_misc_state.sql` — **important, fixes a real bug.**
   Multi-branch support added real branches, but `categories`,
   `monthlyArchive`, and `closedMonths` were still riding on the old
   single-row `app_state`, which has no branch concept — so two branches
   would have silently shared one categories list and one archive. This
   creates a proper per-branch table and backfills whatever's already in
   `app_state` into your existing branch, so nothing is lost. Run it before
   creating a second branch.

**Phase 2 — RLS.** No frontend changes. Defense-in-depth only; the real
gate is still `requireBranchAccess()` in every function.

**Phase 3 — multi-branch UI + role gating.**
- Sidebar shows a branch switcher once you have more than one branch.
- New "Staff & Access" tab (Head Office only): create branches, grant/
  revoke `user_branch_access` by email. The person must already have a
  Supabase Auth account — this doesn't create one, same as always.
- Every write action (forms, Edit/Delete, Close Month, Save Settings) now
  hides for roles that can't perform it, instead of just failing with a
  403 after the click. Settings changes are further restricted to Head
  Office/Branch Manager, matching what the API already enforced.

**Phase 4 — approvals.** Non-approver roles (accountant) get a "Submit for
approval" checkbox when logging an expense. Pending expenses are excluded
from every total (gross/net OpEx, Dashboard pace, everything) until a
Branch Manager or Head Office approves or rejects them from the Expenses
table. This is enforced server-side too, not just hidden in the UI — an
Accountant can't self-approve by calling the API directly.

**Phase 5 — reporting.**
- Trend Archive now has a Variance column (budget vs. actual OpEx) and,
  for Head Office with more than one branch, a current-month branch
  comparison table.
- True `.xlsx` export added for Expenses and the Trend Archive (uses the
  SheetJS build already loaded for the Tende importer — no new
  dependency). Revenue still only has CSV; say the word if you want xlsx
  there too.
- Still not built: quarterly/annual roll-ups and true budget-variance
  reporting beyond the one column added here — flag if that's actually
  needed day to day, since "reporting engine" could mean a lot more than
  this.

Every screenshot in this conversation was a real render (a headless
browser with mock data), not a description — but none of this has touched
your live Supabase/Netlify yet. Same rollout advice as before: preview
deploy first, test role-by-role if you can (an Accountant and a Branch
Manager account would catch anything the Owner view hides).

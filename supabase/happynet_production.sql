-- Happynet production bootstrap and migration runner.
--
-- Execute this file with psql against the Supabase database. It is
-- intentionally a psql runner: Supabase SQL Editor does not
-- support including other SQL files. Run it from the repository root so the
-- relative paths below resolve correctly.
--
-- This replaces the old manual 20+ file deployment sequence. It is safe to
-- rerun: the component migrations use IF NOT EXISTS, CREATE OR REPLACE, and
-- idempotent backfills where appropriate.

\set ON_ERROR_STOP on

begin;

-- Legacy JSON store required by hfms_schema_v2's one-time migration block.
\ir supabase/schema.sql

-- Canonical relational schema and its original RLS/triggers.
\ir supabase/hfms_schema_v2.sql
\ir supabase/storage_setup.sql
\ir supabase/rls_policies_complete.sql
\ir supabase/branch_misc_state.sql

-- Ledger foundation. This order is significant.
\ir supabase/hfms_foundation_fix_00_ledger_core.sql
\ir supabase/hfms_foundation_fix_01_ledger_sync.sql
\ir supabase/hfms_foundation_fix_02_journal_posting.sql
\ir supabase/hfms_foundation_fix_03_accounting_periods.sql

-- Operational finance modules.
\ir supabase/hfms_foundation_fix_04_accounts_payable.sql
\ir supabase/hfms_foundation_fix_05_reconciliation.sql
\ir supabase/hfms_foundation_fix_05_relationship_repair.sql
\ir supabase/hfms_foundation_fix_06_tax_intelligence.sql
\ir supabase/hfms_foundation_fix_07_ai_conversations.sql
\ir supabase/hfms_foundation_fix_08_automation.sql
\ir supabase/hfms_foundation_fix_09_period_close_entries.sql
\ir supabase/hfms_foundation_fix_10_supplier_fields.sql
\ir supabase/hfms_foundation_fix_11_ai_followups.sql
\ir supabase/hfms_foundation_fix_12_document_intelligence.sql
\ir supabase/hfms_foundation_fix_13_audit_coverage.sql
\ir supabase/hfms_foundation_fix_14_sync_error_visibility.sql
\ir supabase/hfms_foundation_fix_15_decision_queue.sql
\ir supabase/hfms_foundation_fix_16_supplier_documents.sql
\ir supabase/hfms_foundation_fix_17_loan_reimbursement_sync.sql
\ir supabase/hfms_foundation_fix_18_oauth_pkce.sql

-- Access provisioning function. The auth repair script is deliberately not
-- included: it deletes and recreates a named bootstrap user and is not a
-- production migration.
\ir supabase/ensure_default_access.sql

-- Complete the one-time ledger activation for every existing branch.
select public.hfms_seed_chart_of_accounts(id) from public.branches;
select public.hfms_post_all_unposted_transactions();

-- Fail the deployment if any required feature table was not created.
do $$
declare
  missing text;
begin
  select string_agg(required_table, ', ' order by required_table)
    into missing
  from (values
    ('financial_transactions'), ('chart_of_accounts'), ('journal_entries'),
    ('journal_lines'), ('accounting_periods'), ('bills'), ('bill_payments'),
    ('bank_statement_imports'), ('bank_statement_lines'), ('tax_periods'),
    ('ai_conversations'), ('ai_messages'), ('ai_follow_ups'), ('hfms_alerts'),
    ('audit_log'), ('supplier_documents')
  ) as required(required_table)
  where to_regclass('public.' || required_table) is null;

  if missing is not null then
    raise exception 'Happynet migration incomplete; missing public tables: %', missing;
  end if;
end $$;

-- The posted journal must remain balanced before the transaction is committed.
do $$
declare
  difference numeric;
begin
  select coalesce(sum(total_debit_kes), 0) - coalesce(sum(total_credit_kes), 0)
    into difference
  from public.v_hfms_trial_balance;
  if abs(difference) >= 0.01 then
    raise exception 'Ledger is unbalanced by KES %; migration rolled back.', difference;
  end if;
end $$;

commit;

select 'Happynet production schema and foundation migrations completed.' as status;
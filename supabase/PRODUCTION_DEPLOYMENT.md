# Production Supabase Deployment

Run these files in Supabase SQL Editor, one file at a time, in this order:

1. `hfms_schema_v2.sql`
2. `storage_setup.sql`
3. `rls_policies_complete.sql`
4. `branch_misc_state.sql`
5. `hfms_foundation_fix_00_ledger_core.sql`
6. `hfms_foundation_fix_01_ledger_sync.sql`
7. `hfms_foundation_fix_02_journal_posting.sql`
8. `hfms_foundation_fix_03_accounting_periods.sql`
9. `hfms_foundation_fix_04_accounts_payable.sql`
10. `hfms_foundation_fix_05_reconciliation.sql`
11. `hfms_foundation_fix_06_tax_intelligence.sql`
12. `hfms_foundation_fix_07_ai_conversations.sql`
13. `hfms_foundation_fix_08_automation.sql`
14. `hfms_foundation_fix_09_period_close_entries.sql`
15. `hfms_foundation_fix_10_supplier_fields.sql`
16. `hfms_foundation_fix_11_ai_followups.sql`
17. `hfms_foundation_fix_12_document_intelligence.sql`
18. `hfms_foundation_fix_13_audit_coverage.sql`
19. `hfms_foundation_fix_14_sync_error_visibility.sql`
20. `hfms_foundation_fix_15_decision_queue.sql`
21. `hfms_foundation_fix_16_supplier_documents.sql`
22. `hfms_foundation_fix_17_loan_reimbursement_sync.sql`
23. `ensure_default_access.sql`

`hfms_foundation_fix_18_oauth_pkce.sql` is no longer required because Google
sign-in was removed from the application. It can remain unapplied.

After the migrations complete, seed the chart of accounts for every branch:

```sql
select public.hfms_seed_chart_of_accounts(id) from public.branches;
select public.hfms_post_all_unposted_transactions();
```

Verify the ledger and feature tables:

```sql
select sum(total_debit_kes) - sum(total_credit_kes) as ledger_difference
from public.v_hfms_trial_balance;

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_name in (
    'financial_transactions', 'chart_of_accounts', 'journal_entries',
    'journal_lines', 'bills', 'bill_payments', 'bank_statement_imports',
    'bank_statement_lines', 'ai_conversations', 'ai_follow_ups',
    'hfms_alerts', 'audit_log'
  )
order by table_name;
```

The ledger difference must be `0`. Then redeploy the Netlify site and use the
Head Office Audit Log's Foundation SQL status panel to confirm reachability.
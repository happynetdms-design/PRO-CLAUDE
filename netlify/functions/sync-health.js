// Surfaces silent ledger sync failures (hfms_sync_errors), AND does a
// live reachability check across every foundation-fix table this app
// depends on. The reachability idea (probe whether a table actually
// exists and is queryable, rather than trusting a file existing on disk)
// is a genuinely good pattern — borrowed and improved from a parallel
// build a coworker was working on, whose own version checked whether
// *function files* exist on disk, which proves nothing about whether
// the underlying logic is correct. This only checks tables, and is
// explicit that "reachable" means exactly that — not "correct."
const { requireUser, adminClient, json } = require('./_lib/supabase');
const { getAccess } = require('./_lib/rbac');

// Every table added by a foundation-fix file, so a failed check tells you
// exactly which SQL file still needs to run — not just "something's missing."
const REQUIRED_TABLES = [
  { table: 'financial_transactions', file: 'hfms_foundation_fix_01_ledger_sync.sql' },
  { table: 'journal_entries', file: 'hfms_foundation_fix_00_ledger_core.sql' },
  { table: 'journal_lines', file: 'hfms_foundation_fix_00_ledger_core.sql' },
  { table: 'chart_of_accounts', file: 'hfms_foundation_fix_00_ledger_core.sql' },
  { table: 'accounting_periods', file: 'hfms_foundation_fix_00_ledger_core.sql' },
  { table: 'bills', file: 'hfms_foundation_fix_04_accounts_payable.sql' },
  { table: 'bill_payments', file: 'hfms_foundation_fix_04_accounts_payable.sql' },
  { table: 'bank_statement_imports', file: 'hfms_foundation_fix_05_reconciliation.sql' },
  { table: 'bank_statement_lines', file: 'hfms_foundation_fix_05_reconciliation.sql' },
  { table: 'tax_periods', file: 'hfms_foundation_fix_06_tax_intelligence.sql' },
  { table: 'ai_conversations', file: 'hfms_foundation_fix_07_ai_conversations.sql' },
  { table: 'hfms_alerts', file: 'hfms_foundation_fix_08_automation.sql' },
  { table: 'ai_follow_ups', file: 'hfms_foundation_fix_11_ai_followups.sql' },
  { table: 'document_intelligence_queue', file: 'hfms_foundation_fix_12_document_intelligence.sql' },
  { table: 'management_decisions', file: 'hfms_foundation_fix_15_decision_queue.sql' },
  { table: 'supplier_documents', file: 'hfms_foundation_fix_16_supplier_documents.sql' }
];

exports.handler = async (event) => {
  if(event.httpMethod !== 'GET') return json(405, { error: 'Method not allowed.' });
  const admin = adminClient();

  const { user, error } = await requireUser(event);
  if(error) return json(401, { error });

  const access = await getAccess(admin, user.id);
  if(!access.isHeadOffice){
    return json(403, { error: 'System health visibility is Head Office only.' });
  }

  try{
    const tableChecks = await Promise.all(REQUIRED_TABLES.map(async ({ table, file }) => {
      const { error: probeErr } = await admin.from(table).select('*', { head: true, count: 'exact' }).limit(1);
      return { table, file, status: probeErr ? 'not_set_up' : 'ok', detail: probeErr ? probeErr.message : 'reachable' };
    }));

    const { data, error: fetchErr } = await admin
      .from('hfms_sync_errors').select('*').order('occurred_at', { ascending: false }).limit(100);
    const syncErrors = fetchErr ? [] : (data || []);

    return json(200, {
      tables: tableChecks,
      tables_ok_count: tableChecks.filter(t=>t.status==='ok').length,
      tables_total: tableChecks.length,
      errors: syncErrors, count: syncErrors.length
    });
  }catch(e){
    console.error('sync-health error', e);
    return json(500, { error: 'Unexpected error checking sync health.' });
  }
};

-- ============================================================================
-- HFMS Foundation Fix, part 13 — audit trail coverage for everything built
-- since the original 6-phase build
-- ----------------------------------------------------------------------------
-- Run this LAST, after every other foundation-fix file (needs bills,
-- journal_entries, tax_periods, accounting_periods, and bank_statement_*
-- to already exist).
--
-- THE GAP THIS CLOSES
-- The audit_log table and its trigger have existed since the original
-- build, wired to revenue_entries, expenses, and loans. Everything added
-- in the extended session — bills, bill payments, journal entries, tax
-- periods, accounting period closes/reopens, reconciliation — has had
-- NO audit trail at all. A period being reopened, a bill being approved,
-- a journal entry being voided: none of that was ever recorded. That's a
-- real, growing accountability gap, not a cosmetic one.
--
-- WHY THE TRIGGER FUNCTION NEEDED FIXING FIRST, NOT JUST REUSING
-- The original audit_row_change() unconditionally reads new.is_deleted to
-- decide whether an update was a soft-delete. accounting_periods has no
-- is_deleted column at all (it uses status: open/closed/reopened instead)
-- — attaching the old trigger as-is would throw "record has no field
-- is_deleted" the instant anyone closed or reopened a period, breaking
-- that entire feature. Rewritten below to check for the column's
-- existence via jsonb (`v_new ? 'is_deleted'`) rather than referencing it
-- directly, so it works safely on any table regardless of which pattern
-- (is_deleted vs status) that table uses. Bonus: tables using a status
-- field now get a more informative 'status_change' audit action instead
-- of a generic 'update' — a bill going draft -> approved is more useful
-- to see at a glance than just "updated".
-- ============================================================================

create or replace function public.audit_row_change()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  v_action text;
  v_new jsonb := to_jsonb(new);
  v_old jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.audit_log(table_name, record_id, action, new_data, changed_by)
    values (tg_table_name, new.id, 'insert', v_new, auth.uid());
    return new;
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_action := 'update';
    if v_new ? 'is_deleted' and (v_new->>'is_deleted')::boolean and not coalesce((v_old->>'is_deleted')::boolean, false) then
      v_action := 'soft_delete';
    elsif v_new ? 'status' and (v_old->>'status') is distinct from (v_new->>'status') then
      v_action := 'status_change';
    end if;
    insert into public.audit_log(table_name, record_id, action, old_data, new_data, changed_by)
    values (tg_table_name, new.id, v_action, v_old, v_new, auth.uid());
    return new;
  end if;
  return new;
end;
$$;

-- Existing tables automatically get the improved behavior (create or
-- replace, same function, same triggers already attached) — no changes
-- needed to revenue_entries/expenses/loans coverage.

drop trigger if exists trg_audit_bills on public.bills;
create trigger trg_audit_bills after insert or update on public.bills
  for each row execute function public.audit_row_change();

drop trigger if exists trg_audit_bill_payments on public.bill_payments;
create trigger trg_audit_bill_payments after insert or update on public.bill_payments
  for each row execute function public.audit_row_change();

drop trigger if exists trg_audit_journal_entries on public.journal_entries;
create trigger trg_audit_journal_entries after insert or update on public.journal_entries
  for each row execute function public.audit_row_change();

drop trigger if exists trg_audit_tax_periods on public.tax_periods;
create trigger trg_audit_tax_periods after insert or update on public.tax_periods
  for each row execute function public.audit_row_change();

-- The highest-value addition here: closing and reopening a period is
-- exactly the kind of high-stakes action that needs a paper trail, and
-- previously had none at all.
drop trigger if exists trg_audit_accounting_periods on public.accounting_periods;
create trigger trg_audit_accounting_periods after insert or update on public.accounting_periods
  for each row execute function public.audit_row_change();

drop trigger if exists trg_audit_bank_statement_imports on public.bank_statement_imports;
create trigger trg_audit_bank_statement_imports after insert or update on public.bank_statement_imports
  for each row execute function public.audit_row_change();

drop trigger if exists trg_audit_bank_statement_lines on public.bank_statement_lines;
create trigger trg_audit_bank_statement_lines after insert or update on public.bank_statement_lines
  for each row execute function public.audit_row_change();

-- ----------------------------------------------------------------------------
-- VERIFICATION
-- ----------------------------------------------------------------------------
-- select table_name, count(*) from audit_log group by table_name order by table_name;
--   -- should now include bills, bill_payments, journal_entries, tax_periods,
--   -- accounting_periods, bank_statement_imports, bank_statement_lines
--   -- alongside the original revenue_entries/expenses/loans.
-- select * from audit_log where table_name='accounting_periods' order by changed_at desc;
--   -- close/reopen a period, then run this — should show a 'status_change' row.

-- Repair for databases where bank_statement_imports was created before the
-- account relationship was included in hfms_foundation_fix_05.
-- Run after hfms_schema_v2.sql and hfms_foundation_fix_05_reconciliation.sql.

do $$
begin
  if to_regclass('public.bank_statement_imports') is not null
     and to_regclass('public.financial_accounts') is not null
     and exists (
       select 1 from information_schema.columns
       where table_schema = 'public'
         and table_name = 'bank_statement_imports'
         and column_name = 'account_id'
     )
     and not exists (
       select 1
       from pg_constraint c
       join pg_attribute a on a.attrelid = c.conrelid
         and a.attnum = any(c.conkey)
       where c.conrelid = 'public.bank_statement_imports'::regclass
         and c.contype = 'f'
         and a.attname = 'account_id'
         and c.confrelid = 'public.financial_accounts'::regclass
     ) then
    alter table public.bank_statement_imports
      add constraint bank_statement_imports_account_id_fkey
      foreign key (account_id) references public.financial_accounts(id);
  end if;
end $$;
-- ============================================================================
-- HFMS Foundation Fix, part 10 — richer supplier records
-- ----------------------------------------------------------------------------
-- Run this AFTER hfms_schema_v2.sql (the suppliers table already exists).
-- Purely additive — ALTER TABLE ADD COLUMN IF NOT EXISTS, safe to run
-- against a table that already has data in it.
-- ============================================================================

alter table public.suppliers add column if not exists kra_pin text;
alter table public.suppliers add column if not exists is_active boolean not null default true;

-- A simple statement: every bill and payment for one supplier, for
-- handing to them or reviewing before a call. Built as a view, not a new
-- table — it's just a join over data that already exists.
create or replace view public.v_hfms_supplier_statement as
select
  b.supplier_id, s.name as supplier_name, b.id as bill_id, b.invoice_number, b.invoice_date,
  b.total_kes,
  coalesce((select sum(amount_kes) from public.bill_payments bp where bp.bill_id = b.id and bp.is_deleted = false), 0) as paid_kes,
  b.total_kes - coalesce((select sum(amount_kes) from public.bill_payments bp where bp.bill_id = b.id and bp.is_deleted = false), 0) as outstanding_kes,
  b.status
from public.bills b
join public.suppliers s on s.id = b.supplier_id
where b.is_deleted = false;

-- ----------------------------------------------------------------------------
-- VERIFICATION
-- ----------------------------------------------------------------------------
-- select * from v_hfms_supplier_statement where supplier_id = '<a supplier id>' order by invoice_date;

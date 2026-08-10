-- 031_payments_and_allocations (down)
DROP TRIGGER IF EXISTS trg_invoice_void_guard ON invoices;
DROP FUNCTION IF EXISTS guard_invoice_void();
DROP TRIGGER IF EXISTS trg_guard_payment_allocation_sum ON payment_allocations;
DROP FUNCTION IF EXISTS guard_payment_allocation_sum();
DROP TABLE IF EXISTS payment_allocations;
DROP TRIGGER IF EXISTS trg_payments_immutable_amount ON payments;
DROP FUNCTION IF EXISTS guard_payment_immutable_amount();
DROP TABLE IF EXISTS payments;

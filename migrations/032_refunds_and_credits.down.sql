-- 032_refunds_and_credits (down)
DROP TABLE IF EXISTS child_credits;
DROP TRIGGER IF EXISTS trg_guard_refund_allocation_ceiling ON refund_allocations;
DROP FUNCTION IF EXISTS guard_refund_allocation_ceiling();
DROP TABLE IF EXISTS refund_allocations;
DROP TRIGGER IF EXISTS trg_sync_payment_status_after_refund ON refunds;
DROP FUNCTION IF EXISTS sync_payment_status_after_refund();
DROP TRIGGER IF EXISTS trg_guard_refund_ceiling ON refunds;
DROP FUNCTION IF EXISTS guard_refund_ceiling();
DROP TABLE IF EXISTS refunds;

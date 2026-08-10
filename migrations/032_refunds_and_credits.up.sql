-- 032_refunds_and_credits
--
-- Sahə mənbəyi: Faz 3.1 CRITICAL FIX #7:
--   refunds(id, payment_id, amount, reason, refunded_at)
--   refund_allocations(refund_id, payment_allocation_id, reversed_amount)
--   child_credits(id, child_id, source_payment_id, amount, used_amount, created_at)

CREATE TABLE refunds (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  payment_id      UUID NOT NULL,
  amount          NUMERIC(12,2) NOT NULL,
  reason          TEXT,
  refunded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  CHECK (amount > 0),
  FOREIGN KEY (organization_id, payment_id)
    REFERENCES payments (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX idx_refunds_org ON refunds(organization_id);
CREATE INDEX idx_refunds_org_payment ON refunds(organization_id, payment_id);

ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;
ALTER TABLE refunds FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_refunds ON refunds
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

CREATE TRIGGER trg_refunds_no_delete
  BEFORE DELETE ON refunds
  FOR EACH ROW EXECUTE FUNCTION guard_no_physical_delete();
CREATE TRIGGER trg_refunds_no_update
  BEFORE UPDATE ON refunds
  FOR EACH ROW EXECUTE FUNCTION guard_no_update();

-- ---------------------------------------------------------------------------
-- REFUND CEILING + RACE-SAFETY (Faz 3.9 bənd 13/19): amount <= payment.amount
-- - əvvəlki refund-ların cəmi. "FOR UPDATE" payment sətrini kilidləyir.
-- ---------------------------------------------------------------------------
CREATE FUNCTION guard_refund_ceiling() RETURNS TRIGGER AS $$
DECLARE
  v_payment_amount NUMERIC(12,2);
  v_prev_refunds NUMERIC(12,2);
BEGIN
  SELECT amount INTO v_payment_amount FROM payments WHERE id = NEW.payment_id FOR UPDATE;
  IF v_payment_amount IS NULL THEN
    RAISE EXCEPTION 'Payment tapılmadı: %', NEW.payment_id;
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_prev_refunds FROM refunds WHERE payment_id = NEW.payment_id;

  IF v_prev_refunds + NEW.amount > v_payment_amount THEN
    RAISE EXCEPTION 'Refund limiti aşıldı: əvvəlki refund-lar=% + yeni=% > payment.amount=%',
      v_prev_refunds, NEW.amount, v_payment_amount;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_refund_ceiling
  BEFORE INSERT ON refunds
  FOR EACH ROW EXECUTE FUNCTION guard_refund_ceiling();

-- Refund tam ödənildikdə payment.status avtomatik yenilənir (REFUNDED/PARTIALLY_REFUNDED).
CREATE FUNCTION sync_payment_status_after_refund() RETURNS TRIGGER AS $$
DECLARE
  v_payment_amount NUMERIC(12,2);
  v_total_refunded NUMERIC(12,2);
BEGIN
  SELECT amount INTO v_payment_amount FROM payments WHERE id = NEW.payment_id;
  SELECT COALESCE(SUM(amount), 0) INTO v_total_refunded FROM refunds WHERE payment_id = NEW.payment_id;

  IF v_total_refunded >= v_payment_amount THEN
    UPDATE payments SET status = 'REFUNDED', updated_at = now() WHERE id = NEW.payment_id;
  ELSE
    UPDATE payments SET status = 'PARTIALLY_REFUNDED', updated_at = now() WHERE id = NEW.payment_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sync_payment_status_after_refund
  AFTER INSERT ON refunds
  FOR EACH ROW EXECUTE FUNCTION sync_payment_status_after_refund();


CREATE TABLE refund_allocations (
  id                      UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id         UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  refund_id               UUID NOT NULL,
  payment_allocation_id   UUID NOT NULL,
  reversed_amount         NUMERIC(12,2) NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  CHECK (reversed_amount > 0),
  FOREIGN KEY (organization_id, refund_id)
    REFERENCES refunds (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (organization_id, payment_allocation_id)
    REFERENCES payment_allocations (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX idx_refund_alloc_org ON refund_allocations(organization_id);
CREATE INDEX idx_refund_alloc_org_refund ON refund_allocations(organization_id, refund_id);
CREATE INDEX idx_refund_alloc_org_pa ON refund_allocations(organization_id, payment_allocation_id);

ALTER TABLE refund_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE refund_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_refund_allocations ON refund_allocations
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

CREATE TRIGGER trg_refund_allocations_no_delete
  BEFORE DELETE ON refund_allocations
  FOR EACH ROW EXECUTE FUNCTION guard_no_physical_delete();
CREATE TRIGGER trg_refund_allocations_no_update
  BEFORE UPDATE ON refund_allocations
  FOR EACH ROW EXECUTE FUNCTION guard_no_update();

-- SUM(reversed_amount) <= orijinal payment_allocation.allocated_amount, FOR UPDATE ilə race-safe.
CREATE FUNCTION guard_refund_allocation_ceiling() RETURNS TRIGGER AS $$
DECLARE
  v_original_amount NUMERIC(12,2);
  v_prev_reversed NUMERIC(12,2);
BEGIN
  SELECT allocated_amount INTO v_original_amount FROM payment_allocations WHERE id = NEW.payment_allocation_id FOR UPDATE;
  IF v_original_amount IS NULL THEN
    RAISE EXCEPTION 'payment_allocation tapılmadı: %', NEW.payment_allocation_id;
  END IF;

  SELECT COALESCE(SUM(reversed_amount), 0) INTO v_prev_reversed
  FROM refund_allocations WHERE payment_allocation_id = NEW.payment_allocation_id;

  IF v_prev_reversed + NEW.reversed_amount > v_original_amount THEN
    RAISE EXCEPTION 'Refund allocation limiti aşıldı: əvvəlki=% + yeni=% > original allocated_amount=%',
      v_prev_reversed, NEW.reversed_amount, v_original_amount;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_refund_allocation_ceiling
  BEFORE INSERT ON refund_allocations
  FOR EACH ROW EXECUTE FUNCTION guard_refund_allocation_ceiling();


CREATE TABLE child_credits (
  id                UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  child_id          UUID NOT NULL,
  source_payment_id UUID NOT NULL,
  amount            NUMERIC(12,2) NOT NULL,
  used_amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  CHECK (amount > 0),
  CHECK (used_amount >= 0),
  CHECK (used_amount <= amount),
  FOREIGN KEY (organization_id, child_id)
    REFERENCES children (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (organization_id, source_payment_id)
    REFERENCES payments (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX idx_child_credits_org ON child_credits(organization_id);
CREATE INDEX idx_child_credits_org_child ON child_credits(organization_id, child_id);

ALTER TABLE child_credits ENABLE ROW LEVEL SECURITY;
ALTER TABLE child_credits FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_child_credits ON child_credits
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

CREATE TRIGGER trg_child_credits_no_delete
  BEFORE DELETE ON child_credits
  FOR EACH ROW EXECUTE FUNCTION guard_no_physical_delete();

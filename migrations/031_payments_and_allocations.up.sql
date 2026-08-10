-- 031_payments_and_allocations
--
-- Sahə mənbəyi: Faz 3.1 CRITICAL FIX #7 (Finance modeli, FINAL):
--   payments(id, organization_id, child_id, amount, method, paid_at,
--            status[COMPLETED/REFUNDED/PARTIALLY_REFUNDED])  -- invoice_id YOXDUR
--   payment_allocations(id, payment_id, invoice_id, invoice_item_id NULLABLE, allocated_amount)
--
-- MÜTLƏQ QAYDA (Faz 3.9 bənd 7): "payments.invoice_id" YARADILMIR. Əlaqə
-- yalnız payment_allocations vasitəsilədir.

CREATE TABLE payments (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  child_id        UUID NOT NULL,
  amount          NUMERIC(12,2) NOT NULL,
  method          TEXT,
  paid_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  status          TEXT NOT NULL DEFAULT 'COMPLETED'
                  CHECK (status IN ('COMPLETED','REFUNDED','PARTIALLY_REFUNDED')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  CHECK (amount > 0),
  FOREIGN KEY (organization_id, child_id)
    REFERENCES children (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX idx_payments_org ON payments(organization_id);
CREATE INDEX idx_payments_org_child ON payments(organization_id, child_id);

ALTER TABLE payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE payments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_payments ON payments
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

CREATE TRIGGER trg_payments_no_delete
  BEFORE DELETE ON payments
  FOR EACH ROW EXECUTE FUNCTION guard_no_physical_delete();

CREATE FUNCTION guard_payment_immutable_amount() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.amount <> OLD.amount OR NEW.child_id <> OLD.child_id OR NEW.organization_id <> OLD.organization_id THEN
    RAISE EXCEPTION 'Payment: amount/child_id/organization_id dəyişdirilə bilməz (ledger immutability)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_payments_immutable_amount
  BEFORE UPDATE ON payments
  FOR EACH ROW EXECUTE FUNCTION guard_payment_immutable_amount();


CREATE TABLE payment_allocations (
  id                UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  payment_id        UUID NOT NULL,
  invoice_id        UUID NOT NULL,
  invoice_item_id   UUID,
  allocated_amount  NUMERIC(12,2) NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  CHECK (allocated_amount > 0),
  FOREIGN KEY (organization_id, payment_id)
    REFERENCES payments (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (organization_id, invoice_id)
    REFERENCES invoices (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (organization_id, invoice_item_id)
    REFERENCES invoice_items (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX idx_pay_alloc_org ON payment_allocations(organization_id);
CREATE INDEX idx_pay_alloc_org_payment ON payment_allocations(organization_id, payment_id);
CREATE INDEX idx_pay_alloc_org_invoice ON payment_allocations(organization_id, invoice_id);

ALTER TABLE payment_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE payment_allocations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_payment_allocations ON payment_allocations
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

CREATE TRIGGER trg_payment_allocations_no_delete
  BEFORE DELETE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION guard_no_physical_delete();

CREATE TRIGGER trg_payment_allocations_no_update
  BEFORE UPDATE ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION guard_no_update();

-- ---------------------------------------------------------------------------
-- OVER-ALLOCATION QORUNMASI + RACE-CONDITION TƏHLÜKƏSİZLİYİ (Faz 3.9 bənd 10/19):
-- SUM(payment_allocations.allocated_amount) HEÇ VAXT payment.amount-u aşmır.
-- "SELECT ... FOR UPDATE" payment sətrini kilidləyir — eyni anda gələn 2
-- paralel allocation sorğusu bu kilid üzərində SERİALLAŞIR, belə ki 70+50=120>100
-- kimi over-allocation baş verə bilməz.
-- ---------------------------------------------------------------------------
CREATE FUNCTION guard_payment_allocation_sum() RETURNS TRIGGER AS $$
DECLARE
  v_payment_amount NUMERIC(12,2);
  v_allocated_sum NUMERIC(12,2);
BEGIN
  SELECT amount INTO v_payment_amount FROM payments WHERE id = NEW.payment_id FOR UPDATE;
  IF v_payment_amount IS NULL THEN
    RAISE EXCEPTION 'Payment tapılmadı: %', NEW.payment_id;
  END IF;

  SELECT COALESCE(SUM(allocated_amount), 0) INTO v_allocated_sum
  FROM payment_allocations WHERE payment_id = NEW.payment_id;

  IF v_allocated_sum + NEW.allocated_amount > v_payment_amount THEN
    RAISE EXCEPTION 'Over-allocation: SUM(allocated)=% + yeni=% > payment.amount=%',
      v_allocated_sum, NEW.allocated_amount, v_payment_amount;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_guard_payment_allocation_sum
  BEFORE INSERT ON payment_allocations
  FOR EACH ROW EXECUTE FUNCTION guard_payment_allocation_sum();

-- ---------------------------------------------------------------------------
-- VOID QAYDASININ TAMAMLANMASI (Faz 3.9 bənd 15): indi payment_allocations
-- mövcuddur — invoices üzərindəki VOID trigger-i BURADA əlavə olunur.
-- ---------------------------------------------------------------------------
CREATE FUNCTION guard_invoice_void() RETURNS TRIGGER AS $$
DECLARE
  v_alloc_count INTEGER;
BEGIN
  IF NEW.status = 'void' AND OLD.status <> 'void' THEN
    SELECT COUNT(*) INTO v_alloc_count FROM payment_allocations
    WHERE organization_id = OLD.organization_id AND invoice_id = OLD.id;
    IF v_alloc_count > 0 THEN
      RAISE EXCEPTION 'Invoice VOID edilə bilməz: % payment_allocation bağlıdır', v_alloc_count;
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_invoice_void_guard
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION guard_invoice_void();

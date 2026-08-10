-- 030_invoices_and_items
--
-- Sahə mənbəyi: Faz 3.1 C.7:
--   invoices(id, organization_id, child_id, status[draft/issued/partially_paid/paid/void],
--            issued_at, due_date, total_amount)
--   invoice_items(id, invoice_id, service_id NULLABLE, package_id NULLABLE, description,
--                 quantity, unit_price, amount)
--   discounts(id, invoice_id, type[percent/fixed], value, reason)
--
-- QEYD: balans/"remaining" sütunu BURAYA ƏLAVƏ EDİLMİR (Faz 3.1: "balanslar
-- ayrıca source-of-truth kimi saxlanmamalıdır" — DERIVED, servis səviyyəsində
-- hesablanır, bax finance/invoice.service.ts).

CREATE TABLE invoices (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  child_id        UUID NOT NULL,
  status          TEXT NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','issued','partially_paid','paid','void')),
  issued_at       TIMESTAMPTZ,
  due_date        DATE,
  total_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  CHECK (total_amount >= 0),
  FOREIGN KEY (organization_id, child_id)
    REFERENCES children (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX idx_invoices_org ON invoices(organization_id);
CREATE INDEX idx_invoices_org_child ON invoices(organization_id, child_id);
CREATE INDEX idx_invoices_org_status ON invoices(organization_id, status);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_invoices ON invoices
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

CREATE TRIGGER trg_invoices_no_delete
  BEFORE DELETE ON invoices
  FOR EACH ROW EXECUTE FUNCTION guard_no_physical_delete();

-- VOID QAYDASI (Faz 3.9 bənd 15, MÜTLƏQ) trigger-i payment_allocations
-- cədvəli yarandıqdan sonra 031-ci migrationda əlavə olunur (dependency
-- ardıcıllığı: payment_allocations bu migrationdan SONRA yaranır).


CREATE TABLE invoice_items (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  invoice_id      UUID NOT NULL,
  service_id      UUID,
  package_id      UUID,
  description     TEXT,
  quantity        NUMERIC(12,2) NOT NULL DEFAULT 1,
  unit_price      NUMERIC(12,2) NOT NULL,
  amount          NUMERIC(12,2) NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  CHECK (quantity > 0),
  CHECK (unit_price >= 0),
  CHECK (amount >= 0),
  FOREIGN KEY (organization_id, invoice_id)
    REFERENCES invoices (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (organization_id, service_id)
    REFERENCES services (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (organization_id, package_id)
    REFERENCES packages (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX idx_invoice_items_org ON invoice_items(organization_id);
CREATE INDEX idx_invoice_items_org_invoice ON invoice_items(organization_id, invoice_id);

ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_invoice_items ON invoice_items
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);


CREATE TABLE discounts (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  invoice_id      UUID NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('percent','fixed')),
  value           NUMERIC(12,2) NOT NULL,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  CHECK (value > 0),
  FOREIGN KEY (organization_id, invoice_id)
    REFERENCES invoices (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX idx_discounts_org ON discounts(organization_id);
CREATE INDEX idx_discounts_org_invoice ON discounts(organization_id, invoice_id);

ALTER TABLE discounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE discounts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_discounts ON discounts
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

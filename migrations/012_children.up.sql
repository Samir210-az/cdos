-- 012_children
--
-- Sahə mənbəyi: Faz 0-2 Arxitektura Sənədi, bölmə 2.3:
--   "children(id, organization_id 🔒, branch_id, local_code, first_name,
--             last_name, dob, gender, status[active/archived])"
-- Faz 3.1 bənd 12 (Data Lifecycle): children üçün YALNIZ ACTIVE/ARCHIVED —
-- "DELETED" statusu QƏTİ YARADILMIR (klinik sənəd hüquqi baxımdan qorunur).

CREATE TABLE children (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  branch_id       UUID,
  local_code      TEXT NOT NULL,   -- məs. "CH-A-00125" — generasiya application-layer-də (bu fazın scope-u deyil)
  first_name      TEXT NOT NULL,
  last_name       TEXT NOT NULL,
  dob             DATE NOT NULL,
  gender          TEXT,
  status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, local_code),
  FOREIGN KEY (organization_id, branch_id)
    REFERENCES branches (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
    -- branch_id NULL ola bilər (composite FK, MATCH SIMPLE — hər hansı sütun NULL-dursa yoxlanmır)
);

CREATE INDEX idx_children_org ON children(organization_id);
CREATE INDEX idx_children_org_status ON children(organization_id, status);
CREATE INDEX idx_children_org_branch ON children(organization_id, branch_id);

ALTER TABLE children ENABLE ROW LEVEL SECURITY;
ALTER TABLE children FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_children ON children
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- Faz 3.2-dən qalan borc: specialist_child_assignments.child_id indiyə qədər
-- FK-siz idi (children mövcud deyildi). İndi children yarandı — composite FK
-- ƏLAVƏ OLUNUR (Faz 3.3 bənd 7/20 tələbi).
-- ---------------------------------------------------------------------------
ALTER TABLE specialist_child_assignments
  ADD CONSTRAINT fk_assignment_child
  FOREIGN KEY (organization_id, child_id)
  REFERENCES children (organization_id, id)
  ON DELETE RESTRICT ON UPDATE CASCADE;

-- 013_child_guardians_emergency_contacts
--
-- Sahə mənbəyi: Faz 0-2 Arxitektura Sənədi, bölmə 2.3:
--   "child_guardians(id, child_id, parent_id, relation_type, is_primary)"
--   "emergency_contacts(id, child_id, name, relation, phone, priority)"
--
-- QEYD: Faz 3.3 tapşırığında nümunə kimi göstərilən "legal_authority" sahəsi
-- ORİJİNAL Faz 0-2 ERD-də YOXDUR. Bənd 8 açıq şəkildə "yalnız əvvəlki ERD-də
-- nəzərdə tutulan sahələri əlavə et, yeni business logic uydurma" dediyi üçün
-- "legal_authority" BURAYA ƏLAVƏ EDİLMİR (uydurma qadağasına əməl olunur).
-- Əgər lazımdırsa, bu ayrıca, açıq razılaşdırılmış migration kimi əlavə oluna bilər.

CREATE TABLE child_guardians (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  child_id        UUID NOT NULL,
  parent_id       UUID NOT NULL,
  relation_type   TEXT NOT NULL,   -- məs. 'mother','father','legal_guardian' — sərbəst mətn, enum bu fazda tələb olunmayıb
  is_primary      BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, child_id, parent_id),   -- eyni cütlük təkrarlanmır
  FOREIGN KEY (organization_id, child_id)
    REFERENCES children (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (organization_id, parent_id)
    REFERENCES parents (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX idx_child_guardians_org ON child_guardians(organization_id);
CREATE INDEX idx_child_guardians_org_child ON child_guardians(organization_id, child_id);
CREATE INDEX idx_child_guardians_org_parent ON child_guardians(organization_id, parent_id);

ALTER TABLE child_guardians ENABLE ROW LEVEL SECURITY;
ALTER TABLE child_guardians FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_child_guardians ON child_guardians
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);


CREATE TABLE emergency_contacts (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  child_id        UUID NOT NULL,
  name            TEXT NOT NULL,
  relation        TEXT,
  phone           TEXT NOT NULL,
  priority        INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, child_id)
    REFERENCES children (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX idx_emergency_contacts_org ON emergency_contacts(organization_id);
CREATE INDEX idx_emergency_contacts_org_child ON emergency_contacts(organization_id, child_id);

ALTER TABLE emergency_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE emergency_contacts FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_emergency_contacts ON emergency_contacts
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

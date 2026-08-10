-- 011_parents
--
-- Sahə mənbəyi: Faz 0-2 Arxitektura Sənədi, bölmə 2.3 (İnsanlar domeni):
--   "parents(id, organization_id 🔒, user_id, phone, address)"
-- QEYD (şəffaf inferens): orijinal ERD-də parents üçün ayrıca "status" sahəsi
-- göstərilməyib. Sistemdəki bütün digər identity-bağlı tenant entity-lərində
-- (specialists, organization_members) eyni ACTIVE/SUSPENDED/DEACTIVATED
-- lifecycle pattern-i mövcuddur — struktur ardıcıllıq üçün eyni pattern
-- burada da tətbiq olunur (bu, yeni BİZNES QAYDASI deyil, yalnız movcud
-- lifecycle konvensiyasının struktur tətbiqidir).

CREATE TABLE parents (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  phone           TEXT,
  address         TEXT,
  status          TEXT NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE','SUSPENDED','DEACTIVATED')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id)
);

CREATE INDEX idx_parents_org ON parents(organization_id);
CREATE INDEX idx_parents_org_status ON parents(organization_id, status);

ALTER TABLE parents ENABLE ROW LEVEL SECURITY;
ALTER TABLE parents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_parents ON parents
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

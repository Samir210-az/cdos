-- 004_branches
-- İlk tenant cədvəli. RLS EYNİ migration daxilində CREATE TABLE ilə birlikdə aktivləşdirilir
-- (Faz 3.1 Fix#1: RLS heç vaxt sonraya təxirə salınmır).

CREATE TABLE branches (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id)   -- Fix#15: composite tenant FK-lər üçün əsas
);

CREATE INDEX idx_branches_org ON branches(organization_id);
CREATE INDEX idx_branches_org_status ON branches(organization_id, status);

ALTER TABLE branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE branches FORCE ROW LEVEL SECURITY; -- table owner üçün belə tətbiq olunsun (cdos_migrator BYPASSRLS-lə işlədiyi üçün əsl qorunma cdos_app-a aiddir)

CREATE POLICY tenant_isolation_branches ON branches
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

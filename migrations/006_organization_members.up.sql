-- 006_organization_members
-- Tenant membership modelinin əsas cədvəli.
-- KRİTİK (Faz 3.1 Fix#4): scope_type NOT NULL, DEFAULT 'NO_BRANCH' — fail-closed.
-- Heç vaxt "NULL/boş = ALL_BRANCHES" məntiqi yaradılmır.

CREATE TABLE organization_members (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  scope_type      TEXT NOT NULL DEFAULT 'NO_BRANCH'
                  CHECK (scope_type IN ('ALL_BRANCHES','SELECTED_BRANCHES','NO_BRANCH')),
  status          TEXT NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE','SUSPENDED','REMOVED')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  UNIQUE (user_id, organization_id)   -- bir user bir org-da yalnız 1 membership
);

CREATE INDEX idx_org_members_org ON organization_members(organization_id);
CREATE INDEX idx_org_members_org_user ON organization_members(organization_id, user_id);
CREATE INDEX idx_org_members_org_status ON organization_members(organization_id, status);

ALTER TABLE organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_members FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_org_members ON organization_members
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- LOGIN-TIME İSTİSNA (sənədləşdirilmiş, dar əhatəli):
-- Login zamanı (JWT hələ yoxdur => app.current_org hələ məlum deyil) backend
-- istifadəçinin HANSI organization-lara üzv olduğunu bilməlidir ki, JWT-ni
-- düzgün active_organization_id ilə versin. Bu, RLS-i cdos_app üçün YOX,
-- yalnız bu DAR məqsədli SECURITY DEFINER funksiya vasitəsilə həll olunur:
-- funksiya cdos_migrator (BYPASSRLS) sahibliyində işləyir, amma YALNIZ
-- (organization_id, member_id, status) sahələrini qaytarır — heç bir başqa
-- həssas sütun ifşa olunmur. cdos_app-a birbaşa BYPASSRLS verilmir.
-- ---------------------------------------------------------------------------
CREATE FUNCTION find_user_org_memberships(p_user_id UUID)
RETURNS TABLE (organization_id UUID, member_id UUID, status TEXT)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id, id AS member_id, status
  FROM organization_members
  WHERE user_id = p_user_id;
$$;

REVOKE ALL ON FUNCTION find_user_org_memberships(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_user_org_memberships(UUID) TO cdos_app;

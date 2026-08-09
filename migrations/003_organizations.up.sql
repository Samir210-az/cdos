-- 003_organizations
-- "organizations" tenant sərhədinin ROOT entity-sidir — özü organization_id daşımır,
-- ona görə RLS tətbiq olunmur (Faz 3.1: "RLS N/A, platform-level cədvəl").
-- Görünürlük app-layer-də idarə olunur: PLATFORM_ADMIN hamısını görür,
-- adi istifadəçi yalnız öz membership-lərinə uyğun organization(lar)ı görür.

CREATE TABLE organizations (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'ACTIVE'
              CHECK (status IN ('ACTIVE','SUSPENDED','DEACTIVATED')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_organizations_status ON organizations(status);

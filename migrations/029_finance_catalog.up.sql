-- 029_finance_catalog
--
-- Sahə mənbəyi: Faz 3.1 Final Technical Freeze, bölmə C.7 (Finance Engine):
--   services(id, organization_id, name, duration_min, price, color, allowed_specialist_roles)
--   packages(id, organization_id, name, sessions_included, price, validity_days)
--   child_packages(id, child_id, package_id, purchased_at, sessions_remaining, expires_at)
--
-- QEYD: "services" üçün orijinal siyahıda "status" (aktiv/deaktiv) sahəsi
-- YOXDUR — UYDURULMADI. Xidmətin deaktiv edilməsi bu fazın scope-unda deyil
-- (NOT SPECIFIED — NOT IMPLEMENTED, FINAL REPORT-da qeyd olunur).

CREATE TABLE services (
  id                        UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name                      TEXT NOT NULL,
  duration_min              INTEGER,
  price                     NUMERIC(12,2) NOT NULL,
  color                     TEXT,
  allowed_specialist_roles  TEXT[],
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  CHECK (price >= 0)
);
CREATE INDEX idx_services_org ON services(organization_id);

ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE services FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_services ON services
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);


CREATE TABLE packages (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  name            TEXT NOT NULL,
  sessions_included INTEGER NOT NULL,
  price           NUMERIC(12,2) NOT NULL,
  validity_days   INTEGER,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  CHECK (price >= 0),
  CHECK (sessions_included > 0)
);
CREATE INDEX idx_packages_org ON packages(organization_id);

ALTER TABLE packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE packages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_packages ON packages
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);


CREATE TABLE child_packages (
  id                  UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  child_id            UUID NOT NULL,
  package_id          UUID NOT NULL,
  purchased_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  sessions_remaining  INTEGER NOT NULL,
  expires_at          TIMESTAMPTZ,
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  CHECK (sessions_remaining >= 0),
  FOREIGN KEY (organization_id, child_id)
    REFERENCES children (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (organization_id, package_id)
    REFERENCES packages (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX idx_child_packages_org ON child_packages(organization_id);
CREATE INDEX idx_child_packages_org_child ON child_packages(organization_id, child_id);

ALTER TABLE child_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE child_packages FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_child_packages ON child_packages
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

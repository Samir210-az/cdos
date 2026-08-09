-- 009_specialists

CREATE TABLE specialists (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  branch_id       UUID,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  specialization  TEXT,
  status          TEXT NOT NULL DEFAULT 'ACTIVE'
                  CHECK (status IN ('ACTIVE','SUSPENDED','DEACTIVATED')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, user_id),   -- eyni user eyni org-da 2 dəfə specialist kimi qeydə alınmır
  FOREIGN KEY (organization_id, branch_id)
    REFERENCES branches(organization_id, id) ON DELETE RESTRICT
    -- branch_id NULL ola bilər (composite FK, MATCH SIMPLE — hər hansı sütun NULL-dursa yoxlanmır)
);

CREATE INDEX idx_specialists_org ON specialists(organization_id);
CREATE INDEX idx_specialists_org_status ON specialists(organization_id, status);
CREATE INDEX idx_specialists_org_branch ON specialists(organization_id, branch_id);

ALTER TABLE specialists ENABLE ROW LEVEL SECURITY;
ALTER TABLE specialists FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_specialists ON specialists
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

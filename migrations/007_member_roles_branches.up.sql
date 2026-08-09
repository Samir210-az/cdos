-- 007_member_roles_branches
-- Çox-rol və çox-filial dəstəyi. Composite FK-lər (organization_id, ...) ilə
-- cross-tenant əlaqənin DB səviyyəsində mümkün olmaması təmin edilir (Faz 3.1 bənd 15).

CREATE TABLE member_roles (
  organization_id UUID NOT NULL,
  member_id       UUID NOT NULL,
  role_id         UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, role_id),
  FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_member_roles_org ON member_roles(organization_id);
CREATE INDEX idx_member_roles_member ON member_roles(organization_id, member_id);

ALTER TABLE member_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_roles FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_member_roles ON member_roles
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);


CREATE TABLE member_branches (
  organization_id UUID NOT NULL,
  member_id       UUID NOT NULL,
  branch_id       UUID NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (member_id, branch_id),
  FOREIGN KEY (organization_id, member_id)
    REFERENCES organization_members(organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, branch_id)
    REFERENCES branches(organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX idx_member_branches_org ON member_branches(organization_id);
CREATE INDEX idx_member_branches_member ON member_branches(organization_id, member_id);

ALTER TABLE member_branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE member_branches FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_member_branches ON member_branches
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- Tətbiq qaydası (app-layer, DB-də enforce edilmir, servis səviyyəsində yoxlanılır):
-- member_branches yalnız organization_members.scope_type = 'SELECTED_BRANCHES' olduqda
-- authorization scope kimi oxunur. Digər scope_type-larda bu cədvəldə sətir olsa belə
-- authorization resolver-i onu İSTİFADƏ ETMİR (bax src/scope-cache/scope-resolver.ts).

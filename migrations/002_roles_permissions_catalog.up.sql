-- 002_roles_permissions_catalog
-- Rol və icazə kataloqu — platform-level statik istinad datasıdır (organization_id yoxdur, RLS tələb olunmur).

CREATE TABLE roles (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE permissions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code        TEXT NOT NULL UNIQUE,   -- "module.action" formatı
  description TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE role_permissions (
  role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE RESTRICT,
  permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE RESTRICT,
  PRIMARY KEY (role_id, permission_id)
);

-- Faz 3.1-də təsdiqlənmiş 9 rol (adlar dəyişdirilmədən)
INSERT INTO roles (code, name) VALUES
  ('PLATFORM_ADMIN', 'Platform Admin'),
  ('CENTER_OWNER',   'Center Owner'),
  ('CENTER_ADMIN',   'Center Admin'),
  ('BRANCH_ADMIN',   'Branch Admin'),
  ('SUPERVISOR',     'Supervisor'),
  ('SPECIALIST',     'Specialist'),
  ('RECEPTIONIST',   'Receptionist'),
  ('ACCOUNTANT',     'Accountant'),
  ('PARENT',         'Parent');

-- Bu fazın scope-una aid permission-lar + Faz 3.1-in tələb etdiyi
-- gələcək (011+) endpoint-lər üçün kataloqda ƏVVƏLCƏDƏN mövcud olmalı permission-lar
-- (bu fazda müvafiq endpoint-lər YARADILMIR, yalnız kataloqda yer alır).
INSERT INTO permissions (code, description) VALUES
  ('organizations.manage',       'Platform: mərkəzləri idarə et'),
  ('organizations.view',         'Mərkəz məlumatına bax'),
  ('branches.create',            'Filial yarat'),
  ('branches.update',            'Filialı yenilə'),
  ('branches.view',              'Filiallara bax'),
  ('members.invite',             'Üzv dəvət et'),
  ('members.update',             'Üzv məlumatını/rolunu yenilə'),
  ('members.view',               'Üzvlərə bax'),
  ('specialists.manage',         'Mütəxəssisləri idarə et'),
  ('specialists.view',           'Mütəxəssislərə bax'),
  ('assignment.create',          'Mütəxəssis-uşaq təyinatı yarat'),
  ('assignment.end',             'Mütəxəssis-uşaq təyinatını bitir'),
  -- Faz 3.1-də təsdiqlənmiş, gələcək fazlar üçün kataloqda öncədən yer almalı permission-lar:
  ('consent.approve',            '(gələcək) Valideyn tərəfindən consent təsdiqi'),
  ('finance.refund',             '(gələcək) Geri qaytarma əməliyyatı'),
  ('report.revise',              '(gələcək) Hesabatın yeni versiyasını yarat'),
  ('platform.break_glass.request', '(gələcək) Break-glass giriş sorğusu'),
  ('platform.break_glass.approve', '(gələcək) Break-glass sorğusunu təsdiqləmə');

-- Bu fazın minimal rol↔icazə əlaqələndirməsi (yalnız 001–010 scope-una aid olanlar)
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id FROM roles r, permissions p
WHERE (r.code = 'PLATFORM_ADMIN' AND p.code = 'organizations.manage')
   OR (r.code IN ('CENTER_OWNER','CENTER_ADMIN') AND p.code IN
        ('organizations.view','branches.create','branches.update','branches.view',
         'members.invite','members.update','members.view',
         'specialists.manage','specialists.view',
         'assignment.create','assignment.end'))
   OR (r.code = 'BRANCH_ADMIN' AND p.code IN
        ('branches.view','members.view','specialists.view','specialists.manage',
         'assignment.create','assignment.end'))
   OR (r.code = 'SUPERVISOR' AND p.code IN
        ('specialists.view','assignment.create'))
   OR (r.code = 'SPECIALIST' AND p.code IN ('specialists.view'));

-- Least-privilege sərtləşdirmə: kataloq cədvəlləri yalnız migration/admin tərəfindən
-- dəyişdirilir, backend tətbiqi (cdos_app) yalnız OXUYA bilər.
REVOKE INSERT, UPDATE, DELETE ON roles FROM cdos_app;
REVOKE INSERT, UPDATE, DELETE ON permissions FROM cdos_app;
REVOKE INSERT, UPDATE, DELETE ON role_permissions FROM cdos_app;

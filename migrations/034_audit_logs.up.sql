-- 034_audit_logs
--
-- Sahə mənbəyi: Faz 3.1 Final Technical Freeze, bölmə C.10 (Final Audit Model):
--   audit_logs(id, actor_user_id, organization_id, action, target_type, target_id,
--              before(JSONB), after(JSONB), ip_address, user_agent, request_id,
--              result[SUCCESS/DENIED], created_at)
-- + bənd 14 (Faz 3.1) tam hadisə siyahısı (23 element, aşağıda CHECK-də).
--
-- QEYD 1 (append-only mexanizmi): Faz 3.1 bu cədvəl üçün AÇIQ ŞƏKİLDƏ digər
-- ledger cədvəllərindən (trigger-based) FƏRQLİ bir mexanizm göstərib:
-- "DB-də bu cədvələ yalnız INSERT icazəsi verilir; UPDATE/DELETE tətbiq
-- olunan DB rolu üçün bağlanır (Postgres REVOKE UPDATE, DELETE)". Ona görə
-- BURADA trigger YOX, REVOKE istifadə olunur (spesifikasiyaya sadiq qalmaq üçün).
--
-- QEYD 2 (organization_id NULLABLE, texniki zərurət): bəzi hadisələr
-- (LOGIN, LOGIN_FAILED) tenant context TƏYİN OLUNMAZDAN ƏVVƏL baş verir
-- (auth "toyuq-yumurta" problemi, bax migration 006). Ona görə organization_id
-- NULLABLE saxlanılır; RLS "WITH CHECK" bu halı açıq icazə verir, "USING" isə
-- NULL-org sətirləri adi tenant sorğularında GÖRÜNMƏZ saxlayır (yalnız
-- migrator/platform-admin yolu ilə əlçatandır — future PLATFORM_ADMIN UI-nin
-- işi, bu fazın scope-unda deyil).
--
-- QEYD 3 (target_id, polymorphic): 028-ci migrationdakı eyni səbəbdən (bax
-- data_shares) DB FK-siz saxlanılır — tətbiq müxtəlif entity tiplərinə
-- (child/session/assessment/plan/report/document/consent/member/...) istinad
-- edə bilər, Postgres tək sütuna çoxlu-cədvəl FK-ni dəstəkləmir.

CREATE TABLE audit_logs (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE RESTRICT,
  actor_user_id   UUID REFERENCES users(id) ON DELETE RESTRICT,
  action          TEXT NOT NULL CHECK (action IN (
                    'LOGIN','LOGIN_FAILED','LOGOUT','TOKEN_REUSE',
                    'PERMISSION_DENIED','TENANT_ACCESS_DENIED',
                    'CHILD_VIEWED','CHILD_UPDATED',
                    'ASSESSMENT_CREATED','ASSESSMENT_LOCKED',
                    'PLAN_APPROVED','SESSION_LOCKED','SESSION_AMENDED',
                    'AI_GENERATED','AI_APPROVED',
                    'DOCUMENT_VIEWED','DOCUMENT_DOWNLOADED',
                    'CONSENT_GRANTED','CONSENT_REVOKED','DATA_EXPORTED',
                    'MEMBER_ROLE_CHANGED','MEMBER_BRANCH_CHANGED',
                    'BREAK_GLASS_GRANTED','BREAK_GLASS_USED'
                  )),
  target_type     TEXT,
  target_id       UUID,
  before          JSONB,
  after           JSONB,
  ip_address      INET,
  user_agent      TEXT,
  request_id      UUID,
  result          TEXT NOT NULL CHECK (result IN ('SUCCESS','DENIED')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id)
);

CREATE INDEX idx_audit_logs_org ON audit_logs(organization_id);
CREATE INDEX idx_audit_logs_org_created ON audit_logs(organization_id, created_at);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_target ON audit_logs(target_type, target_id);
CREATE INDEX idx_audit_logs_actor ON audit_logs(actor_user_id);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_audit_logs ON audit_logs
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
               OR organization_id IS NULL);

-- APPEND-ONLY (Faz 3.1 QEYD 1-ə uyğun: REVOKE, trigger YOX)
REVOKE UPDATE, DELETE ON audit_logs FROM cdos_app;

-- 028_data_shares
--
-- Sahə mənbəyi: Faz 3.1 Final Technical Freeze, bölmə C.9:
--   data_shares(id, consent_id, entity_type, entity_id, granted_at, revoked_at)
--
-- QEYD (ARCHITECTURE NOTE — "organization_id" texniki əlavəsi): composite-FK
-- invariantı üçün consent_id-dən əlavə birbaşa organization_id sütunu
-- əlavə olunub (007/010/013-dəki eyni presedent).
--
-- QEYD 2 (STRUKTUR MƏHDUDİYYƏTİ, uydurma DEYİL): "entity_id" POLYMORPHIC-dir
-- (entity_type-a görə fərqli cədvəllərə istinad edir: reports/documents/
-- assessment_instances/sessions/development_plans). PostgreSQL polymorphic
-- FK-ni DB səviyyəsində BİRBAŞA dəstəkləmir (bir sütun eyni anda bir neçə
-- fərqli cədvələ FK ola bilməz). Ona görə entity_id-nin mövcudluğu
-- APPLICATION-LAYER-də (data-share.service.ts) entity_type-a uyğun cədvəldə
-- yoxlanılır — DB-də yalnız entity_type whitelist CHECK CONSTRAINT-i var.
-- Bu, layihə boyu qorunan "hər FK composite olmalıdır" qaydasının
-- texniki/strukturel istisnasıdır və FINAL REPORT-da açıq qeyd olunur.
--
-- entity_type whitelist Faz 3.1-in "consents.data_scope" siyahısı ilə EYNİDİR
-- (uydurulmayıb, mövcud sənəddən götürülüb): assessment/reports/documents/
-- development_plan/sessions.

CREATE TABLE data_shares (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  consent_id      UUID NOT NULL,
  entity_type     TEXT NOT NULL CHECK (entity_type IN
                    ('assessment','reports','documents','development_plan','sessions')),
  entity_id       UUID NOT NULL,   -- polymorphic — yuxarı qeydə bax, DB FK-siz
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at      TIMESTAMPTZ,
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, consent_id, entity_type, entity_id),
  FOREIGN KEY (organization_id, consent_id)
    REFERENCES consents (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX idx_data_shares_org ON data_shares(organization_id);
CREATE INDEX idx_data_shares_org_consent ON data_shares(organization_id, consent_id);
CREATE INDEX idx_data_shares_entity ON data_shares(organization_id, entity_type, entity_id);

ALTER TABLE data_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE data_shares FORCE ROW LEVEL SECURITY;
-- consents ilə eyni "iki tərəfli görünürlük" qaydası: consent-in özünün
-- (organization_id VƏ to_organization_id) tərəflərindən hər ikisi görə bilir.
CREATE POLICY tenant_isolation_data_shares ON data_shares
  USING (
    organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
    OR EXISTS (
      SELECT 1 FROM consents c
      WHERE c.organization_id = data_shares.organization_id
        AND c.id = data_shares.consent_id
        AND c.to_organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
    )
  )
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- Tarixi paylaşım qeydi qalır (bənd 17: "Data share avtomatik silinməyə məcbur
-- deyil") — fiziki DELETE qadağandır, yalnız revoked_at ilə "bağlana" bilər.
CREATE TRIGGER trg_data_shares_no_delete
  BEFORE DELETE ON data_shares
  FOR EACH ROW EXECUTE FUNCTION guard_no_physical_delete();

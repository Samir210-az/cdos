-- 027_consents
--
-- Sahə mənbəyi: Faz 3.1 Final Technical Freeze, bölmə C.9 "Final Consent Model":
--   consents(id, child_id, granted_by(parent_id), from_organization_id, to_organization_id,
--            data_scope(TEXT[] — assessment/reports/documents/development_plan/sessions),
--            purpose, start_date, end_date, status[PENDING/ACTIVE/EXPIRED/REVOKED/DECLINED])
--
-- QEYD (ARCHITECTURE NOTE — adlandırma): "from_organization_id" bu layihədəki
-- HƏR cədvəldə istifadə olunan "organization_id" tenant-sütunu ilə EYNİ
-- konsepti daşıyır (uşağın "ev" mərkəzi) — ona görə mövcud konvensiyaya
-- uyğun sadəcə "organization_id" adlandırılıb (composite FK/RLS pattern-i
-- ilə tam uzlaşma üçün), "to_organization_id" isə ayrıca sütun kimi qalır.
-- Bu, YENİ SAHƏ DEYİL, mövcud "from_organization_id" sahəsinin adının
-- repository konvensiyasına uyğunlaşdırılmasıdır.
--
-- QEYD 2 (texniki zərurət): "activated_at"/"revoked_at" orijinal sadə
-- siyahıda ayrıca göstərilməyib, AMMA bu fazın bənd 25-dəki "DƏRHAL
-- revocation" tələbini yoxlamaq üçün MƏCBURİDİR (bənd 6-da da "activation
-- timestamp"/"revocation timestamp" AÇIQ tələb olunur).

-- QEYD 3 (ARCHITECTURE NOTE — bərabər organization_id/to_organization_id):
-- Faz 3.1 C.9 consent modeli konseptual olaraq CROSS-CENTER paylaşım üçün
-- dizayn edilib. Faz 3.8 bənd 18 isə Faz 3.7-dəki "access_policy.parent_visible"
-- müvəqqəti sənəd-görünürlük mexanizmini DƏ eyni consent+data_share modelinə
-- köçürməyi tələb edir — BU HAL ÜÇÜN valideynin öz mərkəzi daxilində bir sənədə
-- baxış icazəsi "özünə-consent" kimi modelləşdirilir (organization_id =
-- to_organization_id). Ona görə "organization_id <> to_organization_id"
-- CHECK-i BURAYA QOYULMUR (əvvəlcə əlavə edilmişdi, təhlil sonrası çıxarıldı) —
-- bu, iki fərqli istifadə halının (cross-center VƏ in-center parent visibility)
-- EYNİ cədvəllə həll edilməsinin nəticəsidir və FINAL REPORT-da ARCHITECTURE
-- NOTE/DEVIATION kimi açıq qeyd olunur.

CREATE TABLE consents (
  id                UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT, -- = "from_organization_id" (uşağın ev mərkəzi)
  to_organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  child_id          UUID NOT NULL,
  granted_by        UUID NOT NULL,   -- parent_id
  data_scope        TEXT[] NOT NULL,
  purpose           TEXT,
  start_date        DATE,
  end_date          DATE,
  status            TEXT NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','ACTIVE','EXPIRED','REVOKED','DECLINED')),
  activated_at      TIMESTAMPTZ,
  revoked_at        TIMESTAMPTZ,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  CHECK (data_scope <@ ARRAY['assessment','reports','documents','development_plan','sessions']::TEXT[]),
  FOREIGN KEY (organization_id, child_id)
    REFERENCES children (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (organization_id, granted_by)
    REFERENCES parents (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX idx_consents_org ON consents(organization_id);
CREATE INDEX idx_consents_org_child ON consents(organization_id, child_id);
CREATE INDEX idx_consents_to_org ON consents(to_organization_id);
CREATE INDEX idx_consents_org_status ON consents(organization_id, status);
-- Cross-org canlı yoxlama üçün əsas sorğu indeksi (bənd 16/22): "to_org, child, status"
CREATE INDEX idx_consents_cross_org_check ON consents(to_organization_id, child_id, status);

ALTER TABLE consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE consents FORCE ROW LEVEL SECURITY;
-- RLS QAYDASI (ARCHITECTURE NOTE): consent İKİ mərkəzə aiddir (source+target).
-- Ona görə policy HƏR İKİSİNƏ görünürlük verir: ya sizin mərkəziniz uşağın
-- evi (organization_id), ya da siz giriş istəyən (to_organization_id) tərəfsiniz.
-- INSERT/UPDATE (WITH CHECK) isə YALNIZ source-org context-də icazəlidir —
-- consent yalnız uşağın öz mərkəzində idarə olunur (parent bu kontekstdə əməliyyat aparır).
CREATE POLICY tenant_isolation_consents ON consents
  USING (
    organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
    OR to_organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid
  )
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- STATE MACHINE (Faz 3.1/3.8 bənd 2/24): yalnız icazəli keçidlər.
-- PENDING → ACTIVE | DECLINED
-- ACTIVE  → REVOKED | EXPIRED
-- Digərləri (REVOKED/DECLINED/EXPIRED-dən çıxış) TERMİNALDİR.
-- ---------------------------------------------------------------------------
CREATE FUNCTION guard_consent_transition() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.child_id <> OLD.child_id OR NEW.organization_id <> OLD.organization_id
     OR NEW.to_organization_id <> OLD.to_organization_id OR NEW.granted_by <> OLD.granted_by THEN
    RAISE EXCEPTION 'Consent: core sahələr dəyişdirilə bilməz';
  END IF;

  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'PENDING' AND NEW.status IN ('ACTIVE','DECLINED')) OR
    (OLD.status = 'ACTIVE'  AND NEW.status IN ('REVOKED','EXPIRED'))
  ) THEN
    RAISE EXCEPTION 'Invalid consent status transition: % -> %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_consent_transition
  BEFORE UPDATE ON consents
  FOR EACH ROW EXECUTE FUNCTION guard_consent_transition();

CREATE TRIGGER trg_consents_no_delete
  BEFORE DELETE ON consents
  FOR EACH ROW EXECUTE FUNCTION guard_no_physical_delete();

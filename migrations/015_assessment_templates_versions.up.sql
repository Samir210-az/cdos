-- 015_assessment_templates_versions
--
-- Sahə mənbəyi: Faz 3 (Blueprint) C.4 + Faz 3.1 CRITICAL FIX #2 (Assessment Engine):
--   assessment_templates(id, organization_id 🔒, specialization, name, status)
--   assessment_template_versions(id, template_id, version_no, status[draft/published/archived], published_at)
--
-- QEYD (composite FK üçün texniki zərurət): orijinal ERD-də
-- assessment_template_versions sətrində "organization_id" ayrıca göstərilməyib
-- (template_id üzərindən transitiv əlaqə nəzərdə tutulub). Lakin Faz 3.1
-- composite-FK invariantı (bax bənd 15) hər tenant-daxili FK-nin
-- (organization_id, id) cütlüyü üzərindən qurulmasını TƏLƏB EDİR. Ona görə
-- organization_id sütunu BURADA DA əlavə olunur — bu, yeni klinik/biznes
-- məlumat DEYİL, yalnız artıq frozen olan tenant-isolation qaydasının
-- texniki icrası üçün zəruri sütundur (eyni presedent 007/010/013-də
-- artıq tətbiq olunub).

CREATE TABLE assessment_templates (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  specialization  TEXT,
  name            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ARCHIVED')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id)
);

CREATE INDEX idx_assessment_templates_org ON assessment_templates(organization_id);
CREATE INDEX idx_assessment_templates_org_status ON assessment_templates(organization_id, status);

ALTER TABLE assessment_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_templates FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_assessment_templates ON assessment_templates
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);


CREATE TABLE assessment_template_versions (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  template_id     UUID NOT NULL,
  version_no      INTEGER NOT NULL,
  status          TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PUBLISHED','ARCHIVED')),
  published_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, template_id, version_no),
  FOREIGN KEY (organization_id, template_id)
    REFERENCES assessment_templates (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK ( status <> 'PUBLISHED' OR published_at IS NOT NULL )
);

CREATE INDEX idx_atv_org ON assessment_template_versions(organization_id);
CREATE INDEX idx_atv_org_template ON assessment_template_versions(organization_id, template_id);
CREATE INDEX idx_atv_org_status ON assessment_template_versions(organization_id, status);

ALTER TABLE assessment_template_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_template_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_atv ON assessment_template_versions
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- PUBLISHED/ARCHIVED version-un immutability-si (Faz 3.4 bənd 4) DB
-- səviyyəsində trigger ilə qorunur: status bir dəfə PUBLISHED-ə keçdikdən
-- sonra strukturu (bu cədvəldəki sətir) DƏYİŞDİRİLƏ BİLMƏZ (yalnız
-- PUBLISHED→ARCHIVED keçidinə icazə verilir, geriyə yox).
CREATE FUNCTION guard_template_version_immutability() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'PUBLISHED' THEN
    IF NEW.status = 'ARCHIVED' THEN
      -- yalnız bu keçidə icazə (digər sahələr dəyişməməlidir)
      IF NEW.template_id <> OLD.template_id OR NEW.version_no <> OLD.version_no
         OR NEW.published_at IS DISTINCT FROM OLD.published_at THEN
        RAISE EXCEPTION 'PUBLISHED template version: yalnız status ARCHIVED-ə keçə bilər, digər sahələr dəyişdirilə bilməz';
      END IF;
      RETURN NEW;
    END IF;
    IF NEW.status = 'PUBLISHED' THEN
      -- heç bir sahə dəyişməməlidir (idempotent no-op halları istisna)
      IF NEW IS DISTINCT FROM OLD THEN
        RAISE EXCEPTION 'PUBLISHED template version dəyişdirilə bilməz';
      END IF;
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'PUBLISHED template version-un statusu yalnız ARCHIVED-ə keçə bilər';
  END IF;
  IF OLD.status = 'ARCHIVED' THEN
    RAISE EXCEPTION 'ARCHIVED template version dəyişdirilə bilməz';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_atv_immutability
  BEFORE UPDATE ON assessment_template_versions
  FOR EACH ROW EXECUTE FUNCTION guard_template_version_immutability();

-- 016_assessment_sections_items_subscales
--
-- Sahə mənbəyi: Faz 3 (Blueprint) C.4:
--   assessment_sections(id, template_version_id, title, order_index)
--   assessment_items(id, section_id, code, label, field_type, options(JSONB), subscale_id, weight)
--   assessment_subscales(id, template_version_id, name, calculation_rule(JSONB))
--
-- QEYD: orijinal ERD-də sahə "order" adlanır — Postgres-də bu rezerv sözdür,
-- ona görə "order_index" istifadə olunur (yalnız texniki adlandırma
-- zərurəti, sahənin mənası dəyişməyib).
-- organization_id sütunu composite-FK invariantı üçün əlavə olunub (015-dəki
-- eyni əsaslandırma, bax həmin faylın qeydi).

CREATE TABLE assessment_subscales (
  id                  UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  template_version_id UUID NOT NULL,
  name                TEXT NOT NULL,
  calculation_rule    JSONB,   -- declarative scoring DSL (whitelist-based, publish-time validasiya olunur)
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, template_version_id)
    REFERENCES assessment_template_versions (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX idx_subscales_org ON assessment_subscales(organization_id);
CREATE INDEX idx_subscales_org_version ON assessment_subscales(organization_id, template_version_id);

ALTER TABLE assessment_subscales ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_subscales FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_subscales ON assessment_subscales
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);


CREATE TABLE assessment_sections (
  id                  UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id     UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  template_version_id UUID NOT NULL,
  title               TEXT NOT NULL,
  order_index         INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, template_version_id)
    REFERENCES assessment_template_versions (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX idx_sections_org ON assessment_sections(organization_id);
CREATE INDEX idx_sections_org_version ON assessment_sections(organization_id, template_version_id);

ALTER TABLE assessment_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_sections FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_sections ON assessment_sections
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);


CREATE TABLE assessment_items (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  section_id      UUID NOT NULL,
  code            TEXT NOT NULL,   -- DSL-in referens verdiyi stabil kod (məs. "Q1")
  label           TEXT NOT NULL,
  field_type      TEXT NOT NULL CHECK (field_type IN
                    ('numeric','scale','boolean','single_select','multi_select','text')),
  options         JSONB,
  subscale_id     UUID,
  weight          NUMERIC,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, section_id)
    REFERENCES assessment_sections (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (organization_id, subscale_id)
    REFERENCES assessment_subscales (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
    -- subscale_id NULL ola bilər (composite FK MATCH SIMPLE — yoxlanmır)
);
CREATE INDEX idx_items_org ON assessment_items(organization_id);
CREATE INDEX idx_items_org_section ON assessment_items(organization_id, section_id);
CREATE INDEX idx_items_org_subscale ON assessment_items(organization_id, subscale_id);

ALTER TABLE assessment_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_items ON assessment_items
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- QEYD: "item.code" template_version daxilində unikal olmalıdır (DSL operand
-- resolution üçün) — bu, cross-table (items→sections→template_version)
-- uniqueness olduğu üçün sadə UNIQUE constraint ilə ifadə edilə bilməz.
-- Faz 3.1 Fix#6 qərarına uyğun olaraq bu, RUNTIME-da yox, PUBLISH-TIME-da
-- application-layer validator tərəfindən yoxlanılır (bax
-- src/modules/assessments/scoring-validator.ts).

-- ---------------------------------------------------------------------------
-- PUBLISHED/ARCHIVED VERSION IMMUTABILITY (Faz 3.4 bənd 4):
-- "Published version-da: item dəyişdirilə bilməz, section dəyişdirilə bilməz,
--  subscale dəyişdirilə bilməz". DB-səviyyəli trigger — application-layer
-- (assertVersionIsDraft) əlavə qat kimi, əsas müdafiə BURADADIR.
-- ---------------------------------------------------------------------------
CREATE FUNCTION guard_published_version_direct_children() RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
  v_version_id UUID;
BEGIN
  v_version_id := COALESCE(NEW.template_version_id, OLD.template_version_id);
  SELECT status INTO v_status FROM assessment_template_versions WHERE id = v_version_id;
  IF v_status IN ('PUBLISHED','ARCHIVED') THEN
    RAISE EXCEPTION 'Template version % statusdadır — struktur (section/subscale) dəyişdirilə/silinə bilməz', v_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_sections_publish_guard
  BEFORE UPDATE OR DELETE ON assessment_sections
  FOR EACH ROW EXECUTE FUNCTION guard_published_version_direct_children();

CREATE TRIGGER trg_subscales_publish_guard
  BEFORE UPDATE OR DELETE ON assessment_subscales
  FOR EACH ROW EXECUTE FUNCTION guard_published_version_direct_children();

CREATE FUNCTION guard_published_version_items() RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
  v_section_id UUID;
BEGIN
  v_section_id := COALESCE(NEW.section_id, OLD.section_id);
  SELECT atv.status INTO v_status
    FROM assessment_sections s
    JOIN assessment_template_versions atv
      ON atv.id = s.template_version_id AND atv.organization_id = s.organization_id
    WHERE s.id = v_section_id;
  IF v_status IN ('PUBLISHED','ARCHIVED') THEN
    RAISE EXCEPTION 'Template version % statusdadır — item dəyişdirilə/silinə bilməz', v_status;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_items_publish_guard
  BEFORE UPDATE OR DELETE ON assessment_items
  FOR EACH ROW EXECUTE FUNCTION guard_published_version_items();

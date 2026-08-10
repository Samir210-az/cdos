-- 017_assessment_instances_answers_results
--
-- Sahə mənbəyi: Faz 3 (Blueprint) C.4:
--   assessment_instances(id, organization_id, child_id, template_version_id, assessor_id,
--                         status[IN_PROGRESS/LOCKED], started_at, locked_at,
--                         corrected_from_instance_id NULLABLE)
--   assessment_answers(id, instance_id, item_id, value(JSONB), answered_at)
--   assessment_results(id, instance_id, subscale_id, raw_score, interpreted_result, calculated_at)
--
-- "assessor_id" — Faz 3 sənədində konkret hansı entity-yə FK olduğu
-- göstərilməyib. Repository-də axtarış: sistemdə klinik qeyd aparan yeganə
-- "mütəxəssis" entity-si "specialists"-dir (bax 009_specialists). Ona görə
-- assessor_id → specialists(organization_id, id) kimi həll edilib (minimal,
-- təhlükəsiz, mövcud pattern-ə əsaslanan qərar — uydurma DEYİL, mövcud
-- entity-yə məntiqi bağlama).

CREATE TABLE assessment_instances (
  id                          UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id             UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  child_id                    UUID NOT NULL,
  template_version_id         UUID NOT NULL,
  assessor_id                 UUID NOT NULL,
  status                      TEXT NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS','LOCKED')),
  started_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  locked_at                   TIMESTAMPTZ,
  corrected_from_instance_id  UUID,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, child_id)
    REFERENCES children (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (organization_id, template_version_id)
    REFERENCES assessment_template_versions (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (organization_id, assessor_id)
    REFERENCES specialists (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (organization_id, corrected_from_instance_id)
    REFERENCES assessment_instances (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  CHECK ( status <> 'LOCKED' OR locked_at IS NOT NULL )
);
CREATE INDEX idx_instances_org ON assessment_instances(organization_id);
CREATE INDEX idx_instances_org_child ON assessment_instances(organization_id, child_id);
CREATE INDEX idx_instances_org_status ON assessment_instances(organization_id, status);

ALTER TABLE assessment_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_instances FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_instances ON assessment_instances
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- LOCKED instance immutability (Faz 3.1/3.4): bir dəfə LOCKED olduqdan sonra
-- əsas sətir HEÇ NƏ ilə dəyişdirilə bilməz (düzəliş = yeni instance,
-- corrected_from_instance_id ilə).
CREATE FUNCTION guard_instance_immutability() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status = 'LOCKED' THEN
    RAISE EXCEPTION 'Assessment instance LOCKED-dir — dəyişdirilə bilməz (düzəliş üçün yeni instance yaradın)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_instance_immutability
  BEFORE UPDATE ON assessment_instances
  FOR EACH ROW EXECUTE FUNCTION guard_instance_immutability();


CREATE TABLE assessment_answers (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  instance_id     UUID NOT NULL,
  item_id         UUID NOT NULL,
  value           JSONB NOT NULL,
  answered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, instance_id, item_id),
  FOREIGN KEY (organization_id, instance_id)
    REFERENCES assessment_instances (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (organization_id, item_id)
    REFERENCES assessment_items (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX idx_answers_org ON assessment_answers(organization_id);
CREATE INDEX idx_answers_org_instance ON assessment_answers(organization_id, instance_id);

ALTER TABLE assessment_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_answers FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_answers ON assessment_answers
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);


CREATE TABLE assessment_results (
  id                 UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id    UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  instance_id        UUID NOT NULL,
  subscale_id        UUID NOT NULL,
  raw_score          NUMERIC NOT NULL,
  interpreted_result TEXT,
  calculated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  UNIQUE (organization_id, instance_id, subscale_id),
  FOREIGN KEY (organization_id, instance_id)
    REFERENCES assessment_instances (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (organization_id, subscale_id)
    REFERENCES assessment_subscales (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX idx_results_org ON assessment_results(organization_id);
CREATE INDEX idx_results_org_instance ON assessment_results(organization_id, instance_id);

ALTER TABLE assessment_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE assessment_results FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_results ON assessment_results
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- answers/results üçün: valid instance LOCKED-dırsa, HEÇ BİR insert/update/delete
-- icazə verilmir (DB-səviyyəli müdafiə, app-layer guard-a əlavə qat).
CREATE FUNCTION guard_locked_instance_children() RETURNS TRIGGER AS $$
DECLARE
  v_status TEXT;
  v_instance_id UUID;
BEGIN
  v_instance_id := COALESCE(NEW.instance_id, OLD.instance_id);
  SELECT status INTO v_status FROM assessment_instances WHERE id = v_instance_id;
  IF v_status = 'LOCKED' THEN
    RAISE EXCEPTION 'Assessment instance LOCKED-dir — answers/results dəyişdirilə/əlavə edilə bilməz';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_answers_lock_guard
  BEFORE INSERT OR UPDATE OR DELETE ON assessment_answers
  FOR EACH ROW EXECUTE FUNCTION guard_locked_instance_children();

CREATE TRIGGER trg_results_lock_guard
  BEFORE UPDATE OR DELETE ON assessment_results
  FOR EACH ROW EXECUTE FUNCTION guard_locked_instance_children();
-- QEYD: results üçün INSERT trigger-ə DAXİL EDİLMİR — çünki nəticələr məhz
-- LOCK əməliyyatının bir hissəsi kimi (eyni transaction daxilində, instance
-- status LOCKED-ə keçdikdən dərhal sonra) yazılır (bax instance.service.ts
-- `lockInstance`). UPDATE/DELETE isə hər zaman qadağandır.

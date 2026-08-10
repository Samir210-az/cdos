-- 018_development_plans
--
-- Sahə mənbəyi: Faz 3 (Blueprint) C.5 + Faz 3.5 bənd 2/4/6 (bu fazın özü):
--   development_plans(id, organization_id, child_id, parent_plan_id NULLABLE,
--                      version_no, status, created_by, approved_by, created_at)
--
-- QEYD (status set uzlaşdırılması — ARCHITECTURE NOTE, GAP deyil):
-- Faz 3 (Blueprint) sənədində status seti 7 mərhələli idi
-- (AI_DRAFT/SPECIALIST_REVIEWED/APPROVED/ACTIVE/PAUSED/COMPLETED/ARCHIVED).
-- Bu fazın (Faz 3.5) bənd 6-sı isə DƏQİQ 8 keçidi olan 6 statuslu state
-- machine təyin edir: AI_DRAFT→REVIEWED→ACTIVE→PAUSED/COMPLETED→ARCHIVED.
-- Faz 3.5 bu fazın CARİ, daha spesifik icra təlimatı olduğu üçün BU sənəddəki
-- dəqiq status/keçid siyahısına əməl olunur (SPECIALIST_REVIEWED+APPROVED
-- konseptual olaraq "REVIEWED"-də birləşdirilib). Bu, FINAL REPORT-da
-- ARCHITECTURE NOTE kimi açıq qeyd olunur.
--
-- "source_assessment_instance_id" (bənd 9): freeze sənədində konkret sütun adı
-- verilməyib, YALNIZ konsepsiya təsvir olunub ("Assessment Result → Development
-- Plan" əlaqəsi mövcud assessment entity-sinə reference ilə). Bu, YENİ klinik
-- SAHƏ deyil — mövcud assessment_instances entity-sinə edilən texniki
-- reference-dir, composite FK ilə, NULLABLE (məcburi deyil).

CREATE TABLE development_plans (
  id                            UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id               UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  child_id                      UUID NOT NULL,
  parent_plan_id                UUID,
  source_assessment_instance_id UUID,
  version_no                    INTEGER NOT NULL DEFAULT 1,
  status                        TEXT NOT NULL DEFAULT 'AI_DRAFT'
                                 CHECK (status IN ('AI_DRAFT','REVIEWED','ACTIVE','PAUSED','COMPLETED','ARCHIVED')),
  created_by                    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by                   UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                    TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  CHECK (parent_plan_id IS NULL OR parent_plan_id <> id),
  FOREIGN KEY (organization_id, child_id)
    REFERENCES children (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (organization_id, parent_plan_id)
    REFERENCES development_plans (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (organization_id, source_assessment_instance_id)
    REFERENCES assessment_instances (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX idx_plans_org ON development_plans(organization_id);
CREATE INDEX idx_plans_org_child ON development_plans(organization_id, child_id);
CREATE INDEX idx_plans_org_status ON development_plans(organization_id, status);
CREATE INDEX idx_plans_org_parent ON development_plans(organization_id, parent_plan_id);

ALTER TABLE development_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE development_plans FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_plans ON development_plans
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- STATE MACHINE GUARD (Faz 3.5 bənd 6/12): yalnız icazəli keçidlər;
-- ARCHIVED/COMPLETED-in "core" sahələri (child_id/parent_plan_id/version_no)
-- heç bir halda dəyişmir.
-- ---------------------------------------------------------------------------
CREATE FUNCTION guard_plan_transition() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.child_id <> OLD.child_id
     OR NEW.parent_plan_id IS DISTINCT FROM OLD.parent_plan_id
     OR NEW.version_no <> OLD.version_no
     OR NEW.organization_id <> OLD.organization_id THEN
    RAISE EXCEPTION 'Development plan: core sahələr (child_id/parent_plan_id/version_no/organization_id) heç vaxt dəyişdirilə bilməz';
  END IF;

  IF NEW.status = OLD.status THEN
    RETURN NEW; -- digər sahələrin (approved_by və s.) yenilənməsinə icazə
  END IF;

  IF NOT (
    (OLD.status = 'AI_DRAFT'   AND NEW.status = 'REVIEWED') OR
    (OLD.status = 'REVIEWED'   AND NEW.status = 'ACTIVE')   OR
    (OLD.status = 'ACTIVE'     AND NEW.status IN ('PAUSED','COMPLETED')) OR
    (OLD.status = 'PAUSED'     AND NEW.status IN ('ACTIVE','COMPLETED','ARCHIVED')) OR
    (OLD.status = 'COMPLETED'  AND NEW.status = 'ARCHIVED')
  ) THEN
    RAISE EXCEPTION 'Invalid development plan status transition: % -> %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_plan_transition
  BEFORE UPDATE ON development_plans
  FOR EACH ROW EXECUTE FUNCTION guard_plan_transition();

-- Fiziki DELETE qadağası (klinik məlumat) — bütün rollar üçün (trigger role-dan asılı olmayaraq işləyir)
CREATE FUNCTION guard_no_physical_delete() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% cədvəlində fiziki DELETE qadağandır (klinik məlumat — lifecycle/status istifadə edin)', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_plans_no_delete
  BEFORE DELETE ON development_plans
  FOR EACH ROW EXECUTE FUNCTION guard_no_physical_delete();

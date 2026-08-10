-- 019_goals
--
-- Sahə mənbəyi: Faz 3 (Blueprint) C.5:
--   goals(id, plan_id, domain_id, title, metric_type, baseline_value(JSONB),
--         target_value(JSONB), measurement_method, responsible_specialist_id, status)
--
-- QEYD (ARCHITECTURE GAP): "domain_id" freeze sənədində "development_domains"
-- adlı entity-yə istinad edir, AMMA bu entity heç bir migrationda (001-018)
-- YARADILMAYIB — Faz 0-2 sənədində konseptual olaraq qeyd olunub, lakin
-- rəsmi ERD/migration siyahısına daxil edilməyib. Bu fazın təlimatına görə
-- (bənd 4: "field freeze olunmuş mənbədə yoxdursa UYDURMA") yeni
-- "development_domains" cədvəli BURADA YARADILMIR. domain_id sütunu
-- saxlanılır (sahənin adı ERD-də var), AMMA FK CONSTRAINT-SİZ, NULLABLE
-- saxlanılır. Bu, FINAL REPORT-da ARCHITECTURE GAP kimi açıq qeyd olunur —
-- development_domains gələcək fazda əlavə edilməli və composite FK sonra
-- tamamlanmalıdır (eynilə specialist_child_assignments.child_id-nin Faz
-- 3.2→3.3 keçidində necə tamamlandığı kimi).

CREATE TABLE goals (
  id                        UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  plan_id                   UUID NOT NULL,
  domain_id                 UUID,   -- ARCHITECTURE GAP: development_domains yoxdur, FK-siz (yuxarı qeydə bax)
  title                     TEXT NOT NULL,
  metric_type               TEXT NOT NULL CHECK (metric_type IN
                             ('numeric','percentage','frequency','duration','binary','rating','rubric','custom')),
  baseline_value            JSONB,
  target_value              JSONB,
  measurement_method        TEXT,
  responsible_specialist_id UUID,
  status                    TEXT NOT NULL DEFAULT 'ACTIVE'
                             CHECK (status IN ('ACTIVE','COMPLETED','PAUSED','MODIFIED','CANCELLED')),
  created_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at                TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, plan_id)
    REFERENCES development_plans (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (organization_id, responsible_specialist_id)
    REFERENCES specialists (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX idx_goals_org ON goals(organization_id);
CREATE INDEX idx_goals_org_plan ON goals(organization_id, plan_id);
CREATE INDEX idx_goals_org_status ON goals(organization_id, status);
CREATE INDEX idx_goals_org_specialist ON goals(organization_id, responsible_specialist_id);

ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE goals FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_goals ON goals
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- Lifecycle-only dəyişiklik: status keçidi sərbəstdir (freeze-də konkret state
-- machine göstərilməyib, Faz 3.1-in "goal.status: ACTIVE/COMPLETED/PAUSED/
-- MODIFIED/CANCELLED" siyahısı sadə statuslardır, ardıcıllıq tələbi yoxdur) —
-- AMMA "core" sahələr (plan_id) dəyişməz qalmalıdır.
CREATE FUNCTION guard_goal_core_fields() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.plan_id <> OLD.plan_id OR NEW.organization_id <> OLD.organization_id THEN
    RAISE EXCEPTION 'Goal: plan_id/organization_id dəyişdirilə bilməz';
  END IF;
  IF OLD.status IN ('CANCELLED') AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'CANCELLED goal statusu dəyişdirilə bilməz';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_goal_core_guard
  BEFORE UPDATE ON goals
  FOR EACH ROW EXECUTE FUNCTION guard_goal_core_fields();

CREATE TRIGGER trg_goals_no_delete
  BEFORE DELETE ON goals
  FOR EACH ROW EXECUTE FUNCTION guard_no_physical_delete();

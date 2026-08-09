-- 010_specialist_child_assignments
--
-- QEYD (forward-dependency həlli — Faz 3.2 tələbi):
-- "children" cədvəli BU FAZDA hələ yaradılmayıb (011+ migration-ların işidir).
-- Ona görə child_id sütunu bu migrationda FK OLMADAN yaradılır.
-- Composite FK (organization_id, child_id) -> children(organization_id, id)
-- "children" cədvəlini yaradan gələcək migration daxilində ALTER TABLE ilə
-- ƏLAVƏ OLUNACAQ (məs. 0XX_children.up.sql sonunda). Bu, FINAL invariantı
-- (composite tenant FK, cross-tenant əlaqənin DB səviyyəsində mümkünsüzlüyü)
-- pozmur — yalnız icra ardıcıllığını düzgün idarə edir.
--
-- specialist_id üçün composite FK dərhal qoyulur, çünki "specialists" artıq (009) mövcuddur.

CREATE TABLE specialist_child_assignments (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  specialist_id   UUID NOT NULL,
  child_id        UUID NOT NULL,   -- FK gələcək children migration-da əlavə olunacaq (yuxarıdakı qeydə bax)
  assigned_by     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  assigned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ended_at        TIMESTAMPTZ,
  status          TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','ENDED')),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, specialist_id)
    REFERENCES specialists(organization_id, id) ON DELETE RESTRICT,
  CHECK ( (status = 'ACTIVE' AND ended_at IS NULL) OR (status = 'ENDED' AND ended_at IS NOT NULL) )
);

-- Faz 3.1 tələbi: eyni specialist+child üçün 2 ACTIVE assignment mümkün olmamalıdır
CREATE UNIQUE INDEX uq_active_specialist_child_assignment
  ON specialist_child_assignments (specialist_id, child_id)
  WHERE status = 'ACTIVE';

CREATE INDEX idx_assignments_org ON specialist_child_assignments(organization_id);
CREATE INDEX idx_assignments_org_specialist ON specialist_child_assignments(organization_id, specialist_id);
CREATE INDEX idx_assignments_org_child ON specialist_child_assignments(organization_id, child_id);

ALTER TABLE specialist_child_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE specialist_child_assignments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_assignments ON specialist_child_assignments
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

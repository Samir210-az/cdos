-- 021_sessions
--
-- Sahə mənbəyi: Faz 3 (Blueprint) C.6:
--   sessions(id, organization_id, child_id, specialist_id, appointment_id, goal_ids(UUID[]),
--            observation, intervention, result, difficulty, next_step, home_activity,
--            duration_min, status[DRAFT/IN_PROGRESS/COMPLETED/LOCKED], locked_at)
--   session_amendments(id, session_id, editor_id, previous_data(JSONB), new_data(JSONB), reason, created_at)
--
-- QEYD 1 (texniki zərurət, YENİ SAHƏ DEYİL): orijinal ERD-də "goal_ids(UUID[])"
-- massiv sütun kimi təsvir olunub. Postgres massiv sütunlara FK CONSTRAINT
-- QOYA BİLMİR. Faz 3.6 bənd 8 composite FK-ni məcburi tələb etdiyi üçün,
-- massiv sütun ƏVƏZİNƏ "session_goals" junction cədvəli (022-ci migration)
-- istifadə olunur — eyni many-to-many semantikanı saxlayır, composite FK-ni
-- mümkün edir. Bu, "order"→"order_index" (016-cı migrationda) presedentinə
-- bənzər struktur adaptasiyasıdır, yeni biznes məlumatı DEYİL.
--
-- QEYD 2 (ARCHITECTURE GAP): "appointment_id" freeze-də mövcuddur, AMMA
-- "appointments" cədvəli heç vaxt migrate edilməyib (calendar modulu bu
-- fazların heç birində qurulmayıb). Sütun saxlanılır (adı ERD-də var),
-- FK-SİZ, NULLABLE. GAP kimi FINAL REPORT-da qeyd olunur.
--
-- QEYD 3 (texniki zərurət): "completed_at" sütunu orijinal ERD-də yox idi,
-- AMMA Faz 3.6 bənd 12 məhz bu formulla 48-saatlıq avtomatik lock tələb edir:
--   "now >= completed_at + lock_hours". Bu hesablama üçün completed_at
-- vaxt damğası MƏCBURİDİR — bu, klinik/biznes sahəsi deyil, bu fazın öz
-- tələb etdiyi hesablamanın texniki əsasıdır.

CREATE TABLE sessions (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  child_id        UUID NOT NULL,
  specialist_id   UUID NOT NULL,
  appointment_id  UUID,   -- ARCHITECTURE GAP: "appointments" cədvəli yoxdur, FK-siz (yuxarı qeydə bax)
  observation     TEXT,
  intervention    TEXT,
  result          TEXT,
  difficulty      TEXT,
  next_step       TEXT,
  home_activity   TEXT,
  duration_min    INTEGER,
  status          TEXT NOT NULL DEFAULT 'DRAFT'
                  CHECK (status IN ('DRAFT','IN_PROGRESS','COMPLETED','LOCKED')),
  completed_at    TIMESTAMPTZ,
  locked_at       TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  CHECK (status <> 'COMPLETED' AND status <> 'LOCKED' OR completed_at IS NOT NULL),
  CHECK (status <> 'LOCKED' OR locked_at IS NOT NULL),
  FOREIGN KEY (organization_id, child_id)
    REFERENCES children (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (organization_id, specialist_id)
    REFERENCES specialists (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX idx_sessions_org ON sessions(organization_id);
CREATE INDEX idx_sessions_org_child ON sessions(organization_id, child_id);
CREATE INDEX idx_sessions_org_specialist ON sessions(organization_id, specialist_id);
CREATE INDEX idx_sessions_org_status ON sessions(organization_id, status);
-- 48-saatlıq avtomatik lock job-u üçün: COMPLETED sessiyaları tez tapmaq
CREATE INDEX idx_sessions_lock_candidates ON sessions(organization_id, completed_at) WHERE status = 'COMPLETED';

ALTER TABLE sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_sessions ON sessions
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- LIFECYCLE GUARD (Faz 3.6 bənd 11): yalnız DRAFT→IN_PROGRESS→COMPLETED→LOCKED
-- (freeze-də başqa keçid göstərilməyib). LOCKED-dən geri qayıtmaq QƏTİ qadağan.
-- ---------------------------------------------------------------------------
CREATE FUNCTION guard_session_transition() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.child_id <> OLD.child_id OR NEW.specialist_id <> OLD.specialist_id
     OR NEW.organization_id <> OLD.organization_id THEN
    RAISE EXCEPTION 'Session: core sahələr (child_id/specialist_id/organization_id) dəyişdirilə bilməz';
  END IF;

  IF OLD.status = 'LOCKED' THEN
    RAISE EXCEPTION 'Session LOCKED-dir — dəyişdirilə bilməz (düzəliş üçün session_amendments istifadə edin)';
  END IF;

  IF NEW.status = OLD.status THEN
    RETURN NEW; -- LOCKED-dən əvvəl digər sahələrin (observation və s.) yenilənməsinə icazə
  END IF;

  IF NOT (
    (OLD.status = 'DRAFT'       AND NEW.status = 'IN_PROGRESS') OR
    (OLD.status = 'IN_PROGRESS' AND NEW.status = 'COMPLETED')   OR
    (OLD.status = 'COMPLETED'   AND NEW.status = 'LOCKED')
  ) THEN
    RAISE EXCEPTION 'Invalid session status transition: % -> %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_session_transition
  BEFORE UPDATE ON sessions
  FOR EACH ROW EXECUTE FUNCTION guard_session_transition();

CREATE TRIGGER trg_sessions_no_delete
  BEFORE DELETE ON sessions
  FOR EACH ROW EXECUTE FUNCTION guard_no_physical_delete();


CREATE TABLE session_amendments (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  session_id      UUID NOT NULL,
  editor_id       UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  previous_data   JSONB NOT NULL,
  new_data        JSONB NOT NULL,
  reason          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, session_id)
    REFERENCES sessions (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX idx_amendments_org ON session_amendments(organization_id);
CREATE INDEX idx_amendments_org_session ON session_amendments(organization_id, session_id);

ALTER TABLE session_amendments ENABLE ROW LEVEL SECURITY;
ALTER TABLE session_amendments FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_amendments ON session_amendments
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- Amendment append-only tarixi qeyddir (goal_measurements-dəki eyni pattern)
CREATE TRIGGER trg_amendments_no_update
  BEFORE UPDATE ON session_amendments
  FOR EACH ROW EXECUTE FUNCTION guard_no_update();

CREATE TRIGGER trg_amendments_no_delete
  BEFORE DELETE ON session_amendments
  FOR EACH ROW EXECUTE FUNCTION guard_no_physical_delete();

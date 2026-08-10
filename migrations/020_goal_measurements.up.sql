-- 020_goal_measurements
--
-- Sahə mənbəyi: Faz 3 (Blueprint) C.5:
--   goal_measurements(id, goal_id, session_id NULLABLE, value(JSONB), measured_at, recorded_by)
--
-- QEYD (DEFERRED, GAP deyil): "session_id" freeze sənədində "sessions"
-- entity-sinə istinad edir. Faz 3.5 bu fazın QADAĞAN siyahısında AÇIQ ŞƏKİLDƏ
-- "Sessions... modullarını yaratma" deyir. Ona görə session_id sütunu
-- saxlanılır (NULLABLE, freeze-də belə idi), lakin FK CONSTRAINT-SİZ —
-- sessions cədvəli mövcud olmadığı üçün. Sessions modulu gələcək fazda
-- yaradıldıqda composite FK əlavə olunmalıdır (children FK-nin 3.2→3.3
-- keçidində tamamlandığı presedentə uyğun).

CREATE TABLE goal_measurements (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  goal_id         UUID NOT NULL,
  session_id      UUID,   -- DEFERRED: sessions cədvəli bu fazda yoxdur, FK-siz (yuxarı qeydə bax)
  value           JSONB NOT NULL,
  measured_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  recorded_by     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, goal_id)
    REFERENCES goals (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX idx_measurements_org ON goal_measurements(organization_id);
CREATE INDEX idx_measurements_org_goal ON goal_measurements(organization_id, goal_id);

ALTER TABLE goal_measurements ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_measurements FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_measurements ON goal_measurements
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- Ölçmə tarixi məlumatdır — dəyişdirilmir, yalnız əlavə olunur (append-only).
CREATE FUNCTION guard_no_update() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION '% cədvəlində UPDATE qadağandır (append-only tarixi qeyd)', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_measurements_no_update
  BEFORE UPDATE ON goal_measurements
  FOR EACH ROW EXECUTE FUNCTION guard_no_update();

CREATE TRIGGER trg_measurements_no_delete
  BEFORE DELETE ON goal_measurements
  FOR EACH ROW EXECUTE FUNCTION guard_no_physical_delete();

-- 024_reports
--
-- Sahə mənbəyi: Faz 3 (Blueprint) C entity siyahısı + Faz 3.1 bənd 13
-- (Immutability Rules — "APPROVED report: parent_report_id ilə versiyalama"):
--   reports(id, organization_id, child_id, period_start, period_end,
--           content(JSONB), status[AI_DRAFT/SPECIALIST_REVIEWED/APPROVED], approved_by)
--   + parent_report_id (Faz 3.1 bənd 13-də əlavə edilmiş versiyalama sahəsi)
--
-- QEYD (ARCHITECTURE NOTE): "created_by" sütunu orijinal siyahıda ayrıca
-- göstərilməyib, AMMA layihədəki BÜTÜN digər klinik entity-lərdə (plans,
-- goals, sessions) eyni "kim yaratdı" pattern-i mövcuddur — struktur
-- ardıcıllıq üçün əlavə olunub (development_plans.created_by presedentinə
-- uyğun), yeni klinik sahə DEYİL.
--
-- QEYD: report üçün session_id/plan_id/assessment_instance_id kimi əlavə
-- reference-lər orijinal ERD-də YOXDUR — bənd 9 tələbinə uyğun olaraq
-- UYDURULMADI, əlavə edilmədi.

CREATE TABLE reports (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  child_id        UUID NOT NULL,
  parent_report_id UUID,
  period_start    DATE,
  period_end      DATE,
  content         JSONB,
  status          TEXT NOT NULL DEFAULT 'AI_DRAFT'
                  CHECK (status IN ('AI_DRAFT','SPECIALIST_REVIEWED','APPROVED')),
  created_by      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  approved_by     UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  CHECK (parent_report_id IS NULL OR parent_report_id <> id),
  FOREIGN KEY (organization_id, child_id)
    REFERENCES children (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE,
  FOREIGN KEY (organization_id, parent_report_id)
    REFERENCES reports (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX idx_reports_org ON reports(organization_id);
CREATE INDEX idx_reports_org_child ON reports(organization_id, child_id);
CREATE INDEX idx_reports_org_status ON reports(organization_id, status);
CREATE INDEX idx_reports_org_parent ON reports(organization_id, parent_report_id);

ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_reports ON reports
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- IMMUTABILITY (Faz 3.1 bənd 13 / Faz 3.7 bənd 5-6): APPROVED report tam
-- dəyişməzdir (heç bir sahə, o cümlədən status). Düzəliş = yeni report sətri.
-- Keçidlər: AI_DRAFT → SPECIALIST_REVIEWED → APPROVED (freeze-də başqa
-- keçid göstərilməyib).
-- ---------------------------------------------------------------------------
CREATE FUNCTION guard_report_transition() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.child_id <> OLD.child_id
     OR NEW.organization_id <> OLD.organization_id
     OR NEW.parent_report_id IS DISTINCT FROM OLD.parent_report_id THEN
    RAISE EXCEPTION 'Report: core sahələr (child_id/parent_report_id/organization_id) dəyişdirilə bilməz';
  END IF;

  IF OLD.status = 'APPROVED' THEN
    RAISE EXCEPTION 'APPROVED report dəyişdirilə bilməz (düzəliş üçün yeni versiya — parent_report_id ilə — yaradın)';
  END IF;

  IF NEW.status = OLD.status THEN
    RETURN NEW; -- content və s. sahələrin APPROVED-a qədər yenilənməsinə icazə
  END IF;

  IF NOT (
    (OLD.status = 'AI_DRAFT'             AND NEW.status = 'SPECIALIST_REVIEWED') OR
    (OLD.status = 'SPECIALIST_REVIEWED'  AND NEW.status = 'APPROVED')
  ) THEN
    RAISE EXCEPTION 'Invalid report status transition: % -> %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_report_transition
  BEFORE UPDATE ON reports
  FOR EACH ROW EXECUTE FUNCTION guard_report_transition();

CREATE TRIGGER trg_reports_no_delete
  BEFORE DELETE ON reports
  FOR EACH ROW EXECUTE FUNCTION guard_no_physical_delete();

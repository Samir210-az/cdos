-- 035_ai_generations
--
-- Sahə mənbəyi: Faz 3.1 Final Technical Freeze, bölmə C.11 (Final AI Model) +
-- CRITICAL FIX #5 (AI Grounding):
--   ai_generations(id, organization_id, use_case, model_version, prompt_version,
--                  input_snapshot(JSONB), output(JSONB),
--                  status[DRAFT/FLAGGED/REVIEWED/APPROVED/REJECTED],
--                  requested_by, reviewed_by, created_at)
--   ai_generation_claims(id, generation_id, claim_text,
--                        source_type[assessment/session/goal/plan/report],
--                        source_id, source_field)
--
-- QEYD 1 (texniki əlavə, YENİ KLİNİK SAHƏ DEYİL): "child_id" orijinal sadə
-- siyahıda ayrıca göstərilməyib (input_snapshot JSONB daxilində nəzərdə
-- tutulub), AMMA authorization (specialist assignment, parent scope) VƏ
-- composite-FK tenant təhlükəsizliyi ÜÇÜN bu sütun BİRBAŞA lazımdır — Faz
-- 3.1-in özünün "AI context builder authorization-u bypass edə bilməz"
-- prinsipini DB səviyyəsində icra etmək üçün zəruri struktur əlaqədir.
--
-- QEYD 2: use_case dəyərləri Faz 3.1 F.2-də sadalanan 7 use-case-dən
-- GÖTÜRÜLÜB (uydurulmayıb): development plan draft, goal suggestion,
-- session summary draft, case summary, progress report draft,
-- parent-friendly summary, home activity suggestion.
--
-- QEYD 3: status seti Faz 3.1 CRITICAL FIX #5-dəki YENİLƏNMİŞ (5-statuslu)
-- versiyadır: DRAFT → FLAGGED (safety uğursuz) → REVIEWED → APPROVED/REJECTED.

CREATE TABLE ai_generations (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  child_id        UUID NOT NULL,
  use_case        TEXT NOT NULL CHECK (use_case IN (
                    'development_plan_draft','goal_suggestion','session_summary_draft',
                    'case_summary','progress_report_draft','parent_friendly_summary',
                    'home_activity_suggestion'
                  )),
  model_version   TEXT NOT NULL,
  prompt_version  TEXT NOT NULL,
  input_snapshot  JSONB NOT NULL,
  output          JSONB,
  status          TEXT NOT NULL DEFAULT 'DRAFT'
                  CHECK (status IN ('DRAFT','FLAGGED','REVIEWED','APPROVED','REJECTED')),
  requested_by    UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  reviewed_by     UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, child_id)
    REFERENCES children (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX idx_ai_generations_org ON ai_generations(organization_id);
CREATE INDEX idx_ai_generations_org_child ON ai_generations(organization_id, child_id);
CREATE INDEX idx_ai_generations_org_status ON ai_generations(organization_id, status);

ALTER TABLE ai_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_generations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_ai_generations ON ai_generations
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- ---------------------------------------------------------------------------
-- STATE MACHINE + CORE-FIELD IMMUTABILITY (Faz 3.1 Fix#5):
-- DRAFT → FLAGGED | REVIEWED ; FLAGGED → REVIEWED | REJECTED ; REVIEWED → APPROVED | REJECTED.
-- input_snapshot/output/child_id/use_case bir dəfə yazıldıqdan sonra dəyişmir
-- (generation nəticəsi immutable-dır — AI "mövcud məlumatları dəyişməməlidir").
-- ---------------------------------------------------------------------------
CREATE FUNCTION guard_ai_generation_transition() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.child_id <> OLD.child_id OR NEW.organization_id <> OLD.organization_id
     OR NEW.use_case <> OLD.use_case
     OR NEW.input_snapshot IS DISTINCT FROM OLD.input_snapshot
     OR NEW.output IS DISTINCT FROM OLD.output THEN
    RAISE EXCEPTION 'ai_generations: core sahələr (child_id/use_case/input_snapshot/output) dəyişdirilə bilməz';
  END IF;

  IF OLD.status IN ('APPROVED','REJECTED') THEN
    RAISE EXCEPTION 'ai_generations: % statusu terminaldır, dəyişdirilə bilməz', OLD.status;
  END IF;

  IF NEW.status = OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'DRAFT'    AND NEW.status IN ('FLAGGED','REVIEWED')) OR
    (OLD.status = 'FLAGGED'  AND NEW.status IN ('REVIEWED','REJECTED')) OR
    (OLD.status = 'REVIEWED' AND NEW.status IN ('APPROVED','REJECTED'))
  ) THEN
    RAISE EXCEPTION 'Invalid ai_generations status transition: % -> %', OLD.status, NEW.status;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ai_generation_transition
  BEFORE UPDATE ON ai_generations
  FOR EACH ROW EXECUTE FUNCTION guard_ai_generation_transition();

CREATE TRIGGER trg_ai_generations_no_delete
  BEFORE DELETE ON ai_generations
  FOR EACH ROW EXECUTE FUNCTION guard_no_physical_delete();


CREATE TABLE ai_generation_claims (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL,
  generation_id   UUID NOT NULL,
  claim_text      TEXT NOT NULL,
  source_type     TEXT NOT NULL CHECK (source_type IN ('assessment','session','goal','plan','report')),
  source_id       UUID NOT NULL,   -- polymorphic, DB FK-siz (028/034-dəki eyni presedent)
  source_field    TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, generation_id)
    REFERENCES ai_generations (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX idx_ai_claims_org ON ai_generation_claims(organization_id);
CREATE INDEX idx_ai_claims_org_generation ON ai_generation_claims(organization_id, generation_id);

ALTER TABLE ai_generation_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_generation_claims FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_ai_claims ON ai_generation_claims
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- Append-only (claim-lər generation ilə birlikdə yaradılır, sonradan dəyişmir)
CREATE TRIGGER trg_ai_claims_no_update
  BEFORE UPDATE ON ai_generation_claims
  FOR EACH ROW EXECUTE FUNCTION guard_no_update();
CREATE TRIGGER trg_ai_claims_no_delete
  BEFORE DELETE ON ai_generation_claims
  FOR EACH ROW EXECUTE FUNCTION guard_no_physical_delete();

-- 014_children_clinical_profiles
--
-- Sahə mənbəyi: Faz 3 (Audit/Blueprint) sənədi, bölmə C.3 "Children — klinik
-- domen (genişləndirilmiş)". Orijinal ERD bu profili 6 AYRI cədvəl kimi
-- müəyyən edib (hər biri öz sahəsinə uyğun mütəxəssis üçün, axtarış/filter
-- imkanı üçün — "hamısı JSONB" anti-pattern-dən qaçmaq məqsədilə). Faz 3.3
-- tapşırığındakı "014_children_clinical_profiles" tək migration ADI, 007-ci
-- migration-dakı presedentə uyğun olaraq (member_roles+member_branches bir
-- faylda), BURADA 6 cədvəli EYNİ FAYLDA yaradır — bu, ERD-ni dəyişmir,
-- yalnız fayl təşkilatlanmasıdır.
--
-- Faz 3-dəki dəqiq sahələr (uydurulmayıb, mövcud sənəddən köçürülüb):
--   medical_background(id, child_id, allergies, medications(JSONB), conditions(JSONB), notes, updated_by, updated_at)
--   developmental_history(id, child_id, milestones(JSONB), notes)
--   communication_profile(id, child_id, primary_language, communication_method, notes)
--   behavior_profile(id, child_id, triggers(JSONB), calming_strategies(JSONB), notes)
--   sensory_profile(id, child_id, sensitivities(JSONB), notes)
--   educational_info(id, child_id, school_name, grade, iep_status, notes)
--
-- Bənd 12 tələbi: 1:1 münasibət — UNIQUE(organization_id, child_id) hər cədvəldə.

CREATE TABLE medical_background (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  child_id        UUID NOT NULL,
  allergies       TEXT,
  medications     JSONB,
  conditions      JSONB,
  notes           TEXT,
  updated_by      UUID REFERENCES users(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, child_id),
  FOREIGN KEY (organization_id, child_id)
    REFERENCES children (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
ALTER TABLE medical_background ENABLE ROW LEVEL SECURITY;
ALTER TABLE medical_background FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_medical_background ON medical_background
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);


CREATE TABLE developmental_history (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  child_id        UUID NOT NULL,
  milestones      JSONB,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, child_id),
  FOREIGN KEY (organization_id, child_id)
    REFERENCES children (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
ALTER TABLE developmental_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE developmental_history FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_developmental_history ON developmental_history
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);


CREATE TABLE communication_profile (
  id                    UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  child_id              UUID NOT NULL,
  primary_language      TEXT,
  communication_method  TEXT,
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, child_id),
  FOREIGN KEY (organization_id, child_id)
    REFERENCES children (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
ALTER TABLE communication_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE communication_profile FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_communication_profile ON communication_profile
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);


CREATE TABLE behavior_profile (
  id                   UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  child_id             UUID NOT NULL,
  triggers             JSONB,
  calming_strategies   JSONB,
  notes                TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, child_id),
  FOREIGN KEY (organization_id, child_id)
    REFERENCES children (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
ALTER TABLE behavior_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE behavior_profile FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_behavior_profile ON behavior_profile
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);


CREATE TABLE sensory_profile (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  child_id        UUID NOT NULL,
  sensitivities   JSONB,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, child_id),
  FOREIGN KEY (organization_id, child_id)
    REFERENCES children (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
ALTER TABLE sensory_profile ENABLE ROW LEVEL SECURITY;
ALTER TABLE sensory_profile FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_sensory_profile ON sensory_profile
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);


CREATE TABLE educational_info (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  child_id        UUID NOT NULL,
  school_name     TEXT,
  grade           TEXT,
  iep_status      TEXT,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, child_id),
  FOREIGN KEY (organization_id, child_id)
    REFERENCES children (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);
ALTER TABLE educational_info ENABLE ROW LEVEL SECURITY;
ALTER TABLE educational_info FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_educational_info ON educational_info
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- İndeks strategiyası: hər cədvəldə (organization_id, child_id) artıq UNIQUE
-- constraint ilə örtülüb (Postgres avtomatik unikal index yaradır) — əlavə
-- indeksə real query pattern məlum olmayana qədər ehtiyac yoxdur (bənd 19
-- "hər sütuna kor-koranə index əlavə etmə" qaydasına uyğun).

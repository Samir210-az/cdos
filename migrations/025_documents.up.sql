-- 025_documents
--
-- Sahə mənbəyi: Faz 3 (Blueprint) C.8:
--   documents(id, organization_id, child_id, owner_type, uploader_id,
--             storage_key (private), mime_type, size_bytes,
--             access_policy(JSONB), status[active/deleted], created_at)
--
-- QEYD (ARCHITECTURE NOTE — no fabrication): orijinal ERD-də documents
-- "report_id" SÜTUNU YOXDUR. Faz 3.7 bənd 12 "yalnız əvvəlki architecture-də
-- təsdiqlənmiş relation-ları əlavə et" dediyi üçün report_id FK BURAYA
-- ƏLAVƏ EDİLMİR. Sənəd yalnız child_id ilə əlaqələndirilir (ERD-də olduğu kimi).
--
-- QEYD 2 (ARCHITECTURE DEVIATION, sənədləşdirilib): Faz 3.7 bənd 13 valideyn
-- sənəd girişi üçün "data_shares" mexanizmini istifadə etməyi tələb edir,
-- AMMA "data_shares"/"consents" cədvəlləri HEÇ BİR fazda migrate edilməyib
-- (Faz 3.2-dən bəri consent testləri SKIP-dədir — real dependency yoxdur).
-- Tam data_shares/consent zənciri bu fazın scope-unda YARADILMIR (bu, əvvəlki
-- fazaların QADAĞAN siyahısına uyğun — "Consent yaratma"). Bunun əvəzinə,
-- "access_policy" JSONB sütunu (artıq ERD-də mövcud olan sahə) üzərindən
-- MİNİMAL, MÜVƏQQƏTİ konvensiya istifadə olunur: access_policy->>'parent_visible'.
-- Bu, tam data_shares modeli tamamlanana qədər keçici həlldir — FINAL
-- REPORT-da ARCHITECTURE DEVIATION kimi açıq qeyd olunur.

CREATE TABLE documents (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  child_id        UUID NOT NULL,
  owner_type      TEXT,
  uploader_id     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  storage_key     TEXT NOT NULL,
  mime_type       TEXT,
  size_bytes      BIGINT,
  access_policy   JSONB,
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted')),
  deleted_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  CHECK (status <> 'deleted' OR deleted_at IS NOT NULL),
  FOREIGN KEY (organization_id, child_id)
    REFERENCES children (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX idx_documents_org ON documents(organization_id);
CREATE INDEX idx_documents_org_child ON documents(organization_id, child_id);
CREATE INDEX idx_documents_org_status ON documents(organization_id, status);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE documents FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_documents ON documents
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- Fiziki DELETE qadağandır (bənd 16: "Physical DELETE attempt → DENIED/unsupported").
-- Storage obyektinə toxunulmur (bu fazda storage inteqrasiyası yoxdur) — yalnız
-- "status='deleted'" ilə soft-delete edilir, sətir DB-də qalır.
CREATE TRIGGER trg_documents_no_delete
  BEFORE DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION guard_no_physical_delete();

-- 026_document_access_logs
--
-- Sahə mənbəyi: Faz 3 (Blueprint) C.9 + Faz 3.7 bənd 14:
--   document_access_logs(id, document_id, accessed_by, action[view/download], ip, created_at)
--
-- QEYD: bu, "audit_logs" (gələcək, ayrıca fazın işi) ilə QARIŞDIRILMIR —
-- yalnız sənəd girişini izləyən dar əhatəli, sənədə xüsusi log-dur (Faz 3.7
-- bənd 14 açıq şəkildə bunu ayırır). "action" siyahısına bənd 14-dəki
-- VIEW/DOWNLOAD/DENIED hadisələri daxildir.

CREATE TABLE document_access_logs (
  id              UUID NOT NULL DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
  document_id     UUID NOT NULL,
  accessed_by     UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action          TEXT NOT NULL CHECK (action IN ('view','download','denied')),
  ip              INET,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (id),
  UNIQUE (organization_id, id),
  FOREIGN KEY (organization_id, document_id)
    REFERENCES documents (organization_id, id) ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX idx_doc_access_logs_org ON document_access_logs(organization_id);
CREATE INDEX idx_doc_access_logs_org_document ON document_access_logs(organization_id, document_id);

ALTER TABLE document_access_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_access_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation_doc_access_logs ON document_access_logs
  USING       (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid)
  WITH CHECK  (organization_id = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- Append-only (audit_logs pattern-inə uyğun, bax Faz 3.1 bənd 10)
CREATE TRIGGER trg_doc_access_logs_no_update
  BEFORE UPDATE ON document_access_logs
  FOR EACH ROW EXECUTE FUNCTION guard_no_update();

CREATE TRIGGER trg_doc_access_logs_no_delete
  BEFORE DELETE ON document_access_logs
  FOR EACH ROW EXECUTE FUNCTION guard_no_physical_delete();

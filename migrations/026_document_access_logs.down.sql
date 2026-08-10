-- 026_document_access_logs (down)
DROP TRIGGER IF EXISTS trg_doc_access_logs_no_delete ON document_access_logs;
DROP TRIGGER IF EXISTS trg_doc_access_logs_no_update ON document_access_logs;
DROP TABLE IF EXISTS document_access_logs;

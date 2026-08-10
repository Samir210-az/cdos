-- 024_reports (down)
DROP TRIGGER IF EXISTS trg_reports_no_delete ON reports;
DROP TRIGGER IF EXISTS trg_report_transition ON reports;
DROP FUNCTION IF EXISTS guard_report_transition();
DROP TABLE IF EXISTS reports;

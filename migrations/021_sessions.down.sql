-- 021_sessions (down)
DROP TRIGGER IF EXISTS trg_amendments_no_delete ON session_amendments;
DROP TRIGGER IF EXISTS trg_amendments_no_update ON session_amendments;
DROP TABLE IF EXISTS session_amendments;
DROP TRIGGER IF EXISTS trg_sessions_no_delete ON sessions;
DROP TRIGGER IF EXISTS trg_session_transition ON sessions;
DROP FUNCTION IF EXISTS guard_session_transition();
DROP TABLE IF EXISTS sessions;

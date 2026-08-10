-- 027_consents (down)
DROP TRIGGER IF EXISTS trg_consents_no_delete ON consents;
DROP TRIGGER IF EXISTS trg_consent_transition ON consents;
DROP FUNCTION IF EXISTS guard_consent_transition();
DROP TABLE IF EXISTS consents;

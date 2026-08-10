-- 035_ai_generations (down)
DROP TABLE IF EXISTS ai_generation_claims;
DROP TRIGGER IF EXISTS trg_ai_generations_no_delete ON ai_generations;
DROP TRIGGER IF EXISTS trg_ai_generation_transition ON ai_generations;
DROP FUNCTION IF EXISTS guard_ai_generation_transition();
DROP TABLE IF EXISTS ai_generations;

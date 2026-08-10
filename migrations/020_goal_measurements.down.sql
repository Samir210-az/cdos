-- 020_goal_measurements (down)
DROP TRIGGER IF EXISTS trg_measurements_no_delete ON goal_measurements;
DROP TRIGGER IF EXISTS trg_measurements_no_update ON goal_measurements;
DROP FUNCTION IF EXISTS guard_no_update();
DROP TABLE IF EXISTS goal_measurements;

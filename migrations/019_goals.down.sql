-- 019_goals (down)
DROP TRIGGER IF EXISTS trg_goals_no_delete ON goals;
DROP TRIGGER IF EXISTS trg_goal_core_guard ON goals;
DROP FUNCTION IF EXISTS guard_goal_core_fields();
DROP TABLE IF EXISTS goals;

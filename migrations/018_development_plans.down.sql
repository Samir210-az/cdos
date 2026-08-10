-- 018_development_plans (down)
DROP TRIGGER IF EXISTS trg_plans_no_delete ON development_plans;
DROP TRIGGER IF EXISTS trg_plan_transition ON development_plans;
DROP FUNCTION IF EXISTS guard_no_physical_delete();
DROP FUNCTION IF EXISTS guard_plan_transition();
DROP TABLE IF EXISTS development_plans;

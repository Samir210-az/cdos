-- 017_assessment_instances_answers_results (down)
DROP TRIGGER IF EXISTS trg_results_lock_guard ON assessment_results;
DROP TRIGGER IF EXISTS trg_answers_lock_guard ON assessment_answers;
DROP FUNCTION IF EXISTS guard_locked_instance_children();
DROP TABLE IF EXISTS assessment_results;
DROP TABLE IF EXISTS assessment_answers;
DROP TRIGGER IF EXISTS trg_instance_immutability ON assessment_instances;
DROP FUNCTION IF EXISTS guard_instance_immutability();
DROP TABLE IF EXISTS assessment_instances;

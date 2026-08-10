-- 012_children (down)
ALTER TABLE specialist_child_assignments DROP CONSTRAINT IF EXISTS fk_assignment_child;
DROP TABLE IF EXISTS children;

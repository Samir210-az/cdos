-- 016_assessment_sections_items_subscales (down)
DROP TRIGGER IF EXISTS trg_items_publish_guard ON assessment_items;
DROP FUNCTION IF EXISTS guard_published_version_items();
DROP TRIGGER IF EXISTS trg_subscales_publish_guard ON assessment_subscales;
DROP TRIGGER IF EXISTS trg_sections_publish_guard ON assessment_sections;
DROP FUNCTION IF EXISTS guard_published_version_direct_children();
DROP TABLE IF EXISTS assessment_items;
DROP TABLE IF EXISTS assessment_sections;
DROP TABLE IF EXISTS assessment_subscales;

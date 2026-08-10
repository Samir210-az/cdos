-- 015_assessment_templates_versions (down)
DROP TRIGGER IF EXISTS trg_atv_immutability ON assessment_template_versions;
DROP FUNCTION IF EXISTS guard_template_version_immutability();
DROP TABLE IF EXISTS assessment_template_versions;
DROP TABLE IF EXISTS assessment_templates;

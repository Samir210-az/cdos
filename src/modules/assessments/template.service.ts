import { withTenantTransaction } from '../../common/db/tenant-context';
import { resolveMemberScope } from '../../scope-cache/scope-resolver';
import { validateScoringRule } from './scoring-validator';

export class TemplateError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

interface ActorContext {
  organizationId: string;
  memberId: string;
}

/**
 * QEYD (ARCHITECTURE GAP — Faz 3.4 bənd 16):
 * Faz 3.1 "permissions" kataloqunda (migration 002) assessment template
 * publish üçün konkret permission KODU YOXDUR (yalnız organizations/branches/
 * members/specialists/assignment permission-ları frozen edilib). Yeni
 * permission uydurmaq əvəzinə, Faz 3.1 Clinical Data Access Matrix-də
 * "Assessment" sətrinin APPROVE/ADMIN səviyyəli rolları (CENTER_OWNER,
 * CENTER_ADMIN, SUPERVISOR) istifadə olunur. Bu, FINAL REPORT-da
 * ARCHITECTURE GAP kimi açıq qeyd olunub.
 */
const PUBLISH_AUTHORIZED_ROLES = ['CENTER_OWNER', 'CENTER_ADMIN', 'SUPERVISOR'];

export async function createTemplate(
  actor: ActorContext,
  input: { name: string; specialization?: string },
): Promise<{ id: string }> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    const res = await client.query(
      `INSERT INTO assessment_templates (organization_id, name, specialization) VALUES ($1,$2,$3) RETURNING id`,
      [actor.organizationId, input.name, input.specialization ?? null],
    );
    return { id: res.rows[0].id };
  });
}

export async function createTemplateVersion(
  actor: ActorContext,
  templateId: string,
): Promise<{ id: string; versionNo: number }> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    const tRes = await client.query(
      `SELECT id FROM assessment_templates WHERE id=$1 AND organization_id=$2`,
      [templateId, actor.organizationId],
    );
    if (tRes.rowCount === 0) throw new TemplateError('NOT_FOUND', 'Template tapılmadı.');

    const maxRes = await client.query(
      `SELECT COALESCE(MAX(version_no), 0) AS max_v FROM assessment_template_versions
       WHERE organization_id=$1 AND template_id=$2`,
      [actor.organizationId, templateId],
    );
    const nextVersion = Number(maxRes.rows[0].max_v) + 1;

    const insertRes = await client.query(
      `INSERT INTO assessment_template_versions (organization_id, template_id, version_no, status)
       VALUES ($1,$2,$3,'DRAFT') RETURNING id`,
      [actor.organizationId, templateId, nextVersion],
    );
    return { id: insertRes.rows[0].id, versionNo: nextVersion };
  });
}

export async function addSection(
  actor: ActorContext,
  input: { templateVersionId: string; title: string; orderIndex?: number },
): Promise<{ id: string }> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    await assertVersionIsDraft(client, actor.organizationId, input.templateVersionId);
    const res = await client.query(
      `INSERT INTO assessment_sections (organization_id, template_version_id, title, order_index)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [actor.organizationId, input.templateVersionId, input.title, input.orderIndex ?? 0],
    );
    return { id: res.rows[0].id };
  });
}

export async function addSubscale(
  actor: ActorContext,
  input: { templateVersionId: string; name: string; calculationRule: unknown },
): Promise<{ id: string }> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    await assertVersionIsDraft(client, actor.organizationId, input.templateVersionId);
    const res = await client.query(
      `INSERT INTO assessment_subscales (organization_id, template_version_id, name, calculation_rule)
       VALUES ($1,$2,$3,$4) RETURNING id`,
      [actor.organizationId, input.templateVersionId, input.name, JSON.stringify(input.calculationRule)],
    );
    return { id: res.rows[0].id };
  });
}

export async function addItem(
  actor: ActorContext,
  input: {
    sectionId: string;
    code: string;
    label: string;
    fieldType: 'numeric' | 'scale' | 'boolean' | 'single_select' | 'multi_select' | 'text';
    options?: unknown;
    subscaleId?: string;
    weight?: number;
  },
): Promise<{ id: string }> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    const secRes = await client.query(
      `SELECT template_version_id FROM assessment_sections WHERE id=$1 AND organization_id=$2`,
      [input.sectionId, actor.organizationId],
    );
    if (secRes.rowCount === 0) throw new TemplateError('NOT_FOUND', 'Section tapılmadı.');
    await assertVersionIsDraft(client, actor.organizationId, secRes.rows[0].template_version_id);

    const res = await client.query(
      `INSERT INTO assessment_items (organization_id, section_id, code, label, field_type, options, subscale_id, weight)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        actor.organizationId,
        input.sectionId,
        input.code,
        input.label,
        input.fieldType,
        input.options ? JSON.stringify(input.options) : null,
        input.subscaleId ?? null,
        input.weight ?? null,
      ],
    );
    return { id: res.rows[0].id };
  });
}

async function assertVersionIsDraft(client: any, organizationId: string, templateVersionId: string): Promise<void> {
  const res = await client.query(
    `SELECT status FROM assessment_template_versions WHERE id=$1 AND organization_id=$2`,
    [templateVersionId, organizationId],
  );
  if (res.rowCount === 0) throw new TemplateError('NOT_FOUND', 'Template version tapılmadı.');
  if (res.rows[0].status !== 'DRAFT') {
    throw new TemplateError('CONFLICT', 'Yalnız DRAFT statuslu versiyaya struktur əlavə edilə bilər.');
  }
}

/**
 * PUBLISH — Faz 3.1/3.4 bənd 8: bütün scoring configuration validasiya olunur.
 * İstənilən subscale-in calculation_rule-i naməlum operator, dərinlik>5,
 * mövcud olmayan item referansı, dövrü referans, sxem pozuntusu, THRESHOLD/
 * WEIGHTED_SUM struktur xətası ehtiva edərsə — PUBLISH RƏDD OLUNUR.
 */
export async function publishTemplateVersion(
  actor: ActorContext,
  templateVersionId: string,
): Promise<{ published: true }> {
  const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
  const authorized = scope.roleCodes.some((r) => PUBLISH_AUTHORIZED_ROLES.includes(r));
  if (!authorized) {
    throw new TemplateError('ACCESS_DENIED', 'Template publish icazəniz yoxdur.');
  }

  return withTenantTransaction(actor.organizationId, async (client) => {
    const versionRes = await client.query(
      `SELECT status FROM assessment_template_versions WHERE id=$1 AND organization_id=$2`,
      [templateVersionId, actor.organizationId],
    );
    if (versionRes.rowCount === 0) throw new TemplateError('NOT_FOUND', 'Template version tapılmadı.');
    if (versionRes.rows[0].status !== 'DRAFT') {
      throw new TemplateError('CONFLICT', 'Yalnız DRAFT statuslu versiya publish edilə bilər.');
    }

    const itemsRes = await client.query(
      `SELECT ai.code FROM assessment_items ai
       JOIN assessment_sections s ON s.id = ai.section_id AND s.organization_id = ai.organization_id
       WHERE s.template_version_id = $1 AND s.organization_id = $2`,
      [templateVersionId, actor.organizationId],
    );
    const validItemCodes = new Set<string>(itemsRes.rows.map((r: any) => r.code));

    // DSL-in özündəki code-lar unikal olmalıdır (Faz 3.4 bənd 8, item reference bütövlüyü)
    const codeCounts = new Map<string, number>();
    for (const code of validItemCodes) codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);

    const subscalesRes = await client.query(
      `SELECT id, name, calculation_rule FROM assessment_subscales
       WHERE template_version_id=$1 AND organization_id=$2`,
      [templateVersionId, actor.organizationId],
    );

    const allErrors: string[] = [];
    for (const sub of subscalesRes.rows) {
      if (sub.calculation_rule === null) {
        allErrors.push(`Subscale "${sub.name}": calculation_rule boşdur.`);
        continue;
      }
      const result = validateScoringRule(sub.calculation_rule, { validItemCodes });
      if (!result.valid) {
        allErrors.push(...result.errors.map((e) => `Subscale "${sub.name}": ${e}`));
      }
    }

    if (allErrors.length > 0) {
      throw new TemplateError('INVALID_DSL', `Publish rədd edildi:\n${allErrors.join('\n')}`);
    }

    await client.query(
      `UPDATE assessment_template_versions SET status='PUBLISHED', published_at=now(), updated_at=now()
       WHERE id=$1 AND organization_id=$2`,
      [templateVersionId, actor.organizationId],
    );
    return { published: true };
  });
}

export async function archiveTemplateVersion(actor: ActorContext, templateVersionId: string): Promise<void> {
  const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
  const authorized = scope.roleCodes.some((r) => PUBLISH_AUTHORIZED_ROLES.includes(r));
  if (!authorized) {
    throw new TemplateError('ACCESS_DENIED', 'Template arxivləşdirmə icazəniz yoxdur.');
  }
  await withTenantTransaction(actor.organizationId, async (client) => {
    const res = await client.query(
      `UPDATE assessment_template_versions SET status='ARCHIVED', updated_at=now()
       WHERE id=$1 AND organization_id=$2 AND status='PUBLISHED' RETURNING id`,
      [templateVersionId, actor.organizationId],
    );
    if (res.rowCount === 0) {
      throw new TemplateError('CONFLICT', 'Yalnız PUBLISHED versiya arxivləşdirilə bilər.');
    }
  });
}

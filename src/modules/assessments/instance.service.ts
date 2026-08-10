import { withTenantTransaction } from '../../common/db/tenant-context';
import { evaluateSubscaleRule } from './scoring-interpreter';
import { ScoringRule } from './scoring-dsl.types';
import { insertAuditRow } from '../audit/audit.service';

export class InstanceError extends Error {
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
  userId?: string; // Faz 3.13 audit retrofit: audit_logs.actor_user_id üçün (opsional, geriyə uyğun)
}

/** Yeni assessment cəhdi yalnız PUBLISHED template version üzərində yaradıla bilər. */
export async function createInstance(
  actor: ActorContext,
  input: { childId: string; templateVersionId: string; assessorSpecialistId: string },
): Promise<{ id: string }> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    const versionRes = await client.query(
      `SELECT status FROM assessment_template_versions WHERE id=$1 AND organization_id=$2`,
      [input.templateVersionId, actor.organizationId],
    );
    if (versionRes.rowCount === 0) throw new InstanceError('NOT_FOUND', 'Template version tapılmadı.');
    if (versionRes.rows[0].status !== 'PUBLISHED') {
      throw new InstanceError('CONFLICT', 'Yalnız PUBLISHED template version üzərindən yeni assessment açıla bilər.');
    }

    const res = await client.query(
      `INSERT INTO assessment_instances (organization_id, child_id, template_version_id, assessor_id, status)
       VALUES ($1,$2,$3,$4,'IN_PROGRESS') RETURNING id`,
      [actor.organizationId, input.childId, input.templateVersionId, input.assessorSpecialistId],
    );
    const instanceId = res.rows[0].id;

    // Faz 3.13 retrofit: ASSESSMENT_CREATED (frozen action), eyni transaction daxilində (atomik)
    await insertAuditRow(client, {
      organizationId: actor.organizationId,
      actorUserId: actor.userId ?? null,
      action: 'ASSESSMENT_CREATED',
      targetType: 'assessment_instances',
      targetId: instanceId,
      after: { childId: input.childId, templateVersionId: input.templateVersionId, status: 'IN_PROGRESS' },
      result: 'SUCCESS',
    });

    return { id: instanceId };
  });
}

/** Cavab yazma/yeniləmə — LOCKED instance-da DB trigger (guard_locked_instance_children) rədd edəcək. */
export async function submitAnswer(
  actor: ActorContext,
  input: { instanceId: string; itemId: string; value: unknown },
): Promise<void> {
  await withTenantTransaction(actor.organizationId, async (client) => {
    await client.query(
      `INSERT INTO assessment_answers (organization_id, instance_id, item_id, value)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (organization_id, instance_id, item_id)
       DO UPDATE SET value = EXCLUDED.value, answered_at = now()`,
      [actor.organizationId, input.instanceId, input.itemId, JSON.stringify(input.value)],
    );
  });
}

/**
 * LOCK + CALCULATE — Faz 3.1/3.4 bənd 12/13.
 * 1) instance IN_PROGRESS olduğunu yoxlayır
 * 2) bütün subscale-lər üçün pure interpreter ilə nəticə hesablayır
 * 3) assessment_results-a yazır
 * 4) instance-i LOCKED-ə keçirir (bundan sonra DB trigger dəyişikliyi bloklayır)
 */
export async function lockInstanceAndCalculate(
  actor: ActorContext,
  instanceId: string,
): Promise<{ results: Array<{ subscaleId: string; rawScore: number; interpretedResult: string | null }> }> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    const instRes = await client.query(
      `SELECT status, template_version_id FROM assessment_instances WHERE id=$1 AND organization_id=$2`,
      [instanceId, actor.organizationId],
    );
    if (instRes.rowCount === 0) throw new InstanceError('NOT_FOUND', 'Assessment instance tapılmadı.');
    if (instRes.rows[0].status !== 'IN_PROGRESS') {
      throw new InstanceError('CONFLICT', 'Yalnız IN_PROGRESS statuslu instance LOCK edilə bilər.');
    }
    const templateVersionId = instRes.rows[0].template_version_id;

    const answersRes = await client.query(
      `SELECT ai.code, a.value FROM assessment_answers a
       JOIN assessment_items ai ON ai.id = a.item_id AND ai.organization_id = a.organization_id
       WHERE a.instance_id=$1 AND a.organization_id=$2`,
      [instanceId, actor.organizationId],
    );
    const answerMap: Record<string, unknown> = {};
    for (const row of answersRes.rows) answerMap[row.code] = row.value;

    const subscalesRes = await client.query(
      `SELECT id, calculation_rule FROM assessment_subscales WHERE template_version_id=$1 AND organization_id=$2`,
      [templateVersionId, actor.organizationId],
    );

    const results: Array<{ subscaleId: string; rawScore: number; interpretedResult: string | null }> = [];
    for (const sub of subscalesRes.rows) {
      if (!sub.calculation_rule) continue;
      const output = evaluateSubscaleRule(sub.calculation_rule as ScoringRule, answerMap);
      await client.query(
        `INSERT INTO assessment_results (organization_id, instance_id, subscale_id, raw_score, interpreted_result)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (organization_id, instance_id, subscale_id)
         DO UPDATE SET raw_score = EXCLUDED.raw_score, interpreted_result = EXCLUDED.interpreted_result, calculated_at = now()`,
        [actor.organizationId, instanceId, sub.id, output.rawScore, output.interpretedResult],
      );
      results.push({ subscaleId: sub.id, rawScore: output.rawScore, interpretedResult: output.interpretedResult });
    }

    await client.query(
      `UPDATE assessment_instances SET status='LOCKED', locked_at=now(), updated_at=now()
       WHERE id=$1 AND organization_id=$2`,
      [instanceId, actor.organizationId],
    );

    // Faz 3.13 retrofit: ASSESSMENT_LOCKED (frozen action), eyni transaction daxilində
    await insertAuditRow(client, {
      organizationId: actor.organizationId,
      actorUserId: actor.userId ?? null,
      action: 'ASSESSMENT_LOCKED',
      targetType: 'assessment_instances',
      targetId: instanceId,
      before: { status: 'IN_PROGRESS' },
      after: { status: 'LOCKED', resultsCount: results.length },
      result: 'SUCCESS',
    });

    return { results };
  });
}

export async function getResults(
  actor: ActorContext,
  instanceId: string,
): Promise<Array<{ subscaleId: string; rawScore: number; interpretedResult: string | null }>> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    const res = await client.query(
      `SELECT subscale_id, raw_score, interpreted_result FROM assessment_results
       WHERE instance_id=$1 AND organization_id=$2`,
      [instanceId, actor.organizationId],
    );
    return res.rows.map((r: any) => ({
      subscaleId: r.subscale_id,
      rawScore: Number(r.raw_score),
      interpretedResult: r.interpreted_result,
    }));
  });
}

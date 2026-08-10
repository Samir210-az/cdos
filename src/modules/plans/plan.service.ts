import { withTenantTransaction } from '../../common/db/tenant-context';
import { resolveMemberScope } from '../../scope-cache/scope-resolver';

export class PlanError extends Error {
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
  userId: string;
}

/**
 * QEYD (ARCHITECTURE GAP — Faz 3.5 bənd 14): permission kataloqunda plan
 * üçün konkret kod yoxdur. Faz 3.1 Clinical Access Matrix-in rol siyahısı
 * birbaşa istifadə olunur (yeni permission kodu UYDURULMUR).
 */
const APPROVE_ROLES = ['CENTER_OWNER', 'CENTER_ADMIN', 'SUPERVISOR'];

async function assertActiveAssignment(client: any, organizationId: string, specialistId: string, childId: string) {
  const res = await client.query(
    `SELECT 1 FROM specialist_child_assignments
     WHERE organization_id=$1 AND specialist_id=$2 AND child_id=$3 AND status='ACTIVE'`,
    [organizationId, specialistId, childId],
  );
  if (res.rowCount === 0) {
    throw new PlanError('ACCESS_DENIED', 'Bu uşağa aktiv specialist_child_assignment yoxdur.');
  }
}

/** SPECIALIST öz təyin olunduğu uşaq üçün, ya da APPROVE-səviyyəli rol draft yarada bilər. */
export async function createDraft(
  actor: ActorContext,
  input: { childId: string; assessorSpecialistId?: string; sourceAssessmentInstanceId?: string },
): Promise<{ id: string }> {
  const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
  const isApprover = scope.roleCodes.some((r) => APPROVE_ROLES.includes(r));
  const isSpecialist = scope.roleCodes.includes('SPECIALIST');

  if (!isApprover && !isSpecialist) {
    throw new PlanError('ACCESS_DENIED', 'Plan draft yaratmaq icazəniz yoxdur.');
  }

  return withTenantTransaction(actor.organizationId, async (client) => {
    if (isSpecialist && input.assessorSpecialistId) {
      await assertActiveAssignment(client, actor.organizationId, input.assessorSpecialistId, input.childId);
    }

    const maxRes = await client.query(
      `SELECT COALESCE(MAX(version_no),0) AS max_v FROM development_plans WHERE organization_id=$1 AND child_id=$2`,
      [actor.organizationId, input.childId],
    );
    const nextVersion = Number(maxRes.rows[0].max_v) + 1;

    const res = await client.query(
      `INSERT INTO development_plans
         (organization_id, child_id, version_no, status, created_by, source_assessment_instance_id)
       VALUES ($1,$2,$3,'AI_DRAFT',$4,$5) RETURNING id`,
      [actor.organizationId, input.childId, nextVersion, actor.userId, input.sourceAssessmentInstanceId ?? null],
    );
    return { id: res.rows[0].id };
  });
}

async function transition(
  actor: ActorContext,
  planId: string,
  fromExpected: string[],
  toStatus: string,
  opts: { requireApproveRole?: boolean; setApprovedBy?: boolean; auditAction?: string } = {},
): Promise<void> {
  if (opts.requireApproveRole) {
    const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
    if (!scope.roleCodes.some((r) => APPROVE_ROLES.includes(r))) {
      throw new PlanError('ACCESS_DENIED', `Bu keçid (${toStatus}) üçün APPROVE-səviyyəli rol tələb olunur.`);
    }
  }
  await withTenantTransaction(actor.organizationId, async (client) => {
    const planRes = await client.query(`SELECT status FROM development_plans WHERE id=$1 AND organization_id=$2`, [
      planId,
      actor.organizationId,
    ]);
    if (planRes.rowCount === 0) throw new PlanError('NOT_FOUND', 'Plan tapılmadı.');
    const fromStatus = planRes.rows[0].status;
    if (!fromExpected.includes(fromStatus)) {
      throw new PlanError(
        'CONFLICT',
        `Plan statusu "${fromStatus}" — bu əməliyyat yalnız [${fromExpected.join(',')}] statuslarından mümkündür.`,
      );
    }
    if (opts.setApprovedBy) {
      await client.query(
        `UPDATE development_plans SET status=$1, approved_by=$2, updated_at=now() WHERE id=$3 AND organization_id=$4`,
        [toStatus, actor.userId, planId, actor.organizationId],
      );
    } else {
      await client.query(
        `UPDATE development_plans SET status=$1, updated_at=now() WHERE id=$2 AND organization_id=$3`,
        [toStatus, planId, actor.organizationId],
      );
    }

    // Faz 3.13 retrofit: yalnız frozen action verilmişsə (məs. "PLAN_APPROVED"),
    // eyni transaction daxilində (atomik). Digər keçidlər (review/pause/resume/
    // complete/archive) üçün frozen event YOXDUR — audit yazılmır (DEFERRED).
    if (opts.auditAction) {
      const { insertAuditRow } = await import('../audit/audit.service');
      await insertAuditRow(client, {
        organizationId: actor.organizationId,
        actorUserId: actor.userId,
        action: opts.auditAction as any,
        targetType: 'development_plans',
        targetId: planId,
        before: { status: fromStatus },
        after: { status: toStatus },
        result: 'SUCCESS',
      });
    }
  });
}

export const reviewPlan = (actor: ActorContext, planId: string) =>
  transition(actor, planId, ['AI_DRAFT'], 'REVIEWED', { requireApproveRole: true, setApprovedBy: true });

/**
 * QEYD (Faz 3.13 Phase 2, event mapping əsaslandırması): Faz 3.5-dəki 6-statuslu
 * model REVIEWED→ACTIVE keçidini "planın rəsmən qüvvəyə minməsi" kimi təyin edir
 * — bu, frozen "PLAN_APPROVED" hadisəsinin funksional qarşılığıdır (orijinal
 * 7-statuslu modeldə ayrıca "APPROVED" statusu var idi, hazırkı sxemdə yoxdur).
 * Yeni event adı UYDURULMAYIB — mövcud 23-lükdən İSTİFADƏ OLUNUB.
 */
export const activatePlan = (actor: ActorContext, planId: string) =>
  transition(actor, planId, ['REVIEWED'], 'ACTIVE', { requireApproveRole: true, auditAction: 'PLAN_APPROVED' });

export const pausePlan = (actor: ActorContext, planId: string) => transition(actor, planId, ['ACTIVE'], 'PAUSED');

export const resumePlan = (actor: ActorContext, planId: string) => transition(actor, planId, ['PAUSED'], 'ACTIVE');

export const completePlan = (actor: ActorContext, planId: string) =>
  transition(actor, planId, ['ACTIVE', 'PAUSED'], 'COMPLETED');

export const archivePlan = (actor: ActorContext, planId: string) =>
  transition(actor, planId, ['COMPLETED', 'PAUSED'], 'ARCHIVED', { requireApproveRole: true });

/** Yeni versiya (revision) yaradır — köhnə versiyaya toxunmur, parent_plan_id ilə bağlayır. */
export async function createRevision(actor: ActorContext, previousPlanId: string): Promise<{ id: string }> {
  const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
  const isApprover = scope.roleCodes.some((r) => APPROVE_ROLES.includes(r));
  const isSpecialist = scope.roleCodes.includes('SPECIALIST');
  if (!isApprover && !isSpecialist) {
    throw new PlanError('ACCESS_DENIED', 'Plan revision yaratmaq icazəniz yoxdur.');
  }

  return withTenantTransaction(actor.organizationId, async (client) => {
    const prevRes = await client.query(
      `SELECT child_id, version_no FROM development_plans WHERE id=$1 AND organization_id=$2`,
      [previousPlanId, actor.organizationId],
    );
    if (prevRes.rowCount === 0) throw new PlanError('NOT_FOUND', 'Əvvəlki plan tapılmadı.');
    const prev = prevRes.rows[0];

    const res = await client.query(
      `INSERT INTO development_plans
         (organization_id, child_id, parent_plan_id, version_no, status, created_by)
       VALUES ($1,$2,$3,$4,'AI_DRAFT',$5) RETURNING id`,
      [actor.organizationId, prev.child_id, previousPlanId, Number(prev.version_no) + 1, actor.userId],
    );
    return { id: res.rows[0].id };
  });
}

/** Versiya zəncirini (v1→v2→v3...) tam gətirir (recursive CTE). */
export async function getVersionChain(actor: ActorContext, anyPlanIdInChain: string): Promise<any[]> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    let currentId = anyPlanIdInChain;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const r = await client.query(
        `SELECT parent_plan_id FROM development_plans WHERE id=$1 AND organization_id=$2`,
        [currentId, actor.organizationId],
      );
      if (r.rowCount === 0 || !r.rows[0].parent_plan_id) break;
      currentId = r.rows[0].parent_plan_id;
    }
    const rootId = currentId;

    const res = await client.query(
      `WITH RECURSIVE chain AS (
         SELECT * FROM development_plans WHERE id=$1 AND organization_id=$2
         UNION ALL
         SELECT dp.* FROM development_plans dp
         JOIN chain c ON dp.parent_plan_id = c.id AND dp.organization_id = c.organization_id
       )
       SELECT * FROM chain ORDER BY version_no ASC`,
      [rootId, actor.organizationId],
    );
    return res.rows;
  });
}

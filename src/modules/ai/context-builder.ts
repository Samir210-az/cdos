import { withTenantTransaction } from '../../common/db/tenant-context';
import { resolveMemberScope } from '../../scope-cache/scope-resolver';

export class ContextBuilderError extends Error {
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

export interface SourceRef {
  type: 'assessment' | 'session' | 'goal' | 'plan' | 'report';
  id: string;
  field?: string;
}

export interface BuiltContext {
  childId: string;
  context: Record<string, unknown>;
  availableSourceIds: Set<string>; // `${type}:${id}`
}

const APPROVE_ROLES = ['CENTER_OWNER', 'CENTER_ADMIN', 'SUPERVISOR'];

/**
 * TENANT/AUTHORIZATION (Faz 3.14 Phase 4) — context builder authorization-u
 * bypass EDƏ BİLMƏZ: actor SPECIALIST-dirsə, uşağa ACTIVE assignment tələb
 * olunur; digər hallarda APPROVE-səviyyəli rol tələb olunur.
 */
async function assertAuthorized(client: any, actor: ActorContext, childId: string): Promise<void> {
  const childRes = await client.query(`SELECT id FROM children WHERE id=$1 AND organization_id=$2`, [
    childId,
    actor.organizationId,
  ]);
  if (childRes.rowCount === 0) {
    throw new ContextBuilderError('ACCESS_DENIED', 'Uşaq bu organization-da tapılmadı (cross-tenant giriş rədd edildi).');
  }

  const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
  const isApprover = scope.roleCodes.some((r) => APPROVE_ROLES.includes(r));
  const isSpecialist = scope.roleCodes.includes('SPECIALIST');

  if (isApprover) return;

  if (isSpecialist) {
    const assignRes = await client.query(
      `SELECT 1 FROM specialist_child_assignments sca
       JOIN specialists s ON s.id = sca.specialist_id AND s.organization_id = sca.organization_id
       WHERE sca.organization_id=$1 AND sca.child_id=$2 AND s.user_id=$3 AND sca.status='ACTIVE'`,
      [actor.organizationId, childId, actor.userId],
    );
    if ((assignRes.rowCount ?? 0) > 0) return;
    throw new ContextBuilderError('ACCESS_DENIED', 'Bu uşağa aktiv specialist_child_assignment yoxdur.');
  }

  throw new ContextBuilderError('ACCESS_DENIED', 'AI context yaratmaq icazəniz yoxdur.');
}

/**
 * "case_summary" use-case üçün deterministik context builder — Faz 0-2 bənd 27
 * ("AI yalnız sistemdəki məlumatlardan istifadə etməli") + Faz 3.1 AI grounding
 * qaydasına uyğun: YALNIZ APPROVED/LOCKED/COMPLETED (başqa mütəxəssisin
 * PENDING/DRAFT işi DEYİL) məlumatlar daxil edilir.
 */
export async function buildCaseSummaryContext(actor: ActorContext, childId: string): Promise<BuiltContext> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    await assertAuthorized(client, actor, childId);

    const availableSourceIds = new Set<string>();
    const sourceIdsList: SourceRef[] = [];

    const assessments = await client.query(
      `SELECT ai_.id, ar.raw_score, ar.interpreted_result, asub.name AS subscale_name
       FROM assessment_instances ai_
       LEFT JOIN assessment_results ar ON ar.instance_id = ai_.id AND ar.organization_id = ai_.organization_id
       LEFT JOIN assessment_subscales asub ON asub.id = ar.subscale_id AND asub.organization_id = ar.organization_id
       WHERE ai_.organization_id=$1 AND ai_.child_id=$2 AND ai_.status='LOCKED'`,
      [actor.organizationId, childId],
    );
    for (const row of assessments.rows) {
      availableSourceIds.add(`assessment:${row.id}`);
      sourceIdsList.push({ type: 'assessment', id: row.id, field: 'results' });
    }

    const sessions = await client.query(
      `SELECT id, result, difficulty FROM sessions WHERE organization_id=$1 AND child_id=$2 AND status='LOCKED'`,
      [actor.organizationId, childId],
    );
    for (const row of sessions.rows) {
      availableSourceIds.add(`session:${row.id}`);
      sourceIdsList.push({ type: 'session', id: row.id, field: 'result' });
    }

    const plans = await client.query(
      `SELECT id, status FROM development_plans WHERE organization_id=$1 AND child_id=$2 AND status IN ('ACTIVE','COMPLETED')`,
      [actor.organizationId, childId],
    );
    for (const row of plans.rows) {
      availableSourceIds.add(`plan:${row.id}`);
      sourceIdsList.push({ type: 'plan', id: row.id, field: 'status' });
    }

    let goals: { rows: any[] } = { rows: [] };
    if (plans.rows.length > 0) {
      goals = await client.query(
        `SELECT id, title, status FROM goals WHERE organization_id=$1 AND plan_id = ANY($2::uuid[])`,
        [actor.organizationId, plans.rows.map((p: any) => p.id)],
      );
      for (const row of goals.rows) {
        availableSourceIds.add(`goal:${row.id}`);
        sourceIdsList.push({ type: 'goal', id: row.id, field: 'status' });
      }
    }

    const reports = await client.query(
      `SELECT id, period_start, period_end FROM reports WHERE organization_id=$1 AND child_id=$2 AND status='APPROVED'`,
      [actor.organizationId, childId],
    );
    for (const row of reports.rows) {
      availableSourceIds.add(`report:${row.id}`);
      sourceIdsList.push({ type: 'report', id: row.id, field: 'period' });
    }

    return {
      childId,
      context: {
        assessments: assessments.rows,
        sessions: sessions.rows,
        plans: plans.rows,
        goals: goals.rows,
        reports: reports.rows,
        availableSourceIds: sourceIdsList,
      },
      availableSourceIds,
    };
  });
}

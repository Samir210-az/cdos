import { withTenantTransaction } from '../../common/db/tenant-context';
import { resolveMemberScope } from '../../scope-cache/scope-resolver';

export class GoalError extends Error {
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

const APPROVE_ROLES = ['CENTER_OWNER', 'CENTER_ADMIN', 'SUPERVISOR'];

function assertAuthorGoalWriter(roleCodes: string[]): void {
  const ok = roleCodes.includes('SPECIALIST') || roleCodes.some((r) => APPROVE_ROLES.includes(r));
  if (!ok) throw new GoalError('ACCESS_DENIED', 'Goal əməliyyatı üçün icazəniz yoxdur.');
}

export async function createGoal(
  actor: ActorContext,
  input: {
    planId: string;
    title: string;
    metricType: 'numeric' | 'percentage' | 'frequency' | 'duration' | 'binary' | 'rating' | 'rubric' | 'custom';
    baselineValue?: unknown;
    targetValue?: unknown;
    measurementMethod?: string;
    responsibleSpecialistId?: string;
    domainId?: string;
  },
): Promise<{ id: string }> {
  const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
  assertAuthorGoalWriter(scope.roleCodes);

  return withTenantTransaction(actor.organizationId, async (client) => {
    const planRes = await client.query(`SELECT id FROM development_plans WHERE id=$1 AND organization_id=$2`, [
      input.planId,
      actor.organizationId,
    ]);
    if (planRes.rowCount === 0) throw new GoalError('NOT_FOUND', 'Plan tapılmadı.');

    const res = await client.query(
      `INSERT INTO goals
         (organization_id, plan_id, domain_id, title, metric_type, baseline_value, target_value,
          measurement_method, responsible_specialist_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [
        actor.organizationId,
        input.planId,
        input.domainId ?? null,
        input.title,
        input.metricType,
        input.baselineValue ? JSON.stringify(input.baselineValue) : null,
        input.targetValue ? JSON.stringify(input.targetValue) : null,
        input.measurementMethod ?? null,
        input.responsibleSpecialistId ?? null,
      ],
    );
    return { id: res.rows[0].id };
  });
}

async function setStatus(actor: ActorContext, goalId: string, status: string): Promise<void> {
  const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
  assertAuthorGoalWriter(scope.roleCodes);

  await withTenantTransaction(actor.organizationId, async (client) => {
    const res = await client.query(
      `UPDATE goals SET status=$1, updated_at=now() WHERE id=$2 AND organization_id=$3 RETURNING id`,
      [status, goalId, actor.organizationId],
    );
    if (res.rowCount === 0) throw new GoalError('NOT_FOUND', 'Goal tapılmadı.');
  });
}

export const completeGoal = (actor: ActorContext, goalId: string) => setStatus(actor, goalId, 'COMPLETED');
export const pauseGoal = (actor: ActorContext, goalId: string) => setStatus(actor, goalId, 'PAUSED');
export const modifyGoalStatus = (actor: ActorContext, goalId: string) => setStatus(actor, goalId, 'MODIFIED');
export const cancelGoal = (actor: ActorContext, goalId: string) => setStatus(actor, goalId, 'CANCELLED');

export async function addMeasurement(
  actor: ActorContext,
  input: { goalId: string; value: unknown; sessionId?: string },
): Promise<{ id: string }> {
  const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
  assertAuthorGoalWriter(scope.roleCodes);

  return withTenantTransaction(actor.organizationId, async (client) => {
    const res = await client.query(
      `INSERT INTO goal_measurements (organization_id, goal_id, session_id, value, recorded_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [actor.organizationId, input.goalId, input.sessionId ?? null, JSON.stringify(input.value), actor.userId],
    );
    return { id: res.rows[0].id };
  });
}

export async function listGoalsForPlan(actor: ActorContext, planId: string): Promise<any[]> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    const res = await client.query(`SELECT * FROM goals WHERE plan_id=$1 AND organization_id=$2`, [
      planId,
      actor.organizationId,
    ]);
    return res.rows;
  });
}

export async function listMeasurements(actor: ActorContext, goalId: string): Promise<any[]> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    const res = await client.query(
      `SELECT * FROM goal_measurements WHERE goal_id=$1 AND organization_id=$2 ORDER BY measured_at ASC`,
      [goalId, actor.organizationId],
    );
    return res.rows;
  });
}

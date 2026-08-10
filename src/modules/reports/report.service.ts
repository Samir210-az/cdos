import { withTenantTransaction } from '../../common/db/tenant-context';
import { resolveMemberScope } from '../../scope-cache/scope-resolver';

export class ReportError extends Error {
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
 * QEYD (ARCHITECTURE GAP): permission kataloqunda report üçün konkret kod
 * yoxdur. Faz 3.1 Clinical Access Matrix-in rol siyahısı istifadə olunur.
 */
const APPROVE_ROLES = ['CENTER_OWNER', 'CENTER_ADMIN', 'SUPERVISOR'];

async function assertActiveAssignment(client: any, organizationId: string, specialistId: string, childId: string) {
  const res = await client.query(
    `SELECT 1 FROM specialist_child_assignments
     WHERE organization_id=$1 AND specialist_id=$2 AND child_id=$3 AND status='ACTIVE'`,
    [organizationId, specialistId, childId],
  );
  if (res.rowCount === 0) {
    throw new ReportError('ACCESS_DENIED', 'Bu uşağa aktiv specialist_child_assignment yoxdur.');
  }
}

export async function createDraft(
  actor: ActorContext,
  input: { childId: string; assessorSpecialistId?: string; periodStart?: string; periodEnd?: string; content?: unknown },
): Promise<{ id: string }> {
  const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
  const isSpecialist = scope.roleCodes.includes('SPECIALIST');
  const isApprover = scope.roleCodes.some((r) => APPROVE_ROLES.includes(r));
  if (!isSpecialist && !isApprover) {
    throw new ReportError('ACCESS_DENIED', 'Report draft yaratmaq icazəniz yoxdur.');
  }

  return withTenantTransaction(actor.organizationId, async (client) => {
    if (isSpecialist && input.assessorSpecialistId) {
      await assertActiveAssignment(client, actor.organizationId, input.assessorSpecialistId, input.childId);
    }
    const res = await client.query(
      `INSERT INTO reports (organization_id, child_id, period_start, period_end, content, created_by)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [
        actor.organizationId,
        input.childId,
        input.periodStart ?? null,
        input.periodEnd ?? null,
        input.content ? JSON.stringify(input.content) : null,
        actor.userId,
      ],
    );
    return { id: res.rows[0].id };
  });
}

async function transition(actor: ActorContext, reportId: string, from: string, to: string, setApprovedBy = false): Promise<void> {
  const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
  if (!scope.roleCodes.some((r) => APPROVE_ROLES.includes(r))) {
    throw new ReportError('ACCESS_DENIED', `Bu keçid (${to}) üçün APPROVE-səviyyəli rol tələb olunur.`);
  }
  await withTenantTransaction(actor.organizationId, async (client) => {
    const res = await client.query(`SELECT status FROM reports WHERE id=$1 AND organization_id=$2`, [
      reportId,
      actor.organizationId,
    ]);
    if (res.rowCount === 0) throw new ReportError('NOT_FOUND', 'Report tapılmadı.');
    if (res.rows[0].status !== from) {
      throw new ReportError('CONFLICT', `Report statusu "${res.rows[0].status}" — bu keçid yalnız "${from}"-dan mümkündür.`);
    }
    if (setApprovedBy) {
      await client.query(
        `UPDATE reports SET status=$1, approved_by=$2, updated_at=now() WHERE id=$3 AND organization_id=$4`,
        [to, actor.userId, reportId, actor.organizationId],
      );
    } else {
      await client.query(`UPDATE reports SET status=$1, updated_at=now() WHERE id=$2 AND organization_id=$3`, [
        to,
        reportId,
        actor.organizationId,
      ]);
    }
  });
}

export const reviewReport = (actor: ActorContext, reportId: string) =>
  transition(actor, reportId, 'AI_DRAFT', 'SPECIALIST_REVIEWED');

export const approveReport = (actor: ActorContext, reportId: string) =>
  transition(actor, reportId, 'SPECIALIST_REVIEWED', 'APPROVED', true);

/**
 * REVISE — Faz 3.7 bənd 10: yalnız APPROVED report-dan yeni versiya yaradıla bilər.
 * Original sətir DƏYİŞMİR, yeni sətir parent_report_id ilə bağlanır.
 */
export async function reviseReport(actor: ActorContext, sourceReportId: string): Promise<{ id: string }> {
  const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
  const isSpecialist = scope.roleCodes.includes('SPECIALIST');
  const isApprover = scope.roleCodes.some((r) => APPROVE_ROLES.includes(r));
  if (!isSpecialist && !isApprover) {
    throw new ReportError('ACCESS_DENIED', 'Report revision yaratmaq icazəniz yoxdur.');
  }

  return withTenantTransaction(actor.organizationId, async (client) => {
    const sourceRes = await client.query(`SELECT * FROM reports WHERE id=$1 AND organization_id=$2`, [
      sourceReportId,
      actor.organizationId,
    ]);
    if (sourceRes.rowCount === 0) throw new ReportError('NOT_FOUND', 'Mənbə report tapılmadı.');
    const source = sourceRes.rows[0];
    if (source.status !== 'APPROVED') {
      throw new ReportError('CONFLICT', 'Yalnız APPROVED report-dan yeni versiya yaradıla bilər.');
    }

    const res = await client.query(
      `INSERT INTO reports (organization_id, child_id, parent_report_id, period_start, period_end, content, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [
        actor.organizationId,
        source.child_id,
        sourceReportId,
        source.period_start,
        source.period_end,
        source.content,
        actor.userId,
      ],
    );
    return { id: res.rows[0].id };
  });
}

export async function getReport(actor: ActorContext, reportId: string): Promise<any> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    const res = await client.query(`SELECT * FROM reports WHERE id=$1 AND organization_id=$2`, [
      reportId,
      actor.organizationId,
    ]);
    if (res.rowCount === 0) throw new ReportError('NOT_FOUND', 'Report tapılmadı.');
    return res.rows[0];
  });
}

export async function getChildReports(actor: ActorContext, childId: string): Promise<any[]> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    const res = await client.query(
      `SELECT * FROM reports WHERE child_id=$1 AND organization_id=$2 ORDER BY created_at DESC`,
      [childId, actor.organizationId],
    );
    return res.rows;
  });
}

import { withTenantTransaction } from '../../common/db/tenant-context';
import { resolveMemberScope, isBranchInScope } from '../../scope-cache/scope-resolver';

export class AssignmentError extends Error {
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
  userId: string; // assigned_by FK users(id)-ə istinad edir — memberId ilə QARIŞDIRILMAMALIDIR (tapılan bug)
}

/**
 * QEYD (faza sərhədi — Faz 3.2 bənd 2):
 * "children" cədvəli bu fazda mövcud deyil. Ona görə child_id-nin
 * mövcudluğu/branch-i BU FAZDA doğrulana bilmir — yalnız specialist-in
 * organization/branch scope-u doğrulanır. Child-səviyyəli yoxlama (5-ci
 * addım, Faz 3.2 bənd 9) "children" migration-ı (011+) yarandıqdan sonra
 * bu servisə əlavə ediləcək (bax FINAL REPORT → Known limitations).
 */
export async function createAssignment(
  actor: ActorContext,
  input: { specialistId: string; childId: string },
): Promise<{ id: string }> {
  const scope = await resolveMemberScope(actor.organizationId, actor.memberId);

  const canCreate =
    scope.roleCodes.includes('CENTER_ADMIN') ||
    scope.roleCodes.includes('CENTER_OWNER') ||
    scope.roleCodes.includes('BRANCH_ADMIN') ||
    scope.roleCodes.includes('SUPERVISOR');
  if (!canCreate) {
    throw new AssignmentError('ACCESS_DENIED', 'assignment.create icazəniz yoxdur.');
  }

  return withTenantTransaction(actor.organizationId, async (client) => {
    // 1) specialist bu organization-a aiddirmi + hansı branch-dədir
    const specRes = await client.query(
      `SELECT id, branch_id, status FROM specialists WHERE id = $1 AND organization_id = $2`,
      [input.specialistId, actor.organizationId],
    );
    if (specRes.rowCount === 0) {
      throw new AssignmentError('NOT_FOUND', 'Specialist bu organization-da tapılmadı.');
    }
    const specialist = specRes.rows[0];
    if (specialist.status !== 'ACTIVE') {
      throw new AssignmentError('SPECIALIST_INACTIVE', 'Specialist aktiv deyil.');
    }

    // 2) BRANCH_ADMIN/SUPERVISOR üçün branch-scope yoxlaması
    //    (CENTER_ADMIN/CENTER_OWNER adətən ALL_BRANCHES, amma scope_type-a
    //    hər zaman hörmət edilir — fail-closed).
    const isOrgLevel = scope.roleCodes.includes('CENTER_ADMIN') || scope.roleCodes.includes('CENTER_OWNER');
    if (!isOrgLevel) {
      if (!specialist.branch_id || !isBranchInScope(scope, specialist.branch_id)) {
        throw new AssignmentError('ACCESS_DENIED', 'Bu specialist sizin filial scope-unuzda deyil.');
      }
    }

    // 3) DB partial unique index (specialist_id, child_id) WHERE status='ACTIVE'
    //    son müdafiə xətti kimi qalır — burada əvvəlcədən dublikat yoxlaması edilir
    //    ki, istifadəçiyə aydın xəta versin (DB constraint xətası əvəzinə).
    const existing = await client.query(
      `SELECT id FROM specialist_child_assignments
       WHERE organization_id = $1 AND specialist_id = $2 AND child_id = $3 AND status = 'ACTIVE'`,
      [actor.organizationId, input.specialistId, input.childId],
    );
    if ((existing.rowCount ?? 0) > 0) {
      throw new AssignmentError('CONFLICT', 'Bu specialist artıq bu uşağa aktiv şəkildə təyin olunub.');
    }

    const insertRes = await client.query(
      `INSERT INTO specialist_child_assignments
         (organization_id, specialist_id, child_id, assigned_by, status)
       VALUES ($1, $2, $3, $4, 'ACTIVE')
       RETURNING id`,
      [actor.organizationId, input.specialistId, input.childId, actor.userId],
    );
    return { id: insertRes.rows[0].id };
  });
}

/**
 * ASSIGNMENT END — yalnız CENTER_ADMIN/CENTER_OWNER/BRANCH_ADMIN.
 * SUPERVISOR bu əməliyyatı YERİNƏ YETİRƏ BİLMƏZ (Faz 3.1/3.2: yalnız təklif edə bilər,
 * tam bildiriş mexanizmi bu fazın scope-undan kənardır).
 */
export async function endAssignment(actor: ActorContext, assignmentId: string): Promise<void> {
  const scope = await resolveMemberScope(actor.organizationId, actor.memberId);

  const canEnd =
    scope.roleCodes.includes('CENTER_ADMIN') ||
    scope.roleCodes.includes('CENTER_OWNER') ||
    scope.roleCodes.includes('BRANCH_ADMIN');
  if (!canEnd) {
    throw new AssignmentError(
      'ACCESS_DENIED',
      'assignment.end icazəniz yoxdur (SUPERVISOR birbaşa bitirə bilməz).',
    );
  }

  await withTenantTransaction(actor.organizationId, async (client) => {
    const res = await client.query(
      `UPDATE specialist_child_assignments
       SET status = 'ENDED', ended_at = now()
       WHERE id = $1 AND organization_id = $2 AND status = 'ACTIVE'
       RETURNING id`,
      [assignmentId, actor.organizationId],
    );
    if (res.rowCount === 0) {
      throw new AssignmentError('NOT_FOUND', 'Aktiv assignment tapılmadı.');
    }
  });
}

/** Specialist-in HAL-HAZIRDA aktiv təyin olunduğu uşaqların ID siyahısı. */
export async function listActiveAssignedChildren(
  organizationId: string,
  specialistId: string,
): Promise<string[]> {
  return withTenantTransaction(organizationId, async (client) => {
    const res = await client.query(
      `SELECT child_id FROM specialist_child_assignments
       WHERE organization_id = $1 AND specialist_id = $2 AND status = 'ACTIVE'`,
      [organizationId, specialistId],
    );
    return res.rows.map((r: any) => r.child_id);
  });
}

import { resolveMemberScope, isBranchInScope } from '../../scope-cache/scope-resolver';

export class ChildAuthError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ActorContext {
  organizationId: string;
  memberId: string;
  userId: string;
}

export const ADMIN_ROLES = ['CENTER_OWNER', 'CENTER_ADMIN'];
export const VIEW_ROLES = ['BRANCH_ADMIN', 'SUPERVISOR'];

/**
 * Faz 3.16 bənd 7: paylaşılan authorization — Child/Parent/Guardian/
 * EmergencyContact/ClinicalProfile servislərinin hamısında eyni qayda.
 * Mövcud pattern-lərdən (document.service assertActiveAssignment,
 * ai/context-builder.ts) İSTİFADƏ OLUNUR, yeni qayda UYDURULMUR.
 */
export async function assertAdminOrAssignedSpecialist(
  client: any,
  actor: ActorContext,
  childId: string,
  opts: { requireAdmin?: boolean } = {},
): Promise<void> {
  const childRes = await client.query(`SELECT branch_id FROM children WHERE id=$1 AND organization_id=$2`, [
    childId,
    actor.organizationId,
  ]);
  if (childRes.rowCount === 0) {
    throw new ChildAuthError('NOT_FOUND', 'Uşaq bu organization-da tapılmadı.');
  }
  const branchId = childRes.rows[0].branch_id;

  const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
  const isAdmin = scope.roleCodes.some((r) => ADMIN_ROLES.includes(r));
  const isViewer = scope.roleCodes.some((r) => VIEW_ROLES.includes(r));
  const isSpecialist = scope.roleCodes.includes('SPECIALIST');

  if (isAdmin || isViewer) {
    // Branch-scope fail-closed: NO_BRANCH həmişə rədd edir (branch_id NULL olmadıqda).
    if (branchId && !isBranchInScope(scope, branchId)) {
      throw new ChildAuthError('ACCESS_DENIED', 'Bu filiala giriş icazəniz yoxdur (branch scope).');
    }
    return;
  }

  if (opts.requireAdmin) {
    throw new ChildAuthError('ACCESS_DENIED', 'Bu əməliyyat üçün admin-səviyyəli rol tələb olunur.');
  }

  if (isSpecialist) {
    const assignRes = await client.query(
      `SELECT 1 FROM specialist_child_assignments sca
       JOIN specialists s ON s.id = sca.specialist_id AND s.organization_id = sca.organization_id
       WHERE sca.organization_id=$1 AND sca.child_id=$2 AND s.user_id=$3 AND sca.status='ACTIVE'`,
      [actor.organizationId, childId, actor.userId],
    );
    if ((assignRes.rowCount ?? 0) > 0) return;
    throw new ChildAuthError('ACCESS_DENIED', 'Bu uşağa aktiv specialist_child_assignment yoxdur.');
  }

  throw new ChildAuthError('ACCESS_DENIED', 'Bu uşaq məlumatına giriş icazəniz yoxdur.');
}

export async function assertAdmin(client: any, actor: ActorContext): Promise<void> {
  const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
  if (!scope.roleCodes.some((r) => ADMIN_ROLES.includes(r))) {
    throw new ChildAuthError('ACCESS_DENIED', 'Bu əməliyyat üçün admin-səviyyəli rol (CENTER_OWNER/CENTER_ADMIN) tələb olunur.');
  }
}

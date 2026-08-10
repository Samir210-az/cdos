import { withTenantTransaction } from '../../common/db/tenant-context';
import { resolveMemberScope, isBranchInScope } from '../../scope-cache/scope-resolver';
import { ActorContext, ChildAuthError, assertAdmin, assertAdminOrAssignedSpecialist } from './child-authorization';

export class ChildError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Faz 3.16 Faza 3: yalnız migration 012-dəki real sahələr (uydurma yoxdur). */
export async function createChild(
  actor: ActorContext,
  input: { branchId?: string; localCode: string; firstName: string; lastName: string; dob: string; gender?: string },
): Promise<{ id: string }> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    await assertAdmin(client, actor);

    if (input.branchId) {
      const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
      if (!isBranchInScope(scope, input.branchId)) {
        throw new ChildAuthError('ACCESS_DENIED', 'Bu filiala giriş icazəniz yoxdur (branch scope).');
      }
    }

    const res = await client.query(
      `INSERT INTO children (organization_id, branch_id, local_code, first_name, last_name, dob, gender)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [actor.organizationId, input.branchId ?? null, input.localCode, input.firstName, input.lastName, input.dob, input.gender ?? null],
    );
    return { id: res.rows[0].id };
  });
}

export async function getChild(actor: ActorContext, childId: string): Promise<any> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    await assertAdminOrAssignedSpecialist(client, actor, childId);
    const res = await client.query(`SELECT * FROM children WHERE id=$1 AND organization_id=$2`, [
      childId,
      actor.organizationId,
    ]);
    if (res.rowCount === 0) throw new ChildError('NOT_FOUND', 'Uşaq tapılmadı.');
    return res.rows[0];
  });
}

/** "status" yalnız migration 012 CHECK-inə uyğun: ACTIVE/ARCHIVED — yeni status UYDURULMADI. */
export async function updateChild(
  actor: ActorContext,
  childId: string,
  input: { branchId?: string; localCode?: string; firstName?: string; lastName?: string; dob?: string; gender?: string; status?: 'ACTIVE' | 'ARCHIVED' },
): Promise<void> {
  await withTenantTransaction(actor.organizationId, async (client) => {
    await assertAdminOrAssignedSpecialist(client, actor, childId, { requireAdmin: true });

    if (input.branchId) {
      const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
      if (!isBranchInScope(scope, input.branchId)) {
        throw new ChildAuthError('ACCESS_DENIED', 'Bu filiala giriş icazəniz yoxdur (branch scope).');
      }
    }

    const fields: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => {
      params.push(val);
      fields.push(`${col} = $${params.length}`);
    };
    if (input.branchId !== undefined) set('branch_id', input.branchId);
    if (input.localCode !== undefined) set('local_code', input.localCode);
    if (input.firstName !== undefined) set('first_name', input.firstName);
    if (input.lastName !== undefined) set('last_name', input.lastName);
    if (input.dob !== undefined) set('dob', input.dob);
    if (input.gender !== undefined) set('gender', input.gender);
    if (input.status !== undefined) set('status', input.status);
    if (fields.length === 0) return;
    fields.push('updated_at = now()');

    params.push(childId, actor.organizationId);
    const res = await client.query(
      `UPDATE children SET ${fields.join(', ')} WHERE id = $${params.length - 1} AND organization_id = $${params.length}`,
      params,
    );
    if (res.rowCount === 0) throw new ChildError('NOT_FOUND', 'Uşaq tapılmadı.');
  });
}

/** Yalnız actor-un branch-scope-una uyğun uşaqlar (fail-closed NO_BRANCH → boş nəticə). */
export async function listChildren(
  actor: ActorContext,
  filters: { branchId?: string; status?: 'ACTIVE' | 'ARCHIVED' } = {},
): Promise<any[]> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
    const isAdminOrViewer = scope.roleCodes.some((r) => ['CENTER_OWNER', 'CENTER_ADMIN', 'BRANCH_ADMIN', 'SUPERVISOR'].includes(r));
    if (!isAdminOrViewer) {
      throw new ChildAuthError('ACCESS_DENIED', 'Uşaq siyahısına giriş icazəniz yoxdur.');
    }

    const conditions: string[] = ['organization_id = $1'];
    const params: unknown[] = [actor.organizationId];

    if (scope.scopeType === 'NO_BRANCH') {
      return []; // fail-closed
    }
    if (scope.scopeType === 'SELECTED_BRANCHES') {
      params.push(scope.branchIds);
      conditions.push(`branch_id = ANY($${params.length}::uuid[])`);
    }

    if (filters.branchId) {
      if (!isBranchInScope(scope, filters.branchId)) throw new ChildAuthError('ACCESS_DENIED', 'Bu filiala giriş icazəniz yoxdur.');
      params.push(filters.branchId);
      conditions.push(`branch_id = $${params.length}`);
    }
    if (filters.status) {
      params.push(filters.status);
      conditions.push(`status = $${params.length}`);
    }

    const res = await client.query(`SELECT * FROM children WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`, params);
    return res.rows;
  });
}

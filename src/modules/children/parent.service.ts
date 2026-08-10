import { withTenantTransaction } from '../../common/db/tenant-context';
import { ActorContext, ChildAuthError, assertAdmin } from './child-authorization';

export class ParentError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Faz 3.16 Faza 2: yalnız migration 011-dəki real sahələr. */
export async function createParent(
  actor: ActorContext,
  input: { userId: string; phone?: string; address?: string },
): Promise<{ id: string }> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    await assertAdmin(client, actor);
    const res = await client.query(
      `INSERT INTO parents (organization_id, user_id, phone, address) VALUES ($1,$2,$3,$4) RETURNING id`,
      [actor.organizationId, input.userId, input.phone ?? null, input.address ?? null],
    );
    return { id: res.rows[0].id };
  });
}

/** Admin-tier VƏ YA parent özü (actor.userId üzərindən). */
export async function getParent(actor: ActorContext, parentId: string): Promise<any> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    const res = await client.query(`SELECT * FROM parents WHERE id=$1 AND organization_id=$2`, [
      parentId,
      actor.organizationId,
    ]);
    if (res.rowCount === 0) throw new ParentError('NOT_FOUND', 'Parent tapılmadı.');
    const parent = res.rows[0];

    if (parent.user_id === actor.userId) return parent;

    try {
      await assertAdmin(client, actor);
    } catch {
      throw new ChildAuthError('ACCESS_DENIED', 'Bu parent məlumatına giriş icazəniz yoxdur.');
    }
    return parent;
  });
}

/** Admin: bütün sahələr. Parent özü: yalnız phone/address (status DEYİL). */
export async function updateParent(
  actor: ActorContext,
  parentId: string,
  input: { phone?: string; address?: string; status?: 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED' },
): Promise<void> {
  await withTenantTransaction(actor.organizationId, async (client) => {
    const res0 = await client.query(`SELECT user_id FROM parents WHERE id=$1 AND organization_id=$2`, [
      parentId,
      actor.organizationId,
    ]);
    if (res0.rowCount === 0) throw new ParentError('NOT_FOUND', 'Parent tapılmadı.');
    const isSelf = res0.rows[0].user_id === actor.userId;

    if (input.status !== undefined && !isSelf) {
      await assertAdmin(client, actor);
    } else if (input.status !== undefined && isSelf) {
      throw new ChildAuthError('ACCESS_DENIED', 'Parent öz statusunu dəyişə bilməz.');
    } else if (!isSelf) {
      await assertAdmin(client, actor);
    }

    const fields: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => {
      params.push(val);
      fields.push(`${col} = $${params.length}`);
    };
    if (input.phone !== undefined) set('phone', input.phone);
    if (input.address !== undefined) set('address', input.address);
    if (input.status !== undefined) set('status', input.status);
    if (fields.length === 0) return;
    fields.push('updated_at = now()');

    params.push(parentId, actor.organizationId);
    await client.query(
      `UPDATE parents SET ${fields.join(', ')} WHERE id = $${params.length - 1} AND organization_id = $${params.length}`,
      params,
    );
  });
}

export async function listParents(actor: ActorContext): Promise<any[]> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    await assertAdmin(client, actor);
    const res = await client.query(`SELECT * FROM parents WHERE organization_id=$1 ORDER BY created_at DESC`, [
      actor.organizationId,
    ]);
    return res.rows;
  });
}

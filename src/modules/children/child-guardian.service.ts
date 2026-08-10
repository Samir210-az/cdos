import { withTenantTransaction } from '../../common/db/tenant-context';
import { ActorContext, assertAdmin, assertAdminOrAssignedSpecialist } from './child-authorization';

export class ChildGuardianError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Faz 3.16 Faza 4: yalnız migration 013-dəki real sahələr.
 * QEYD: "legal_authority" sahəsi UYDURULMUR (Faz 3.3-də açıq şəkildə çıxarılıb,
 * orijinal ERD-də mövcud olmadığı üçün — bax 013 migration şərhi).
 */
export async function attachGuardian(
  actor: ActorContext,
  input: { childId: string; parentId: string; relationType: string; isPrimary?: boolean },
): Promise<{ id: string }> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    await assertAdmin(client, actor);
    const res = await client.query(
      `INSERT INTO child_guardians (organization_id, child_id, parent_id, relation_type, is_primary)
       VALUES ($1,$2,$3,$4,$5) RETURNING id`,
      [actor.organizationId, input.childId, input.parentId, input.relationType, input.isPrimary ?? false],
    );
    return { id: res.rows[0].id };
  });
}

export async function detachGuardian(actor: ActorContext, guardianId: string): Promise<void> {
  await withTenantTransaction(actor.organizationId, async (client) => {
    await assertAdmin(client, actor);
    const res = await client.query(`DELETE FROM child_guardians WHERE id=$1 AND organization_id=$2`, [
      guardianId,
      actor.organizationId,
    ]);
    if (res.rowCount === 0) throw new ChildGuardianError('NOT_FOUND', 'Guardian əlaqəsi tapılmadı.');
  });
}

export async function listGuardians(actor: ActorContext, childId: string): Promise<any[]> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    await assertAdminOrAssignedSpecialist(client, actor, childId);
    const res = await client.query(`SELECT * FROM child_guardians WHERE organization_id=$1 AND child_id=$2`, [
      actor.organizationId,
      childId,
    ]);
    return res.rows;
  });
}

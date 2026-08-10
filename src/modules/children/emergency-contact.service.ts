import { withTenantTransaction } from '../../common/db/tenant-context';
import { ActorContext, assertAdminOrAssignedSpecialist } from './child-authorization';

export class EmergencyContactError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Faz 3.16 Faza 5: yalnız migration 013-dəki real sahələr. */
export async function createEmergencyContact(
  actor: ActorContext,
  input: { childId: string; name: string; relation?: string; phone: string; priority?: number },
): Promise<{ id: string }> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    await assertAdminOrAssignedSpecialist(client, actor, input.childId);
    const res = await client.query(
      `INSERT INTO emergency_contacts (organization_id, child_id, name, relation, phone, priority)
       VALUES ($1,$2,$3,$4,$5,COALESCE($6,1)) RETURNING id`,
      [actor.organizationId, input.childId, input.name, input.relation ?? null, input.phone, input.priority ?? null],
    );
    return { id: res.rows[0].id };
  });
}

export async function updateEmergencyContact(
  actor: ActorContext,
  contactId: string,
  input: { name?: string; relation?: string; phone?: string; priority?: number },
): Promise<void> {
  await withTenantTransaction(actor.organizationId, async (client) => {
    const existing = await client.query(`SELECT child_id FROM emergency_contacts WHERE id=$1 AND organization_id=$2`, [
      contactId,
      actor.organizationId,
    ]);
    if (existing.rowCount === 0) throw new EmergencyContactError('NOT_FOUND', 'Emergency contact tapılmadı.');
    await assertAdminOrAssignedSpecialist(client, actor, existing.rows[0].child_id);

    const fields: string[] = [];
    const params: unknown[] = [];
    const set = (col: string, val: unknown) => {
      params.push(val);
      fields.push(`${col} = $${params.length}`);
    };
    if (input.name !== undefined) set('name', input.name);
    if (input.relation !== undefined) set('relation', input.relation);
    if (input.phone !== undefined) set('phone', input.phone);
    if (input.priority !== undefined) set('priority', input.priority);
    if (fields.length === 0) return;
    fields.push('updated_at = now()');

    params.push(contactId, actor.organizationId);
    await client.query(
      `UPDATE emergency_contacts SET ${fields.join(', ')} WHERE id = $${params.length - 1} AND organization_id = $${params.length}`,
      params,
    );
  });
}

export async function deleteEmergencyContact(actor: ActorContext, contactId: string): Promise<void> {
  await withTenantTransaction(actor.organizationId, async (client) => {
    const existing = await client.query(`SELECT child_id FROM emergency_contacts WHERE id=$1 AND organization_id=$2`, [
      contactId,
      actor.organizationId,
    ]);
    if (existing.rowCount === 0) throw new EmergencyContactError('NOT_FOUND', 'Emergency contact tapılmadı.');
    await assertAdminOrAssignedSpecialist(client, actor, existing.rows[0].child_id);
    await client.query(`DELETE FROM emergency_contacts WHERE id=$1 AND organization_id=$2`, [contactId, actor.organizationId]);
  });
}

export async function listEmergencyContacts(actor: ActorContext, childId: string): Promise<any[]> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    await assertAdminOrAssignedSpecialist(client, actor, childId);
    const res = await client.query(
      `SELECT * FROM emergency_contacts WHERE organization_id=$1 AND child_id=$2 ORDER BY priority ASC`,
      [actor.organizationId, childId],
    );
    return res.rows;
  });
}

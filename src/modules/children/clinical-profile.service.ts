import { withTenantTransaction } from '../../common/db/tenant-context';
import { ActorContext, assertAdminOrAssignedSpecialist } from './child-authorization';

export class ClinicalProfileError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Faz 3.16 Faza 6: 6 klinik profil (migration 014) — hər biri 1:1
 * (UNIQUE(organization_id, child_id)) — bu DB constraint upsert-i (ON CONFLICT)
 * təbii şəkildə dəstəkləyir. Yeni klinik sahə UYDURULMADI.
 */

export async function upsertMedicalBackground(
  actor: ActorContext,
  childId: string,
  input: { allergies?: string; medications?: unknown; conditions?: unknown; notes?: string },
): Promise<void> {
  await withTenantTransaction(actor.organizationId, async (client) => {
    await assertAdminOrAssignedSpecialist(client, actor, childId);
    await client.query(
      `INSERT INTO medical_background (organization_id, child_id, allergies, medications, conditions, notes, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (organization_id, child_id) DO UPDATE SET
         allergies=EXCLUDED.allergies, medications=EXCLUDED.medications, conditions=EXCLUDED.conditions,
         notes=EXCLUDED.notes, updated_by=EXCLUDED.updated_by, updated_at=now()`,
      [
        actor.organizationId, childId,
        input.allergies ?? null,
        input.medications !== undefined ? JSON.stringify(input.medications) : null,
        input.conditions !== undefined ? JSON.stringify(input.conditions) : null,
        input.notes ?? null,
        actor.userId,
      ],
    );
  });
}
export async function getMedicalBackground(actor: ActorContext, childId: string): Promise<any> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    await assertAdminOrAssignedSpecialist(client, actor, childId);
    const res = await client.query(`SELECT * FROM medical_background WHERE organization_id=$1 AND child_id=$2`, [actor.organizationId, childId]);
    return res.rows[0] ?? null;
  });
}

export async function upsertDevelopmentalHistory(
  actor: ActorContext,
  childId: string,
  input: { milestones?: unknown; notes?: string },
): Promise<void> {
  await withTenantTransaction(actor.organizationId, async (client) => {
    await assertAdminOrAssignedSpecialist(client, actor, childId);
    await client.query(
      `INSERT INTO developmental_history (organization_id, child_id, milestones, notes)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (organization_id, child_id) DO UPDATE SET
         milestones=EXCLUDED.milestones, notes=EXCLUDED.notes, updated_at=now()`,
      [actor.organizationId, childId, input.milestones !== undefined ? JSON.stringify(input.milestones) : null, input.notes ?? null],
    );
  });
}
export async function getDevelopmentalHistory(actor: ActorContext, childId: string): Promise<any> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    await assertAdminOrAssignedSpecialist(client, actor, childId);
    const res = await client.query(`SELECT * FROM developmental_history WHERE organization_id=$1 AND child_id=$2`, [actor.organizationId, childId]);
    return res.rows[0] ?? null;
  });
}

export async function upsertCommunicationProfile(
  actor: ActorContext,
  childId: string,
  input: { primaryLanguage?: string; communicationMethod?: string; notes?: string },
): Promise<void> {
  await withTenantTransaction(actor.organizationId, async (client) => {
    await assertAdminOrAssignedSpecialist(client, actor, childId);
    await client.query(
      `INSERT INTO communication_profile (organization_id, child_id, primary_language, communication_method, notes)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (organization_id, child_id) DO UPDATE SET
         primary_language=EXCLUDED.primary_language, communication_method=EXCLUDED.communication_method,
         notes=EXCLUDED.notes, updated_at=now()`,
      [actor.organizationId, childId, input.primaryLanguage ?? null, input.communicationMethod ?? null, input.notes ?? null],
    );
  });
}
export async function getCommunicationProfile(actor: ActorContext, childId: string): Promise<any> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    await assertAdminOrAssignedSpecialist(client, actor, childId);
    const res = await client.query(`SELECT * FROM communication_profile WHERE organization_id=$1 AND child_id=$2`, [actor.organizationId, childId]);
    return res.rows[0] ?? null;
  });
}

export async function upsertBehaviorProfile(
  actor: ActorContext,
  childId: string,
  input: { triggers?: unknown; calmingStrategies?: unknown; notes?: string },
): Promise<void> {
  await withTenantTransaction(actor.organizationId, async (client) => {
    await assertAdminOrAssignedSpecialist(client, actor, childId);
    await client.query(
      `INSERT INTO behavior_profile (organization_id, child_id, triggers, calming_strategies, notes)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (organization_id, child_id) DO UPDATE SET
         triggers=EXCLUDED.triggers, calming_strategies=EXCLUDED.calming_strategies,
         notes=EXCLUDED.notes, updated_at=now()`,
      [
        actor.organizationId, childId,
        input.triggers !== undefined ? JSON.stringify(input.triggers) : null,
        input.calmingStrategies !== undefined ? JSON.stringify(input.calmingStrategies) : null,
        input.notes ?? null,
      ],
    );
  });
}
export async function getBehaviorProfile(actor: ActorContext, childId: string): Promise<any> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    await assertAdminOrAssignedSpecialist(client, actor, childId);
    const res = await client.query(`SELECT * FROM behavior_profile WHERE organization_id=$1 AND child_id=$2`, [actor.organizationId, childId]);
    return res.rows[0] ?? null;
  });
}

export async function upsertSensoryProfile(
  actor: ActorContext,
  childId: string,
  input: { sensitivities?: unknown; notes?: string },
): Promise<void> {
  await withTenantTransaction(actor.organizationId, async (client) => {
    await assertAdminOrAssignedSpecialist(client, actor, childId);
    await client.query(
      `INSERT INTO sensory_profile (organization_id, child_id, sensitivities, notes)
       VALUES ($1,$2,$3,$4)
       ON CONFLICT (organization_id, child_id) DO UPDATE SET
         sensitivities=EXCLUDED.sensitivities, notes=EXCLUDED.notes, updated_at=now()`,
      [actor.organizationId, childId, input.sensitivities !== undefined ? JSON.stringify(input.sensitivities) : null, input.notes ?? null],
    );
  });
}
export async function getSensoryProfile(actor: ActorContext, childId: string): Promise<any> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    await assertAdminOrAssignedSpecialist(client, actor, childId);
    const res = await client.query(`SELECT * FROM sensory_profile WHERE organization_id=$1 AND child_id=$2`, [actor.organizationId, childId]);
    return res.rows[0] ?? null;
  });
}

export async function upsertEducationalInfo(
  actor: ActorContext,
  childId: string,
  input: { schoolName?: string; grade?: string; iepStatus?: string; notes?: string },
): Promise<void> {
  await withTenantTransaction(actor.organizationId, async (client) => {
    await assertAdminOrAssignedSpecialist(client, actor, childId);
    await client.query(
      `INSERT INTO educational_info (organization_id, child_id, school_name, grade, iep_status, notes)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (organization_id, child_id) DO UPDATE SET
         school_name=EXCLUDED.school_name, grade=EXCLUDED.grade, iep_status=EXCLUDED.iep_status,
         notes=EXCLUDED.notes, updated_at=now()`,
      [actor.organizationId, childId, input.schoolName ?? null, input.grade ?? null, input.iepStatus ?? null, input.notes ?? null],
    );
  });
}
export async function getEducationalInfo(actor: ActorContext, childId: string): Promise<any> {
  return withTenantTransaction(actor.organizationId, async (client) => {
    await assertAdminOrAssignedSpecialist(client, actor, childId);
    const res = await client.query(`SELECT * FROM educational_info WHERE organization_id=$1 AND child_id=$2`, [actor.organizationId, childId]);
    return res.rows[0] ?? null;
  });
}

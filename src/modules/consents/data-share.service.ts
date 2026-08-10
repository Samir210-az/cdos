import { withTenantTransaction } from '../../common/db/tenant-context';
import { isConsentCurrentlyActive } from './consent.service';

export class DataShareError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export type ShareableEntityType = 'assessment' | 'reports' | 'documents' | 'development_plan' | 'sessions';

const ENTITY_TABLE: Record<ShareableEntityType, string> = {
  assessment: 'assessment_instances',
  reports: 'reports',
  documents: 'documents',
  development_plan: 'development_plans',
  sessions: 'sessions',
};

/**
 * "entity_id" polymorphic-dir (bax 028 migration qeydi) — DB FK ilə yoxlana
 * bilmir, ona görə mövcudluq VƏ "doğru uşağa aid olma" BURADA,
 * application-layer-də yoxlanılır (Faz 3.8 bənd 26/C28 tələbi: paylaşılan
 * entity consent-in child_id-sinə aid olmalıdır, əks halda rədd edilir).
 */
async function assertEntityBelongsToConsentChild(
  client: any,
  organizationId: string,
  entityType: ShareableEntityType,
  entityId: string,
  consentChildId: string,
) {
  const table = ENTITY_TABLE[entityType];
  const res = await client.query(`SELECT child_id FROM ${table} WHERE id=$1 AND organization_id=$2`, [
    entityId,
    organizationId,
  ]);
  if (res.rowCount === 0) {
    throw new DataShareError('NOT_FOUND', `${entityType} (${entityId}) bu organization-da tapılmadı.`);
  }
  if (res.rows[0].child_id !== consentChildId) {
    throw new DataShareError(
      'CHILD_MISMATCH',
      `${entityType} (${entityId}) consent-in aid olduğu uşağa (${consentChildId}) deyil, başqa uşağa aiddir.`,
    );
  }
}

/** Consent-in sahibi olan (source) mərkəz konkret entity-ni paylaşıma əlavə edir. */
export async function shareEntity(
  organizationId: string,
  input: { consentId: string; entityType: ShareableEntityType; entityId: string },
): Promise<{ id: string }> {
  return withTenantTransaction(organizationId, async (client) => {
    const consentRes = await client.query(
      `SELECT status, data_scope, child_id FROM consents WHERE id=$1 AND organization_id=$2`,
      [input.consentId, organizationId],
    );
    if (consentRes.rowCount === 0) throw new DataShareError('NOT_FOUND', 'Consent tapılmadı.');
    if (!consentRes.rows[0].data_scope.includes(input.entityType)) {
      throw new DataShareError('INVALID', `Consent data_scope-u "${input.entityType}" əhatə etmir.`);
    }

    await assertEntityBelongsToConsentChild(
      client,
      organizationId,
      input.entityType,
      input.entityId,
      consentRes.rows[0].child_id,
    );

    const res = await client.query(
      `INSERT INTO data_shares (organization_id, consent_id, entity_type, entity_id) VALUES ($1,$2,$3,$4) RETURNING id`,
      [organizationId, input.consentId, input.entityType, input.entityId],
    );
    return { id: res.rows[0].id };
  });
}

/**
 * FINAL ENFORCEMENT — Faz 3.8 bənd 16: HƏR İKİ şərt tələb olunur:
 *   1) consent.status = ACTIVE (canlı, cache-siz)
 *   2) entity konkret data_shares qeydi ilə paylaşılıb
 * Consent REVOKED olduqda (bənd 17), data_share qeydi qalsa belə ACCESS = DENIED.
 */
export async function hasSharedAccess(
  toOrganizationId: string,
  childId: string,
  entityType: ShareableEntityType,
  entityId: string,
): Promise<boolean> {
  const consentActive = await isConsentCurrentlyActive(toOrganizationId, childId, entityType);
  if (!consentActive) return false;

  return withTenantTransaction(toOrganizationId, async (client) => {
    const res = await client.query(
      `SELECT 1 FROM data_shares ds
       JOIN consents c ON c.id = ds.consent_id AND c.organization_id = ds.organization_id
       WHERE c.to_organization_id = $1 AND c.child_id = $2 AND c.status = 'ACTIVE'
         AND ds.entity_type = $3 AND ds.entity_id = $4 AND ds.revoked_at IS NULL`,
      [toOrganizationId, childId, entityType, entityId],
    );
    return (res.rowCount ?? 0) > 0;
  });
}

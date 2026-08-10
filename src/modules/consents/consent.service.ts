import { withTenantTransaction } from '../../common/db/tenant-context';

export class ConsentError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

interface ParentActor {
  organizationId: string;
  parentId: string;
}

export async function createConsentRequest(
  organizationId: string,
  input: {
    childId: string;
    grantedByParentId: string;
    toOrganizationId: string;
    dataScope: string[];
    purpose?: string;
    startDate?: string;
    endDate?: string;
  },
): Promise<{ id: string }> {
  // QEYD: organizationId === toOrganizationId İCAZƏLİDİR — bax 027 migration
  // QEYD 3 (in-org parent visibility "özünə-consent" pattern-i, Faz 3.8 bənd 18).
  return withTenantTransaction(organizationId, async (client) => {
    const res = await client.query(
      `INSERT INTO consents
         (organization_id, to_organization_id, child_id, granted_by, data_scope, purpose, start_date, end_date)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [
        organizationId,
        input.toOrganizationId,
        input.childId,
        input.grantedByParentId,
        input.dataScope,
        input.purpose ?? null,
        input.startDate ?? null,
        input.endDate ?? null,
      ],
    );
    return { id: res.rows[0].id };
  });
}

async function assertParentOwnsConsentChild(client: any, organizationId: string, parentId: string, consentId: string) {
  const res = await client.query(
    `SELECT c.id, c.status, c.granted_by, c.child_id FROM consents c WHERE c.id=$1 AND c.organization_id=$2`,
    [consentId, organizationId],
  );
  if (res.rowCount === 0) throw new ConsentError('NOT_FOUND', 'Consent tapılmadı.');
  const consent = res.rows[0];
  if (consent.granted_by !== parentId) {
    throw new ConsentError('ACCESS_DENIED', 'Bu consent-i yalnız onu yaradan valideyn idarə edə bilər.');
  }
  return consent;
}

export async function approveConsent(actor: ParentActor, consentId: string): Promise<void> {
  await withTenantTransaction(actor.organizationId, async (client) => {
    const consent = await assertParentOwnsConsentChild(client, actor.organizationId, actor.parentId, consentId);
    if (consent.status !== 'PENDING') {
      throw new ConsentError('CONFLICT', `Consent statusu "${consent.status}" — yalnız PENDING təsdiqlənə bilər.`);
    }
    await client.query(
      `UPDATE consents SET status='ACTIVE', activated_at=now(), updated_at=now() WHERE id=$1 AND organization_id=$2`,
      [consentId, actor.organizationId],
    );

    // Faz 3.13 retrofit: CONSENT_GRANTED (frozen action), eyni transaction daxilində (atomik).
    // actor_user_id üçün parents.user_id axtarılır (ParentActor yalnız parentId daşıyır).
    const { insertAuditRow } = await import('../audit/audit.service');
    const parentUserRes = await client.query(`SELECT user_id FROM parents WHERE id=$1 AND organization_id=$2`, [
      actor.parentId,
      actor.organizationId,
    ]);
    await insertAuditRow(client, {
      organizationId: actor.organizationId,
      actorUserId: parentUserRes.rows[0]?.user_id ?? null,
      targetType: 'consents',
      targetId: consentId,
      action: 'CONSENT_GRANTED',
      before: { status: 'PENDING' },
      after: { status: 'ACTIVE' },
      result: 'SUCCESS',
    });
  });
}

export async function declineConsent(actor: ParentActor, consentId: string): Promise<void> {
  await withTenantTransaction(actor.organizationId, async (client) => {
    const consent = await assertParentOwnsConsentChild(client, actor.organizationId, actor.parentId, consentId);
    if (consent.status !== 'PENDING') {
      throw new ConsentError('CONFLICT', `Consent statusu "${consent.status}" — yalnız PENDING rədd edilə bilər.`);
    }
    await client.query(`UPDATE consents SET status='DECLINED', updated_at=now() WHERE id=$1 AND organization_id=$2`, [
      consentId,
      actor.organizationId,
    ]);
  });
}

export async function revokeConsent(actor: ParentActor, consentId: string): Promise<void> {
  await withTenantTransaction(actor.organizationId, async (client) => {
    const consent = await assertParentOwnsConsentChild(client, actor.organizationId, actor.parentId, consentId);
    if (consent.status !== 'ACTIVE') {
      throw new ConsentError('CONFLICT', `Consent statusu "${consent.status}" — yalnız ACTIVE ləğv edilə bilər.`);
    }
    await client.query(
      `UPDATE consents SET status='REVOKED', revoked_at=now(), updated_at=now() WHERE id=$1 AND organization_id=$2`,
      [consentId, actor.organizationId],
    );

    // Faz 3.13 retrofit: CONSENT_REVOKED (frozen action), eyni transaction daxilində (atomik)
    const { insertAuditRow } = await import('../audit/audit.service');
    const parentUserRes = await client.query(`SELECT user_id FROM parents WHERE id=$1 AND organization_id=$2`, [
      actor.parentId,
      actor.organizationId,
    ]);
    await insertAuditRow(client, {
      organizationId: actor.organizationId,
      actorUserId: parentUserRes.rows[0]?.user_id ?? null,
      targetType: 'consents',
      targetId: consentId,
      action: 'CONSENT_REVOKED',
      before: { status: 'ACTIVE' },
      after: { status: 'REVOKED' },
      result: 'SUCCESS',
    });
  });
}

/** Faz 3.8 bənd 12: scheduled job YOXDUR — query-time expiration, çağırıla bilən funksiya. */
export async function expireOverdueConsents(organizationId: string): Promise<{ expiredCount: number }> {
  return withTenantTransaction(organizationId, async (client) => {
    const res = await client.query(
      `UPDATE consents SET status='EXPIRED', updated_at=now()
       WHERE organization_id=$1 AND status='ACTIVE' AND end_date IS NOT NULL AND end_date < CURRENT_DATE
       RETURNING id`,
      [organizationId],
    );
    return { expiredCount: res.rowCount ?? 0 };
  });
}

/**
 * CANLI (CACHE-SİZ) DOĞRULAMA — Faz 3.8 bənd 4/16/25: hər cross-org sorğuda
 * birbaşa DB-dən yoxlanılır, HEÇ BİR cache istifadə olunmur.
 */
export async function isConsentCurrentlyActive(
  toOrganizationId: string,
  childId: string,
  scope: string,
): Promise<boolean> {
  return withTenantTransaction(toOrganizationId, async (client) => {
    const res = await client.query(
      `SELECT 1 FROM consents
       WHERE to_organization_id=$1 AND child_id=$2 AND status='ACTIVE'
         AND $3 = ANY(data_scope)
         AND (end_date IS NULL OR end_date >= CURRENT_DATE)`,
      [toOrganizationId, childId, scope],
    );
    return (res.rowCount ?? 0) > 0;
  });
}

export async function getConsent(organizationId: string, consentId: string): Promise<any> {
  return withTenantTransaction(organizationId, async (client) => {
    const res = await client.query(`SELECT * FROM consents WHERE id=$1`, [consentId]);
    if (res.rowCount === 0) throw new ConsentError('NOT_FOUND', 'Consent tapılmadı.');
    return res.rows[0];
  });
}

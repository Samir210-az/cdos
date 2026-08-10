import { Fixtures, seedFixtures, cleanupFixtures, runAsApp, migratorClient } from './helpers';
import { closeAppPool } from '../../src/common/db/pool';
import {
  createConsentRequest,
  approveConsent,
  declineConsent,
  revokeConsent,
  isConsentCurrentlyActive,
  ConsentError,
} from '../../src/modules/consents/consent.service';
import { shareEntity, hasSharedAccess, DataShareError } from '../../src/modules/consents/data-share.service';

describe('CDOS Faz 3.8 — Consent + Data Sharing Engine Security Tests', () => {
  let fx: Fixtures;
  let reportA1: string;

  beforeAll(async () => {
    fx = await seedFixtures();
    const c = await migratorClient();
    try {
      reportA1 = (
        await c.query(
          `INSERT INTO reports (organization_id, child_id, created_by, status) VALUES ($1,$2,$3,'APPROVED') RETURNING id`,
          [fx.orgA, fx.childA1, fx.centerAdminUserId],
        )
      ).rows[0].id;

      // Digər test fayllarındakı presedentə uyğun: memberNoBranch (userA1) SPECIALIST
      // rolu ilə genişləndirilir, specialistA1 childA1-ə aktiv təyin olunur —
      // C30-C32 (document upload) testləri bunu tələb edir.
      const roleId = (await c.query(`SELECT id FROM roles WHERE code='SPECIALIST'`)).rows[0].id;
      await c.query(
        `INSERT INTO member_roles (organization_id, member_id, role_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [fx.orgA, fx.memberNoBranch, roleId],
      );
      await c.query(
        `INSERT INTO specialist_child_assignments (organization_id, specialist_id, child_id, assigned_by, status)
         VALUES ($1,$2,$3,$4,'ACTIVE') ON CONFLICT DO NOTHING`,
        [fx.orgA, fx.specialistA1, fx.childA1, fx.centerAdminUserId],
      );
    } finally {
      await c.end();
    }
  });

  afterAll(async () => {
    await cleanupFixtures();
    await closeAppPool();
  });

  // ================= COMPOSITE FK (C1-C4) =================

  let consentId: string;

  test('C1: Org A consent → Org A child = PASS', async () => {
    const res = await createConsentRequest(fx.orgA, {
      childId: fx.childA1,
      grantedByParentId: fx.parentA1,
      toOrganizationId: fx.orgB,
      dataScope: ['reports', 'documents'],
    });
    consentId = res.id;
    expect(consentId).toBeDefined();
  });

  test('C2: Org A consent → Org B child = FAIL (composite FK)', async () => {
    const c = await migratorClient();
    try {
      await expect(
        c.query(
          `INSERT INTO consents (organization_id, to_organization_id, child_id, granted_by, data_scope)
           VALUES ($1,$2,$3,$4,$5)`,
          [fx.orgA, fx.orgB, fx.childB1, fx.parentA1, ['reports']],
        ),
      ).rejects.toThrow(/foreign key/i);
    } finally {
      await c.end();
    }
  });

  test('C3: Org A data_share → Org A entity (report) = PASS', async () => {
    await approveConsent({ organizationId: fx.orgA, parentId: fx.parentA1 }, consentId);
    const share = await shareEntity(fx.orgA, { consentId, entityType: 'reports', entityId: reportA1 });
    expect(share.id).toBeDefined();
  });

  test('C4: Org A data_share → Org B entity = FAIL (app-layer mövcudluq yoxlaması)', async () => {
    const cMig = await migratorClient();
    let orgBReportId: string;
    try {
      orgBReportId = (
        await cMig.query(
          `INSERT INTO reports (organization_id, child_id, created_by) VALUES ($1,$2,$3) RETURNING id`,
          [fx.orgB, fx.childB1, fx.userB1],
        )
      ).rows[0].id;
    } finally {
      await cMig.end();
    }
    await expect(
      shareEntity(fx.orgA, { consentId, entityType: 'reports', entityId: orgBReportId }),
    ).rejects.toThrow(DataShareError);
  });

  // C1/C3-də yaradılan "consentId" testin qalan hissəsi üçün AKTİV qalsaydı,
  // sonrakı "reports" scope-lu hasSharedAccess yoxlamalarını (C22/C25) çirkləndirərdi
  // (childA1 üçün daimi ACTIVE+shared nəticə verərdi). Ona görə burada ləğv edilir.
  test('Təmizlik: C1/C3-dəki consent test təcridi üçün REVOKED edilir', async () => {
    await revokeConsent({ organizationId: fx.orgA, parentId: fx.parentA1 }, consentId);
    const rows = await runAsApp(fx.orgA, async (c) => (await c.query('SELECT status FROM consents WHERE id=$1', [consentId])).rows);
    expect(rows[0].status).toBe('REVOKED');
  });

  // ================= CONSENT RLS (C5-C8) =================

  test('C5: Org A → öz consent-lərini görür (ALLOWED)', async () => {
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT * FROM consents WHERE id=$1', [consentId]);
      return r.rows;
    });
    expect(rows.length).toBe(1);
  });

  test('C6 (adaptasiya): Org B (target) → consent-i görür (Faz 3.1 RLS: hər iki tərəf görə bilir)', async () => {
    const rows = await runAsApp(fx.orgB, async (c) => {
      const r = await c.query('SELECT * FROM consents WHERE id=$1', [consentId]);
      return r.rows;
    });
    expect(rows.length).toBe(1);
  });

  test('C6b: Əlaqəsiz Org (nə source, nə target) consent-i görmür', async () => {
    const cMig = await migratorClient();
    let orgCId: string;
    try {
      orgCId = (await cMig.query(`INSERT INTO organizations (name) VALUES ('Org C Test') RETURNING id`)).rows[0].id;
    } finally {
      await cMig.end();
    }
    const rows = await runAsApp(orgCId, async (c) => {
      const r = await c.query('SELECT * FROM consents WHERE id=$1', [consentId]);
      return r.rows;
    });
    expect(rows.length).toBe(0);
    const cCleanup = await migratorClient();
    try {
      await cCleanup.query(`DELETE FROM organizations WHERE id=$1`, [orgCId]);
    } finally {
      await cCleanup.end();
    }
  });

  test('C7: Tenant-only RLS (branch-scope-dan asılı deyil) — sənədləşdirmə', async () => {
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT * FROM consents WHERE id=$1', [consentId]);
      return r.rows;
    });
    expect(rows.length).toBe(1);
  });

  test('C8: Tenant context yoxdursa → consent access DENIED', async () => {
    const rows = await runAsApp(null, async (c) => {
      const r = await c.query('SELECT * FROM consents WHERE id=$1', [consentId]);
      return r.rows;
    });
    expect(rows.length).toBe(0);
  });

  // ================= PARENT SECURITY (C9-C14) =================

  let pendingConsent: string;

  test('C9+C12: Parent A → öz uşağının PENDING consent-ini approve edir (ALLOWED)', async () => {
    const res = await createConsentRequest(fx.orgA, {
      childId: fx.childA1,
      grantedByParentId: fx.parentA1,
      toOrganizationId: fx.orgB,
      dataScope: ['documents'],
    });
    pendingConsent = res.id;
    await expect(
      approveConsent({ organizationId: fx.orgA, parentId: fx.parentA1 }, pendingConsent),
    ).resolves.toBeUndefined();
  });

  test('C10: Parent A2 → Parent A1-in consent-ini approve edə bilmir (DENIED)', async () => {
    const res = await createConsentRequest(fx.orgA, {
      childId: fx.childA1,
      grantedByParentId: fx.parentA1,
      toOrganizationId: fx.orgB,
      dataScope: ['sessions'],
    });
    await expect(approveConsent({ organizationId: fx.orgA, parentId: fx.parentA2 }, res.id)).rejects.toThrow(
      ConsentError,
    );
  });

  test('C11: Parent A1 → Parent A2-nin uşağı üçün consent (DENIED)', async () => {
    const res = await createConsentRequest(fx.orgA, {
      childId: fx.childA2,
      grantedByParentId: fx.parentA2,
      toOrganizationId: fx.orgB,
      dataScope: ['reports'],
    });
    await expect(approveConsent({ organizationId: fx.orgA, parentId: fx.parentA1 }, res.id)).rejects.toThrow(
      ConsentError,
    );
  });

  test('C13: DECLINED consent-i təkrar approve = DENIED', async () => {
    const res = await createConsentRequest(fx.orgA, {
      childId: fx.childA1,
      grantedByParentId: fx.parentA1,
      toOrganizationId: fx.orgB,
      dataScope: ['reports'],
    });
    await declineConsent({ organizationId: fx.orgA, parentId: fx.parentA1 }, res.id);
    await expect(approveConsent({ organizationId: fx.orgA, parentId: fx.parentA1 }, res.id)).rejects.toThrow(
      /yalnız PENDING/i,
    );
  });

  test('C14: REVOKED consent-i birbaşa approve = DENIED', async () => {
    const res = await createConsentRequest(fx.orgA, {
      childId: fx.childA1,
      grantedByParentId: fx.parentA1,
      toOrganizationId: fx.orgB,
      dataScope: ['reports'],
    });
    await approveConsent({ organizationId: fx.orgA, parentId: fx.parentA1 }, res.id);
    await revokeConsent({ organizationId: fx.orgA, parentId: fx.parentA1 }, res.id);
    await expect(approveConsent({ organizationId: fx.orgA, parentId: fx.parentA1 }, res.id)).rejects.toThrow(
      /yalnız PENDING/i,
    );
  });

  // ================= STATE TRANSITIONS (C15-C21) =================

  test('C15: PENDING → ACTIVE = PASS', async () => {
    const rows = await runAsApp(fx.orgA, async (c) => (await c.query('SELECT status FROM consents WHERE id=$1', [pendingConsent])).rows);
    expect(rows[0].status).toBe('ACTIVE');
  });

  test('C16: PENDING → DECLINED = PASS', async () => {
    const res = await createConsentRequest(fx.orgA, {
      childId: fx.childA1,
      grantedByParentId: fx.parentA1,
      toOrganizationId: fx.orgB,
      dataScope: ['reports'],
    });
    await declineConsent({ organizationId: fx.orgA, parentId: fx.parentA1 }, res.id);
    const rows = await runAsApp(fx.orgA, async (c) => (await c.query('SELECT status FROM consents WHERE id=$1', [res.id])).rows);
    expect(rows[0].status).toBe('DECLINED');
  });

  test('C17: ACTIVE → REVOKED = PASS', async () => {
    await revokeConsent({ organizationId: fx.orgA, parentId: fx.parentA1 }, pendingConsent);
    const rows = await runAsApp(fx.orgA, async (c) => (await c.query('SELECT status FROM consents WHERE id=$1', [pendingConsent])).rows);
    expect(rows[0].status).toBe('REVOKED');
  });

  test('C18: REVOKED → ACTIVE = DENIED (DB trigger)', async () => {
    const c = await migratorClient();
    try {
      await expect(c.query(`UPDATE consents SET status='ACTIVE' WHERE id=$1`, [pendingConsent])).rejects.toThrow(
        /Invalid consent status transition/i,
      );
    } finally {
      await c.end();
    }
  });

  test('C19: DECLINED → ACTIVE = DENIED (DB trigger)', async () => {
    const res = await createConsentRequest(fx.orgA, {
      childId: fx.childA1,
      grantedByParentId: fx.parentA1,
      toOrganizationId: fx.orgB,
      dataScope: ['reports'],
    });
    await declineConsent({ organizationId: fx.orgA, parentId: fx.parentA1 }, res.id);
    const c = await migratorClient();
    try {
      await expect(c.query(`UPDATE consents SET status='ACTIVE' WHERE id=$1`, [res.id])).rejects.toThrow(
        /Invalid consent status transition/i,
      );
    } finally {
      await c.end();
    }
  });

  test('C20: ACTIVE → DECLINED = DENIED (DB trigger)', async () => {
    const res = await createConsentRequest(fx.orgA, {
      childId: fx.childA1,
      grantedByParentId: fx.parentA1,
      toOrganizationId: fx.orgB,
      dataScope: ['reports'],
    });
    await approveConsent({ organizationId: fx.orgA, parentId: fx.parentA1 }, res.id);
    const c = await migratorClient();
    try {
      await expect(c.query(`UPDATE consents SET status='DECLINED' WHERE id=$1`, [res.id])).rejects.toThrow(
        /Invalid consent status transition/i,
      );
    } finally {
      await c.end();
    }
  });

  test('C21: Invalid transition (EXPIRED → PENDING) = DENIED', async () => {
    const c = await migratorClient();
    let expiredId: string;
    try {
      expiredId = (
        await c.query(
          `INSERT INTO consents (organization_id, to_organization_id, child_id, granted_by, data_scope, status)
           VALUES ($1,$2,$3,$4,$5,'EXPIRED') RETURNING id`,
          [fx.orgA, fx.orgB, fx.childA1, fx.parentA1, ['reports']],
        )
      ).rows[0].id;
      await expect(c.query(`UPDATE consents SET status='PENDING' WHERE id=$1`, [expiredId])).rejects.toThrow(
        /Invalid consent status transition/i,
      );
    } finally {
      await c.end();
    }
  });

  // ================= IMMEDIATE REVOCATION (C22) =================

  test('C22: ACTIVE consent → access ALLOWED → revoke → DƏRHAL DENIED (cache YOXDUR)', async () => {
    const res = await createConsentRequest(fx.orgA, {
      childId: fx.childA1,
      grantedByParentId: fx.parentA1,
      toOrganizationId: fx.orgB,
      dataScope: ['reports'],
    });
    await approveConsent({ organizationId: fx.orgA, parentId: fx.parentA1 }, res.id);
    await shareEntity(fx.orgA, { consentId: res.id, entityType: 'reports', entityId: reportA1 });

    expect(await hasSharedAccess(fx.orgB, fx.childA1, 'reports', reportA1)).toBe(true);
    await revokeConsent({ organizationId: fx.orgA, parentId: fx.parentA1 }, res.id);
    expect(await hasSharedAccess(fx.orgB, fx.childA1, 'reports', reportA1)).toBe(false);
  });

  // ================= DATA SHARE TESTS (C23-C29) =================

  let activeConsentForShares: string;

  test('C23: ACTIVE consent + shared report = ALLOWED', async () => {
    const res = await createConsentRequest(fx.orgA, {
      childId: fx.childA1,
      grantedByParentId: fx.parentA1,
      toOrganizationId: fx.orgB,
      dataScope: ['reports', 'documents'],
    });
    activeConsentForShares = res.id;
    await approveConsent({ organizationId: fx.orgA, parentId: fx.parentA1 }, activeConsentForShares);
    await shareEntity(fx.orgA, { consentId: activeConsentForShares, entityType: 'reports', entityId: reportA1 });
    expect(await hasSharedAccess(fx.orgB, fx.childA1, 'reports', reportA1)).toBe(true);
  });

  test('C24: ACTIVE consent + report NOT shared = DENIED', async () => {
    const c = await migratorClient();
    let unsharedReportId: string;
    try {
      unsharedReportId = (
        await c.query(`INSERT INTO reports (organization_id, child_id, created_by) VALUES ($1,$2,$3) RETURNING id`, [
          fx.orgA,
          fx.childA1,
          fx.centerAdminUserId,
        ])
      ).rows[0].id;
    } finally {
      await c.end();
    }
    expect(await hasSharedAccess(fx.orgB, fx.childA1, 'reports', unsharedReportId)).toBe(false);
  });

  test('C25: REVOKED consent + shared report = DENIED', async () => {
    await revokeConsent({ organizationId: fx.orgA, parentId: fx.parentA1 }, activeConsentForShares);
    expect(await hasSharedAccess(fx.orgB, fx.childA1, 'reports', reportA1)).toBe(false);
  });

  let documentForShare: string;

  test('C26: ACTIVE consent + shared document = ALLOWED', async () => {
    const cMig = await migratorClient();
    try {
      documentForShare = (
        await cMig.query(
          `INSERT INTO documents (organization_id, child_id, uploader_id, storage_key) VALUES ($1,$2,$3,'k') RETURNING id`,
          [fx.orgA, fx.childA1, fx.centerAdminUserId],
        )
      ).rows[0].id;
    } finally {
      await cMig.end();
    }
    const res = await createConsentRequest(fx.orgA, {
      childId: fx.childA1,
      grantedByParentId: fx.parentA1,
      toOrganizationId: fx.orgB,
      dataScope: ['documents'],
    });
    await approveConsent({ organizationId: fx.orgA, parentId: fx.parentA1 }, res.id);
    await shareEntity(fx.orgA, { consentId: res.id, entityType: 'documents', entityId: documentForShare });
    expect(await hasSharedAccess(fx.orgB, fx.childA1, 'documents', documentForShare)).toBe(true);
  });

  test('C27: ACTIVE consent + document NOT shared = DENIED', async () => {
    const cMig = await migratorClient();
    let otherDoc: string;
    try {
      otherDoc = (
        await cMig.query(
          `INSERT INTO documents (organization_id, child_id, uploader_id, storage_key) VALUES ($1,$2,$3,'k') RETURNING id`,
          [fx.orgA, fx.childA1, fx.centerAdminUserId],
        )
      ).rows[0].id;
    } finally {
      await cMig.end();
    }
    expect(await hasSharedAccess(fx.orgB, fx.childA1, 'documents', otherDoc)).toBe(false);
  });

  test('C28: Paylaşılmaq istənən entity başqa child-a aiddirsə = DENIED (share-time yoxlama)', async () => {
    const res = await createConsentRequest(fx.orgA, {
      childId: fx.childA2,
      grantedByParentId: fx.parentA2,
      toOrganizationId: fx.orgB,
      dataScope: ['reports'],
    });
    await approveConsent({ organizationId: fx.orgA, parentId: fx.parentA2 }, res.id);
    // reportA1 həqiqətdə childA1-ə aiddir, amma consent childA2 üçündür — shareEntity RƏDD etməlidir
    await expect(
      shareEntity(fx.orgA, { consentId: res.id, entityType: 'reports', entityId: reportA1 }),
    ).rejects.toThrow(DataShareError);
  });

  test('C29: Cross-tenant entity share cəhdi = DENIED (app-layer mövcudluq yoxlaması)', async () => {
    const cMig = await migratorClient();
    let orgBDoc: string;
    try {
      orgBDoc = (
        await cMig.query(
          `INSERT INTO documents (organization_id, child_id, uploader_id, storage_key) VALUES ($1,$2,$3,'k') RETURNING id`,
          [fx.orgB, fx.childB1, fx.userB1],
        )
      ).rows[0].id;
    } finally {
      await cMig.end();
    }
    await expect(
      shareEntity(fx.orgA, { consentId: activeConsentForShares, entityType: 'documents', entityId: orgBDoc }),
    ).rejects.toThrow(DataShareError);
  });

  // ================= DOCUMENT LEGACY (C30-C32) =================

  test('C30: parent_visible=true metadata + NO ACTIVE consent = DENIED', async () => {
    const { uploadDocument, getParentVisibleDocuments } = await import('../../src/modules/documents/document.service');
    const doc = await uploadDocument(
      { organizationId: fx.orgA, memberId: fx.memberNoBranch, userId: fx.userA1 },
      { childId: fx.childA1, storageKey: 'legacy.pdf', assessorSpecialistId: fx.specialistA1, parentVisible: true },
    );
    const docs = await getParentVisibleDocuments(fx.orgA, fx.parentA1, fx.childA1);
    expect(docs.some((d: any) => d.id === doc.id)).toBe(false);
  });

  test('C31: parent_visible=true + ACTIVE consent + shared = ALLOWED', async () => {
    const { uploadDocument, getParentVisibleDocuments } = await import('../../src/modules/documents/document.service');
    const doc = await uploadDocument(
      { organizationId: fx.orgA, memberId: fx.memberNoBranch, userId: fx.userA1 },
      { childId: fx.childA1, storageKey: 'legacy2.pdf', assessorSpecialistId: fx.specialistA1, parentVisible: true },
    );
    const res = await createConsentRequest(fx.orgA, {
      childId: fx.childA1,
      grantedByParentId: fx.parentA1,
      toOrganizationId: fx.orgA,
      dataScope: ['documents'],
    });
    await approveConsent({ organizationId: fx.orgA, parentId: fx.parentA1 }, res.id);
    await shareEntity(fx.orgA, { consentId: res.id, entityType: 'documents', entityId: doc.id });
    const docs = await getParentVisibleDocuments(fx.orgA, fx.parentA1, fx.childA1);
    expect(docs.some((d: any) => d.id === doc.id)).toBe(true);
  });

  test('C32: parent_visible=false + ACTIVE consent + shared = ALLOWED (flag irrelevantdır)', async () => {
    const { uploadDocument, getParentVisibleDocuments } = await import('../../src/modules/documents/document.service');
    const doc = await uploadDocument(
      { organizationId: fx.orgA, memberId: fx.memberNoBranch, userId: fx.userA1 },
      { childId: fx.childA1, storageKey: 'legacy3.pdf', assessorSpecialistId: fx.specialistA1, parentVisible: false },
    );
    const res = await createConsentRequest(fx.orgA, {
      childId: fx.childA1,
      grantedByParentId: fx.parentA1,
      toOrganizationId: fx.orgA,
      dataScope: ['documents'],
    });
    await approveConsent({ organizationId: fx.orgA, parentId: fx.parentA1 }, res.id);
    await shareEntity(fx.orgA, { consentId: res.id, entityType: 'documents', entityId: doc.id });
    const docs = await getParentVisibleDocuments(fx.orgA, fx.parentA1, fx.childA1);
    expect(docs.some((d: any) => d.id === doc.id)).toBe(true);
  });

  // ================= ƏLAVƏ =================

  test('Əlavə: cdos_app RLS bypass edə bilmir', async () => {
    const rows = await runAsApp(null, async (c) => (await c.query('SELECT * FROM consents')).rows);
    expect(rows.length).toBe(0);
  });

  test('Əlavə: isConsentCurrentlyActive canlıdır (cache yoxdur)', async () => {
    const res = await createConsentRequest(fx.orgA, {
      childId: fx.childA1,
      grantedByParentId: fx.parentA1,
      toOrganizationId: fx.orgB,
      dataScope: ['sessions'],
    });
    expect(await isConsentCurrentlyActive(fx.orgB, fx.childA1, 'sessions')).toBe(false);
    await approveConsent({ organizationId: fx.orgA, parentId: fx.parentA1 }, res.id);
    expect(await isConsentCurrentlyActive(fx.orgB, fx.childA1, 'sessions')).toBe(true);
  });
});

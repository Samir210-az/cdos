import { Fixtures, seedFixtures, cleanupFixtures, runAsApp, migratorClient, appClient } from './helpers';
import { closeAppPool } from '../../src/common/db/pool';
import {
  createDraft as createReportDraft,
  reviewReport,
  approveReport,
  reviseReport,
  ReportError,
} from '../../src/modules/reports/report.service';
import {
  uploadDocument,
  softDeleteDocument,
  getChildDocuments,
  getParentVisibleDocuments,
  DocumentError,
} from '../../src/modules/documents/document.service';

describe('CDOS Faz 3.7 — Reports + Documents Engine Security Tests', () => {
  let fx: Fixtures;
  let specialistMemberId: string;

  const admin = () => ({ organizationId: fx.orgA, memberId: fx.centerAdminMember, userId: fx.centerAdminUserId });
  const specialist = () => ({ organizationId: fx.orgA, memberId: specialistMemberId, userId: fx.userA1 });

  beforeAll(async () => {
    fx = await seedFixtures();
    const c = await migratorClient();
    try {
      specialistMemberId = fx.memberNoBranch;
      const roleId = (await c.query(`SELECT id FROM roles WHERE code='SPECIALIST'`)).rows[0].id;
      await c.query(
        `INSERT INTO member_roles (organization_id, member_id, role_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [fx.orgA, specialistMemberId, roleId],
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

  // ================= COMPOSITE FK TESTS (R1-R6) =================

  let reportA: string;

  test('R1: Org A report → Org A child = PASS', async () => {
    const res = await createReportDraft(admin(), { childId: fx.childA1 });
    reportA = res.id;
    expect(reportA).toBeDefined();
  });

  test('R2: Org A report → Org B child = FAIL (composite FK)', async () => {
    const c = await migratorClient();
    try {
      await expect(
        c.query(`INSERT INTO reports (organization_id, child_id, created_by) VALUES ($1,$2,$3)`, [
          fx.orgA,
          fx.childB1,
          fx.centerAdminUserId,
        ]),
      ).rejects.toThrow(/foreign key/i);
    } finally {
      await c.end();
    }
  });

  test('R3+R25+R26: revision Org A parent report = PASS, original dəyişmir', async () => {
    await reviewReport(admin(), reportA);
    await approveReport(admin(), reportA);
    const beforeContent = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT content, status FROM reports WHERE id=$1', [reportA]);
      return r.rows[0];
    });

    const revision = await reviseReport(admin(), reportA);
    expect(revision.id).toBeDefined();

    const afterContent = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT content, status FROM reports WHERE id=$1', [reportA]);
      return r.rows[0];
    });
    expect(afterContent.status).toBe(beforeContent.status); // hələ APPROVED, dəyişməyib
    expect(afterContent.content).toEqual(beforeContent.content);

    const revRow = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT parent_report_id, status FROM reports WHERE id=$1', [revision.id]);
      return r.rows[0];
    });
    expect(revRow.parent_report_id).toBe(reportA);
    expect(revRow.status).toBe('AI_DRAFT');
  });

  test('R4+R27: Cross-tenant parent_report_id = FAIL (composite FK)', async () => {
    const cMig = await migratorClient();
    let orgBReportId: string;
    try {
      orgBReportId = (
        await cMig.query(`INSERT INTO reports (organization_id, child_id, created_by) VALUES ($1,$2,$3) RETURNING id`, [
          fx.orgB,
          fx.childB1,
          fx.userB1,
        ])
      ).rows[0].id;
    } finally {
      await cMig.end();
    }
    const c = await migratorClient();
    try {
      await expect(
        c.query(
          `INSERT INTO reports (organization_id, child_id, parent_report_id, created_by) VALUES ($1,$2,$3,$4)`,
          [fx.orgA, fx.childA1, orgBReportId, fx.centerAdminUserId],
        ),
      ).rejects.toThrow(/foreign key/i);
    } finally {
      await c.end();
    }
  });

  let documentA: string;

  test('R5: Org A document → Org B child = FAIL', async () => {
    const c = await migratorClient();
    try {
      await expect(
        c.query(
          `INSERT INTO documents (organization_id, child_id, uploader_id, storage_key) VALUES ($1,$2,$3,'k')`,
          [fx.orgA, fx.childB1, fx.centerAdminUserId],
        ),
      ).rejects.toThrow(/foreign key/i);
    } finally {
      await c.end();
    }
  });

  test('R6: documents-də report_id sütunu yoxdur (ARCHITECTURE NOTE doğrulaması — uydurulmayıb)', async () => {
    const c = await migratorClient();
    try {
      const r = await c.query(
        `SELECT column_name FROM information_schema.columns WHERE table_name='documents' AND column_name='report_id'`,
      );
      expect(r.rowCount).toBe(0);
    } finally {
      await c.end();
    }
  });

  // ================= RLS TESTS (R7-R10) =================

  test('R7: Org A → Org A report = ALLOWED', async () => {
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT * FROM reports WHERE id=$1', [reportA]);
      return r.rows;
    });
    expect(rows.length).toBe(1);
  });

  test('R8: Org A → Org B report = DENIED (0 rows)', async () => {
    const cMig = await migratorClient();
    let orgBReportId: string;
    try {
      orgBReportId = (
        await cMig.query(`INSERT INTO reports (organization_id, child_id, created_by) VALUES ($1,$2,$3) RETURNING id`, [
          fx.orgB,
          fx.childB1,
          fx.userB1,
        ])
      ).rows[0].id;
    } finally {
      await cMig.end();
    }
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT * FROM reports WHERE id=$1', [orgBReportId]);
      return r.rows;
    });
    expect(rows.length).toBe(0);
  });

  test('R9: Org A → Org A document = ALLOWED', async () => {
    const res = await uploadDocument(specialist(), {
      childId: fx.childA1,
      storageKey: 's3://bucket/a.pdf',
      assessorSpecialistId: fx.specialistA1,
      parentVisible: true,
    });
    documentA = res.id;
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT * FROM documents WHERE id=$1', [documentA]);
      return r.rows;
    });
    expect(rows.length).toBe(1);
  });

  test('R10: Org A → Org B document = DENIED', async () => {
    const cMig = await migratorClient();
    let orgBDocId: string;
    try {
      orgBDocId = (
        await cMig.query(
          `INSERT INTO documents (organization_id, child_id, uploader_id, storage_key) VALUES ($1,$2,$3,'k') RETURNING id`,
          [fx.orgB, fx.childB1, fx.userB1],
        )
      ).rows[0].id;
    } finally {
      await cMig.end();
    }
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT * FROM documents WHERE id=$1', [orgBDocId]);
      return r.rows;
    });
    expect(rows.length).toBe(0);
  });

  // ================= SPECIALIST TESTS (R11-R16) =================

  test('R11: Specialist A aktiv assignment → Child A report = ALLOWED', async () => {
    const res = await createReportDraft(specialist(), { childId: fx.childA1, assessorSpecialistId: fx.specialistA1 });
    expect(res.id).toBeDefined();
  });

  test('R12: Specialist A → Child B (assignment yoxdur) report = DENIED', async () => {
    await expect(
      createReportDraft(specialist(), { childId: fx.childA2, assessorSpecialistId: fx.specialistA1 }),
    ).rejects.toThrow(ReportError);
  });

  test('R13: Specialist A aktiv assignment → Child A document = ALLOWED', async () => {
    const res = await uploadDocument(specialist(), {
      childId: fx.childA1,
      storageKey: 's3://bucket/b.pdf',
      assessorSpecialistId: fx.specialistA1,
    });
    expect(res.id).toBeDefined();
  });

  test('R14: Specialist A → Child B (assignment yoxdur) document = DENIED', async () => {
    await expect(
      uploadDocument(specialist(), { childId: fx.childA2, storageKey: 'x', assessorSpecialistId: fx.specialistA1 }),
    ).rejects.toThrow(DocumentError);
  });

  test('R15: ENDED assignment → yeni report yaratmaq DENIED', async () => {
    const c = await migratorClient();
    try {
      await c.query(
        `UPDATE specialist_child_assignments SET status='ENDED', ended_at=now()
         WHERE organization_id=$1 AND specialist_id=$2 AND child_id=$3 AND status='ACTIVE'`,
        [fx.orgA, fx.specialistA1, fx.childA1],
      );
    } finally {
      await c.end();
    }
    await expect(
      createReportDraft(specialist(), { childId: fx.childA1, assessorSpecialistId: fx.specialistA1 }),
    ).rejects.toThrow(ReportError);

    const c2 = await migratorClient();
    try {
      await c2.query(
        `INSERT INTO specialist_child_assignments (organization_id, specialist_id, child_id, assigned_by, status)
         VALUES ($1,$2,$3,$4,'ACTIVE')`,
        [fx.orgA, fx.specialistA1, fx.childA1, fx.centerAdminUserId],
      );
    } finally {
      await c2.end();
    }
  });

  test('R16: ENDED-dən sonra belə, öz əvvəlki (artıq yaradılmış) report-una VIEW icazəlidir', async () => {
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT * FROM reports WHERE id=$1', [reportA]);
      return r.rows;
    });
    expect(rows.length).toBe(1); // tarixi görünürlük RLS-dən asılıdır, assignment-dən yox
  });

  // ================= PARENT TESTS (R17-R21) =================

  test('R17: Parent A → öz uşağının APPROVED report-u = ALLOWED', async () => {
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query(
        `SELECT r.* FROM reports r
         JOIN child_guardians g ON g.child_id = r.child_id AND g.organization_id = r.organization_id
         WHERE g.parent_id=$1 AND r.id=$2 AND r.status='APPROVED'`,
        [fx.parentA1, reportA],
      );
      return r.rows;
    });
    expect(rows.length).toBe(1);
  });

  test('R18: Parent A → öz uşağının DRAFT report-u = DENIED (yalnız APPROVED görünür)', async () => {
    const draft = await createReportDraft(admin(), { childId: fx.childA1 });
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query(
        `SELECT r.* FROM reports r
         JOIN child_guardians g ON g.child_id = r.child_id AND g.organization_id = r.organization_id
         WHERE g.parent_id=$1 AND r.id=$2 AND r.status='APPROVED'`,
        [fx.parentA1, draft.id],
      );
      return r.rows;
    });
    expect(rows.length).toBe(0);
  });

  test('R19: Parent A → başqa uşağın report-u = DENIED', async () => {
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query(
        `SELECT r.* FROM reports r
         JOIN child_guardians g ON g.child_id = r.child_id AND g.organization_id = r.organization_id
         WHERE g.parent_id=$1 AND r.child_id=$2`,
        [fx.parentA1, fx.childA2],
      );
      return r.rows;
    });
    expect(rows.length).toBe(0);
  });

  test('R20 (Faz 3.8-ə uyğunlaşdırıldı): Parent A → öz uşağının consent+data_share ilə paylaşılmış sənədi = ALLOWED', async () => {
    // "parent_visible" ARTIQ authorization mənbəyi deyil (Faz 3.8 bənd 18) —
    // real consent + entity-level data_share yaradılır.
    const { createConsentRequest, approveConsent } = await import('../../src/modules/consents/consent.service');
    const { shareEntity } = await import('../../src/modules/consents/data-share.service');

    const consent = await createConsentRequest(fx.orgA, {
      childId: fx.childA1,
      grantedByParentId: fx.parentA1,
      toOrganizationId: fx.orgA, // "özünə-consent" — in-org parent visibility (bax 027 migration QEYD 3)
      dataScope: ['documents'],
    });
    await approveConsent({ organizationId: fx.orgA, parentId: fx.parentA1 }, consent.id);
    await shareEntity(fx.orgA, { consentId: consent.id, entityType: 'documents', entityId: documentA });

    const docs = await getParentVisibleDocuments(fx.orgA, fx.parentA1, fx.childA1);
    expect(docs.some((d: any) => d.id === documentA)).toBe(true);
  });

  test('R21 (Faz 3.8-ə uyğunlaşdırıldı): Parent A → paylaşılmamış (data_share yoxdur) sənəd = DENIED', async () => {
    const nonShared = await uploadDocument(specialist(), {
      childId: fx.childA1,
      storageKey: 's3://bucket/private.pdf',
      assessorSpecialistId: fx.specialistA1,
    });
    // ACTIVE consent mövcuddur (R20-dan), amma BU sənəd üçün data_share YOXDUR
    const docs = await getParentVisibleDocuments(fx.orgA, fx.parentA1, fx.childA1);
    expect(docs.some((d: any) => d.id === nonShared.id)).toBe(false);
  });

  // ================= REPORT IMMUTABILITY (R22-R24, R27 artıq yuxarıda) =================

  test('R22: APPROVED report content UPDATE = DENIED', async () => {
    const c = await migratorClient();
    try {
      await expect(
        c.query(`UPDATE reports SET content='{"hack":true}' WHERE id=$1`, [reportA]),
      ).rejects.toThrow(/APPROVED report dəyişdirilə bilməz/i);
    } finally {
      await c.end();
    }
  });

  test('R23: APPROVED report status mutation = DENIED', async () => {
    const c = await migratorClient();
    try {
      await expect(c.query(`UPDATE reports SET status='AI_DRAFT' WHERE id=$1`, [reportA])).rejects.toThrow(
        /APPROVED report dəyişdirilə bilməz/i,
      );
    } finally {
      await c.end();
    }
  });

  test('R24: APPROVED report DELETE = DENIED', async () => {
    const c = await migratorClient();
    try {
      await expect(c.query(`DELETE FROM reports WHERE id=$1`, [reportA])).rejects.toThrow(
        /fiziki DELETE qadağandır/i,
      );
    } finally {
      await c.end();
    }
  });

  // ================= DOCUMENT IMMUTABILITY / DELETE (R28-R31) =================

  test('R28: Active document soft delete = PASS', async () => {
    await softDeleteDocument(admin(), documentA);
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT status, deleted_at FROM documents WHERE id=$1', [documentA]);
      return r.rows;
    });
    expect(rows[0].status).toBe('deleted');
    expect(rows[0].deleted_at).not.toBeNull();
  });

  test('R29: Soft-deleted document normal access = DENIED/hidden', async () => {
    const docs = await getChildDocuments(admin(), fx.childA1);
    expect(docs.some((d: any) => d.id === documentA)).toBe(false); // yalnız 'active' qaytarılır
  });

  test('R30: Physical DELETE attempt = DENIED/unsupported', async () => {
    const c = await migratorClient();
    try {
      await expect(c.query(`DELETE FROM documents WHERE id=$1`, [documentA])).rejects.toThrow(
        /fiziki DELETE qadağandır/i,
      );
    } finally {
      await c.end();
    }
  });

  test('R31: Cross-tenant document relation (specialist FK-siz cədvəl, uploader users-dir — tenant yoxlaması documents.child_id üzərindən) = DENIED', async () => {
    const c = await migratorClient();
    try {
      await expect(
        c.query(
          `INSERT INTO documents (organization_id, child_id, uploader_id, storage_key) VALUES ($1,$2,$3,'k')`,
          [fx.orgA, fx.childB1, fx.userB1],
        ),
      ).rejects.toThrow(/foreign key/i);
    } finally {
      await c.end();
    }
  });

  // ================= ƏLAVƏ =================

  test('Əlavə: cdos_app RLS bypass edə bilmir (reports/documents)', async () => {
    const reportRows = await runAsApp(null, async (c) => (await c.query('SELECT * FROM reports')).rows);
    const docRows = await runAsApp(null, async (c) => (await c.query('SELECT * FROM documents')).rows);
    expect(reportRows.length).toBe(0);
    expect(docRows.length).toBe(0);
  });

  test('Əlavə: connection-pool tenant context sızması (reports)', async () => {
    const client = await appClient();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org', $1, true)", [fx.orgA]);
      const a = await client.query('SELECT * FROM reports WHERE id=$1', [reportA]);
      expect(a.rows.length).toBe(1);
      await client.query('COMMIT');

      await client.query('BEGIN');
      const b = await client.query('SELECT * FROM reports WHERE id=$1', [reportA]);
      expect(b.rows.length).toBe(0);
      await client.query('COMMIT');
    } finally {
      await client.end();
    }
  });

  test('Əlavə: document_access_logs append-only-dur', async () => {
    const c = await migratorClient();
    let logId: string;
    try {
      logId = (
        await c.query(
          `INSERT INTO document_access_logs (organization_id, document_id, accessed_by, action) VALUES ($1,$2,$3,'view') RETURNING id`,
          [fx.orgA, documentA, fx.centerAdminUserId],
        )
      ).rows[0].id;
      await expect(c.query(`UPDATE document_access_logs SET action='download' WHERE id=$1`, [logId])).rejects.toThrow(
        /UPDATE qadağandır/i,
      );
      await expect(c.query(`DELETE FROM document_access_logs WHERE id=$1`, [logId])).rejects.toThrow(
        /fiziki DELETE qadağandır/i,
      );
    } finally {
      await c.end();
    }
  });
});

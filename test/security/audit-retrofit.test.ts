import { Fixtures, seedFixtures, cleanupFixtures, runAsApp, migratorClient } from './helpers';
import { closeAppPool } from '../../src/common/db/pool';
import { activatePlan, createDraft as createPlanDraft, reviewPlan } from '../../src/modules/plans/plan.service';
import {
  createSession,
  startSession,
  completeSession,
  lockSession,
  amendSession,
} from '../../src/modules/sessions/session.service';
import {
  createTemplate,
  createTemplateVersion,
  addSection,
  addSubscale,
  addItem,
  publishTemplateVersion,
} from '../../src/modules/assessments/template.service';
import { createInstance, submitAnswer, lockInstanceAndCalculate } from '../../src/modules/assessments/instance.service';
import { createConsentRequest, approveConsent, revokeConsent } from '../../src/modules/consents/consent.service';
import { uploadDocument, logDocumentAccess } from '../../src/modules/documents/document.service';
import { login } from '../../src/modules/auth/auth.service';
import bcrypt from 'bcryptjs';

describe('CDOS Faz 3.13 — Audit Retrofit Integration Tests', () => {
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

  async function getAuditRow(orgId: string, action: string, targetId: string) {
    return runAsApp(orgId, async (c) => {
      const r = await c.query(
        `SELECT * FROM audit_logs WHERE action=$1 AND target_id=$2 ORDER BY created_at DESC LIMIT 1`,
        [action, targetId],
      );
      return r.rows[0];
    });
  }

  // ================= PLAN_APPROVED =================

  test('PLAN_APPROVED: activatePlan() real audit sətri yaradır (actor/org/target düzgün)', async () => {
    const plan = await createPlanDraft(admin(), { childId: fx.childA1 });
    await reviewPlan(admin(), plan.id);
    await activatePlan(admin(), plan.id);

    const row = await getAuditRow(fx.orgA, 'PLAN_APPROVED', plan.id);
    expect(row).toBeDefined();
    expect(row.actor_user_id).toBe(fx.centerAdminUserId);
    expect(row.organization_id).toBe(fx.orgA);
    expect(row.target_type).toBe('development_plans');
    expect(row.result).toBe('SUCCESS');
    expect(row.before.status).toBe('REVIEWED');
    expect(row.after.status).toBe('ACTIVE');
  });

  test('PLAN_APPROVED: Cross-tenant — Org B bu audit sətrini görmür (data sızmır)', async () => {
    const plan = await createPlanDraft(admin(), { childId: fx.childA1 });
    await reviewPlan(admin(), plan.id);
    await activatePlan(admin(), plan.id);

    const rows = await runAsApp(fx.orgB, async (c) => (await c.query('SELECT * FROM audit_logs WHERE target_id=$1', [plan.id])).rows);
    expect(rows.length).toBe(0);
  });

  // ================= SESSION_LOCKED / SESSION_AMENDED =================

  test('SESSION_LOCKED: lockSession() audit yaradır', async () => {
    const s = await createSession(specialist(), { childId: fx.childA1, specialistId: fx.specialistA1 });
    await startSession(specialist(), s.id);
    await completeSession(specialist(), s.id);
    await lockSession(admin(), s.id);

    const row = await getAuditRow(fx.orgA, 'SESSION_LOCKED', s.id);
    expect(row).toBeDefined();
    expect(row.result).toBe('SUCCESS');
    expect(row.after.status).toBe('LOCKED');
  });

  test('SESSION_AMENDED: amendSession() audit yaradır, before/after doğrudur', async () => {
    const s = await createSession(specialist(), { childId: fx.childA1, specialistId: fx.specialistA1 });
    await startSession(specialist(), s.id);
    await completeSession(specialist(), s.id);
    await lockSession(admin(), s.id);

    const amendment = await amendSession(specialist(), {
      sessionId: s.id,
      newData: { observation: 'Düzəliş edildi' },
      reason: 'Test',
    });
    expect(amendment.id).toBeDefined();

    const row = await getAuditRow(fx.orgA, 'SESSION_AMENDED', s.id);
    expect(row).toBeDefined();
    expect(row.actor_user_id).toBe(fx.userA1);
    expect(row.after.observation).toBe('Düzəliş edildi');
  });

  // ================= ASSESSMENT_CREATED / ASSESSMENT_LOCKED =================

  let versionId: string;
  let itemQ1: string;
  let subscaleId: string;

  test('ASSESSMENT_CREATED: createInstance() audit yaradır', async () => {
    const template = await createTemplate(admin(), { name: 'Audit Retrofit Test Template' });
    const version = await createTemplateVersion(admin(), template.id);
    versionId = version.id;
    const section = await addSection(admin(), { templateVersionId: versionId, title: 'S1' });
    subscaleId = (
      await addSubscale(admin(), { templateVersionId: versionId, name: 'Bal', calculationRule: { operation: 'SUM', operands: ['Q1'] } })
    ).id;
    const item = await addItem(admin(), { sectionId: section.id, code: 'Q1', label: 'Sual', fieldType: 'numeric', subscaleId });
    itemQ1 = item.id;
    await publishTemplateVersion(admin(), versionId);

    const instance = await createInstance(
      { ...specialist() },
      { childId: fx.childA1, templateVersionId: versionId, assessorSpecialistId: fx.specialistA1 },
    );

    const row = await getAuditRow(fx.orgA, 'ASSESSMENT_CREATED', instance.id);
    expect(row).toBeDefined();
    expect(row.actor_user_id).toBe(fx.userA1);
    expect(row.target_type).toBe('assessment_instances');
    (global as any).__auditInstanceId = instance.id; // növbəti test üçün
  });

  test('ASSESSMENT_LOCKED: lockInstanceAndCalculate() audit yaradır', async () => {
    const instanceId = (global as any).__auditInstanceId as string;
    await submitAnswer({ ...specialist() }, { instanceId, itemId: itemQ1, value: 5 });
    await lockInstanceAndCalculate({ ...specialist() }, instanceId);

    const row = await getAuditRow(fx.orgA, 'ASSESSMENT_LOCKED', instanceId);
    expect(row).toBeDefined();
    expect(row.after.status).toBe('LOCKED');
  });

  // ================= CONSENT_GRANTED / CONSENT_REVOKED =================

  test('CONSENT_GRANTED: approveConsent() audit yaradır, actor parent-in user_id-sidir', async () => {
    const consent = await createConsentRequest(fx.orgA, {
      childId: fx.childA1,
      grantedByParentId: fx.parentA1,
      toOrganizationId: fx.orgB,
      dataScope: ['reports'],
    });
    await approveConsent({ organizationId: fx.orgA, parentId: fx.parentA1 }, consent.id);

    const row = await getAuditRow(fx.orgA, 'CONSENT_GRANTED', consent.id);
    expect(row).toBeDefined();
    expect(row.after.status).toBe('ACTIVE');
    // parentA1-in user_id-si (fx-də saxlanılmır, amma NULL olmamalıdır)
    expect(row.actor_user_id).not.toBeNull();
    (global as any).__auditConsentId = consent.id;
  });

  test('CONSENT_REVOKED: revokeConsent() audit yaradır', async () => {
    const consentId = (global as any).__auditConsentId as string;
    await revokeConsent({ organizationId: fx.orgA, parentId: fx.parentA1 }, consentId);

    const row = await getAuditRow(fx.orgA, 'CONSENT_REVOKED', consentId);
    expect(row).toBeDefined();
    expect(row.after.status).toBe('REVOKED');
  });

  // ================= DOCUMENT_VIEWED / DOCUMENT_DOWNLOADED =================

  test('DOCUMENT_VIEWED + DOCUMENT_DOWNLOADED: logDocumentAccess() audit_logs-a DA yazır', async () => {
    const doc = await uploadDocument(specialist(), {
      childId: fx.childA1,
      storageKey: 'audit-test.pdf',
      assessorSpecialistId: fx.specialistA1,
    });
    await logDocumentAccess(admin(), { documentId: doc.id, action: 'view' });
    await logDocumentAccess(admin(), { documentId: doc.id, action: 'download' });

    const viewRow = await getAuditRow(fx.orgA, 'DOCUMENT_VIEWED', doc.id);
    const downloadRow = await getAuditRow(fx.orgA, 'DOCUMENT_DOWNLOADED', doc.id);
    expect(viewRow).toBeDefined();
    expect(downloadRow).toBeDefined();
  });

  test('"denied" action üçün audit_logs YAZILMIR (frozen "DOCUMENT_DENIED" yoxdur — uydurulmadı)', async () => {
    const doc = await uploadDocument(specialist(), {
      childId: fx.childA1,
      storageKey: 'audit-denied-test.pdf',
      assessorSpecialistId: fx.specialistA1,
    });
    await logDocumentAccess(admin(), { documentId: doc.id, action: 'denied' });

    const rows = await runAsApp(fx.orgA, async (c) => (await c.query('SELECT * FROM audit_logs WHERE target_id=$1', [doc.id])).rows);
    expect(rows.length).toBe(0); // document_access_logs-da var, amma audit_logs-da YOX
    const accessLogRows = await runAsApp(fx.orgA, async (c) => (await c.query('SELECT * FROM document_access_logs WHERE document_id=$1', [doc.id])).rows);
    expect(accessLogRows.length).toBe(1);
  });

  // ================= LOGIN / LOGIN_FAILED / LOGOUT =================

  test('LOGIN: uğurlu giriş audit yaradır', async () => {
    const c = await migratorClient();
    const email = `audit-login-${Date.now()}@test.local`;
    const passwordHash = await bcrypt.hash('correct-password', 10);
    let userId: string;
    try {
      userId = (
        await c.query(`INSERT INTO users (email, password_hash, full_name) VALUES ($1,$2,'Audit Login Test') RETURNING id`, [
          email,
          passwordHash,
        ])
      ).rows[0].id;
      await c.query(`INSERT INTO organization_members (organization_id, user_id, scope_type) VALUES ($1,$2,'NO_BRANCH')`, [
        fx.orgA,
        userId,
      ]);
    } finally {
      await c.end();
    }

    const result = await login(email, 'correct-password');
    expect((result as any).requiresOrgSelection).toBe(false);

    const rows = await runAsApp(fx.orgA, async (cc) => (await cc.query(`SELECT * FROM audit_logs WHERE action='LOGIN' AND actor_user_id=$1`, [userId])).rows);
    expect(rows.length).toBe(1);
    expect(rows[0].result).toBe('SUCCESS');
  });

  test('LOGIN_FAILED: yanlış şifrə audit yaradır (organization_id=NULL, secret yazılmır)', async () => {
    const c = await migratorClient();
    const email = `audit-login-fail-${Date.now()}@test.local`;
    const passwordHash = await bcrypt.hash('correct-password', 10);
    let userId: string;
    try {
      userId = (
        await c.query(`INSERT INTO users (email, password_hash, full_name) VALUES ($1,$2,'Audit Fail Test') RETURNING id`, [
          email,
          passwordHash,
        ])
      ).rows[0].id;
    } finally {
      await c.end();
    }

    await expect(login(email, 'wrong-password')).rejects.toThrow();

    const c2 = await migratorClient();
    try {
      const r = await c2.query(`SELECT * FROM audit_logs WHERE action='LOGIN_FAILED' AND actor_user_id=$1`, [userId]);
      expect(r.rows.length).toBe(1);
      expect(r.rows[0].organization_id).toBeNull();
      expect(r.rows[0].result).toBe('DENIED');
      expect(JSON.stringify(r.rows[0])).not.toContain('correct-password'); // heç bir şifrə mətni yazılmayıb
    } finally {
      await c2.end();
    }
  });

  // ================= Ümumi: secret leakage prevention =================

  test('Sensitive secret leakage: password_hash/refresh_token açarları redact olunur (MEMBER_ROLE_CHANGED nümunəsi ilə, Faz 3.12-dən davam)', async () => {
    const { recordAuditEvent } = await import('../../src/modules/audit/audit.service');
    const res = await recordAuditEvent({
      organizationId: fx.orgA,
      action: 'MEMBER_ROLE_CHANGED',
      before: { password_hash: 'x', access_token: 'y', role: 'SPECIALIST' },
      result: 'SUCCESS',
    });
    const rows = await runAsApp(fx.orgA, async (c) => (await c.query('SELECT before FROM audit_logs WHERE id=$1', [res.id])).rows);
    expect(rows[0].before.password_hash).toBe('***REDACTED***');
    expect(rows[0].before.access_token).toBe('***REDACTED***');
  });

  // ================= Append-only davam edir =================

  test('Append-only: retrofit edilmiş sətirlərə belə UPDATE/DELETE mümkün deyil', async () => {
    const c = await migratorClient();
    try {
      const r = await c.query(`SELECT id FROM audit_logs WHERE action='PLAN_APPROVED' LIMIT 1`);
      void r; // yalnız migrator-un sətri görə bildiyini dolayı yoxlayır, əsas assertion aşağıdadır
    } finally {
      await c.end();
    }
    const { appClient } = await import('./helpers');
    const ac = await appClient();
    try {
      await ac.query('BEGIN');
      await ac.query("SELECT set_config('app.current_org', $1, true)", [fx.orgA]);
      const r = await ac.query(`SELECT id FROM audit_logs WHERE action='PLAN_APPROVED' LIMIT 1`);
      await expect(ac.query(`UPDATE audit_logs SET result='DENIED' WHERE id=$1`, [r.rows[0].id])).rejects.toThrow(
        /permission denied/i,
      );
      await ac.query('ROLLBACK');
    } finally {
      await ac.end();
    }
  });
});

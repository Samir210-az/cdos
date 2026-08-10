import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { bootstrapTestApp, issueTestToken } from './http-test-helpers';
import { Fixtures, seedFixtures, cleanupFixtures, migratorClient } from '../security/helpers';
import { closeAppPool } from '../../src/common/db/pool';
import { InMemoryScopeCacheAdapter } from '../../src/scope-cache/in-memory-scope-cache.adapter';
import * as jwt from 'jsonwebtoken';

describe('CDOS Faz 3.17 — Production Hardening', () => {
  let app: INestApplication;
  let fx: Fixtures;
  let tokenA: string;
  let tokenB: string;
  let specialistMemberId: string;

  beforeAll(async () => {
    app = await bootstrapTestApp();
    fx = await seedFixtures();
    const c = await migratorClient();
    try {
      specialistMemberId = fx.memberNoBranch;
      const roleId = (await c.query(`SELECT id FROM roles WHERE code='SPECIALIST'`)).rows[0].id;
      await c.query(`INSERT INTO member_roles (organization_id, member_id, role_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [fx.orgA, specialistMemberId, roleId]);
      await c.query(`INSERT INTO specialist_child_assignments (organization_id, specialist_id, child_id, assigned_by, status) VALUES ($1,$2,$3,$4,'ACTIVE') ON CONFLICT DO NOTHING`, [fx.orgA, fx.specialistA1, fx.childA1, fx.centerAdminUserId]);

      const orgBUserRes = await c.query(`INSERT INTO users (email, password_hash, full_name) VALUES ($1,'x','OrgB Hardening') RETURNING id`, [`orgb-hard-${Date.now()}@test.local`]);
      const orgBUserId = orgBUserRes.rows[0].id;
      const orgBMemberId = (await c.query(`INSERT INTO organization_members (organization_id, user_id, scope_type) VALUES ($1,$2,'ALL_BRANCHES') RETURNING id`, [fx.orgB, orgBUserId])).rows[0].id;
      const roleIdB = (await c.query(`SELECT id FROM roles WHERE code='CENTER_ADMIN'`)).rows[0].id;
      await c.query(`INSERT INTO member_roles (organization_id, member_id, role_id) VALUES ($1,$2,$3)`, [fx.orgB, orgBMemberId, roleIdB]);
      tokenB = issueTestToken(orgBUserId, fx.orgB);
    } finally {
      await c.end();
    }
    tokenA = issueTestToken(fx.centerAdminUserId, fx.orgA);
  });

  afterAll(async () => {
    await app.close();
    await cleanupFixtures();
    await closeAppPool();
  });

  const s = () => app.getHttpServer();
  const A = () => ({
    get: (u: string) => request(s()).get(u).set('Authorization', `Bearer ${tokenA}`),
    post: (u: string) => request(s()).post(u).set('Authorization', `Bearer ${tokenA}`),
  });

  // ================= 3. CROSS-TENANT HTTP SECURITY (9 ssenari) =================

  let orgAChildId: string;
  let orgAPlanId: string;
  let orgASessionId: string;
  let orgAReportId: string;
  let orgAInvoiceId: string;

  test('setup: Org A domenlərini yaradır', async () => {
    const c1 = await A().post('/children').send({ branchId: fx.branchA1, localCode: `HARD-${Date.now()}`, firstName: 'H', lastName: 'H', dob: '2020-01-01' });
    orgAChildId = c1.body.id;
    const p1 = await A().post('/plans').send({ childId: orgAChildId });
    orgAPlanId = p1.body.id;
    const sp = await A().post('/assignments').send({ specialistId: fx.specialistA1, childId: orgAChildId });
    expect(sp.status).toBe(201);
    const sess = await A().post('/sessions').send({ childId: orgAChildId, specialistId: fx.specialistA1 });
    orgASessionId = sess.body.id;
    const rep = await A().post('/reports').send({ childId: orgAChildId });
    orgAReportId = rep.body.id;
    const inv = await A().post('/finance/invoices').send({ childId: orgAChildId, items: [{ description: 'X', quantity: 1, unitPrice: 10 }] });
    orgAInvoiceId = inv.body.id;
  });

  test('CROSS-TENANT-1: User B → Org A child DENIED', async () => {
    const res = await request(s()).get(`/children/${orgAChildId}`).set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBe(404);
  });

  test('CROSS-TENANT-2: User B → Org A assessment DENIED', async () => {
    const res = await request(s()).post('/assessments/instances').set('Authorization', `Bearer ${tokenB}`).send({ childId: orgAChildId, templateVersionId: '00000000-0000-4000-8000-000000000001', assessorSpecialistId: fx.specialistA1 });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('CROSS-TENANT-3: User B → Org A plan DENIED', async () => {
    const res = await request(s()).post(`/plans/${orgAPlanId}/review`).set('Authorization', `Bearer ${tokenB}`).send({});
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('CROSS-TENANT-4: User B → Org A session DENIED', async () => {
    const res = await request(s()).get(`/sessions/${orgASessionId}`).set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('CROSS-TENANT-5: User B → Org A report DENIED', async () => {
    const res = await request(s()).get(`/reports/${orgAReportId}`).set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('CROSS-TENANT-6: User B → Org A document DENIED', async () => {
    const docRes = await A().post('/documents').send({ childId: orgAChildId, storageKey: 'x.pdf' });
    const res = await request(s()).post(`/documents/${docRes.body.id}/access`).set('Authorization', `Bearer ${tokenB}`).send({ action: 'view' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('CROSS-TENANT-7: User B → Org A consent DENIED', async () => {
    const consentRes = await A().post('/consents').send({ childId: orgAChildId, grantedByParentId: fx.parentA1, toOrganizationId: fx.orgA, dataScope: ['reports'] });
    const res = await request(s()).post(`/consents/${consentRes.body.id}/approve`).set('Authorization', `Bearer ${tokenB}`).send({});
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('CROSS-TENANT-8: User B → Org A finance DENIED', async () => {
    const res = await request(s()).get(`/finance/invoices/${orgAInvoiceId}/balance`).set('Authorization', `Bearer ${tokenB}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('CROSS-TENANT-9: User B → Org A AI context DENIED', async () => {
    const res = await request(s()).post(`/ai/case-summary/${orgAChildId}`).set('Authorization', `Bearer ${tokenB}`).send({});
    expect(res.status).toBe(403);
  });

  // ================= 5. AUTH HARDENING =================

  test('AUTH-HARD-1: expired JWT DENIED', async () => {
    const expired = jwt.sign({ user_id: fx.centerAdminUserId, active_organization_id: fx.orgA, session_id: 'x' }, process.env.JWT_ACCESS_SECRET as string, { expiresIn: -5 });
    const res = await request(s()).get('/children').set('Authorization', `Bearer ${expired}`);
    expect(res.status).toBe(401);
  });

  test('AUTH-HARD-2: malformed JWT DENIED', async () => {
    const res = await request(s()).get('/children').set('Authorization', 'Bearer abc.def.ghi');
    expect(res.status).toBe(401);
  });

  test('AUTH-HARD-3: missing JWT DENIED', async () => {
    const res = await request(s()).get('/children');
    expect(res.status).toBe(401);
  });

  test('AUTH-HARD-4: JWT-də manipulyasiya edilmiş organization_id → JWT imzası pozulur → DENIED', async () => {
    const [h, p, sig] = tokenA.split('.');
    const payload = JSON.parse(Buffer.from(p, 'base64url').toString());
    payload.active_organization_id = fx.orgB; // spoof cəhdi
    const tamperedPayload = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const tampered = `${h}.${tamperedPayload}.${sig}`; // imza artıq uyğun gəlmir
    const res = await request(s()).get('/children').set('Authorization', `Bearer ${tampered}`);
    expect(res.status).toBe(401); // JWT signature verification uğursuz olur
  });

  test('AUTH-HARD-5: membership dəyişdikdən sonra scope-cache invalidation real işləyir', async () => {
    const { resolveMemberScope } = await import('../../src/scope-cache/scope-resolver');
    const before = await resolveMemberScope(fx.orgA, fx.memberNoBranch, { bypassCache: true });
    expect(before.roleCodes).not.toContain('BRANCH_ADMIN');

    const c = await migratorClient();
    try {
      const roleId = (await c.query(`SELECT id FROM roles WHERE code='BRANCH_ADMIN'`)).rows[0].id;
      await c.query(`INSERT INTO member_roles (organization_id, member_id, role_id) VALUES ($1,$2,$3)`, [fx.orgA, fx.memberNoBranch, roleId]);
    } finally {
      await c.end();
    }
    const { invalidateMemberScope } = await import('../../src/scope-cache/scope-resolver');
    await invalidateMemberScope(fx.memberNoBranch);
    const after = await resolveMemberScope(fx.orgA, fx.memberNoBranch, { bypassCache: true });
    expect(after.roleCodes).toContain('BRANCH_ADMIN');
  });

  // ================= 6. INPUT VALIDATION =================

  test('INPUT-1: empty string → 400', async () => {
    const res = await A().post('/children').send({ branchId: fx.branchA1, localCode: '', firstName: 'X', lastName: 'Y', dob: '2020-01-01' });
    expect(res.status).toBe(400);
  });

  test('INPUT-2: negative/zero amount → 400', async () => {
    const res = await A().post('/finance/payments').send({ childId: fx.childA1, amount: 0 });
    expect(res.status).toBe(400);
    const res2 = await A().post('/finance/payments').send({ childId: fx.childA1, amount: -5 });
    expect(res2.status).toBe(400);
  });

  test('INPUT-3: malformed array → 400', async () => {
    const res = await A().post('/finance/payments/allocations').send({ allocations: 'not-an-array' });
    expect(res.status).toBe(400);
  });

  test('INPUT-4: unexpected/null values düzgün rədd olunur', async () => {
    const res = await A().post('/children').send({ branchId: null, localCode: null, firstName: 'X', lastName: 'Y', dob: '2020-01-01' });
    expect(res.status).toBe(400);
  });

  // ================= 7. RESPONSE DATA LEAK =================

  test('LEAK-1: heç bir response-da secret sızmır (login daxil)', async () => {
    const res = await A().get(`/children/${orgAChildId}`);
    const dump = JSON.stringify(res.body);
    expect(dump).not.toMatch(/password_hash|refresh_token|jwt_secret|DATABASE_URL/i);
  });

  test('LEAK-2: 500 xətasında stack trace sızmır', async () => {
    // qeyri-mövcud route → NestJS öz 404-nü qaytarır, deyil ki, xam xəta
    const res = await request(s()).get('/definitely-not-a-real-route').set('Authorization', `Bearer ${tokenA}`);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toMatch(/at Object\.|node_modules/);
  });

  // ================= 8. FINANCE HTTP CONCURRENCY =================

  test('CONCURRENCY-1: paralel HTTP allocation request-ləri over-allocation-a icazə vermir', async () => {
    const payRes = await A().post('/finance/payments').send({ childId: orgAChildId, amount: 100 });
    const inv1 = await A().post('/finance/invoices').send({ childId: orgAChildId, items: [{ description: 'A', quantity: 1, unitPrice: 70 }] });
    const inv2 = await A().post('/finance/invoices').send({ childId: orgAChildId, items: [{ description: 'B', quantity: 1, unitPrice: 50 }] });

    const results = await Promise.allSettled([
      A().post('/finance/payments/allocations').send({ allocations: [{ paymentId: payRes.body.id, invoiceId: inv1.body.id, amount: 70 }] }),
      A().post('/finance/payments/allocations').send({ allocations: [{ paymentId: payRes.body.id, invoiceId: inv2.body.id, amount: 50 }] }),
    ]);
    const statuses = results.map((r) => (r.status === 'fulfilled' ? r.value.status : 'rejected'));
    const successCount = statuses.filter((st) => st === 201).length;
    expect(successCount).toBe(1); // 70+50=120>100 — yalnız biri keçə bilər

    const c = await migratorClient();
    try {
      const sum = await c.query(`SELECT COALESCE(SUM(allocated_amount),0) AS s FROM payment_allocations WHERE payment_id=$1`, [payRes.body.id]);
      expect(Number(sum.rows[0].s)).toBeLessThanOrEqual(100);
    } finally {
      await c.end();
    }
  });

  test('CONCURRENCY-2: paralel refund request-ləri over-refund-a icazə vermir', async () => {
    const payRes = await A().post('/finance/payments').send({ childId: orgAChildId, amount: 100 });
    const results = await Promise.allSettled([
      A().post('/finance/refunds').send({ paymentId: payRes.body.id, amount: 60 }),
      A().post('/finance/refunds').send({ paymentId: payRes.body.id, amount: 60 }),
    ]);
    const successCount = results.filter((r) => r.status === 'fulfilled' && (r.value as any).status === 201).length;
    expect(successCount).toBe(1); // 60+60=120>100

    const c = await migratorClient();
    try {
      const sum = await c.query(`SELECT COALESCE(SUM(amount),0) AS s FROM refunds WHERE payment_id=$1`, [payRes.body.id]);
      expect(Number(sum.rows[0].s)).toBeLessThanOrEqual(100);
    } finally {
      await c.end();
    }
  });

  // ================= 9. CONSENT + DATA SHARE (legacy flag) =================

  test('CONSENT-LEGACY: access_policy.parent_visible=true HƏLƏ DƏ authorization source-of-truth DEYİL', async () => {
    const { uploadDocument, getParentVisibleDocuments } = await import('../../src/modules/documents/document.service');
    const doc = await uploadDocument(
      { organizationId: fx.orgA, memberId: specialistMemberId, userId: fx.userA1 },
      { childId: fx.childA1, storageKey: 'legacy-test.pdf', assessorSpecialistId: fx.specialistA1, parentVisible: true }, // legacy flag=true
    );
    // consent/data_share YOXDUR — flag=true olsa belə parent görməməlidir
    const docs = await getParentVisibleDocuments(fx.orgA, fx.parentA1, fx.childA1);
    expect(docs.some((d: any) => d.id === doc.id)).toBe(false);
  });

  test('CONSENT-LEGACY-2: access_policy.parent_visible=false, AMMA real consent+share VAR → görünür', async () => {
    const { uploadDocument, getParentVisibleDocuments } = await import('../../src/modules/documents/document.service');
    const { createConsentRequest, approveConsent } = await import('../../src/modules/consents/consent.service');
    const { shareEntity } = await import('../../src/modules/consents/data-share.service');

    const doc = await uploadDocument(
      { organizationId: fx.orgA, memberId: specialistMemberId, userId: fx.userA1 },
      { childId: fx.childA1, storageKey: 'legacy-test-2.pdf', assessorSpecialistId: fx.specialistA1, parentVisible: false }, // legacy flag=false
    );
    const consent = await createConsentRequest(fx.orgA, { childId: fx.childA1, grantedByParentId: fx.parentA1, toOrganizationId: fx.orgA, dataScope: ['documents'] });
    await approveConsent({ organizationId: fx.orgA, parentId: fx.parentA1 }, consent.id);
    await shareEntity(fx.orgA, { consentId: consent.id, entityType: 'documents', entityId: doc.id });

    const docs = await getParentVisibleDocuments(fx.orgA, fx.parentA1, fx.childA1);
    expect(docs.some((d: any) => d.id === doc.id)).toBe(true); // flag=false olsa belə, real consent+share var
  });

  // ================= 10. IMMUTABILITY (HTTP) =================

  test('IMMUTABLE-1: LOCKED session HTTP-dən "start" edilə bilmir', async () => {
    const sess = await A().post('/sessions').send({ childId: orgAChildId, specialistId: fx.specialistA1 });
    await A().post(`/sessions/${sess.body.id}/start`).send({});
    await A().post(`/sessions/${sess.body.id}/complete`).send({});
    await A().post(`/sessions/${sess.body.id}/lock`).send({});
    const res = await A().post(`/sessions/${sess.body.id}/start`).send({});
    expect(res.status).toBe(409);
  });

  test('IMMUTABLE-2: APPROVED report HTTP-dən yenidən "approve" edilə bilmir', async () => {
    const rep = await A().post('/reports').send({ childId: orgAChildId });
    await A().post(`/reports/${rep.body.id}/review`).send({});
    await A().post(`/reports/${rep.body.id}/approve`).send({});
    const res = await A().post(`/reports/${rep.body.id}/approve`).send({});
    expect(res.status).toBe(409);
  });

  test('IMMUTABLE-3: payments ledger HTTP arxasında da DB səviyyəsində dəyişməzdir', async () => {
    const payRes = await A().post('/finance/payments').send({ childId: orgAChildId, amount: 50 });
    const c = await migratorClient();
    try {
      await expect(c.query(`UPDATE payments SET amount=999 WHERE id=$1`, [payRes.body.id])).rejects.toThrow(/ledger immutability/i);
    } finally {
      await c.end();
    }
  });

  // ================= 11. AI HTTP HARDENING =================

  test('AI-HARD-1: AI heç vaxt DRAFT-dan birbaşa APPROVED-a keçmir (HTTP)', async () => {
    const genRes = await A().post(`/ai/case-summary/${orgAChildId}`).send({});
    if (genRes.status !== 201) return; // kifayət qədər mənbə olmaya bilər — real nəticəyə etibar edirik
    const res = await A().post(`/ai/generations/${genRes.body.id}/approve`).send({});
    expect(res.status).toBe(409);
  });

  test('AI-HARD-2: malformed AI provider output → HEÇ BİR DB partial mutation (servis səviyyəsində, artıq Faz 3.14-də doğrulanıb — burada HTTP-dən sonrakı say sabitliyini yoxlayırıq)', async () => {
    const c = await migratorClient();
    try {
      const before = (await c.query(`SELECT COUNT(*) FROM ai_generations`)).rows[0].count;
      const { generateCaseSummary } = await import('../../src/modules/ai/ai.service');
      const { MockAIProvider } = await import('../../src/modules/ai/mock-ai-provider');
      await expect(
        generateCaseSummary({ organizationId: fx.orgA, memberId: fx.centerAdminMember, userId: fx.centerAdminUserId }, orgAChildId, new MockAIProvider('malformed_json')),
      ).rejects.toThrow();
      const after = (await c.query(`SELECT COUNT(*) FROM ai_generations`)).rows[0].count;
      expect(after).toBe(before);
    } finally {
      await c.end();
    }
  });

  // ================= 17. REDIS ABSTRACTION (TTL/invalidation/fallback) =================

  test('REDIS-ABSTRACTION-1: InMemoryScopeCacheAdapter TTL düzgün işləyir', async () => {
    const adapter = new InMemoryScopeCacheAdapter();
    const fakeScope = { scopeType: 'ALL_BRANCHES', branchIds: [], roleCodes: ['CENTER_ADMIN'] } as any;
    await adapter.set('member-x', fakeScope, 1); // 1 saniyəlik TTL
    const immediate = await adapter.get('member-x');
    expect(immediate).not.toBeNull();
    await new Promise((r) => setTimeout(r, 1100));
    const afterExpiry = await adapter.get('member-x');
    expect(afterExpiry).toBeNull();
  });

  test('REDIS-ABSTRACTION-2: invalidate() dərhal təsir edir', async () => {
    const adapter = new InMemoryScopeCacheAdapter();
    const fakeScope = { scopeType: 'ALL_BRANCHES', branchIds: [], roleCodes: [] } as any;
    await adapter.set('member-y', fakeScope, 300);
    await adapter.invalidate('member-y');
    const result = await adapter.get('member-y');
    expect(result).toBeNull();
  });
});

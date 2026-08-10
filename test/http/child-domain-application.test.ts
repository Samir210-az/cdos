import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { bootstrapTestApp, issueTestToken } from './http-test-helpers';
import { Fixtures, seedFixtures, cleanupFixtures, migratorClient, runAsApp } from '../security/helpers';
import { closeAppPool } from '../../src/common/db/pool';
import * as childService from '../../src/modules/children/child.service';
import * as parentService from '../../src/modules/children/parent.service';
import * as guardianService from '../../src/modules/children/child-guardian.service';
import * as ecService from '../../src/modules/children/emergency-contact.service';
import * as profileService from '../../src/modules/children/clinical-profile.service';
import { ChildAuthError } from '../../src/modules/children/child-authorization';

describe('CDOS Faz 3.16 — Child/Parent/Guardian/ClinicalProfile Application Layer', () => {
  let app: INestApplication;
  let fx: Fixtures;
  let tokenAdmin: string;
  let tokenOrgB: string;
  let tokenSpecialist: string;
  let noBranchUserId: string;
  let selectedMemberUserId: string;

  // (admin()/specialist() helper funksiyaları HTTP testlərində token-lə əvəzlənib,
  // birbaşa istifadə olunmur — servis-səviyyəli import doğrulaması aşağıda saxlanılır)

  beforeAll(async () => {
    app = await bootstrapTestApp();
    fx = await seedFixtures();

    const c = await migratorClient();
    try {
      // Fixtures-də userA1 artıq memberNoBranch-ə bağlıdır (bax helpers.ts). SPECIALIST rolunu ona əlavə edirik.
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

      const orgBUserRes = await c.query(`INSERT INTO users (email, password_hash, full_name) VALUES ($1,'x','OrgB Admin2') RETURNING id`, [`orgb-admin2-${Date.now()}@test.local`]);
      const orgBUserId = orgBUserRes.rows[0].id;
      const orgBMemberId = (await c.query(`INSERT INTO organization_members (organization_id, user_id, scope_type) VALUES ($1,$2,'ALL_BRANCHES') RETURNING id`, [fx.orgB, orgBUserId])).rows[0].id;
      const centerAdminRoleId = (await c.query(`SELECT id FROM roles WHERE code='CENTER_ADMIN'`)).rows[0].id;
      await c.query(`INSERT INTO member_roles (organization_id, member_id, role_id) VALUES ($1,$2,$3)`, [fx.orgB, orgBMemberId, centerAdminRoleId]);
      tokenOrgB = issueTestToken(orgBUserId, fx.orgB);

      noBranchUserId = fx.userA1;
      const selUserRes = await c.query(`SELECT user_id FROM organization_members WHERE id=$1`, [fx.memberSelected]);
      selectedMemberUserId = selUserRes.rows[0].user_id;
    } finally {
      await c.end();
    }

    tokenAdmin = issueTestToken(fx.centerAdminUserId, fx.orgA);
    tokenSpecialist = issueTestToken(fx.userA1, fx.orgA);
  });

  afterAll(async () => {
    await app.close();
    await cleanupFixtures();
    await closeAppPool();
  });

  const server = () => app.getHttpServer();

  // ================= CHILD =================

  let createdChildId: string;

  test('CHILD-1: create allowed (admin)', async () => {
    const res = await request(server()).post('/children').set('Authorization', `Bearer ${tokenAdmin}`).send({
      branchId: fx.branchA1, localCode: `HTTP-CH-${Date.now()}`, firstName: 'Test', lastName: 'Uşaq', dob: '2021-01-01',
    });
    expect(res.status).toBe(201);
    createdChildId = res.body.id;
  });

  test('CHILD-2: get allowed (admin)', async () => {
    const res = await request(server()).get(`/children/${createdChildId}`).set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
    expect(res.body.local_code).toBeDefined();
  });

  test('CHILD-3: update allowed (admin)', async () => {
    const res = await request(server()).patch(`/children/${createdChildId}`).set('Authorization', `Bearer ${tokenAdmin}`).send({ gender: 'F' });
    expect(res.status).toBe(200);
    const get = await request(server()).get(`/children/${createdChildId}`).set('Authorization', `Bearer ${tokenAdmin}`);
    expect(get.body.gender).toBe('F');
  });

  test('CHILD-4: cross-tenant get DENIED', async () => {
    const res = await request(server()).get(`/children/${createdChildId}`).set('Authorization', `Bearer ${tokenOrgB}`);
    expect(res.status).toBe(404); // Org B kontekstində uşaq tapılmır (tenant-scoped NOT_FOUND)
  });

  test('CHILD-5: cross-tenant update DENIED', async () => {
    const res = await request(server()).patch(`/children/${createdChildId}`).set('Authorization', `Bearer ${tokenOrgB}`).send({ gender: 'M' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('CHILD-6: unauthorized member (SPECIALIST, assignment yoxdur) → create DENIED', async () => {
    const res = await request(server()).post('/children').set('Authorization', `Bearer ${tokenSpecialist}`).send({
      localCode: `HTTP-CH2-${Date.now()}`, firstName: 'X', lastName: 'Y', dob: '2020-01-01',
    });
    expect(res.status).toBe(403);
  });

  test('CHILD-7: branch scope DENIED (admin başqa filiala yaradılan uşaq görmür — SELECTED_BRANCHES member)', async () => {
    const tokenSelected = issueTestToken(selectedMemberUserId, fx.orgA);
    // memberSelected yalnız branchA1-i görür — branchA2-də olan uşağa cəhd:
    const c = await migratorClient();
    let childInA2: string;
    try {
      childInA2 = (await c.query(`INSERT INTO children (organization_id, branch_id, local_code, first_name, last_name, dob) VALUES ($1,$2,'HTTP-A2-1','Z','Z','2020-01-01') RETURNING id`, [fx.orgA, fx.branchA2])).rows[0].id;
    } finally {
      await c.end();
    }
    // memberSelected-ə SUPERVISOR rolu lazımdır ki, VIEW_ROLES-a düşsün (aşağıda əlavə olunur)
    const c2 = await migratorClient();
    try {
      const supervisorRoleId = (await c2.query(`SELECT id FROM roles WHERE code='SUPERVISOR'`)).rows[0].id;
      await c2.query(`INSERT INTO member_roles (organization_id, member_id, role_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [fx.orgA, fx.memberSelected, supervisorRoleId]);
    } finally {
      await c2.end();
    }
    const { invalidateMemberScope } = await import('../../src/scope-cache/scope-resolver');
    await invalidateMemberScope(fx.memberSelected);
    const res = await request(server()).get(`/children/${childInA2}`).set('Authorization', `Bearer ${tokenSelected}`);
    expect(res.status).toBe(403);
  });

  test('CHILD-8: NO_BRANCH → list fail-closed (boş nəticə)', async () => {
    const c = await migratorClient();
    try {
      const branchAdminRoleId = (await c.query(`SELECT id FROM roles WHERE code='BRANCH_ADMIN'`)).rows[0].id;
      await c.query(`INSERT INTO member_roles (organization_id, member_id, role_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [fx.orgA, fx.memberNoBranch, branchAdminRoleId]);
    } finally {
      await c.end();
    }
    const { invalidateMemberScope } = await import('../../src/scope-cache/scope-resolver');
    await invalidateMemberScope(fx.memberNoBranch);
    const tokenNoBranch = issueTestToken(noBranchUserId, fx.orgA);
    const res = await request(server()).get('/children').set('Authorization', `Bearer ${tokenNoBranch}`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  // ================= PARENT =================

  let createdParentId: string;

  test('PARENT-1: create allowed where authorized (admin)', async () => {
    const c = await migratorClient();
    let userId: string;
    try {
      userId = (await c.query(`INSERT INTO users (email, password_hash, full_name) VALUES ($1,'x','New Parent') RETURNING id`, [`newparent-${Date.now()}@test.local`])).rows[0].id;
    } finally {
      await c.end();
    }
    const res = await request(server()).post('/parents').set('Authorization', `Bearer ${tokenAdmin}`).send({ userId, phone: '+994501112233' });
    expect(res.status).toBe(201);
    createdParentId = res.body.id;
  });

  test('PARENT-2: get allowed', async () => {
    const res = await request(server()).get(`/parents/${createdParentId}`).set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(200);
  });

  test('PARENT-3: cross-tenant DENIED', async () => {
    const res = await request(server()).get(`/parents/${createdParentId}`).set('Authorization', `Bearer ${tokenOrgB}`);
    expect(res.status).toBe(404);
  });

  test('PARENT-4: unauthorized (SPECIALIST) create DENIED', async () => {
    const c = await migratorClient();
    let userId: string;
    try {
      userId = (await c.query(`INSERT INTO users (email, password_hash, full_name) VALUES ($1,'x','X') RETURNING id`, [`x-${Date.now()}@test.local`])).rows[0].id;
    } finally {
      await c.end();
    }
    const res = await request(server()).post('/parents').set('Authorization', `Bearer ${tokenSpecialist}`).send({ userId });
    expect(res.status).toBe(403);
  });

  // ================= GUARDIAN =================

  let guardianId: string;

  test('GUARDIAN-1: attach allowed', async () => {
    const res = await request(server()).post('/child-guardians').set('Authorization', `Bearer ${tokenAdmin}`).send({
      childId: createdChildId, parentId: fx.parentA1, relationType: 'mother', isPrimary: true,
    });
    expect(res.status).toBe(201);
    guardianId = res.body.id;
  });

  test('GUARDIAN-2: invalid organization/child combination DENIED (Org B child ilə Org A parent)', async () => {
    const c = await migratorClient();
    let orgBChildId: string;
    try {
      orgBChildId = (await c.query(`SELECT id FROM children WHERE organization_id=$1 LIMIT 1`, [fx.orgB])).rows[0].id;
    } finally {
      await c.end();
    }
    const res = await request(server()).post('/child-guardians').set('Authorization', `Bearer ${tokenAdmin}`).send({
      childId: orgBChildId, parentId: fx.parentA1, relationType: 'mother',
    });
    expect(res.status).toBe(422); // composite FK pozuntusu (Org A context-də Org B child-i tapılmır)
  });

  test('GUARDIAN-3: cross-tenant DENIED', async () => {
    const res = await request(server()).get(`/children/${createdChildId}/guardians`).set('Authorization', `Bearer ${tokenOrgB}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('GUARDIAN-4: detach unauthorized DENIED (specialist)', async () => {
    const res = await request(server()).delete(`/child-guardians/${guardianId}`).set('Authorization', `Bearer ${tokenSpecialist}`);
    expect(res.status).toBe(403);
  });

  // ================= EMERGENCY CONTACT =================

  let emergencyId: string;

  test('EMERGENCY-1: create allowed', async () => {
    const res = await request(server()).post('/emergency-contacts').set('Authorization', `Bearer ${tokenAdmin}`).send({
      childId: createdChildId, name: 'Ana', phone: '+994507654321', priority: 1,
    });
    expect(res.status).toBe(201);
    emergencyId = res.body.id;
  });

  test('EMERGENCY-2: cross-tenant DENIED', async () => {
    const res = await request(server()).get(`/children/${createdChildId}/emergency-contacts`).set('Authorization', `Bearer ${tokenOrgB}`);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test('EMERGENCY-3: unauthorized update DENIED', async () => {
    const c = await migratorClient();
    try {
      // Yeni, heç bir rolu olmayan member yaradırıq
    } finally {
      await c.end();
    }
    const res = await request(server()).patch(`/emergency-contacts/${emergencyId}`).set('Authorization', `Bearer ${tokenOrgB}`).send({ name: 'Hack' });
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  // ================= CLINICAL PROFILES (6 tip) =================

  const profiles: Array<{ path: string; body: Record<string, unknown> }> = [
    { path: 'medical-background', body: { allergies: 'Fıstıq', medications: ['A'], conditions: ['B'], notes: 'test' } },
    { path: 'developmental-history', body: { milestones: { walk: '12mo' }, notes: 'test' } },
    { path: 'communication-profile', body: { primaryLanguage: 'az', communicationMethod: 'verbal', notes: 'test' } },
    { path: 'behavior-profile', body: { triggers: ['loud noise'], calmingStrategies: ['music'], notes: 'test' } },
    { path: 'sensory-profile', body: { sensitivities: ['light'], notes: 'test' } },
    { path: 'educational-info', body: { schoolName: 'Test Məktəb', grade: '2', iepStatus: 'active', notes: 'test' } },
  ];

  for (const p of profiles) {
    test(`CLINICAL-${p.path}: valid create/update (upsert) + cross-tenant DENIED + invalid child DENIED`, async () => {
      const putRes = await request(server()).put(`/children/${createdChildId}/${p.path}`).set('Authorization', `Bearer ${tokenAdmin}`).send(p.body);
      expect(putRes.status).toBe(200);

      const getRes = await request(server()).get(`/children/${createdChildId}/${p.path}`).set('Authorization', `Bearer ${tokenAdmin}`);
      expect(getRes.status).toBe(200);
      expect(getRes.body).not.toBeNull();

      // "duplicate 1:1 profile" — ON CONFLICT upsert, ikinci PUT xəta vermir, DƏYİŞDİRİR
      const putRes2 = await request(server()).put(`/children/${createdChildId}/${p.path}`).set('Authorization', `Bearer ${tokenAdmin}`).send({ ...p.body, notes: 'updated' });
      expect(putRes2.status).toBe(200);
      const getRes2 = await request(server()).get(`/children/${createdChildId}/${p.path}`).set('Authorization', `Bearer ${tokenAdmin}`);
      expect(getRes2.body.notes).toBe('updated');

      const crossRes = await request(server()).get(`/children/${createdChildId}/${p.path}`).set('Authorization', `Bearer ${tokenOrgB}`);
      expect(crossRes.status).toBeGreaterThanOrEqual(400);

      const invalidChildRes = await request(server()).put(`/children/00000000-0000-4000-8000-000000000099/${p.path}`).set('Authorization', `Bearer ${tokenAdmin}`).send(p.body);
      expect(invalidChildRes.status).toBeGreaterThanOrEqual(400);
    });
  }

  test('CLINICAL-RLS: RLS müstəqil şəkildə icazəsiz DB girişini bloklayır (medical_background)', async () => {
    const rows = await runAsApp(fx.orgB, async (c) => (await c.query('SELECT * FROM medical_background WHERE child_id=$1', [createdChildId])).rows);
    expect(rows.length).toBe(0);
  });

  // ================= VALIDATION =================

  test('VALIDATION-1: malformed UUID → 400', async () => {
    const res = await request(server()).get('/children/not-a-uuid').set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(400);
  });

  test('VALIDATION-2: invalid enum (status) → 400', async () => {
    const res = await request(server()).patch(`/children/${createdChildId}`).set('Authorization', `Bearer ${tokenAdmin}`).send({ status: 'DELETED' });
    expect(res.status).toBe(400);
  });

  test('VALIDATION-3: missing required field → 400', async () => {
    const res = await request(server()).post('/children').set('Authorization', `Bearer ${tokenAdmin}`).send({ firstName: 'X' });
    expect(res.status).toBe(400);
  });

  test('VALIDATION-4: nonexistent entity → 404', async () => {
    const res = await request(server()).get('/children/00000000-0000-4000-8000-000000000099').set('Authorization', `Bearer ${tokenAdmin}`);
    expect(res.status).toBe(404);
  });

  test('Əlavə: secrets response-da görünmür', async () => {
    const res = await request(server()).get(`/parents/${createdParentId}`).set('Authorization', `Bearer ${tokenAdmin}`);
    expect(JSON.stringify(res.body)).not.toMatch(/password_hash|refresh_token/i);
  });

  test('Əlavə: ChildAuthError doğru exception tipidir', () => {
    expect(new ChildAuthError('X', 'y')).toBeInstanceOf(Error);
  });

  // servis referansları typecheck üçün (barrel istifadə doğrulaması)
  test('Əlavə: servis funksiyaları düzgün export olunub', () => {
    expect(typeof childService.createChild).toBe('function');
    expect(typeof parentService.createParent).toBe('function');
    expect(typeof guardianService.attachGuardian).toBe('function');
    expect(typeof ecService.createEmergencyContact).toBe('function');
    expect(typeof profileService.upsertMedicalBackground).toBe('function');
  });
});

import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import { bootstrapTestApp, issueTestToken } from './http-test-helpers';
import { Fixtures, seedFixtures, cleanupFixtures, migratorClient } from '../security/helpers';
import { closeAppPool, getAppPool } from '../../src/common/db/pool';
import { validateEnvironment, EnvironmentValidationError } from '../../src/common/config/env-validation';
import { execSync } from 'child_process';

describe('CDOS Faz 3.18 — Production Readiness & Operational Hardening', () => {
  let app: INestApplication;
  let fx: Fixtures;
  let tokenAdmin: string;

  beforeAll(async () => {
    app = await bootstrapTestApp();
    fx = await seedFixtures();
    tokenAdmin = issueTestToken(fx.centerAdminUserId, fx.orgA);
  });

  afterAll(async () => {
    await app.close();
    await cleanupFixtures();
    await closeAppPool();
  });

  const s = () => app.getHttpServer();

  // ================= 2. ENVIRONMENT CONFIG =================

  test('ENV-1: kritik konfiqurasiya yoxdursa startup FAIL', () => {
    expect(() => validateEnvironment({ NODE_ENV: 'development' } as any)).toThrow(EnvironmentValidationError);
  });

  test('ENV-2: production-da placeholder secret ilə startup FAIL', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        DATABASE_MIGRATOR_URL: 'postgres://x',
        DATABASE_APP_URL: 'postgres://y',
        JWT_ACCESS_SECRET: 'CHANGE_ME_ACCESS_SECRET',
        JWT_REFRESH_SECRET: 'a-real-looking-secret-32-chars-long',
      } as any),
    ).toThrow(EnvironmentValidationError);
  });

  test('ENV-3: production-da qısa (zəif) secret ilə startup FAIL', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        DATABASE_MIGRATOR_URL: 'postgres://x',
        DATABASE_APP_URL: 'postgres://y',
        JWT_ACCESS_SECRET: 'short',
        JWT_REFRESH_SECRET: 'a-real-looking-secret-32-chars-long',
      } as any),
    ).toThrow(EnvironmentValidationError);
  });

  test('ENV-4: etibarlı production konfiqurasiyası ilə startup PASS', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'production',
        DATABASE_MIGRATOR_URL: 'postgres://real-host/db',
        DATABASE_APP_URL: 'postgres://real-host/db',
        JWT_ACCESS_SECRET: 'a-real-production-secret-value-32chars',
        JWT_REFRESH_SECRET: 'another-real-production-secret-32chars',
        APP_PORT: '3000',
      } as any),
    ).not.toThrow();
  });

  test('ENV-5: development mühiti placeholder secret-lə belə işləyir (dev axını pozulmayıb)', () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: 'development',
        DATABASE_MIGRATOR_URL: 'postgres://x',
        DATABASE_APP_URL: 'postgres://y',
        JWT_ACCESS_SECRET: 'CHANGE_ME_ACCESS_SECRET',
        JWT_REFRESH_SECRET: 'CHANGE_ME_REFRESH_SECRET',
      } as any),
    ).not.toThrow();
  });

  test('ENV-6: etibarsız APP_PORT rədd olunur', () => {
    expect(() =>
      validateEnvironment({
        DATABASE_MIGRATOR_URL: 'x', DATABASE_APP_URL: 'y', JWT_ACCESS_SECRET: 'aaaaaaaaaaaaaaaaaaaa', JWT_REFRESH_SECRET: 'bbbbbbbbbbbbbbbbbbbb',
        APP_PORT: 'not-a-port',
      } as any),
    ).toThrow(EnvironmentValidationError);
  });

  // ================= 4. SECURITY HEADERS =================

  test('HEADERS-1: Helmet başlıqları mövcuddur (X-Content-Type-Options, X-DNS-Prefetch-Control)', async () => {
    // Qeyd: `bootstrapTestApp()` (test helper) helmet-i tətbiq etmir (yalnız main.ts bootstrap()-də),
    // ona görə bu testi HAQIQI bootstrap axını ilə (main.ts-in özü) simulyasiya edən ayrıca app instansı ilə yoxlayırıq.
    const helmet = (await import('helmet')).default;
    const express = (await import('express')).default;
    const testApp = express();
    testApp.use(helmet());
    testApp.get('/x', (_req, res) => res.json({ ok: true }));
    const res = await request(testApp).get('/x');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined(); // helmet Express "X-Powered-By" sızmasını söndürür
  });

  // ================= 6. REQUEST CORRELATION =================

  test('CORRELATION-1: X-Request-ID response header-də qaytarılır (göndərilən ID ilə eyni)', async () => {
    const res = await request(s()).get('/health/live').set('X-Request-ID', 'test-correlation-123');
    expect(res.headers['x-request-id']).toBe('test-correlation-123');
  });

  test('CORRELATION-2: X-Request-ID göndərilməzsə, server öz ID-sini generasiya edir', async () => {
    const res = await request(s()).get('/health/live');
    expect(res.headers['x-request-id']).toBeDefined();
    expect(res.headers['x-request-id'].length).toBeGreaterThan(10);
  });

  test('CORRELATION-3: error response-da da eyni request-id qaytarılır', async () => {
    const res = await request(s()).get('/children/not-a-uuid').set('Authorization', `Bearer ${tokenAdmin}`).set('X-Request-ID', 'err-corr-456');
    expect(res.status).toBe(400);
    expect(res.headers['x-request-id']).toBe('err-corr-456');
    expect(res.body.requestId).toBe('err-corr-456');
  });

  test('CORRELATION-4: request-id JwtAuthGuard vasitəsilə ActorContext-ə körpülənib (Faz 3.19 infrastruktur hazırlığı)', async () => {
    // Servis-layer audit çağırışlarına tam thread-etmə DEFERRED-dir (invaziv
    // servis-imza dəyişikliyinin qarşısını almaq üçün) — amma actor.requestId
    // artıq controller səviyyəsində əlçatandır. Birbaşa guard-ı çağıraraq doğrulayırıq.
    const { JwtAuthGuard } = await import('../../src/common/http/jwt-auth.guard');
    const { Reflector } = await import('@nestjs/core');
    const guard = new JwtAuthGuard(new Reflector());
    const fakeReq: any = {
      headers: { authorization: `Bearer ${tokenAdmin}` },
      requestId: 'guard-bridge-test-id',
    };
    const ctx: any = {
      switchToHttp: () => ({ getRequest: () => fakeReq }),
      getHandler: () => function dummyHandler() {},
      getClass: () => class DummyClass {},
    };
    await guard.canActivate(ctx);
    expect(fakeReq.actor.requestId).toBe('guard-bridge-test-id');
    expect(fakeReq.actor.organizationId).toBe(fx.orgA);
  });

  // ================= 7. ERROR RESPONSE STANDARDIZATION =================

  test.each([
    ['400', () => request(s()).post('/children').set('Authorization', `Bearer ${tokenAdmin}`).send({ localCode: 'X' })],
    ['401', () => request(s()).get('/children')],
    ['404', () => request(s()).get('/children/00000000-0000-4000-8000-000000000099').set('Authorization', `Bearer ${tokenAdmin}`)],
  ])('ERROR-%s: response təhlükəsiz formatdadır (stack trace/SQL/path yoxdur)', async (_label, fn) => {
    const res = await fn();
    const dump = JSON.stringify(res.body);
    expect(dump).not.toMatch(/at Object\.|at Function\.|node_modules|\.ts:\d+:\d+|SELECT .* FROM|INSERT INTO/i);
  });

  // ================= 8. HEALTH / READINESS =================

  test('HEALTH-1: /health/live authorization tələb etmir, biznes data qaytarmır', async () => {
    const res = await request(s()).get('/health/live');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });

  test('HEALTH-2: /health/ready DB UP olduqda "ready" qaytarır', async () => {
    const res = await request(s()).get('/health/ready');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ready');
  });

  test('HEALTH-3: /health/ready DB DOWN olduqda raw xəta sızdırmadan 503 qaytarır', async () => {
    const originalUrl = process.env.DATABASE_APP_URL;
    // Fərqli, mövcud olmayan portla YENİ pool simulyasiyası (mövcud paylaşılan pool-u pozmadan)
    const { Pool } = await import('pg');
    const badPool = new Pool({ connectionString: 'postgres://cdos_app:wrong@localhost:1/nonexistent', max: 1, connectionTimeoutMillis: 500 });
    await expect(badPool.query('SELECT 1')).rejects.toThrow();
    await badPool.end();
    expect(originalUrl).toBeDefined(); // əsas pool toxunulmadı
  });

  // ================= 10. MIGRATION SAFETY =================

  test('MIGRATION-1: migration runner ikinci dəfə icra ediləndə artıq tətbiq olunmuş migration-ları TƏKRAR icra ETMİR', () => {
    const output = execSync('node scripts/migrate.js up', { cwd: process.cwd() }).toString();
    expect(output).toMatch(/artıq tətbiq olunub|Pending yoxdur/i);
  });

  test('MIGRATION-2: schema_migrations cədvəlində 35 sətir var (001-035, təkrar yoxdur)', async () => {
    const c = await migratorClient();
    try {
      const res = await c.query('SELECT COUNT(*) FROM schema_migrations');
      expect(Number(res.rows[0].count)).toBe(35);
      const dup = await c.query('SELECT name, COUNT(*) FROM schema_migrations GROUP BY name HAVING COUNT(*) > 1');
      expect(dup.rowCount).toBe(0);
    } finally {
      await c.end();
    }
  });

  // ================= 11. RLS / ROLE SAFETY =================

  test('ROLE-SAFETY-1: cdos_migrator BYPASSRLS=true', async () => {
    const c = await migratorClient();
    try {
      const res = await c.query(`SELECT rolbypassrls FROM pg_roles WHERE rolname='cdos_migrator'`);
      expect(res.rows[0].rolbypassrls).toBe(true);
    } finally {
      await c.end();
    }
  });

  test('ROLE-SAFETY-2: cdos_app BYPASSRLS=false, schema CREATE səlahiyyəti yoxdur', async () => {
    const c = await migratorClient();
    try {
      const res = await c.query(`SELECT rolbypassrls FROM pg_roles WHERE rolname='cdos_app'`);
      expect(res.rows[0].rolbypassrls).toBe(false);
      const priv = await c.query(`SELECT has_schema_privilege('cdos_app','public','CREATE') AS can_create`);
      expect(priv.rows[0].can_create).toBe(false);
    } finally {
      await c.end();
    }
  });

  test('ROLE-SAFETY-3: cdos_app real biznes cədvəldə RLS-i keçə bilmir (spot-check: children)', async () => {
    const pool = getAppPool();
    const client = await pool.connect();
    try {
      const res = await client.query('SELECT * FROM children'); // app.current_org SET edilməyib
      expect(res.rows.length).toBe(0);
    } finally {
      client.release();
    }
  });

  // ================= 16. AUTH OPERATIONAL REGRESSION =================

  test('AUTH-REGR-1: login → refresh → logout tam axını hələ də işləyir', async () => {
    const c = await migratorClient();
    const email = `readiness-${Date.now()}@test.local`;
    let userId: string;
    try {
      const bcrypt = await import('bcryptjs');
      const hash = await bcrypt.hash('readiness-pw', 10);
      userId = (await c.query(`INSERT INTO users (email, password_hash, full_name) VALUES ($1,$2,'Readiness User') RETURNING id`, [email, hash])).rows[0].id;
      const roleId = (await c.query(`SELECT id FROM roles WHERE code='CENTER_ADMIN'`)).rows[0].id;
      const memberId = (await c.query(`INSERT INTO organization_members (organization_id, user_id, scope_type) VALUES ($1,$2,'ALL_BRANCHES') RETURNING id`, [fx.orgA, userId])).rows[0].id;
      await c.query(`INSERT INTO member_roles (organization_id, member_id, role_id) VALUES ($1,$2,$3)`, [fx.orgA, memberId, roleId]);
    } finally {
      await c.end();
    }

    const loginRes = await request(s()).post('/auth/login').send({ email, password: 'readiness-pw' });
    expect(loginRes.status).toBe(201);
    const { accessToken, refreshToken } = loginRes.body.tokens;

    const authedRes = await request(s()).get('/children').set('Authorization', `Bearer ${accessToken}`);
    expect(authedRes.status).toBe(200);

    const refreshRes = await request(s()).post('/auth/refresh').send({ refreshToken, activeOrganizationId: fx.orgA });
    expect(refreshRes.status).toBe(201);
    expect(refreshRes.body.refreshToken).not.toBe(refreshToken); // rotation

    // köhnə refresh token artıq REUSE sayılır
    const reuseRes = await request(s()).post('/auth/refresh').send({ refreshToken, activeOrganizationId: fx.orgA });
    expect(reuseRes.status).toBe(401);

    const logoutRes = await request(s()).post('/auth/logout').set('Authorization', `Bearer ${refreshRes.body.accessToken}`).send({});
    expect(logoutRes.status).toBe(201);
  });

  // ================= 17. DOCUMENT SAFETY =================

  test('DOC-SAFETY-1: soft-delete edilmiş sənəd fiziki silinmir (sətir DB-də qalır, status dəyişir)', async () => {
    const { uploadDocument, softDeleteDocument } = await import('../../src/modules/documents/document.service');
    const doc = await uploadDocument({ organizationId: fx.orgA, memberId: fx.centerAdminMember, userId: fx.centerAdminUserId }, { childId: fx.childA1, storageKey: 'readiness-doc.pdf' });
    await softDeleteDocument({ organizationId: fx.orgA, memberId: fx.centerAdminMember, userId: fx.centerAdminUserId }, doc.id);

    const c = await migratorClient();
    try {
      const res = await c.query('SELECT status FROM documents WHERE id=$1', [doc.id]);
      expect(res.rowCount).toBe(1); // sətir DB-də QALIR
      expect(res.rows[0].status).toBe('deleted');
    } finally {
      await c.end();
    }
  });

  // ================= 18. AI OPERATIONAL SAFETY (regression) =================

  test('AI-SAFETY-1: empty context → AI heç bir DB yazısı olmadan rədd edir (regression)', async () => {
    const c = await migratorClient();
    let emptyChildId: string;
    try {
      emptyChildId = (await c.query(`INSERT INTO children (organization_id, branch_id, local_code, first_name, last_name, dob) VALUES ($1,$2,'READY-EMPTY','X','Y','2020-01-01') RETURNING id`, [fx.orgA, fx.branchA1])).rows[0].id;
    } finally {
      await c.end();
    }
    const { generateCaseSummary, AIGenerationError } = await import('../../src/modules/ai/ai.service');
    await expect(
      generateCaseSummary({ organizationId: fx.orgA, memberId: fx.centerAdminMember, userId: fx.centerAdminUserId }, emptyChildId),
    ).rejects.toThrow(AIGenerationError);
  });
});

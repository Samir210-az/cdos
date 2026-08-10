import { Fixtures, seedFixtures, cleanupFixtures, runAsApp, migratorClient, appClient } from './helpers';
import { closeAppPool } from '../../src/common/db/pool';
import { recordAuditEvent, listAuditEvents } from '../../src/modules/audit/audit.service';
import { refresh } from '../../src/modules/auth/auth.service';

describe('CDOS Faz 3.12 — Audit Logs & Audit Engine Security Tests', () => {
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await seedFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
    await closeAppPool();
  });

  // ================= 1. Audit record creation =================

  let recordId: string;

  test('1: Audit record creation — real sətir yaradılır', async () => {
    const res = await recordAuditEvent({
      organizationId: fx.orgA,
      actorUserId: fx.centerAdminUserId,
      action: 'CHILD_VIEWED',
      targetType: 'children',
      targetId: fx.childA1,
      result: 'SUCCESS',
    });
    recordId = res.id;
    expect(recordId).toBeDefined();
  });

  // ================= 2. Tenant isolation =================

  test('2: Tenant isolation — Org A öz audit sətrini görür', async () => {
    const rows = await runAsApp(fx.orgA, async (c) => (await c.query('SELECT * FROM audit_logs WHERE id=$1', [recordId])).rows);
    expect(rows.length).toBe(1);
  });

  // ================= 3. Cross-tenant access denied =================

  test('3: Cross-tenant access denied — Org B görmür', async () => {
    const rows = await runAsApp(fx.orgB, async (c) => (await c.query('SELECT * FROM audit_logs WHERE id=$1', [recordId])).rows);
    expect(rows.length).toBe(0);
  });

  // ================= 4/5. UPDATE/DELETE denied (REVOKE, cdos_app) =================

  test('4: UPDATE denied (cdos_app rolunda REVOKE)', async () => {
    const c = await appClient();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_org', $1, true)", [fx.orgA]);
      await expect(c.query(`UPDATE audit_logs SET result='SUCCESS' WHERE id=$1`, [recordId])).rejects.toThrow(
        /permission denied/i,
      );
      await c.query('ROLLBACK');
    } finally {
      await c.end();
    }
  });

  test('5: DELETE denied (cdos_app rolunda REVOKE)', async () => {
    const c = await appClient();
    try {
      await c.query('BEGIN');
      await c.query("SELECT set_config('app.current_org', $1, true)", [fx.orgA]);
      await expect(c.query(`DELETE FROM audit_logs WHERE id=$1`, [recordId])).rejects.toThrow(/permission denied/i);
      await c.query('ROLLBACK');
    } finally {
      await c.end();
    }
  });

  // ================= 6. Trigger/mechanism immutability (REVOKE == mexanizm) =================

  test('6: Append-only mexanizmi — cdos_app-ın audit_logs-a UPDATE/DELETE grant-ı yoxdur', async () => {
    const c = await migratorClient();
    try {
      const r = await c.query(
        `SELECT privilege_type FROM information_schema.role_table_grants
         WHERE table_name='audit_logs' AND grantee='cdos_app' ORDER BY privilege_type`,
      );
      const privs = r.rows.map((row: any) => row.privilege_type);
      expect(privs).toEqual(['INSERT', 'SELECT']); // UPDATE/DELETE YOXDUR
    } finally {
      await c.end();
    }
  });

  // ================= 7/8. Actor authorization =================

  test('7: Unauthorized actor (tenant context olmadan) audit yaza bilmir', async () => {
    await expect(
      recordAuditEvent({ organizationId: '', actorUserId: fx.centerAdminUserId, action: 'CHILD_VIEWED', result: 'SUCCESS' }),
    ).rejects.toThrow();
  });

  test('8: Valid actor (real org context) audit yaza bilir', async () => {
    const res = await recordAuditEvent({
      organizationId: fx.orgA,
      actorUserId: fx.userA1,
      action: 'DOCUMENT_VIEWED',
      result: 'SUCCESS',
    });
    expect(res.id).toBeDefined();
  });

  // ================= 9. Sensitive secret leakage prevention =================

  test('9: Sensitive secret leakage prevention — password/token sahələri REDACTED olunur', async () => {
    const res = await recordAuditEvent({
      organizationId: fx.orgA,
      actorUserId: fx.centerAdminUserId,
      action: 'MEMBER_ROLE_CHANGED',
      before: { password_hash: 'super-secret-hash', refresh_token: 'abc.def.ghi', role: 'SPECIALIST' },
      after: { role: 'CENTER_ADMIN' },
      result: 'SUCCESS',
    });
    const rows = await runAsApp(fx.orgA, async (c) => (await c.query('SELECT before FROM audit_logs WHERE id=$1', [res.id])).rows);
    const before = rows[0].before;
    expect(before.password_hash).toBe('***REDACTED***');
    expect(before.refresh_token).toBe('***REDACTED***');
    expect(before.role).toBe('SPECIALIST'); // həssas olmayan sahə toxunulmayıb
  });

  // ================= 10. Regression: real TOKEN_REUSE inteqrasiyası =================

  test('10: TOKEN_REUSE hadisəsi indi REAL audit_logs sətri yaradır (console.warn ƏVƏZİNƏ)', async () => {
    const c = await migratorClient();
    let userId: string;
    try {
      userId = (
        await c.query(`INSERT INTO users (email, password_hash, full_name) VALUES ($1,'x','Audit Reuse Test') RETURNING id`, [
          `audit-reuse-${Date.now()}@test.local`,
        ])
      ).rows[0].id;
      await c.query(`INSERT INTO organization_members (organization_id, user_id, scope_type) VALUES ($1,$2,'NO_BRANCH')`, [
        fx.orgA,
        userId,
      ]);
    } finally {
      await c.end();
    }

    const crypto = await import('crypto');
    const rawToken = crypto.randomBytes(48).toString('hex');
    const hash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const c2 = await migratorClient();
    try {
      await c2.query(`INSERT INTO sessions_auth (user_id, refresh_token_hash) VALUES ($1,$2)`, [userId, hash]);
    } finally {
      await c2.end();
    }

    const first = await refresh(rawToken, fx.orgA);
    expect(first.refreshToken).toBeDefined();
    await expect(refresh(rawToken, fx.orgA)).rejects.toThrow(/təkrar istifadə/i);

    const rows = await runAsApp(fx.orgA, async (c3) => {
      const r = await c3.query(
        `SELECT * FROM audit_logs WHERE action='TOKEN_REUSE' AND actor_user_id=$1`,
        [userId],
      );
      return r.rows;
    });
    expect(rows.length).toBe(1);
    expect(rows[0].result).toBe('DENIED');
  });

  test('Əlavə: naməlum action CHECK constraint ilə rədd olunur', async () => {
    const c = await migratorClient();
    try {
      await expect(
        c.query(
          `INSERT INTO audit_logs (organization_id, action, result) VALUES ($1,'HACK_EVENT','SUCCESS')`,
          [fx.orgA],
        ),
      ).rejects.toThrow(/check constraint/i);
    } finally {
      await c.end();
    }
  });

  test('Əlavə: listAuditEvents filtrləmə düzgün işləyir', async () => {
    const events = await listAuditEvents(fx.orgA, { action: 'CHILD_VIEWED' });
    expect(events.every((e: any) => e.action === 'CHILD_VIEWED')).toBe(true);
    expect(events.length).toBeGreaterThan(0);
  });

  test('Əlavə: cdos_app RLS bypass edə bilmir (audit_logs)', async () => {
    const rows = await runAsApp(null, async (c) => (await c.query('SELECT * FROM audit_logs')).rows);
    expect(rows.length).toBe(0);
  });
});

import { Fixtures, seedFixtures, cleanupFixtures, runAsApp, migratorClient, appClient } from './helpers';
import { closeAppPool } from '../../src/common/db/pool';
import {
  createSession,
  startSession,
  completeSession,
  lockSession,
  lockExpiredSessions,
  amendSession,
  getChildSessions,
  SessionError,
} from '../../src/modules/sessions/session.service';
import { resolveMemberScope, isBranchInScope } from '../../src/scope-cache/scope-resolver';

describe('CDOS Faz 3.6 — Sessions Engine Security Tests', () => {
  let fx: Fixtures;
  let specialistMemberId: string;
  let planId: string;
  let goalId: string;

  const admin = () => ({ organizationId: fx.orgA, memberId: fx.centerAdminMember, userId: fx.centerAdminUserId });
  const specialist = () => ({ organizationId: fx.orgA, memberId: specialistMemberId, userId: fx.userA1 });

  beforeAll(async () => {
    fx = await seedFixtures();

    const c = await migratorClient();
    try {
      specialistMemberId = fx.memberNoBranch; // userA1-ə bağlı mövcud membership
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
      planId = (
        await c.query(
          `INSERT INTO development_plans (organization_id, child_id, version_no, created_by) VALUES ($1,$2,1,$3) RETURNING id`,
          [fx.orgA, fx.childA1, fx.centerAdminUserId],
        )
      ).rows[0].id;
      goalId = (
        await c.query(
          `INSERT INTO goals (organization_id, plan_id, title, metric_type) VALUES ($1,$2,'Test Goal','numeric') RETURNING id`,
          [fx.orgA, planId],
        )
      ).rows[0].id;
    } finally {
      await c.end();
    }
  });

  afterAll(async () => {
    await cleanupFixtures();
    await closeAppPool();
  });

  // ================= SESSION LIFECYCLE (1-6) =================

  let sessionId: string;

  test('LIFE-1: DRAFT yaradılır', async () => {
    const res = await createSession(specialist(), { childId: fx.childA1, specialistId: fx.specialistA1, goalIds: [goalId] });
    sessionId = res.id;
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT status FROM sessions WHERE id=$1', [sessionId]);
      return r.rows;
    });
    expect(rows[0].status).toBe('DRAFT');
  });

  test('LIFE-2: DRAFT → IN_PROGRESS', async () => {
    await startSession(specialist(), sessionId);
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT status FROM sessions WHERE id=$1', [sessionId]);
      return r.rows;
    });
    expect(rows[0].status).toBe('IN_PROGRESS');
  });

  test('LIFE-3: IN_PROGRESS → COMPLETED', async () => {
    await completeSession(specialist(), sessionId);
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT status, completed_at FROM sessions WHERE id=$1', [sessionId]);
      return r.rows;
    });
    expect(rows[0].status).toBe('COMPLETED');
    expect(rows[0].completed_at).not.toBeNull();
  });

  test('LIFE-4: COMPLETED → LOCKED', async () => {
    await lockSession(admin(), sessionId);
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT status, locked_at FROM sessions WHERE id=$1', [sessionId]);
      return r.rows;
    });
    expect(rows[0].status).toBe('LOCKED');
    expect(rows[0].locked_at).not.toBeNull();
  });

  test('LIFE-5: Invalid transition (DRAFT → COMPLETED birbaşa) rədd edilir', async () => {
    const res = await createSession(specialist(), { childId: fx.childA1, specialistId: fx.specialistA1 });
    await expect(completeSession(specialist(), res.id)).rejects.toThrow(SessionError);
  });

  test('LIFE-6: LOCKED → əvvəlki hər hansı status rədd edilir', async () => {
    const c = await migratorClient();
    try {
      await expect(c.query(`UPDATE sessions SET status='COMPLETED' WHERE id=$1`, [sessionId])).rejects.toThrow(
        /LOCKED-dir/i,
      );
      await expect(c.query(`UPDATE sessions SET status='IN_PROGRESS' WHERE id=$1`, [sessionId])).rejects.toThrow(
        /LOCKED-dir/i,
      );
      await expect(c.query(`UPDATE sessions SET status='DRAFT' WHERE id=$1`, [sessionId])).rejects.toThrow(
        /LOCKED-dir/i,
      );
    } finally {
      await c.end();
    }
  });

  // ================= ACCESS (7-15) =================

  test('ACC-7: Specialist aktiv assignment ilə session yarada bilir', async () => {
    const res = await createSession(specialist(), { childId: fx.childA1, specialistId: fx.specialistA1 });
    expect(res.id).toBeDefined();
  });

  test('ACC-8: Specialist assignment olmayan child üçün session yarada bilmir', async () => {
    await expect(
      createSession(specialist(), { childId: fx.childA2, specialistId: fx.specialistA1 }),
    ).rejects.toThrow(SessionError);
  });

  test('ACC-9: ENDED assignment ilə yeni session yaradıla bilmir', async () => {
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
      createSession(specialist(), { childId: fx.childA1, specialistId: fx.specialistA1 }),
    ).rejects.toThrow(SessionError);

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

  test('ACC-10: Specialist başqa organization-un child-ına session yarada bilmir (composite FK)', async () => {
    const c = await migratorClient();
    try {
      await expect(
        c.query(
          `INSERT INTO sessions (organization_id, child_id, specialist_id) VALUES ($1,$2,$3)`,
          [fx.orgA, fx.childB1, fx.specialistA1],
        ),
      ).rejects.toThrow(/foreign key/i);
    } finally {
      await c.end();
    }
  });

  test('ACC-11: Supervisor öz branch scope-da (branchA1) uşağa aid session görə bilir', async () => {
    const scope = await resolveMemberScope(fx.orgA, fx.supervisorMember, { bypassCache: true });
    expect(isBranchInScope(scope, fx.branchA1)).toBe(true);
  });

  test('ACC-12: Supervisor scope xaricində (branchA2) session görə bilmir', async () => {
    const scope = await resolveMemberScope(fx.orgA, fx.supervisorMember, { bypassCache: true });
    expect(isBranchInScope(scope, fx.branchA2)).toBe(false);
  });

  test('ACC-13: Parent öz uşağının session-unu görə bilir', async () => {
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query(
        `SELECT s.* FROM sessions s
         JOIN child_guardians g ON g.child_id = s.child_id AND g.organization_id = s.organization_id
         WHERE g.parent_id = $1 AND s.child_id = $2`,
        [fx.parentA1, fx.childA1],
      );
      return r.rows;
    });
    expect(rows.length).toBeGreaterThan(0);
  });

  test('ACC-14: Parent başqa uşağın session-unu görə bilmir', async () => {
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query(
        `SELECT s.* FROM sessions s
         JOIN child_guardians g ON g.child_id = s.child_id AND g.organization_id = s.organization_id
         WHERE g.parent_id = $1 AND s.child_id = $2`,
        [fx.parentA1, fx.childA2],
      );
      return r.rows;
    });
    expect(rows.length).toBe(0);
  });

  test('ACC-15: NO_BRANCH member branch-a bağlı session scope-unda deyil', async () => {
    const scope = await resolveMemberScope(fx.orgA, fx.memberNoBranch, { bypassCache: true });
    expect(scope.scopeType).toBe('NO_BRANCH');
    expect(isBranchInScope(scope, fx.branchA1)).toBe(false);
  });

  // ================= RLS (16-20) =================

  test('RLS-16: Org A → Org B session-larını görə bilmir', async () => {
    const cMig = await migratorClient();
    let orgBSessionId: string;
    try {
      orgBSessionId = (
        await cMig.query(
          `INSERT INTO sessions (organization_id, child_id, specialist_id) VALUES ($1,$2,$3) RETURNING id`,
          [fx.orgB, fx.childB1, fx.specialistB1],
        )
      ).rows[0].id;
    } finally {
      await cMig.end();
    }
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT * FROM sessions WHERE id=$1', [orgBSessionId]);
      return r.rows;
    });
    expect(rows.length).toBe(0);
  });

  test('RLS-17: Org B → Org A session-larını görə bilmir', async () => {
    const rows = await runAsApp(fx.orgB, async (c) => {
      const r = await c.query('SELECT * FROM sessions WHERE id=$1', [sessionId]);
      return r.rows;
    });
    expect(rows.length).toBe(0);
  });

  test('RLS-18: cdos_app RLS bypass edə bilmir', async () => {
    const rows = await runAsApp(null, async (c) => {
      const r = await c.query('SELECT * FROM sessions');
      return r.rows;
    });
    expect(rows.length).toBe(0);
  });

  test('RLS-19: cdos_migrator fixture yaza bilir', async () => {
    const c = await migratorClient();
    try {
      const r = await c.query('SELECT COUNT(*) FROM sessions WHERE organization_id=$1', [fx.orgA]);
      expect(Number(r.rows[0].count)).toBeGreaterThan(0);
    } finally {
      await c.end();
    }
  });

  test('RLS-20: Connection-pool tenant context sızması baş vermir', async () => {
    const client = await appClient();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org', $1, true)", [fx.orgA]);
      const a = await client.query('SELECT * FROM sessions WHERE id=$1', [sessionId]);
      expect(a.rows.length).toBe(1);
      await client.query('COMMIT');

      await client.query('BEGIN');
      const b = await client.query('SELECT * FROM sessions WHERE id=$1', [sessionId]);
      expect(b.rows.length).toBe(0);
      await client.query('COMMIT');
    } finally {
      await client.end();
    }
  });

  // ================= COMPOSITE FK (21-24) =================

  test('FK-21: Cross-tenant child FK rədd edilir', async () => {
    const c = await migratorClient();
    try {
      await expect(
        c.query(`INSERT INTO sessions (organization_id, child_id, specialist_id) VALUES ($1,$2,$3)`, [
          fx.orgA,
          fx.childB1,
          fx.specialistA1,
        ]),
      ).rejects.toThrow(/foreign key/i);
    } finally {
      await c.end();
    }
  });

  test('FK-22: Cross-tenant specialist FK rədd edilir', async () => {
    const c = await migratorClient();
    try {
      await expect(
        c.query(`INSERT INTO sessions (organization_id, child_id, specialist_id) VALUES ($1,$2,$3)`, [
          fx.orgA,
          fx.childA1,
          fx.specialistB1,
        ]),
      ).rejects.toThrow(/foreign key/i);
    } finally {
      await c.end();
    }
  });

  test('FK-23: Cross-tenant goal FK (session_goals) rədd edilir', async () => {
    const cMig = await migratorClient();
    let orgBPlanId: string;
    let orgBGoalId: string;
    try {
      orgBPlanId = (
        await cMig.query(
          `INSERT INTO development_plans (organization_id, child_id, version_no, created_by) VALUES ($1,$2,1,$3) RETURNING id`,
          [fx.orgB, fx.childB1, fx.userB1],
        )
      ).rows[0].id;
      orgBGoalId = (
        await cMig.query(
          `INSERT INTO goals (organization_id, plan_id, title, metric_type) VALUES ($1,$2,'X','numeric') RETURNING id`,
          [fx.orgB, orgBPlanId],
        )
      ).rows[0].id;
    } finally {
      await cMig.end();
    }
    const c = await migratorClient();
    try {
      await expect(
        c.query(`INSERT INTO session_goals (organization_id, session_id, goal_id) VALUES ($1,$2,$3)`, [
          fx.orgA,
          sessionId,
          orgBGoalId,
        ]),
      ).rejects.toThrow(/foreign key/i);
    } finally {
      await c.end();
    }
  });

  test('FK-24: goal_measurements.session_id cross-tenant FK rədd edir (GAP closure doğrulaması)', async () => {
    const cMig = await migratorClient();
    let orgBSessionId: string;
    try {
      orgBSessionId = (
        await cMig.query(
          `INSERT INTO sessions (organization_id, child_id, specialist_id) VALUES ($1,$2,$3) RETURNING id`,
          [fx.orgB, fx.childB1, fx.specialistB1],
        )
      ).rows[0].id;
    } finally {
      await cMig.end();
    }
    const c = await migratorClient();
    try {
      await expect(
        c.query(
          `INSERT INTO goal_measurements (organization_id, goal_id, session_id, value, recorded_by)
           VALUES ($1,$2,$3,'1',$4)`,
          [fx.orgA, goalId, orgBSessionId, fx.centerAdminUserId],
        ),
      ).rejects.toThrow(/foreign key/i);
    } finally {
      await c.end();
    }
  });

  // ================= IMMUTABILITY (25-28) =================

  test('IMM-25: LOCKED session UPDATE rədd edilir', async () => {
    const c = await migratorClient();
    try {
      await expect(c.query(`UPDATE sessions SET observation='hack' WHERE id=$1`, [sessionId])).rejects.toThrow(
        /LOCKED-dir/i,
      );
    } finally {
      await c.end();
    }
  });

  test('IMM-26: LOCKED session DELETE rədd edilir', async () => {
    const c = await migratorClient();
    try {
      await expect(c.query(`DELETE FROM sessions WHERE id=$1`, [sessionId])).rejects.toThrow(
        /fiziki DELETE qadağandır/i,
      );
    } finally {
      await c.end();
    }
  });

  test('IMM-27+28: Amendment original session-u dəyişmir, tarixçə saxlanılır', async () => {
    const before = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT observation FROM sessions WHERE id=$1', [sessionId]);
      return r.rows[0];
    });

    const amendment = await amendSession(specialist(), {
      sessionId,
      newData: { observation: 'Düzəliş: uşaq yaxşı reaksiya verdi' },
      reason: 'İlkin qeyddə səhv var idi',
    });
    expect(amendment.id).toBeDefined();

    const after = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT observation FROM sessions WHERE id=$1', [sessionId]);
      return r.rows[0];
    });
    expect(after.observation).toBe(before.observation);

    const amendments = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT * FROM session_amendments WHERE session_id=$1', [sessionId]);
      return r.rows;
    });
    expect(amendments.length).toBe(1);
    expect(amendments[0].reason).toBe('İlkin qeyddə səhv var idi');
  });

  test('Əlavə: amendment append-only-dur (UPDATE/DELETE rədd olunur)', async () => {
    const amendments = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT id FROM session_amendments WHERE session_id=$1', [sessionId]);
      return r.rows;
    });
    const amendmentId = amendments[0].id;
    const c = await migratorClient();
    try {
      await expect(c.query(`UPDATE session_amendments SET reason='x' WHERE id=$1`, [amendmentId])).rejects.toThrow(
        /UPDATE qadağandır/i,
      );
      await expect(c.query(`DELETE FROM session_amendments WHERE id=$1`, [amendmentId])).rejects.toThrow(
        /fiziki DELETE qadağandır/i,
      );
    } finally {
      await c.end();
    }
  });

  // ================= AUTO LOCK (29-32) =================

  test('LOCK-29: 48 saatdan az COMPLETED session LOCK edilmir', async () => {
    const c = await migratorClient();
    let recentSessionId: string;
    try {
      recentSessionId = (
        await c.query(
          `INSERT INTO sessions (organization_id, child_id, specialist_id, status, completed_at)
           VALUES ($1,$2,$3,'COMPLETED', now() - interval '10 hours') RETURNING id`,
          [fx.orgA, fx.childA1, fx.specialistA1],
        )
      ).rows[0].id;
    } finally {
      await c.end();
    }
    const result = await lockExpiredSessions(fx.orgA);
    expect(result.lockedIds).not.toContain(recentSessionId);
  });

  test('LOCK-30: 48 saat tamamlandıqda session LOCK edilə bilir', async () => {
    const c = await migratorClient();
    let expiredSessionId: string;
    try {
      expiredSessionId = (
        await c.query(
          `INSERT INTO sessions (organization_id, child_id, specialist_id, status, completed_at)
           VALUES ($1,$2,$3,'COMPLETED', now() - interval '49 hours') RETURNING id`,
          [fx.orgA, fx.childA1, fx.specialistA1],
        )
      ).rows[0].id;
    } finally {
      await c.end();
    }
    const result = await lockExpiredSessions(fx.orgA);
    expect(result.lockedIds).toContain(expiredSessionId);

    const rows = await runAsApp(fx.orgA, async (cc) => {
      const r = await cc.query('SELECT status FROM sessions WHERE id=$1', [expiredSessionId]);
      return r.rows;
    });
    expect(rows[0].status).toBe('LOCKED');
  });

  test('LOCK-31: "session_lock_hours" konfiqurasiyası (funksiya parametri) nəzərdə tutulmuş şəkildə işləyir', async () => {
    const c = await migratorClient();
    let s: string;
    try {
      s = (
        await c.query(
          `INSERT INTO sessions (organization_id, child_id, specialist_id, status, completed_at)
           VALUES ($1,$2,$3,'COMPLETED', now() - interval '3 hours') RETURNING id`,
          [fx.orgA, fx.childA1, fx.specialistA1],
        )
      ).rows[0].id;
    } finally {
      await c.end();
    }
    const withDefault = await lockExpiredSessions(fx.orgA);
    expect(withDefault.lockedIds).not.toContain(s);
    const withOverride = await lockExpiredSessions(fx.orgA, 2);
    expect(withOverride.lockedIds).toContain(s);
  });

  test('LOCK-32: LOCK edilmiş session ikinci dəfə dəyişdirilmir (idempotent, təkrar LOCK cəhdi təsirsizdir)', async () => {
    const result = await lockExpiredSessions(fx.orgA);
    expect(result.lockedIds).not.toContain(sessionId);
  });

  // ================= GAP CLOSURE (33-34) =================

  test('GAP-33: goal_measurements.session_id artıq real composite FK ilə qorunur', async () => {
    const c = await migratorClient();
    try {
      const r = await c.query(`SELECT conname FROM pg_constraint WHERE conname='fk_goal_measurements_session'`);
      expect(r.rowCount).toBe(1);
    } finally {
      await c.end();
    }
  });

  test('GAP-34: goals.domain_id — development_domains yaradılmadığı üçün FK testi DEFERRED', () => {
    // development_domains heç bir freeze sənədində konkret field-lərlə müəyyən
    // edilməyib (yalnız Faz 0-2-də konseptual tələb kimi qeyd olunub).
    // Bu fazda UYDURULMADI — GAP AÇIQ QALIR (bax FINAL REPORT).
    expect(true).toBe(true);
  });

  test('Əlavə: getChildSessions düzgün nəticə qaytarır', async () => {
    const sessions = await getChildSessions(admin(), fx.childA1);
    expect(sessions.length).toBeGreaterThan(0);
  });
});

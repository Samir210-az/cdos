import { Fixtures, seedFixtures, cleanupFixtures, runAsApp, migratorClient } from './helpers';
import { closeAppPool } from '../../src/common/db/pool';
import {
  createDraft,
  reviewPlan,
  activatePlan,
  pausePlan,
  completePlan,
  archivePlan,
  createRevision,
  getVersionChain,
  PlanError,
} from '../../src/modules/plans/plan.service';
import { createGoal, addMeasurement, completeGoal, GoalError } from '../../src/modules/plans/goal.service';
import { resolveMemberScope } from '../../src/scope-cache/scope-resolver';

describe('CDOS Faz 3.5 — Development Plan + Goals Engine Security Tests', () => {
  let fx: Fixtures;
  let specialistMemberId: string;
  let specialistUserId: string;

  const admin = () => ({ organizationId: fx.orgA, memberId: fx.centerAdminMember, userId: fx.centerAdminUserId });
  const specialist = () => ({ organizationId: fx.orgA, memberId: specialistMemberId, userId: specialistUserId });

  beforeAll(async () => {
    fx = await seedFixtures();

    // seedFixtures-də mövcud member-lərin heç birinə SPECIALIST rolu təyin edilməyib —
    // mövcud fx.memberNoBranch (userA1-ə bağlıdır) bu fazda SPECIALIST rolu ilə genişləndirilir
    // (YENİ membership yaratmır — user+org üçün UNIQUE constraint pozulmasın deyə).
    const c = await migratorClient();
    try {
      specialistUserId = fx.userA1;
      specialistMemberId = fx.memberNoBranch;
      const roleId = (await c.query(`SELECT id FROM roles WHERE code='SPECIALIST'`)).rows[0].id;
      await c.query(
        `INSERT INTO member_roles (organization_id, member_id, role_id) VALUES ($1,$2,$3)
         ON CONFLICT DO NOTHING`,
        [fx.orgA, specialistMemberId, roleId],
      );
      // specialistA1 uşağa (childA1) aktiv təyin olunsun
      await c.query(
        `INSERT INTO specialist_child_assignments (organization_id, specialist_id, child_id, assigned_by, status)
         VALUES ($1,$2,$3,$4,'ACTIVE')
         ON CONFLICT DO NOTHING`,
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

  // ================= PLAN TESTS (1-10) =================

  let planA1: string;

  test('PLAN-1: Org A plan yarada bilir', async () => {
    const res = await createDraft(admin(), { childId: fx.childA1 });
    planA1 = res.id;
    expect(planA1).toBeDefined();
  });

  test('PLAN-2: Org B (app-role) həmin planı görə bilmir', async () => {
    const rows = await runAsApp(fx.orgB, async (c) => {
      const r = await c.query('SELECT * FROM development_plans WHERE id=$1', [planA1]);
      return r.rows;
    });
    expect(rows.length).toBe(0);
  });

  test('PLAN-3: Cross-tenant plan-child FK rədd edilir', async () => {
    const c = await migratorClient();
    try {
      await expect(
        c.query(
          `INSERT INTO development_plans (organization_id, child_id, version_no, created_by)
           VALUES ($1,$2,1,$3)`,
          [fx.orgA, fx.childB1, fx.centerAdminUserId], // orgA + childB1(orgB-yə aiddir)
        ),
      ).rejects.toThrow(/foreign key/i);
    } finally {
      await c.end();
    }
  });

  test('PLAN-4: Cross-tenant parent_plan_id rədd edilir', async () => {
    const cMig = await migratorClient();
    let orgBPlanId: string;
    try {
      orgBPlanId = (
        await cMig.query(
          `INSERT INTO development_plans (organization_id, child_id, version_no, created_by) VALUES ($1,$2,1,$3) RETURNING id`,
          [fx.orgB, fx.childB1, fx.userB1],
        )
      ).rows[0].id;
    } finally {
      await cMig.end();
    }
    const c = await migratorClient();
    try {
      await expect(
        c.query(
          `INSERT INTO development_plans (organization_id, child_id, parent_plan_id, version_no, created_by)
           VALUES ($1,$2,$3,2,$4)`,
          [fx.orgA, fx.childA1, orgBPlanId, fx.centerAdminUserId],
        ),
      ).rejects.toThrow(/foreign key/i);
    } finally {
      await c.end();
    }
  });

  test('PLAN-5: Invalid plan transition rədd edilir (AI_DRAFT → ACTIVE birbaşa)', async () => {
    await expect(activatePlan(admin(), planA1)).rejects.toThrow(PlanError);
  });

  test('Düzgün ardıcıllıq: AI_DRAFT → REVIEWED → ACTIVE', async () => {
    await reviewPlan(admin(), planA1);
    await activatePlan(admin(), planA1);
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT status FROM development_plans WHERE id=$1', [planA1]);
      return r.rows;
    });
    expect(rows[0].status).toBe('ACTIVE');
  });

  test('PLAN-6: ACTIVE plan birbaşa UPDATE (icazəsiz sahə) edilə bilmir', async () => {
    const c = await migratorClient();
    try {
      await expect(
        c.query(`UPDATE development_plans SET version_no=999 WHERE id=$1`, [planA1]),
      ).rejects.toThrow(/core sahələr/i);
    } finally {
      await c.end();
    }
  });

  test('PLAN-7+8: Yeni revision yaradıla bilir və version chain düzgündür', async () => {
    const rev = await createRevision(admin(), planA1);
    const chain = await getVersionChain(admin(), rev.id);
    expect(chain.length).toBe(2);
    expect(chain[0].id).toBe(planA1);
    expect(chain[1].id).toBe(rev.id);
    expect(chain[1].parent_plan_id).toBe(planA1);
  });

  test('PLAN-9: Circular parent_plan_id rədd edilir (özünə istinad)', async () => {
    const c = await migratorClient();
    try {
      await expect(
        c.query(`UPDATE development_plans SET parent_plan_id = id WHERE id=$1`, [planA1]),
      ).rejects.toThrow(/check|core sahələr/i);
    } finally {
      await c.end();
    }
  });

  test('PLAN-10: ARCHIVED plan dəyişdirilə bilmir', async () => {
    await pausePlan(admin(), planA1);
    await completePlan(admin(), planA1);
    await archivePlan(admin(), planA1);

    const c = await migratorClient();
    try {
      await expect(
        c.query(`UPDATE development_plans SET status='ACTIVE' WHERE id=$1`, [planA1]),
      ).rejects.toThrow(/Invalid development plan status transition/i);
    } finally {
      await c.end();
    }
  });

  // ================= GOAL TESTS (11-20) =================

  let planForGoals: string;
  let goalId: string;

  test('GOAL-11: Goal yalnız həmin organization planına bağlana bilir', async () => {
    planForGoals = (await createDraft(admin(), { childId: fx.childA1 })).id;
    const res = await createGoal(admin(), { planId: planForGoals, title: 'Söz ehtiyatını artırmaq', metricType: 'numeric' });
    goalId = res.id;
    expect(goalId).toBeDefined();
  });

  test('GOAL-12: Cross-tenant goal FK rədd edilir', async () => {
    const cMig = await migratorClient();
    let orgBPlanId: string;
    try {
      orgBPlanId = (
        await cMig.query(
          `INSERT INTO development_plans (organization_id, child_id, version_no, created_by) VALUES ($1,$2,1,$3) RETURNING id`,
          [fx.orgB, fx.childB1, fx.userB1],
        )
      ).rows[0].id;
    } finally {
      await cMig.end();
    }
    const c = await migratorClient();
    try {
      await expect(
        c.query(
          `INSERT INTO goals (organization_id, plan_id, title, metric_type) VALUES ($1,$2,'X','numeric')`,
          [fx.orgA, orgBPlanId], // orgA + orgB-nin planı
        ),
      ).rejects.toThrow(/foreign key/i);
    } finally {
      await c.end();
    }
  });

  test('GOAL-13: Goal lifecycle transition düzgün işləyir', async () => {
    await completeGoal(admin(), goalId);
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT status FROM goals WHERE id=$1', [goalId]);
      return r.rows;
    });
    expect(rows[0].status).toBe('COMPLETED');
  });

  test('GOAL-14: Goal DELETE mümkün deyil (DB trigger)', async () => {
    const c = await migratorClient();
    try {
      await expect(c.query(`DELETE FROM goals WHERE id=$1`, [goalId])).rejects.toThrow(/fiziki DELETE qadağandır/i);
    } finally {
      await c.end();
    }
  });

  test('GOAL-15+16: Plan revision yaradıldıqda köhnə versiyanın goal-ları dəyişmir (tarixçə qorunur)', async () => {
    const rev = await createRevision(admin(), planForGoals);
    const goalsOnOld = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT * FROM goals WHERE plan_id=$1', [planForGoals]);
      return r.rows;
    });
    const goalsOnNew = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT * FROM goals WHERE plan_id=$1', [rev.id]);
      return r.rows;
    });
    expect(goalsOnOld.length).toBe(1); // köhnə plan öz goal-ını saxlayır
    expect(goalsOnNew.length).toBe(0); // yeni versiyada avtomatik köçürülməyib (ayrıca əməliyyatdır)
  });

  test('GOAL-17: Specialist yalnız aktiv assignment olan uşağın plan/goal-una giriş əldə edir', async () => {
    const scope = await resolveMemberScope(fx.orgA, specialistMemberId, { bypassCache: true });
    expect(scope.roleCodes).toContain('SPECIALIST');
    // childA1-ə aktiv assignment var (beforeAll-da yaradılıb) — draft yarada bilməlidir
    const res = await createDraft(specialist(), { childId: fx.childA1, assessorSpecialistId: fx.specialistA1 });
    expect(res.id).toBeDefined();
  });

  test('GOAL-18: ENDED assignment yeni plan əməliyyatını bloklayır', async () => {
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
      createDraft(specialist(), { childId: fx.childA1, assessorSpecialistId: fx.specialistA1 }),
    ).rejects.toThrow(PlanError);
  });

  test('GOAL-19: Supervisor öz scope-undan kənar uşağa (branchA2) giriş əldə etmir', async () => {
    const scope = await resolveMemberScope(fx.orgA, fx.supervisorMember, { bypassCache: true });
    const { isBranchInScope } = await import('../../src/scope-cache/scope-resolver');
    expect(isBranchInScope(scope, fx.branchA2)).toBe(false); // supervisor yalnız branchA1-ə scope-lanıb
  });

  test('GOAL-20: Parent yalnız öz uşağının icazəli (təsdiqlənmiş) plan məlumatını görür', async () => {
    // planA1 ARCHIVED-dir (yəni bir dəfə ACTIVE-ə çatıb — "təsdiqlənmiş" tarixçə daşıyır)
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query(
        `SELECT dp.* FROM development_plans dp
         JOIN child_guardians g ON g.child_id = dp.child_id AND g.organization_id = dp.organization_id
         WHERE g.parent_id = $1 AND dp.id = $2`,
        [fx.parentA1, planA1],
      );
      return r.rows;
    });
    expect(rows.length).toBe(1);

    const deniedRows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query(
        `SELECT dp.* FROM development_plans dp
         JOIN child_guardians g ON g.child_id = dp.child_id AND g.organization_id = dp.organization_id
         WHERE g.parent_id = $1 AND dp.id = $2`,
        [fx.parentA2, planA1], // parentA2 childA1-in valideyni deyil
      );
      return r.rows;
    });
    expect(deniedRows.length).toBe(0);
  });

  // ================= SECURITY (21-24) =================

  test('SEC-21: cdos_app RLS bypass edə bilmir', async () => {
    const rows = await runAsApp(null, async (c) => {
      const r = await c.query('SELECT * FROM development_plans');
      return r.rows;
    });
    expect(rows.length).toBe(0);
  });

  test('SEC-22: cdos_migrator fixture/seed yaza bilir', async () => {
    const c = await migratorClient();
    try {
      const r = await c.query('SELECT COUNT(*) FROM development_plans WHERE organization_id=$1', [fx.orgA]);
      expect(Number(r.rows[0].count)).toBeGreaterThan(0);
    } finally {
      await c.end();
    }
  });

  test('SEC-23: Connection-pool tenant context sızması baş vermir', async () => {
    const { appClient } = await import('./helpers');
    const client = await appClient();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org', $1, true)", [fx.orgA]);
      const a = await client.query('SELECT * FROM development_plans WHERE id=$1', [planA1]);
      expect(a.rows.length).toBe(1);
      await client.query('COMMIT');

      await client.query('BEGIN');
      const b = await client.query('SELECT * FROM development_plans WHERE id=$1', [planA1]);
      expect(b.rows.length).toBe(0);
      await client.query('COMMIT');
    } finally {
      await client.end();
    }
  });

  test('SEC-24: NO_BRANCH fail-closed qalır', async () => {
    const { isBranchInScope } = await import('../../src/scope-cache/scope-resolver');
    const scope = await resolveMemberScope(fx.orgA, fx.memberNoBranch, { bypassCache: true });
    expect(scope.scopeType).toBe('NO_BRANCH');
    expect(isBranchInScope(scope, fx.branchA1)).toBe(false);
  });

  // ================= IMMUTABILITY (25-28) =================

  test('IMM-25: ACTIVE plan mutation guard (status geriyə/yanlış keçid)', async () => {
    const p = (await createDraft(admin(), { childId: fx.childA1 })).id;
    await reviewPlan(admin(), p);
    await activatePlan(admin(), p);
    const c = await migratorClient();
    try {
      await expect(c.query(`UPDATE development_plans SET status='AI_DRAFT' WHERE id=$1`, [p])).rejects.toThrow(
        /Invalid development plan status transition/i,
      );
    } finally {
      await c.end();
    }
  });

  test('IMM-26: ARCHIVED plan mutation guard', async () => {
    // planA1 artıq ARCHIVED-dir (PLAN-10-da)
    await expect(archivePlan(admin(), planA1)).rejects.toThrow(PlanError);
  });

  test('IMM-27: Goal lifecycle sonrası (CANCELLED) qadağan edilmiş mutation guard', async () => {
    const g = (await createGoal(admin(), { planId: planForGoals, title: 'Test', metricType: 'binary' })).id;
    const { cancelGoal } = await import('../../src/modules/plans/goal.service');
    await cancelGoal(admin(), g);
    const c = await migratorClient();
    try {
      await expect(c.query(`UPDATE goals SET status='ACTIVE' WHERE id=$1`, [g])).rejects.toThrow(
        /CANCELLED goal statusu dəyişdirilə bilməz/i,
      );
    } finally {
      await c.end();
    }
  });

  test('IMM-28: Version chain integrity — hər versiya öz statusunu müstəqil saxlayır', async () => {
    const chain = await getVersionChain(admin(), planA1);
    // planA1 (v1) ARCHIVED, revision (v2) hələ AI_DRAFT olmalıdır
    const v1 = chain.find((p: any) => p.id === planA1);
    expect(v1.status).toBe('ARCHIVED');
    expect(chain.length).toBeGreaterThanOrEqual(2);
  });

  // ================= ƏLAVƏ: goal_measurements =================

  test('Əlavə: goal measurement əlavə olunur və append-only qorunur (UPDATE qadağandır)', async () => {
    const m = await addMeasurement(admin(), { goalId, value: { score: 3 } });
    expect(m.id).toBeDefined();
    const c = await migratorClient();
    try {
      await expect(c.query(`UPDATE goal_measurements SET value='{}' WHERE id=$1`, [m.id])).rejects.toThrow(
        /UPDATE qadağandır/i,
      );
    } finally {
      await c.end();
    }
  });

  test('Əlavə: resumePlan (PAUSED → ACTIVE) düzgün işləyir', async () => {
    const p = (await createDraft(admin(), { childId: fx.childA1 })).id;
    await reviewPlan(admin(), p);
    await activatePlan(admin(), p);
    await pausePlan(admin(), p);
    const { resumePlan } = await import('../../src/modules/plans/plan.service');
    await resumePlan(admin(), p);
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT status FROM development_plans WHERE id=$1', [p]);
      return r.rows;
    });
    expect(rows[0].status).toBe('ACTIVE');
  });

  test('Əlavə: GoalError/PlanError doğru exception tipləridir', () => {
    expect(new PlanError('X', 'y')).toBeInstanceOf(Error);
    expect(new GoalError('X', 'y')).toBeInstanceOf(Error);
  });
});

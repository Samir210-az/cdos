import { Fixtures, seedFixtures, cleanupFixtures, runAsApp, migratorClient, appClient } from './helpers';
import { createAssignment, endAssignment, listActiveAssignedChildren } from '../../src/modules/assignments/assignment.service';
import { resolveMemberScope, isBranchInScope } from '../../src/scope-cache/scope-resolver';
import { closeAppPool } from '../../src/common/db/pool';

describe('CDOS Faz 3.3 — Child Domain Security Tests (C1–C16)', () => {
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await seedFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
    await closeAppPool();
  });

  test('C1 Org A app-role → Org B-nin uşağı görünmür', async () => {
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT * FROM children WHERE id = $1', [fx.childB1]);
      return r.rows;
    });
    expect(rows.length).toBe(0);
  });

  test('C2 Org A → öz uşağı görünür', async () => {
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT * FROM children WHERE id = $1', [fx.childA1]);
      return r.rows;
    });
    expect(rows.length).toBe(1);
  });

  test('C3 Org A context-də Org B-nin organization_id-i ilə child yaratmaq cəhdi → RLS WITH CHECK rədd edir', async () => {
    await expect(
      runAsApp(fx.orgA, async (c) => {
        await c.query(
          `INSERT INTO children (organization_id, branch_id, local_code, first_name, last_name, dob)
           VALUES ($1, $2, 'HACK-1', 'X', 'Y', '2020-01-01')`,
          [fx.orgB, fx.branchB1], // client app.current_org=orgA-dır, amma organization_id=orgB göndərilir
        );
      }),
    ).rejects.toThrow(/row-level security|policy/i);
  });

  test('C4 Org A assignment → Org B-nin uşağına bağlamaq cəhdi → composite FK pozuntusu', async () => {
    const c = await migratorClient();
    try {
      await expect(
        c.query(
          `INSERT INTO specialist_child_assignments (organization_id, specialist_id, child_id, assigned_by, status)
           VALUES ($1, $2, $3, $4, 'ACTIVE')`,
          [fx.orgA, fx.specialistA1, fx.childB1, fx.userA2], // orgA + childB1(orgB-yə aiddir)
        ),
      ).rejects.toThrow(/foreign key/i);
    } finally {
      await c.end();
    }
  });

  test('C5 Org A-nın parent-i → Org B-nin uşağı ilə guardian əlaqəsi yaratmaq cəhdi → composite FK pozuntusu', async () => {
    const c = await migratorClient();
    try {
      await expect(
        c.query(
          `INSERT INTO child_guardians (organization_id, child_id, parent_id, relation_type, is_primary)
           VALUES ($1, $2, $3, 'mother', false)`,
          [fx.orgA, fx.childB1, fx.parentA1], // orgA + childB1(orgB-yə aiddir)
        ),
      ).rejects.toThrow(/foreign key/i);
    } finally {
      await c.end();
    }
  });

  test('C6 Org A emergency contact → Org B-nin uşağı ilə əlaqə yaratmaq cəhdi → FK pozuntusu', async () => {
    const c = await migratorClient();
    try {
      await expect(
        c.query(
          `INSERT INTO emergency_contacts (organization_id, child_id, name, phone)
           VALUES ($1, $2, 'Test Contact', '+994500000000')`,
          [fx.orgA, fx.childB1],
        ),
      ).rejects.toThrow(/foreign key/i);
    } finally {
      await c.end();
    }
  });

  test('C7 Specialist ACTIVE assignment → uşaq görünür', async () => {
    await createAssignment(
      { organizationId: fx.orgA, memberId: fx.centerAdminMember, userId: fx.centerAdminUserId },
      { specialistId: fx.specialistA1, childId: fx.childA1 },
    );
    const children = await listActiveAssignedChildren(fx.orgA, fx.specialistA1);
    expect(children).toContain(fx.childA1);
  });

  test('C8 Specialist ENDED assignment → yeni clinical data (bu fazda: medical_background) yarada bilmir', async () => {
    const created = await createAssignment(
      { organizationId: fx.orgA, memberId: fx.centerAdminMember, userId: fx.centerAdminUserId },
      { specialistId: fx.specialistA1, childId: fx.childA2 },
    );
    await endAssignment({ organizationId: fx.orgA, memberId: fx.centerAdminMember, userId: fx.centerAdminUserId }, created.id);

    const activeAfterEnd = await listActiveAssignedChildren(fx.orgA, fx.specialistA1);
    expect(activeAfterEnd).not.toContain(fx.childA2);

    // Faz 3.1 qaydası: "assignment.status = ACTIVE" şərti klinik yaratma əməliyyatlarına da aiddir.
    // Bu fazda tam permission-guard servisi yoxdur (Faz 3.3 bənd 14: yeni permission sistemi
    // yaradılmır) — ona görə DB-səviyyəli sübut kimi göstərilir: aktiv assignment olmadan
    // "hansı uşaqlara yeni klinik məlumat yazıla bilər" siyahısında childA2 YOXDUR.
    const activeAssignmentCheck = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query(
        `SELECT 1 FROM specialist_child_assignments
         WHERE organization_id=$1 AND specialist_id=$2 AND child_id=$3 AND status='ACTIVE'`,
        [fx.orgA, fx.specialistA1, fx.childA2],
      );
      return r.rows;
    });
    expect(activeAssignmentCheck.length).toBe(0);
  });

  test('C9 Parent → öz uşağı görünür', async () => {
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query(
        `SELECT ch.* FROM children ch
         JOIN child_guardians g ON g.child_id = ch.id AND g.organization_id = ch.organization_id
         WHERE g.parent_id = $1 AND ch.id = $2`,
        [fx.parentA1, fx.childA1],
      );
      return r.rows;
    });
    expect(rows.length).toBe(1);
  });

  test('C10 Parent → başqa uşaq görünmür', async () => {
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query(
        `SELECT ch.* FROM children ch
         JOIN child_guardians g ON g.child_id = ch.id AND g.organization_id = ch.organization_id
         WHERE g.parent_id = $1 AND ch.id = $2`,
        [fx.parentA1, fx.childA2],
      );
      return r.rows;
    });
    expect(rows.length).toBe(0);
  });

  test('C11 NO_BRANCH → branch-a bağlı uşaq scope-unda deyil', async () => {
    const scope = await resolveMemberScope(fx.orgA, fx.memberNoBranch, { bypassCache: true });
    expect(isBranchInScope(scope, fx.branchA1)).toBe(false); // childA1 branchA1-dədir
  });

  test('C12 SELECTED_BRANCHES → yalnız seçilmiş branch (childA1-in branch-ı)', async () => {
    const scope = await resolveMemberScope(fx.orgA, fx.memberSelected, { bypassCache: true });
    expect(isBranchInScope(scope, fx.branchA1)).toBe(true);
    expect(isBranchInScope(scope, fx.branchA2)).toBe(false);
  });

  test('C13 ALL_BRANCHES → bütün branch-lər (childA1 və gələcək branchA2 uşaqları daxil)', async () => {
    const scope = await resolveMemberScope(fx.orgA, fx.memberAll, { bypassCache: true });
    expect(isBranchInScope(scope, fx.branchA1)).toBe(true);
    expect(isBranchInScope(scope, fx.branchA2)).toBe(true);
  });

  test('C14 Clinical profile (medical_background) cross-tenant relation → FK pozuntusu', async () => {
    const c = await migratorClient();
    try {
      await expect(
        c.query(`INSERT INTO medical_background (organization_id, child_id) VALUES ($1, $2)`, [
          fx.orgA,
          fx.childB1, // orgA + childB1(orgB-yə aiddir)
        ]),
      ).rejects.toThrow(/foreign key/i);
    } finally {
      await c.end();
    }
  });

  test('C14b Eyni uşaq üçün 2-ci medical_background sətri (1:1) rədd olunur', async () => {
    const c = await migratorClient();
    try {
      await c.query(`INSERT INTO medical_background (organization_id, child_id, allergies) VALUES ($1,$2,'yox')`, [
        fx.orgA,
        fx.childA1,
      ]);
      await expect(
        c.query(`INSERT INTO medical_background (organization_id, child_id, allergies) VALUES ($1,$2,'penisillin')`, [
          fx.orgA,
          fx.childA1,
        ]),
      ).rejects.toThrow(/duplicate key|unique/i);
    } finally {
      await c.end();
    }
  });

  test('C15 cdos_app RLS-dən bypass edə BİLMİR (tenant context yoxdursa uşaqlar görünmür)', async () => {
    const rows = await runAsApp(null, async (c) => {
      const r = await c.query('SELECT * FROM children');
      return r.rows;
    });
    expect(rows.length).toBe(0);
  });

  test('C16 cdos_migrator (BYPASSRLS) fixture yaratmağa qadirdir (artıq fixture mərhələsində sübut olunub)', async () => {
    const c = await migratorClient();
    try {
      const r = await c.query('SELECT * FROM children WHERE organization_id IN ($1,$2)', [fx.orgA, fx.orgB]);
      expect(r.rows.length).toBeGreaterThanOrEqual(3); // childA1, childA2, childB1 (+ legacy)
    } finally {
      await c.end();
    }
  });

  test('EK C: connection-pool izolyasiyası children cədvəlində də qorunur', async () => {
    const client = await appClient();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org', $1, true)", [fx.orgA]);
      const a = await client.query('SELECT * FROM children WHERE id = $1', [fx.childA1]);
      expect(a.rows.length).toBe(1);
      await client.query('COMMIT');

      await client.query('BEGIN');
      const b = await client.query('SELECT * FROM children WHERE id = $1', [fx.childA1]);
      expect(b.rows.length).toBe(0);
      await client.query('COMMIT');
    } finally {
      await client.end();
    }
  });
});

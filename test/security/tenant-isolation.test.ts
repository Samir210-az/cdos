import { Fixtures, seedFixtures, cleanupFixtures, runAsApp, migratorClient, appClient } from './helpers';

describe('CDOS Faz 3.2 — Security & Tenant Isolation Tests', () => {
  let fx: Fixtures;

  beforeAll(async () => {
    fx = await seedFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
    const { closeAppPool } = await import('../../src/common/db/pool');
    await closeAppPool();
  });

  // ---------------------------------------------------------------------
  // QEYD: "children" cədvəli bu fazda mövcud deyil (011+ scope-udur).
  // Spesifikasiyanın özü bunu nəzərdə tutur ("Bu mərhələdə children yoxdur,
  // infrastructure versiyasını mövcud tenant table-lar üzərində tətbiq et").
  // Ona görə Test 1/2/3 "children" əvəzinə "specialists" cədvəli üzərində,
  // eyni tenant-isolation mexanizmini yoxlayır. Test 6/7/8/9 (parent/consent)
  // parents/consents cədvəlləri olmadığı üçün DEFERRED işarələnib.
  // ---------------------------------------------------------------------

  test('TEST 1 (adaptasiya: children→specialists) Org A → Org B-nin specialistinə giriş = 0 sətir', async () => {
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT * FROM specialists WHERE id = $1', [fx.specialistB1]);
      return r.rows;
    });
    expect(rows.length).toBe(0);
  });

  test('TEST 2 Org A → öz specialistinə giriş = 1 sətir', async () => {
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT * FROM specialists WHERE id = $1', [fx.specialistA1]);
      return r.rows;
    });
    expect(rows.length).toBe(1);
  });

  test('TEST 3 Branch scope: SELECTED_BRANCHES(branchA1) member branchA2-ni scope-da görmür', async () => {
    const { resolveMemberScope, isBranchInScope } = await import('../../src/scope-cache/scope-resolver');
    const { resetScopeCacheForTests } = await import('../../src/scope-cache/scope-cache.factory');
    resetScopeCacheForTests();
    const scope = await resolveMemberScope(fx.orgA, fx.memberSelected, { bypassCache: true });
    expect(isBranchInScope(scope, fx.branchA1)).toBe(true);
    expect(isBranchInScope(scope, fx.branchA2)).toBe(false);
  });

  test('TEST 4 Specialist yalnız ACTIVE assignment olan uşaqları görür', async () => {
    const { createAssignment, listActiveAssignedChildren } = await import(
      '../../src/modules/assignments/assignment.service'
    );
    await createAssignment(
      { organizationId: fx.orgA, memberId: fx.centerAdminMember, userId: fx.centerAdminUserId },
      { specialistId: fx.specialistA1, childId: fx.childX },
    );
    const children = await listActiveAssignedChildren(fx.orgA, fx.specialistA1);
    expect(children).toContain(fx.childX);
  });

  test('TEST 5 Təyin olunmamış specialist həmin uşağı görmür (DENIED)', async () => {
    const { listActiveAssignedChildren } = await import('../../src/modules/assignments/assignment.service');
    const children = await listActiveAssignedChildren(fx.orgA, fx.specialistA2); // A2-yə heç bir assignment verilməyib
    expect(children).not.toContain(fx.childX);
  });

  test('TEST 6 Parent A → öz uşağını (child_guardians vasitəsilə) görür — İNDİ REAL (parents/children Faz 3.3-də yarandı)', async () => {
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

  test('TEST 7 Parent A → başqa valideynin uşağını görmür (DENIED) — İNDİ REAL', async () => {
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query(
        `SELECT ch.* FROM children ch
         JOIN child_guardians g ON g.child_id = ch.id AND g.organization_id = ch.organization_id
         WHERE g.parent_id = $1 AND ch.id = $2`,
        [fx.parentA1, fx.childA2], // childA2 parentA2-yə aiddir, parentA1-ə YOX
      );
      return r.rows;
    });
    expect(rows.length).toBe(0);
  });
  test.skip('TEST 8 Cross-center ACTIVE consent → limited access (DEFERRED: consents/data_shares 011+ scope-undadır)', () => {});
  test.skip('TEST 9 Cross-center REVOKED consent → DENIED (DEFERRED: eyni səbəb)', () => {});

  test('TEST 10 Composite FK: cross-tenant specialist_child_assignment DB səviyyəsində rədd olunur', async () => {
    const c = await migratorClient();
    try {
      await expect(
        c.query(
          `INSERT INTO specialist_child_assignments (organization_id, specialist_id, child_id, assigned_by, status)
           VALUES ($1, $2, $3, $4, 'ACTIVE')`,
          [fx.orgA, fx.specialistB1, fx.childX, fx.userA2], // orgA + specialistB1(orgB-yə aiddir) => composite FK pozuntusu
        ),
      ).rejects.toThrow(/foreign key/i);
    } finally {
      await c.end();
    }
  });

  test('TEST 11 NO_BRANCH membership → heç bir branch scope-da deyil', async () => {
    const { resolveMemberScope, isBranchInScope } = await import('../../src/scope-cache/scope-resolver');
    const scope = await resolveMemberScope(fx.orgA, fx.memberNoBranch, { bypassCache: true });
    expect(scope.scopeType).toBe('NO_BRANCH');
    expect(isBranchInScope(scope, fx.branchA1)).toBe(false);
    expect(isBranchInScope(scope, fx.branchA2)).toBe(false);
  });

  test('TEST 12 SELECTED_BRANCHES → yalnız seçilmiş branch', async () => {
    const { resolveMemberScope, isBranchInScope } = await import('../../src/scope-cache/scope-resolver');
    const scope = await resolveMemberScope(fx.orgA, fx.memberSelected, { bypassCache: true });
    expect(isBranchInScope(scope, fx.branchA1)).toBe(true);
    expect(isBranchInScope(scope, fx.branchA2)).toBe(false);
  });

  test('TEST 13 ALL_BRANCHES → bütün branch-lər', async () => {
    const { resolveMemberScope, isBranchInScope } = await import('../../src/scope-cache/scope-resolver');
    const scope = await resolveMemberScope(fx.orgA, fx.memberAll, { bypassCache: true });
    expect(scope.scopeType).toBe('ALL_BRANCHES');
    expect(isBranchInScope(scope, fx.branchA1)).toBe(true);
    expect(isBranchInScope(scope, fx.branchA2)).toBe(true);
  });

  test('TEST 14 ENDED assignment → artıq aktiv siyahıda görünmür, yeni ACTIVE yaradıla bilir', async () => {
    const { createAssignment, endAssignment, listActiveAssignedChildren } = await import(
      '../../src/modules/assignments/assignment.service'
    );
    const childY = '00000000-0000-4000-8000-000000000002';
    const created = await createAssignment(
      { organizationId: fx.orgA, memberId: fx.centerAdminMember, userId: fx.centerAdminUserId },
      { specialistId: fx.specialistA1, childId: childY },
    );
    await endAssignment({ organizationId: fx.orgA, memberId: fx.centerAdminMember, userId: fx.centerAdminUserId }, created.id);

    const children = await listActiveAssignedChildren(fx.orgA, fx.specialistA1);
    expect(children).not.toContain(childY);

    // ENDED-dən sonra eyni cütlük üçün YENİ ACTIVE assignment mümkün olmalıdır (partial unique index yalnız ACTIVE-lərə tətbiq olunur)
    const recreated = await createAssignment(
      { organizationId: fx.orgA, memberId: fx.centerAdminMember, userId: fx.centerAdminUserId },
      { specialistId: fx.specialistA1, childId: childY },
    );
    expect(recreated.id).toBeDefined();
  });

  test('TEST 14b Eyni specialist+child üçün 2 ACTIVE assignment DB səviyyəsində rədd olunur', async () => {
    const c = await migratorClient();
    try {
      // Test 14-dəki "recreated" artıq ACTIVE-dir — təkrar ACTIVE insert yoxlanılır
      await expect(
        c.query(
          `INSERT INTO specialist_child_assignments (organization_id, specialist_id, child_id, assigned_by, status)
           VALUES ($1, $2, $3, $4, 'ACTIVE')`,
          [fx.orgA, fx.specialistA1, '00000000-0000-4000-8000-000000000002', fx.userA2],
        ),
      ).rejects.toThrow(/duplicate key|unique/i);
    } finally {
      await c.end();
    }
  });

  test('TEST 15 ENDED assignment tarixi qeyd kimi qalır (fiziki silinmir)', async () => {
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query(
        `SELECT status, ended_at FROM specialist_child_assignments
         WHERE organization_id=$1 AND specialist_id=$2 AND child_id=$3 AND status='ENDED'`,
        [fx.orgA, fx.specialistA1, '00000000-0000-4000-8000-000000000002'],
      );
      return r.rows;
    });
    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].ended_at).not.toBeNull();
  });

  test('TEST 16 SUPERVISOR → assignment yarada bilər, END edə BİLMƏZ', async () => {
    const { createAssignment, endAssignment } = await import('../../src/modules/assignments/assignment.service');
    const childZ = '00000000-0000-4000-8000-000000000003';
    const created = await createAssignment(
      { organizationId: fx.orgA, memberId: fx.supervisorMember, userId: fx.supervisorUserId },
      { specialistId: fx.specialistA1, childId: childZ },
    );
    expect(created.id).toBeDefined();

    await expect(
      endAssignment({ organizationId: fx.orgA, memberId: fx.supervisorMember, userId: fx.supervisorUserId }, created.id),
    ).rejects.toThrow(/ACCESS_DENIED|icazəniz yoxdur/i);
  });

  test('TEST 17 CENTER_ADMIN → assignment END edə bilər', async () => {
    const { createAssignment, endAssignment } = await import('../../src/modules/assignments/assignment.service');
    const childW = '00000000-0000-4000-8000-000000000004';
    const created = await createAssignment(
      { organizationId: fx.orgA, memberId: fx.centerAdminMember, userId: fx.centerAdminUserId },
      { specialistId: fx.specialistA1, childId: childW },
    );
    await expect(
      endAssignment({ organizationId: fx.orgA, memberId: fx.centerAdminMember, userId: fx.centerAdminUserId }, created.id),
    ).resolves.toBeUndefined();
  });

  test('TEST 18 JWT yalnız minimal sahələri daşıyır', async () => {
    const { signAccessToken } = await import('../../src/modules/auth/jwt.service');
    const jwt = await import('jsonwebtoken');
    const token = signAccessToken({
      user_id: fx.userA1,
      active_organization_id: fx.orgA,
      session_id: '00000000-0000-4000-8000-000000000099',
    });
    const decoded = jwt.decode(token) as Record<string, unknown>;
    const keys = Object.keys(decoded).sort();
    expect(keys).toEqual(['active_organization_id', 'exp', 'iat', 'session_id', 'user_id']);
    expect(decoded).not.toHaveProperty('roles');
    expect(decoded).not.toHaveProperty('permissions');
    expect(decoded).not.toHaveProperty('active_branch_ids');
  });

  test('TEST 19 Vaxtı bitmiş access token qəbul edilmir', async () => {
    const jwt = await import('jsonwebtoken');
    const expired = jwt.sign(
      { user_id: fx.userA1, active_organization_id: fx.orgA, session_id: 'x' },
      process.env.JWT_ACCESS_SECRET as string,
      { expiresIn: -10 },
    );
    const { verifyAccessToken } = await import('../../src/modules/auth/jwt.service');
    expect(() => verifyAccessToken(expired)).toThrow();
  });

  test('TEST 20 Refresh token reuse detection: təkrar istifadə bütün sessiyaları ləğv edir', async () => {
    const c = await migratorClient();
    let userId: string;
    try {
      userId = (
        await c.query(
          `INSERT INTO users (email, password_hash, full_name) VALUES ($1,'x','Reuse Test') RETURNING id`,
          [`reuse-${Date.now()}@test.local`],
        )
      ).rows[0].id;
    } finally {
      await c.end();
    }

    const crypto = await import('crypto');
    const generateOpaqueToken = () => crypto.randomBytes(48).toString('hex');
    const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
    const rawToken = generateOpaqueToken();

    const c2 = await migratorClient();
    try {
      await c2.query(`INSERT INTO sessions_auth (user_id, refresh_token_hash) VALUES ($1,$2)`, [
        userId,
        hashToken(rawToken),
      ]);
    } finally {
      await c2.end();
    }

    const { refresh } = await import('../../src/modules/auth/auth.service');

    // Membership lazımdır ki, refresh activeOrganizationId doğrulaması keçsin
    const c3 = await migratorClient();
    try {
      await c3.query(`INSERT INTO organization_members (organization_id, user_id, scope_type) VALUES ($1,$2,'NO_BRANCH')`, [
        fx.orgA,
        userId,
      ]);
    } finally {
      await c3.end();
    }

    const first = await refresh(rawToken, fx.orgA);
    expect(first.refreshToken).toBeDefined();

    // Eyni (artıq revoked) token TƏKRAR göndərilir → reuse aşkarlanmalıdır
    await expect(refresh(rawToken, fx.orgA)).rejects.toThrow(/təkrar istifadə/i);

    // Reuse-dan sonra HƏTTA yeni verilmiş token də ləğv olunmalıdır (bütün sessiyalar)
    await expect(refresh(first.refreshToken, fx.orgA)).rejects.toThrow();
  });

  test('EK: cdos_app RLS-dən bypass edə BİLMİR (tenant context olmadan 0 sətir)', async () => {
    const rows = await runAsApp(null, async (c) => {
      const r = await c.query('SELECT * FROM specialists');
      return r.rows;
    });
    expect(rows.length).toBe(0);
  });

  test('EK: cdos_migrator (BYPASSRLS) bütün tenant-lardakı sətirləri görür', async () => {
    const c = await migratorClient();
    try {
      const r = await c.query('SELECT * FROM specialists WHERE id IN ($1,$2)', [fx.specialistA1, fx.specialistB1]);
      expect(r.rows.length).toBe(2);
    } finally {
      await c.end();
    }
  });

  test('EK: connection pool/request context isolation — ardıcıl transaction-lar bir-birinin current_org-unu görmür', async () => {
    const client = await appClient();
    try {
      // "Request A" — Org A context
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org', $1, true)", [fx.orgA]);
      const a = await client.query('SELECT * FROM specialists WHERE id = $1', [fx.specialistA1]);
      expect(a.rows.length).toBe(1);
      await client.query('COMMIT'); // SET LOCAL burada avtomatik sıfırlanır

      // "Request B" — eyni fiziki connection, YENİ transaction, context TƏYİN EDİLMİR
      await client.query('BEGIN');
      const b = await client.query('SELECT * FROM specialists WHERE id = $1', [fx.specialistA1]);
      expect(b.rows.length).toBe(0); // köhnə context miras alınmayıb — 0 sətir (fail-closed)
      await client.query('COMMIT');
    } finally {
      await client.end();
    }
  });
});

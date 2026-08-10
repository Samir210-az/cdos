import { Client } from 'pg';

export async function migratorClient(): Promise<Client> {
  const c = new Client({ connectionString: process.env.DATABASE_MIGRATOR_URL });
  await c.connect();
  return c;
}

export async function appClient(): Promise<Client> {
  const c = new Client({ connectionString: process.env.DATABASE_APP_URL });
  await c.connect();
  return c;
}

/** cdos_app ilə, verilmiş tenant context altında bir sorğu icra edir (transaction + SET LOCAL). */
export async function runAsApp<T>(
  organizationIdOrNull: string | null,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const client = await appClient();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', [
      'app.current_org',
      organizationIdOrNull ?? '',
    ]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await client.end();
  }
}

export interface Fixtures {
  orgA: string;
  orgB: string;
  branchA1: string;
  branchA2: string;
  branchB1: string;
  userA1: string; // specialist user, org A
  userA2: string; // admin-oxşarı user, org A
  userB1: string; // specialist user, org B
  specialistA1: string; // branchA1-də
  specialistA2: string; // branch_id NULL
  specialistB1: string; // org B
  memberNoBranch: string; // org A, scope_type=NO_BRANCH
  memberSelected: string; // org A, scope_type=SELECTED_BRANCHES -> branchA1
  memberAll: string; // org A, scope_type=ALL_BRANCHES
  centerAdminMember: string; // org A, rol CENTER_ADMIN, scope ALL_BRANCHES
  centerAdminUserId: string;
  supervisorMember: string; // org A, rol SUPERVISOR, scope SELECTED_BRANCHES -> branchA1
  supervisorUserId: string;
  childX: string; // uydurma uşaq UUID (children cədvəli yoxdur, opaque id kimi istifadə olunur)
  // --- Faz 3.3 əlavələri ---
  childA1: string;   // Org A-nın real child sətri (branchA1-də)
  childA2: string;   // Org A-nın 2-ci child sətri
  childB1: string;   // Org B-nin child sətri
  parentA1: string;  // Org A parent
  parentA2: string;  // Org A parent (Parent A1-in uşağına aid DEYİL)
}

/** cdos_migrator ilə (BYPASSRLS) test fixture-larını yaradır. Hər seed sətrində organization_id AÇIQ təyin olunur (Faz 3.1/3.2 seed qaydası). */
export async function seedFixtures(): Promise<Fixtures> {
  const c = await migratorClient();
  try {
    const orgA = (await c.query(`INSERT INTO organizations (name) VALUES ('Org A Test') RETURNING id`)).rows[0].id;
    const orgB = (await c.query(`INSERT INTO organizations (name) VALUES ('Org B Test') RETURNING id`)).rows[0].id;

    const branchA1 = (await c.query(`INSERT INTO branches (organization_id, name) VALUES ($1,'Branch A1') RETURNING id`, [orgA])).rows[0].id;
    const branchA2 = (await c.query(`INSERT INTO branches (organization_id, name) VALUES ($1,'Branch A2') RETURNING id`, [orgA])).rows[0].id;
    const branchB1 = (await c.query(`INSERT INTO branches (organization_id, name) VALUES ($1,'Branch B1') RETURNING id`, [orgB])).rows[0].id;

    const mkUser = async (email: string) =>
      (await c.query(
        `INSERT INTO users (email, password_hash, full_name) VALUES ($1,'x','Test User') RETURNING id`,
        [email],
      )).rows[0].id;

    const userA1 = await mkUser(`spec-a1-${Date.now()}@test.local`);
    const userA2 = await mkUser(`admin-a-${Date.now()}@test.local`);
    const userB1 = await mkUser(`spec-b1-${Date.now()}@test.local`);

    const specialistA1 = (await c.query(
      `INSERT INTO specialists (organization_id, branch_id, user_id, specialization) VALUES ($1,$2,$3,'Psixoloq') RETURNING id`,
      [orgA, branchA1, userA1],
    )).rows[0].id;
    const specialistA2 = (await c.query(
      `INSERT INTO specialists (organization_id, branch_id, user_id, specialization) VALUES ($1,NULL,$2,'Loqoped') RETURNING id`,
      [orgA, userA2],
    )).rows[0].id;
    const specialistB1 = (await c.query(
      `INSERT INTO specialists (organization_id, branch_id, user_id, specialization) VALUES ($1,$2,$3,'Erqoterapevt') RETURNING id`,
      [orgB, branchB1, userB1],
    )).rows[0].id;

    const mkMember = async (orgId: string, userId: string, scopeType: string) =>
      (await c.query(
        `INSERT INTO organization_members (organization_id, user_id, scope_type) VALUES ($1,$2,$3) RETURNING id`,
        [orgId, userId, scopeType],
      )).rows[0].id;

    const memberNoBranch = await mkMember(orgA, userA1, 'NO_BRANCH');
    const uSel = await mkUser(`sel-${Date.now()}@test.local`);
    const memberSelected = await mkMember(orgA, uSel, 'SELECTED_BRANCHES');
    await c.query(`INSERT INTO member_branches (organization_id, member_id, branch_id) VALUES ($1,$2,$3)`, [
      orgA,
      memberSelected,
      branchA1,
    ]);
    const uAll = await mkUser(`all-${Date.now()}@test.local`);
    const memberAll = await mkMember(orgA, uAll, 'ALL_BRANCHES');

    const uCenterAdmin = await mkUser(`center-admin-${Date.now()}@test.local`);
    const centerAdminMember = await mkMember(orgA, uCenterAdmin, 'ALL_BRANCHES');
    const centerAdminRole = (await c.query(`SELECT id FROM roles WHERE code='CENTER_ADMIN'`)).rows[0].id;
    await c.query(`INSERT INTO member_roles (organization_id, member_id, role_id) VALUES ($1,$2,$3)`, [
      orgA,
      centerAdminMember,
      centerAdminRole,
    ]);

    const uSupervisor = await mkUser(`supervisor-${Date.now()}@test.local`);
    const supervisorMember = await mkMember(orgA, uSupervisor, 'SELECTED_BRANCHES');
    await c.query(`INSERT INTO member_branches (organization_id, member_id, branch_id) VALUES ($1,$2,$3)`, [
      orgA,
      supervisorMember,
      branchA1,
    ]);
    const supervisorRole = (await c.query(`SELECT id FROM roles WHERE code='SUPERVISOR'`)).rows[0].id;
    await c.query(`INSERT INTO member_roles (organization_id, member_id, role_id) VALUES ($1,$2,$3)`, [
      orgA,
      supervisorMember,
      supervisorRole,
    ]);

    // children cədvəli artıq mövcuddur (Faz 3.3). Köhnə (Faz 3.2) testlərdə
    // istifadə olunan opaque UUID-lər İNDİ REAL children sətirləri kimi
    // yaradılır ki, yeni composite FK (fk_assignment_child) pozulmasın və
    // Faz 3.2 regression testləri DƏYİŞDİRİLMƏDƏN keçsin.
    const legacyChildIds = [
      '00000000-0000-4000-8000-000000000001', // childX
      '00000000-0000-4000-8000-000000000002', // Test14 (childY)
      '00000000-0000-4000-8000-000000000003', // Test16 (childZ)
      '00000000-0000-4000-8000-000000000004', // Test17 (childW)
    ];
    for (const [i, id] of legacyChildIds.entries()) {
      await c.query(
        `INSERT INTO children (id, organization_id, branch_id, local_code, first_name, last_name, dob)
         VALUES ($1, $2, $3, $4, 'Legacy', 'Child', '2018-01-01')`,
        [id, orgA, branchA1, `LEGACY-${i}`],
      );
    }
    const childX = legacyChildIds[0];

    // --- Faz 3.3 üçün yeni, real child/parent fixture-ları ---
    const childA1 = (await c.query(
      `INSERT INTO children (organization_id, branch_id, local_code, first_name, last_name, dob)
       VALUES ($1,$2,'CH-A-0001','Aysel','Məmmədova','2019-03-10') RETURNING id`,
      [orgA, branchA1],
    )).rows[0].id;
    const childA2 = (await c.query(
      `INSERT INTO children (organization_id, branch_id, local_code, first_name, last_name, dob)
       VALUES ($1,$2,'CH-A-0002','Kamran','Əliyev','2020-06-01') RETURNING id`,
      [orgA, branchA1],
    )).rows[0].id;
    const childB1 = (await c.query(
      `INSERT INTO children (organization_id, branch_id, local_code, first_name, last_name, dob)
       VALUES ($1,$2,'CH-B-0001','Nihad','Hüseynov','2018-11-20') RETURNING id`,
      [orgB, branchB1],
    )).rows[0].id;

    const uParentA1 = await mkUser(`parent-a1-${Date.now()}@test.local`);
    const uParentA2 = await mkUser(`parent-a2-${Date.now()}@test.local`);
    const parentA1 = (await c.query(
      `INSERT INTO parents (organization_id, user_id, phone) VALUES ($1,$2,'+994500000001') RETURNING id`,
      [orgA, uParentA1],
    )).rows[0].id;
    const parentA2 = (await c.query(
      `INSERT INTO parents (organization_id, user_id, phone) VALUES ($1,$2,'+994500000002') RETURNING id`,
      [orgA, uParentA2],
    )).rows[0].id;
    await c.query(
      `INSERT INTO child_guardians (organization_id, child_id, parent_id, relation_type, is_primary)
       VALUES ($1,$2,$3,'mother',true)`,
      [orgA, childA1, parentA1],
    );
    await c.query(
      `INSERT INTO child_guardians (organization_id, child_id, parent_id, relation_type, is_primary)
       VALUES ($1,$2,$3,'mother',true)`,
      [orgA, childA2, parentA2],
    );

    return {
      orgA,
      orgB,
      branchA1,
      branchA2,
      branchB1,
      userA1,
      userA2,
      userB1,
      specialistA1,
      specialistA2,
      specialistB1,
      memberNoBranch,
      memberSelected,
      memberAll,
      centerAdminMember,
      centerAdminUserId: uCenterAdmin,
      supervisorMember,
      supervisorUserId: uSupervisor,
      childX,
      childA1,
      childA2,
      childB1,
      parentA1,
      parentA2,
    };
  } finally {
    await c.end();
  }
}

export async function cleanupFixtures(): Promise<void> {
  const c = await migratorClient();
  try {
    // Faz 3.6: sessions/session_amendments/session_goals klinik fiziki-DELETE
    // trigger-ləri YALNIZ test cleanup üçün müvəqqəti deaktiv edilir.
    await c.query(`DELETE FROM session_goals`);
    await c.query(`ALTER TABLE session_amendments DISABLE TRIGGER trg_amendments_no_delete`);
    await c.query(`DELETE FROM session_amendments`);
    await c.query(`ALTER TABLE session_amendments ENABLE TRIGGER trg_amendments_no_delete`);
    await c.query(`ALTER TABLE sessions DISABLE TRIGGER trg_sessions_no_delete`);
    await c.query(`DELETE FROM sessions`);
    await c.query(`ALTER TABLE sessions ENABLE TRIGGER trg_sessions_no_delete`);

    // Faz 3.5: development_plans/goals/goal_measurements klinik fiziki-DELETE
    // trigger-ləri (Faz 3.1 qaydası) YALNIZ test cleanup üçün müvəqqəti deaktiv
    // edilir — eyni pattern, Faz 3.4-dəki assessment trigger idarəçiliyi ilə.
    await c.query(`ALTER TABLE goal_measurements DISABLE TRIGGER trg_measurements_no_delete`);
    await c.query(`DELETE FROM goal_measurements`);
    await c.query(`ALTER TABLE goal_measurements ENABLE TRIGGER trg_measurements_no_delete`);

    await c.query(`ALTER TABLE goals DISABLE TRIGGER trg_goals_no_delete`);
    await c.query(`DELETE FROM goals`);
    await c.query(`ALTER TABLE goals ENABLE TRIGGER trg_goals_no_delete`);

    await c.query(`ALTER TABLE development_plans DISABLE TRIGGER trg_plans_no_delete`);
    await c.query(`DELETE FROM development_plans`);
    await c.query(`ALTER TABLE development_plans ENABLE TRIGGER trg_plans_no_delete`);

    // LOCKED instance-ların answers/results-u DB trigger ilə qorunur (bu, düzgün
    // təhlükəsizlik davranışıdır) — test cleanup üçün YALNIZ migrator sessiyasında,
    // müvəqqəti olaraq trigger-lər deaktiv edilir (production-da bu heç vaxt edilmir).
    await c.query(`ALTER TABLE assessment_results DISABLE TRIGGER trg_results_lock_guard`);
    await c.query(`DELETE FROM assessment_results`);
    await c.query(`ALTER TABLE assessment_results ENABLE TRIGGER trg_results_lock_guard`);
    await c.query(`ALTER TABLE assessment_answers DISABLE TRIGGER trg_answers_lock_guard`);
    await c.query(`DELETE FROM assessment_answers`);
    await c.query(`ALTER TABLE assessment_answers ENABLE TRIGGER trg_answers_lock_guard`);
    await c.query(`DELETE FROM assessment_instances`);
    await c.query(`ALTER TABLE assessment_items DISABLE TRIGGER trg_items_publish_guard`);
    await c.query(`DELETE FROM assessment_items`);
    await c.query(`ALTER TABLE assessment_items ENABLE TRIGGER trg_items_publish_guard`);
    await c.query(`ALTER TABLE assessment_sections DISABLE TRIGGER trg_sections_publish_guard`);
    await c.query(`DELETE FROM assessment_sections`);
    await c.query(`ALTER TABLE assessment_sections ENABLE TRIGGER trg_sections_publish_guard`);
    await c.query(`ALTER TABLE assessment_subscales DISABLE TRIGGER trg_subscales_publish_guard`);
    await c.query(`DELETE FROM assessment_subscales`);
    await c.query(`ALTER TABLE assessment_subscales ENABLE TRIGGER trg_subscales_publish_guard`);
    await c.query(`DELETE FROM assessment_template_versions`);
    await c.query(`DELETE FROM assessment_templates`);
    await c.query(`DELETE FROM medical_background`);
    await c.query(`DELETE FROM developmental_history`);
    await c.query(`DELETE FROM communication_profile`);
    await c.query(`DELETE FROM behavior_profile`);
    await c.query(`DELETE FROM sensory_profile`);
    await c.query(`DELETE FROM educational_info`);
    await c.query(`DELETE FROM emergency_contacts`);
    await c.query(`DELETE FROM child_guardians`);
    await c.query(`DELETE FROM specialist_child_assignments`);
    await c.query(`DELETE FROM parents`);
    await c.query(`DELETE FROM children`);
    await c.query(`DELETE FROM member_branches`);
    await c.query(`DELETE FROM member_roles`);
    await c.query(`DELETE FROM organization_members`);
    await c.query(`DELETE FROM specialists`);
    await c.query(`DELETE FROM sessions_auth`);
    await c.query(`DELETE FROM branches`);
    await c.query(`DELETE FROM users WHERE email LIKE '%@test.local'`);
    await c.query(`DELETE FROM organizations WHERE name IN ('Org A Test','Org B Test')`);
  } finally {
    await c.end();
  }
}

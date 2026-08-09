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

    // children cədvəli hələ yoxdur — opaque test UUID istifadə olunur (yalnız FK olmadan child_id sütununu doldurmaq üçün)
    const childX = '00000000-0000-4000-8000-000000000001';

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
    };
  } finally {
    await c.end();
  }
}

export async function cleanupFixtures(): Promise<void> {
  const c = await migratorClient();
  try {
    await c.query(`DELETE FROM specialist_child_assignments`);
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

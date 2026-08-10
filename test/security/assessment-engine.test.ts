import { Fixtures, seedFixtures, cleanupFixtures, runAsApp, migratorClient } from './helpers';
import { closeAppPool } from '../../src/common/db/pool';
import {
  createTemplate,
  createTemplateVersion,
  addSection,
  addSubscale,
  addItem,
  publishTemplateVersion,
  TemplateError,
} from '../../src/modules/assessments/template.service';
import { createInstance, submitAnswer, lockInstanceAndCalculate, InstanceError } from '../../src/modules/assessments/instance.service';

describe('CDOS Faz 3.4 — Assessment Engine Security Tests', () => {
  let fx: Fixtures;
  let templateId: string;
  let versionId: string;
  let sectionId: string;
  let subscaleId: string;
  let itemQ1: string;
  let itemQ2: string;
  let orgBTemplateId: string;
  let orgBVersionId: string;

  const actor = () => ({ organizationId: fx.orgA, memberId: fx.centerAdminMember, userId: fx.centerAdminUserId });

  beforeAll(async () => {
    fx = await seedFixtures();

    // --- Org A: draft template + struktur ---
    templateId = (await createTemplate(actor(), { name: 'PEDS Screening', specialization: 'Psixoloq' })).id;
    versionId = (await createTemplateVersion(actor(), templateId)).id;
    sectionId = (await addSection(actor(), { templateVersionId: versionId, title: 'Bölmə 1' })).id;
    subscaleId = (
      await addSubscale(actor(), {
        templateVersionId: versionId,
        name: 'Ümumi bal',
        calculationRule: { operation: 'SUM', operands: ['Q1', 'Q2'] },
      })
    ).id;
    itemQ1 = (
      await addItem(actor(), { sectionId, code: 'Q1', label: 'Sual 1', fieldType: 'numeric', subscaleId })
    ).id;
    itemQ2 = (
      await addItem(actor(), { sectionId, code: 'Q2', label: 'Sual 2', fieldType: 'numeric', subscaleId })
    ).id;

    // --- Org B: müqayisə üçün ayrıca template ---
    const c = await migratorClient();
    try {
      orgBTemplateId = (
        await c.query(`INSERT INTO assessment_templates (organization_id, name) VALUES ($1,'Org B Template') RETURNING id`, [
          fx.orgB,
        ])
      ).rows[0].id;
      orgBVersionId = (
        await c.query(
          `INSERT INTO assessment_template_versions (organization_id, template_id, version_no, status)
           VALUES ($1,$2,1,'DRAFT') RETURNING id`,
          [fx.orgB, orgBTemplateId],
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

  // --- TENANT ISOLATION (1-4) ---

  test('TEST 1: Org A → Org B template görünmür', async () => {
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT * FROM assessment_templates WHERE id=$1', [orgBTemplateId]);
      return r.rows;
    });
    expect(rows.length).toBe(0);
  });

  test('TEST 2: Org A → Org B assessment (instance) görünmür', async () => {
    const cMig = await migratorClient();
    let orgBInstanceId: string;
    try {
      orgBInstanceId = (
        await cMig.query(
          `INSERT INTO assessment_instances (organization_id, child_id, template_version_id, assessor_id)
           VALUES ($1,$2,$3,$4) RETURNING id`,
          [fx.orgB, fx.childB1, orgBVersionId, fx.specialistB1],
        )
      ).rows[0].id;
    } finally {
      await cMig.end();
    }
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query('SELECT * FROM assessment_instances WHERE id=$1', [orgBInstanceId]);
      return r.rows;
    });
    expect(rows.length).toBe(0);
  });

  test('TEST 3: Org A → Org B answer görünmür', async () => {
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query(
        `SELECT a.* FROM assessment_answers a WHERE a.organization_id = $1`,
        [fx.orgB],
      );
      return r.rows;
    });
    expect(rows.length).toBe(0); // orgA context-də orgB filter-i ilə axtarış = 0 (RLS + app filter)
  });

  test('TEST 4: Org A → Org B result görünmür', async () => {
    const rows = await runAsApp(fx.orgA, async (c) => {
      const r = await c.query(`SELECT * FROM assessment_results WHERE organization_id = $1`, [fx.orgB]);
      return r.rows;
    });
    expect(rows.length).toBe(0);
  });

  // --- TEMPLATE INTEGRITY (5-9) ---

  test('TEST 5+8: DRAFT publish edilə bilər', async () => {
    const res = await publishTemplateVersion(actor(), versionId);
    expect(res.published).toBe(true);
  });

  test('TEST 5: PUBLISHED version özü dəyişdirilə bilmir (DB trigger)', async () => {
    const c = await migratorClient();
    try {
      await expect(
        c.query(`UPDATE assessment_template_versions SET version_no = 999 WHERE id=$1`, [versionId]),
      ).rejects.toThrow(/PUBLISHED template version/i);
    } finally {
      await c.end();
    }
  });

  test('TEST 6: PUBLISHED versiyada item dəyişdirilə bilmir (DB trigger)', async () => {
    const c = await migratorClient();
    try {
      await expect(
        c.query(`UPDATE assessment_items SET label='Dəyişdirilmiş' WHERE id=$1`, [itemQ1]),
      ).rejects.toThrow(/item dəyişdirilə/i);
    } finally {
      await c.end();
    }
  });

  test('TEST 7: PUBLISHED versiyada scoring DSL (subscale) dəyişdirilə bilmir (DB trigger)', async () => {
    const c = await migratorClient();
    try {
      await expect(
        c.query(`UPDATE assessment_subscales SET calculation_rule='{"operation":"AVERAGE","operands":["Q1"]}' WHERE id=$1`, [
          subscaleId,
        ]),
      ).rejects.toThrow(/dəyişdirilə/i);
    } finally {
      await c.end();
    }
  });

  test('TEST 6b: PUBLISHED versiyada section dəyişdirilə bilmir (DB trigger)', async () => {
    const c = await migratorClient();
    try {
      await expect(c.query(`UPDATE assessment_sections SET title='X' WHERE id=$1`, [sectionId])).rejects.toThrow(
        /dəyişdirilə/i,
      );
    } finally {
      await c.end();
    }
  });

  test('TEST 9: invalid DSL-li versiya publish edilə bilmir', async () => {
    const badTemplateId = (await createTemplate(actor(), { name: 'Bad Template' })).id;
    const badVersionId = (await createTemplateVersion(actor(), badTemplateId)).id;
    const badSectionId = (await addSection(actor(), { templateVersionId: badVersionId, title: 'S1' })).id;
    await addItem(actor(), { sectionId: badSectionId, code: 'Q1', label: 'Sual 1', fieldType: 'numeric' });
    await addSubscale(actor(), {
      templateVersionId: badVersionId,
      name: 'Pozuq',
      calculationRule: { operation: 'SUM', operands: ['Q1', 'Q_NONEXISTENT'] }, // mövcud olmayan referans
    });

    await expect(publishTemplateVersion(actor(), badVersionId)).rejects.toThrow(TemplateError);
    await expect(publishTemplateVersion(actor(), badVersionId)).rejects.toThrow(/INVALID_DSL|Unknown item reference/i);
  });

  // --- ASSESSMENT LIFECYCLE (15-17) + SCORING END-TO-END ---

  let instanceId: string;

  test('Assessment instance yaradılır (yalnız PUBLISHED version üzərində)', async () => {
    instanceId = (
      await createInstance(actor(), {
        childId: fx.childA1,
        templateVersionId: versionId,
        assessorSpecialistId: fx.specialistA1,
      })
    ).id;
    expect(instanceId).toBeDefined();
  });

  test('PUBLISHED olmayan (DRAFT) versiya üzərində instance yaratmaq rədd olunur', async () => {
    const draftTemplateId = (await createTemplate(actor(), { name: 'Draft Only' })).id;
    const draftVersionId = (await createTemplateVersion(actor(), draftTemplateId)).id;
    await expect(
      createInstance(actor(), { childId: fx.childA1, templateVersionId: draftVersionId, assessorSpecialistId: fx.specialistA1 }),
    ).rejects.toThrow(InstanceError);
  });

  test('Cavablar yazılır, LOCK edilir və SUM(Q1,Q2) düzgün hesablanır', async () => {
    await submitAnswer(actor(), { instanceId, itemId: itemQ1, value: 4 });
    await submitAnswer(actor(), { instanceId, itemId: itemQ2, value: 6 });

    const { results } = await lockInstanceAndCalculate(actor(), instanceId);
    expect(results.length).toBe(1);
    expect(results[0].subscaleId).toBe(subscaleId);
    expect(results[0].rawScore).toBe(10); // 4 + 6
  });

  test('TEST 15: LOCKED instance UPDATE edilə bilmir (DB trigger)', async () => {
    const c = await migratorClient();
    try {
      await expect(
        c.query(`UPDATE assessment_instances SET assessor_id = $1 WHERE id=$2`, [fx.specialistA2, instanceId]),
      ).rejects.toThrow(/LOCKED-dir/i);
    } finally {
      await c.end();
    }
  });

  test('TEST 16: LOCKED instance-da answers dəyişdirilə bilmir (DB trigger)', async () => {
    const c = await migratorClient();
    try {
      await expect(
        c.query(`UPDATE assessment_answers SET value='99' WHERE instance_id=$1 AND item_id=$2`, [instanceId, itemQ1]),
      ).rejects.toThrow(/LOCKED-dir/i);
      // yeni cavab əlavə etmək cəhdi də rədd olunmalıdır
      await expect(
        c.query(
          `INSERT INTO assessment_answers (organization_id, instance_id, item_id, value) VALUES ($1,$2,$3,$4)`,
          [fx.orgA, instanceId, itemQ1, '"hack"'],
        ),
      ).rejects.toThrow(/LOCKED-dir/i);
    } finally {
      await c.end();
    }
  });

  test('TEST 17: LOCKED instance-da results dəyişdirilə bilmir (DB trigger)', async () => {
    const c = await migratorClient();
    try {
      await expect(
        c.query(`UPDATE assessment_results SET raw_score=0 WHERE instance_id=$1 AND subscale_id=$2`, [
          instanceId,
          subscaleId,
        ]),
      ).rejects.toThrow(/LOCKED-dir/i);
    } finally {
      await c.end();
    }
  });

  test('LOCKED instance servis səviyyəsində təkrar LOCK edilə bilmir', async () => {
    await expect(lockInstanceAndCalculate(actor(), instanceId)).rejects.toThrow(InstanceError);
  });

  // --- CROSS-TENANT FK (18-19) ---

  test('TEST 18: Org A instance → Org B child relation composite FK ilə rədd olunur', async () => {
    const c = await migratorClient();
    try {
      await expect(
        c.query(
          `INSERT INTO assessment_instances (organization_id, child_id, template_version_id, assessor_id)
           VALUES ($1,$2,$3,$4)`,
          [fx.orgA, fx.childB1, versionId, fx.specialistA1], // orgA + childB1(orgB-yə aiddir)
        ),
      ).rejects.toThrow(/foreign key/i);
    } finally {
      await c.end();
    }
  });

  test('TEST 19: Org A instance → Org B template version relation composite FK ilə rədd olunur', async () => {
    const c = await migratorClient();
    try {
      await expect(
        c.query(
          `INSERT INTO assessment_instances (organization_id, child_id, template_version_id, assessor_id)
           VALUES ($1,$2,$3,$4)`,
          [fx.orgA, fx.childA1, orgBVersionId, fx.specialistA1], // orgA + orgBVersionId(orgB-yə aiddir)
        ),
      ).rejects.toThrow(/foreign key/i);
    } finally {
      await c.end();
    }
  });

  test('cdos_app RLS-dən bypass edə bilmir (assessment cədvəllərində)', async () => {
    const rows = await runAsApp(null, async (c) => {
      const r = await c.query('SELECT * FROM assessment_templates');
      return r.rows;
    });
    expect(rows.length).toBe(0);
  });
});

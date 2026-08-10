import { Fixtures, seedFixtures, cleanupFixtures, migratorClient } from './helpers';
import { closeAppPool } from '../../src/common/db/pool';
import {
  createSubscriptionPlan,
  createOrganizationSubscription,
  createSubscriptionInvoice,
  recordSubscriptionPayment,
  listOrganizationSubscriptions,
  PlatformBillingError,
} from '../../src/modules/platform-billing/platform-billing.service';

describe('CDOS Faz 3.10 — Platform Billing Engine Security Tests', () => {
  let fx: Fixtures;
  let platformAdminMemberId: string;
  let platformAdminOrgContext: string; // hər hansı org (PLATFORM_ADMIN üçün "hansı org context-də login olub" mənasında)

  const platformActor = () => ({ organizationId: platformAdminOrgContext, memberId: platformAdminMemberId });
  const tenantActor = () => ({ organizationId: fx.orgA, memberId: fx.centerAdminMember });

  beforeAll(async () => {
    fx = await seedFixtures();
    const c = await migratorClient();
    try {
      platformAdminOrgContext = fx.orgA;
      platformAdminMemberId = fx.memberAll; // mövcud member, PLATFORM_ADMIN rolu əlavə olunur
      const roleId = (await c.query(`SELECT id FROM roles WHERE code='PLATFORM_ADMIN'`)).rows[0].id;
      await c.query(
        `INSERT INTO member_roles (organization_id, member_id, role_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [fx.orgA, platformAdminMemberId, roleId],
      );
    } finally {
      await c.end();
    }
  });

  afterAll(async () => {
    await cleanupFixtures();
    await closeAppPool();
  });

  // ================= A/B: schema + cədvəllərin mövcudluğu =================

  test('A: "platform_billing" schema mövcuddur', async () => {
    const c = await migratorClient();
    try {
      const r = await c.query(`SELECT 1 FROM pg_namespace WHERE nspname='platform_billing'`);
      expect(r.rowCount).toBe(1);
    } finally {
      await c.end();
    }
  });

  test('B: bütün 4 cədvəl mövcuddur', async () => {
    const c = await migratorClient();
    try {
      const r = await c.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema='platform_billing' ORDER BY table_name`,
      );
      const names = r.rows.map((row: any) => row.table_name);
      expect(names).toEqual([
        'organization_subscriptions',
        'subscription_invoices',
        'subscription_payments',
        'subscription_plans',
      ]);
    } finally {
      await c.end();
    }
  });

  // ================= C/D: tenant/platform ayrılığı =================

  test('C: tenant finance cədvəlləri (public.payments) ilə platform_billing arasında səhv FK yoxdur', async () => {
    const c = await migratorClient();
    try {
      const r = await c.query(
        `SELECT tc.table_schema, tc.table_name, ccu.table_schema AS foreign_schema, ccu.table_name AS foreign_table
         FROM information_schema.table_constraints tc
         JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
         WHERE tc.constraint_type='FOREIGN KEY'
           AND ((tc.table_schema='platform_billing' AND ccu.table_schema='public' AND ccu.table_name IN ('payments','invoices','payment_allocations'))
             OR (tc.table_schema='public' AND tc.table_name IN ('payments','invoices','payment_allocations') AND ccu.table_schema='platform_billing'))`,
      );
      expect(r.rowCount).toBe(0); // heç bir çarpaz-schema FK yoxdur
    } finally {
      await c.end();
    }
  });

  test('D: subscription_payments.subscription_invoice_id "public.invoices"-a yox, "platform_billing.subscription_invoices"-a bağlıdır', async () => {
    const c = await migratorClient();
    try {
      const r = await c.query(
        `SELECT ccu.table_schema, ccu.table_name FROM information_schema.table_constraints tc
         JOIN information_schema.constraint_column_usage ccu ON tc.constraint_name = ccu.constraint_name
         WHERE tc.table_schema='platform_billing' AND tc.table_name='subscription_payments' AND tc.constraint_type='FOREIGN KEY'
           AND ccu.column_name='id' AND ccu.table_name LIKE 'subscription_invoices'`,
      );
      expect(r.rows[0].table_schema).toBe('platform_billing');
    } finally {
      await c.end();
    }
  });

  // ================= E/F/G: münasibətlərin düzgünlüyü =================

  let planId: string;
  let orgSubId: string;
  let subInvoiceId: string;

  test('E: organization_subscription düzgün organization-a bağlıdır', async () => {
    const plan = await createSubscriptionPlan(platformActor(), { code: `PLAN-${Date.now()}`, name: 'Standard', price: 199 });
    planId = plan.id;
    const sub = await createOrganizationSubscription(platformActor(), { organizationId: fx.orgA, planId, seatsLimit: 20 });
    orgSubId = sub.id;

    const list = await listOrganizationSubscriptions(platformActor(), fx.orgA);
    expect(list.some((s: any) => s.id === orgSubId)).toBe(true);
  });

  test('F: subscription_invoice düzgün subscription-a bağlıdır', async () => {
    const inv = await createSubscriptionInvoice(platformActor(), {
      organizationId: fx.orgA,
      organizationSubscriptionId: orgSubId,
      amount: 199,
    });
    subInvoiceId = inv.id;
    const c = await migratorClient();
    try {
      const r = await c.query(
        `SELECT organization_subscription_id FROM platform_billing.subscription_invoices WHERE id=$1`,
        [subInvoiceId],
      );
      expect(r.rows[0].organization_subscription_id).toBe(orgSubId);
    } finally {
      await c.end();
    }
  });

  test('G: subscription_payment düzgün platform invoice əlaqəsini qoruyur', async () => {
    const pay = await recordSubscriptionPayment(platformActor(), {
      organizationId: fx.orgA,
      subscriptionInvoiceId: subInvoiceId,
      amount: 199,
      method: 'bank_transfer',
    });
    const c = await migratorClient();
    try {
      const r = await c.query(`SELECT subscription_invoice_id FROM platform_billing.subscription_payments WHERE id=$1`, [
        pay.id,
      ]);
      expect(r.rows[0].subscription_invoice_id).toBe(subInvoiceId);
    } finally {
      await c.end();
    }
  });

  // ================= H/I: authorization =================

  test('H: tenant rolunun (CENTER_ADMIN) platform billing-ə icazəsiz girişi bloklanır', async () => {
    await expect(
      createSubscriptionPlan(tenantActor(), { code: `HACK-${Date.now()}`, name: 'Hack' }),
    ).rejects.toThrow(PlatformBillingError);
    await expect(listOrganizationSubscriptions(tenantActor())).rejects.toThrow(/PLATFORM_ADMIN/i);
  });

  test('I: PLATFORM_ADMIN girişi mövcud authorization pattern ilə uyğundur (rol-kodu yoxlaması)', async () => {
    const list = await listOrganizationSubscriptions(platformActor());
    expect(Array.isArray(list)).toBe(true);
  });

  // ================= J/K: cross-org + invalid FK =================

  test("J: subscription_invoice səhv organization_subscription_id ilə yaradıla bilmir (invalid FK)", async () => {
    const c = await migratorClient();
    try {
      await expect(
        c.query(
          `INSERT INTO platform_billing.subscription_invoices (organization_id, organization_subscription_id, amount)
           VALUES ($1,$2,100)`,
          [fx.orgA, '00000000-0000-4000-8000-999999999999'],
        ),
      ).rejects.toThrow(/foreign key/i);
    } finally {
      await c.end();
    }
  });

  test('K: invalid FK-lər (mövcud olmayan organization_id) DB səviyyəsində rədd edilir', async () => {
    const c = await migratorClient();
    try {
      await expect(
        c.query(
          `INSERT INTO platform_billing.organization_subscriptions (organization_id, plan_id) VALUES ($1,$2)`,
          ['00000000-0000-4000-8000-888888888888', planId],
        ),
      ).rejects.toThrow(/foreign key/i);
    } finally {
      await c.end();
    }
  });

  test('Əlavə: subscription_plans.code UNIQUE-dir', async () => {
    const code = `DUP-${Date.now()}`;
    await createSubscriptionPlan(platformActor(), { code, name: 'İlk' });
    const c = await migratorClient();
    try {
      await expect(
        c.query(`INSERT INTO platform_billing.subscription_plans (code, name) VALUES ($1,'İkinci')`, [code]),
      ).rejects.toThrow(/duplicate key|unique/i);
    } finally {
      await c.end();
    }
  });

  test('Əlavə: subscription_invoices/subscription_payments fiziki DELETE qadağandır', async () => {
    const c = await migratorClient();
    try {
      await expect(c.query(`DELETE FROM platform_billing.subscription_invoices WHERE id=$1`, [subInvoiceId])).rejects.toThrow(
        /fiziki DELETE qadağandır/i,
      );
    } finally {
      await c.end();
    }
  });

  // ================= L: migration regression =================

  test('L: migration zənciri (033) real Postgres-də tətbiq olunub — status yoxlaması', async () => {
    const c = await migratorClient();
    try {
      const r = await c.query(`SELECT name FROM schema_migrations WHERE name='033_platform_billing'`);
      expect(r.rowCount).toBe(1);
    } finally {
      await c.end();
    }
  });
});

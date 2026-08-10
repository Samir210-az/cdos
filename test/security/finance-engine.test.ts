import { Fixtures, seedFixtures, cleanupFixtures, runAsApp, migratorClient, appClient } from './helpers';
import { closeAppPool } from '../../src/common/db/pool';
import { createInvoice, voidInvoice, getInvoiceBalance, InvoiceError } from '../../src/modules/finance/invoice.service';
import { recordPayment, allocatePayment, convertOverpaymentToCredit, useChildCredit, PaymentError } from '../../src/modules/finance/payment.service';
import { createRefund, allocateRefund, getRefundableAmount, RefundError } from '../../src/modules/finance/refund.service';

describe('CDOS Faz 3.9 — Finance Engine Security Tests', () => {
  let fx: Fixtures;
  const admin = () => ({ organizationId: fx.orgA, memberId: fx.centerAdminMember });

  beforeAll(async () => {
    fx = await seedFixtures();
  });

  afterAll(async () => {
    await cleanupFixtures();
    await closeAppPool();
  });

  let paymentA: string;
  let invoiceA: string;

  test('FIN-02: Org A invoice → Org A SELECT = ALLOWED', async () => {
    const inv = await createInvoice(admin(), {
      childId: fx.childA1,
      items: [{ description: 'Psixoloq seansı', quantity: 2, unitPrice: 50 }],
    });
    invoiceA = inv.id;
    const rows = await runAsApp(fx.orgA, async (c) => (await c.query('SELECT * FROM invoices WHERE id=$1', [invoiceA])).rows);
    expect(rows.length).toBe(1);
    expect(Number(rows[0].total_amount)).toBe(100);
  });

  test('FIN-01: Org A payment → Org B SELECT = 0 rows', async () => {
    const pay = await recordPayment(admin(), { childId: fx.childA1, amount: 100, method: 'cash' });
    paymentA = pay.id;
    const rows = await runAsApp(fx.orgB, async (c) => (await c.query('SELECT * FROM payments WHERE id=$1', [paymentA])).rows);
    expect(rows.length).toBe(0);
  });

  test('FIN-05: NO_BRANCH user → finance data DENIED (branch-scope app-layer)', async () => {
    const { resolveMemberScope, isBranchInScope } = await import('../../src/scope-cache/scope-resolver');
    const scope = await resolveMemberScope(fx.orgA, fx.memberNoBranch, { bypassCache: true });
    expect(isBranchInScope(scope, fx.branchA1)).toBe(false);
  });

  test('FIN-06: SELECTED_BRANCHES → yalnız həmin branch', async () => {
    const { resolveMemberScope, isBranchInScope } = await import('../../src/scope-cache/scope-resolver');
    const scope = await resolveMemberScope(fx.orgA, fx.memberSelected, { bypassCache: true });
    expect(isBranchInScope(scope, fx.branchA1)).toBe(true);
    expect(isBranchInScope(scope, fx.branchA2)).toBe(false);
  });

  test('FIN-07: ALL_BRANCHES → bütün branch-lər', async () => {
    const { resolveMemberScope, isBranchInScope } = await import('../../src/scope-cache/scope-resolver');
    const scope = await resolveMemberScope(fx.orgA, fx.memberAll, { bypassCache: true });
    expect(isBranchInScope(scope, fx.branchA1)).toBe(true);
    expect(isBranchInScope(scope, fx.branchA2)).toBe(true);
  });

  test('FIN-03: payment allocation → Org B invoice = DB constraint rejection', async () => {
    const cMig = await migratorClient();
    let orgBInvoiceId: string;
    try {
      orgBInvoiceId = (
        await cMig.query(`INSERT INTO invoices (organization_id, child_id, total_amount) VALUES ($1,$2,50) RETURNING id`, [
          fx.orgB,
          fx.childB1,
        ])
      ).rows[0].id;
    } finally {
      await cMig.end();
    }
    const c = await migratorClient();
    try {
      await expect(
        c.query(
          `INSERT INTO payment_allocations (organization_id, payment_id, invoice_id, allocated_amount) VALUES ($1,$2,$3,50)`,
          [fx.orgA, paymentA, orgBInvoiceId],
        ),
      ).rejects.toThrow(/foreign key/i);
    } finally {
      await c.end();
    }
  });

  test('FIN-04 / FIN-20: Org A payment → Org B allocation cəhdi = DB constraint rejection', async () => {
    const cMig = await migratorClient();
    let orgBPaymentId: string;
    try {
      orgBPaymentId = (
        await cMig.query(`INSERT INTO payments (organization_id, child_id, amount) VALUES ($1,$2,50) RETURNING id`, [
          fx.orgB,
          fx.childB1,
        ])
      ).rows[0].id;
    } finally {
      await cMig.end();
    }
    const c = await migratorClient();
    try {
      await expect(
        c.query(
          `INSERT INTO payment_allocations (organization_id, payment_id, invoice_id, allocated_amount) VALUES ($1,$2,$3,50)`,
          [fx.orgA, orgBPaymentId, invoiceA],
        ),
      ).rejects.toThrow(/foreign key/i);
    } finally {
      await c.end();
    }
  });

  test('FIN-17: Payment split across multiple invoices = ALLOWED', async () => {
    const inv2 = await createInvoice(admin(), { childId: fx.childA1, items: [{ description: 'Loqoped', quantity: 1, unitPrice: 30 }] });
    const splitPay = await recordPayment(admin(), { childId: fx.childA1, amount: 100 });
    await allocatePayment(admin(), [
      { paymentId: splitPay.id, invoiceId: invoiceA, amount: 60 },
      { paymentId: splitPay.id, invoiceId: inv2.id, amount: 40 },
    ]);
    const c = await migratorClient();
    try {
      const r = await c.query(`SELECT SUM(allocated_amount) AS s FROM payment_allocations WHERE payment_id=$1`, [splitPay.id]);
      expect(Number(r.rows[0].s)).toBe(100);
    } finally {
      await c.end();
    }
  });

  test('FIN-08: Payment allocation sum > payment amount = REJECTED', async () => {
    const pay = await recordPayment(admin(), { childId: fx.childA1, amount: 50 });
    await allocatePayment(admin(), [{ paymentId: pay.id, invoiceId: invoiceA, amount: 30 }]);
    await expect(
      allocatePayment(admin(), [{ paymentId: pay.id, invoiceId: invoiceA, amount: 30 }]),
    ).rejects.toThrow(/Over-allocation/i);
  });

  test('Race-condition qorunması: paralel iki allocation (70+50 > 100) yalnız biri keçir', async () => {
    const pay = await recordPayment(admin(), { childId: fx.childA1, amount: 100 });
    const inv1 = await createInvoice(admin(), { childId: fx.childA1, items: [{ description: 'A', quantity: 1, unitPrice: 70 }] });
    const inv2 = await createInvoice(admin(), { childId: fx.childA1, items: [{ description: 'B', quantity: 1, unitPrice: 50 }] });

    const results = await Promise.allSettled([
      allocatePayment(admin(), [{ paymentId: pay.id, invoiceId: inv1.id, amount: 70 }]),
      allocatePayment(admin(), [{ paymentId: pay.id, invoiceId: inv2.id, amount: 50 }]),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length;
    const rejected = results.filter((r) => r.status === 'rejected').length;
    expect(fulfilled).toBe(1);
    expect(rejected).toBe(1);

    const c = await migratorClient();
    try {
      const r = await c.query(`SELECT COALESCE(SUM(allocated_amount),0) AS s FROM payment_allocations WHERE payment_id=$1`, [pay.id]);
      expect(Number(r.rows[0].s)).toBeLessThanOrEqual(100);
    } finally {
      await c.end();
    }
  });

  let refundPayment: string;

  test('FIN-10: Partial refund = ALLOWED', async () => {
    const pay = await recordPayment(admin(), { childId: fx.childA1, amount: 100 });
    refundPayment = pay.id;
    const refund = await createRefund(admin(), { paymentId: refundPayment, amount: 30, reason: 'Ləğv edilmiş seans' });
    expect(refund.id).toBeDefined();
    const remaining = await getRefundableAmount(fx.orgA, refundPayment);
    expect(remaining).toBe(70);
  });

  test('FIN-09: Refund > refundable payment amount = REJECTED', async () => {
    await expect(createRefund(admin(), { paymentId: refundPayment, amount: 71 })).rejects.toThrow(/Refund limiti/i);
  });

  test('İkinci qismən refund (70) = ALLOWED, payment.status=REFUNDED', async () => {
    await createRefund(admin(), { paymentId: refundPayment, amount: 70 });
    const rows = await runAsApp(fx.orgA, async (c) => (await c.query('SELECT status FROM payments WHERE id=$1', [refundPayment])).rows);
    expect(rows[0].status).toBe('REFUNDED');
  });

  test('FIN-15+FIN-16: refund_allocations — qismən (ALLOWED) və limitdən çox (REJECTED)', async () => {
    const pay = await recordPayment(admin(), { childId: fx.childA1, amount: 100 });
    const inv = await createInvoice(admin(), { childId: fx.childA1, items: [{ description: 'X', quantity: 1, unitPrice: 100 }] });
    await allocatePayment(admin(), [{ paymentId: pay.id, invoiceId: inv.id, amount: 100 }]);

    const c = await migratorClient();
    let allocationId: string;
    try {
      allocationId = (await c.query('SELECT id FROM payment_allocations WHERE payment_id=$1', [pay.id])).rows[0].id;
    } finally {
      await c.end();
    }

    const refund = await createRefund(admin(), { paymentId: pay.id, amount: 40 });
    await allocateRefund(admin(), [{ refundId: refund.id, paymentAllocationId: allocationId, reversedAmount: 40 }]);

    await expect(
      allocateRefund(admin(), [{ refundId: refund.id, paymentAllocationId: allocationId, reversedAmount: 65 }]),
    ).rejects.toThrow(/Refund allocation limiti/i);
  });

  test('FIN-11: Overpayment → child credit CORRECT', async () => {
    const pay = await recordPayment(admin(), { childId: fx.childA1, amount: 100 });
    const inv = await createInvoice(admin(), { childId: fx.childA1, items: [{ description: 'Y', quantity: 1, unitPrice: 60 }] });
    await allocatePayment(admin(), [{ paymentId: pay.id, invoiceId: inv.id, amount: 60 }]);

    const credit = await convertOverpaymentToCredit(admin(), pay.id);
    expect(credit).not.toBeNull();
    expect(credit!.amount).toBe(40);
  });

  test('FIN-12: Credit used_amount > amount = REJECTED (DB CHECK)', async () => {
    const pay = await recordPayment(admin(), { childId: fx.childA1, amount: 50 });
    const credit = await convertOverpaymentToCredit(admin(), pay.id);
    expect(credit).not.toBeNull();
    await expect(useChildCredit(admin(), credit!.id, credit!.amount + 1)).rejects.toThrow(/check constraint/i);
  });

  test('FIN-13: Invoice with allocation → VOID = REJECTED', async () => {
    await expect(voidInvoice(admin(), invoiceA)).rejects.toThrow(/VOID edilə bilməz/i);
  });

  test('FIN-14: Invoice without allocation → VOID = ALLOWED', async () => {
    const inv = await createInvoice(admin(), { childId: fx.childA1, items: [{ description: 'Z', quantity: 1, unitPrice: 20 }] });
    await voidInvoice(admin(), inv.id);
    const rows = await runAsApp(fx.orgA, async (c) => (await c.query('SELECT status FROM invoices WHERE id=$1', [inv.id])).rows);
    expect(rows[0].status).toBe('void');
  });

  test('FIN-18: Invoice balance after partial payment = CORRECT DERIVED', async () => {
    const inv = await createInvoice(admin(), { childId: fx.childA1, items: [{ description: 'W', quantity: 1, unitPrice: 100 }] });
    const pay = await recordPayment(admin(), { childId: fx.childA1, amount: 40 });
    await allocatePayment(admin(), [{ paymentId: pay.id, invoiceId: inv.id, amount: 40 }]);
    const balance = await getInvoiceBalance(fx.orgA, inv.id);
    expect(balance.remaining).toBe(60);
  });

  test('FIN-19: Invoice balance after refund = CORRECT DERIVED', async () => {
    const inv = await createInvoice(admin(), { childId: fx.childA1, items: [{ description: 'V', quantity: 1, unitPrice: 100 }] });
    const pay = await recordPayment(admin(), { childId: fx.childA1, amount: 100 });
    await allocatePayment(admin(), [{ paymentId: pay.id, invoiceId: inv.id, amount: 100 }]);

    let balance = await getInvoiceBalance(fx.orgA, inv.id);
    expect(balance.remaining).toBe(0);

    const c = await migratorClient();
    let allocationId: string;
    try {
      allocationId = (await c.query('SELECT id FROM payment_allocations WHERE payment_id=$1 AND invoice_id=$2', [pay.id, inv.id])).rows[0].id;
    } finally {
      await c.end();
    }
    const refund = await createRefund(admin(), { paymentId: pay.id, amount: 25 });
    await allocateRefund(admin(), [{ refundId: refund.id, paymentAllocationId: allocationId, reversedAmount: 25 }]);

    balance = await getInvoiceBalance(fx.orgA, inv.id);
    expect(balance.remaining).toBe(25);
  });

  test('Əlavə: NUMERIC(12,2) — floating-point dəqiqlik problemi yoxdur', async () => {
    const inv = await createInvoice(admin(), {
      childId: fx.childA1,
      items: [{ description: 'Dəqiqlik testi', quantity: 3, unitPrice: 0.1 }],
    });
    const rows = await runAsApp(fx.orgA, async (c) => (await c.query('SELECT total_amount FROM invoices WHERE id=$1', [inv.id])).rows);
    expect(Number(rows[0].total_amount)).toBe(0.3);
  });

  test('Əlavə: FINANCE_ROLES olmayan payment yarada bilmir', async () => {
    const c = await migratorClient();
    try {
      const roleId = (await c.query(`SELECT id FROM roles WHERE code='SPECIALIST'`)).rows[0].id;
      await c.query(
        `INSERT INTO member_roles (organization_id, member_id, role_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [fx.orgA, fx.supervisorMember, roleId],
      );
    } finally {
      await c.end();
    }
    await expect(
      recordPayment({ organizationId: fx.orgA, memberId: fx.supervisorMember }, { childId: fx.childA1, amount: 10 }),
    ).rejects.toThrow(PaymentError);
  });

  test('Əlavə: cdos_app RLS bypass edə bilmir (finance cədvəllərində)', async () => {
    const rows = await runAsApp(null, async (c) => (await c.query('SELECT * FROM payments')).rows);
    expect(rows.length).toBe(0);
  });

  test('Əlavə: connection-pool tenant context sızması (invoices)', async () => {
    const client = await appClient();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.current_org', $1, true)", [fx.orgA]);
      const a = await client.query('SELECT * FROM invoices WHERE id=$1', [invoiceA]);
      expect(a.rows.length).toBe(1);
      await client.query('COMMIT');

      await client.query('BEGIN');
      const b = await client.query('SELECT * FROM invoices WHERE id=$1', [invoiceA]);
      expect(b.rows.length).toBe(0);
      await client.query('COMMIT');
    } finally {
      await client.end();
    }
  });

  test('Əlavə: payment_allocations append-only-dur (UPDATE rədd olunur)', async () => {
    const c = await migratorClient();
    try {
      const r = await c.query('SELECT id FROM payment_allocations LIMIT 1');
      const id = r.rows[0].id;
      await expect(c.query(`UPDATE payment_allocations SET allocated_amount=999 WHERE id=$1`, [id])).rejects.toThrow(
        /UPDATE qadağandır/i,
      );
    } finally {
      await c.end();
    }
  });

  test('Əlavə: payments ledger immutability — amount dəyişdirilə bilmir', async () => {
    const c = await migratorClient();
    try {
      await expect(c.query(`UPDATE payments SET amount=9999 WHERE id=$1`, [paymentA])).rejects.toThrow(
        /ledger immutability/i,
      );
    } finally {
      await c.end();
    }
  });

  test('Əlavə: InvoiceError/RefundError doğru exception tipləridir', () => {
    expect(new InvoiceError('X', 'y')).toBeInstanceOf(Error);
    expect(new RefundError('X', 'y')).toBeInstanceOf(Error);
  });
});

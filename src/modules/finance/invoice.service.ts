import { withTenantTransaction } from '../../common/db/tenant-context';
import { resolveMemberScope } from '../../scope-cache/scope-resolver';

export class InvoiceError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

const FINANCE_ROLES = ['CENTER_OWNER', 'CENTER_ADMIN', 'ACCOUNTANT'];

interface ActorContext {
  organizationId: string;
  memberId: string;
}

async function assertFinanceRole(roleCodes: string[]): Promise<void> {
  if (!roleCodes.some((r) => FINANCE_ROLES.includes(r))) {
    throw new InvoiceError('ACCESS_DENIED', 'Maliyyə əməliyyatı üçün icazəniz yoxdur.');
  }
}

export async function createInvoice(
  actor: ActorContext,
  input: {
    childId: string;
    items: Array<{ serviceId?: string; packageId?: string; description?: string; quantity: number; unitPrice: number }>;
  },
): Promise<{ id: string }> {
  const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
  await assertFinanceRole(scope.roleCodes);

  return withTenantTransaction(actor.organizationId, async (client) => {
    const totalAmount = input.items.reduce((sum, i) => sum + i.quantity * i.unitPrice, 0);
    const invRes = await client.query(
      `INSERT INTO invoices (organization_id, child_id, total_amount) VALUES ($1,$2,$3) RETURNING id`,
      [actor.organizationId, input.childId, totalAmount],
    );
    const invoiceId = invRes.rows[0].id;

    for (const item of input.items) {
      const amount = item.quantity * item.unitPrice;
      await client.query(
        `INSERT INTO invoice_items (organization_id, invoice_id, service_id, package_id, description, quantity, unit_price, amount)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          actor.organizationId,
          invoiceId,
          item.serviceId ?? null,
          item.packageId ?? null,
          item.description ?? null,
          item.quantity,
          item.unitPrice,
          amount,
        ],
      );
    }
    return { id: invoiceId };
  });
}

export async function issueInvoice(actor: ActorContext, invoiceId: string): Promise<void> {
  const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
  await assertFinanceRole(scope.roleCodes);

  await withTenantTransaction(actor.organizationId, async (client) => {
    const res = await client.query(
      `UPDATE invoices SET status='issued', issued_at=now(), updated_at=now()
       WHERE id=$1 AND organization_id=$2 AND status='draft' RETURNING id`,
      [invoiceId, actor.organizationId],
    );
    if (res.rowCount === 0) throw new InvoiceError('CONFLICT', 'Yalnız draft invoice issue edilə bilər.');
  });
}

/**
 * VOID — Faz 3.9 bənd 15: yalnız heç bir payment_allocation bağlı deyilsə.
 * DB trigger (guard_invoice_void) əsas müdafiədir, bura app-layer üçün aydın xəta mesajı verir.
 */
export async function voidInvoice(actor: ActorContext, invoiceId: string): Promise<void> {
  const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
  await assertFinanceRole(scope.roleCodes);

  await withTenantTransaction(actor.organizationId, async (client) => {
    const allocRes = await client.query(
      `SELECT COUNT(*) FROM payment_allocations WHERE organization_id=$1 AND invoice_id=$2`,
      [actor.organizationId, invoiceId],
    );
    if (Number(allocRes.rows[0].count) > 0) {
      throw new InvoiceError('CONFLICT', 'Invoice VOID edilə bilməz: payment_allocation bağlıdır.');
    }
    const res = await client.query(
      `UPDATE invoices SET status='void', updated_at=now() WHERE id=$1 AND organization_id=$2 RETURNING id`,
      [invoiceId, actor.organizationId],
    );
    if (res.rowCount === 0) throw new InvoiceError('NOT_FOUND', 'Invoice tapılmadı.');
  });
}

/**
 * DERIVED balans — Faz 3.9 bənd 11: heç bir yerdə "remaining_amount" sütunu
 * kimi saxlanmır, hər dəfə HESABLANIR:
 *   remaining = total_amount - SUM(payment_allocations) + SUM(həmin invoice-a
 *               aid allocation-ları geri çevirən refund_allocations)
 */
export async function getInvoiceBalance(
  organizationId: string,
  invoiceId: string,
): Promise<{ totalAmount: number; allocated: number; refunded: number; remaining: number }> {
  return withTenantTransaction(organizationId, async (client) => {
    const invRes = await client.query(`SELECT total_amount FROM invoices WHERE id=$1 AND organization_id=$2`, [
      invoiceId,
      organizationId,
    ]);
    if (invRes.rowCount === 0) throw new InvoiceError('NOT_FOUND', 'Invoice tapılmadı.');
    const totalAmount = Number(invRes.rows[0].total_amount);

    const allocRes = await client.query(
      `SELECT COALESCE(SUM(allocated_amount),0) AS s FROM payment_allocations WHERE organization_id=$1 AND invoice_id=$2`,
      [organizationId, invoiceId],
    );
    const allocated = Number(allocRes.rows[0].s);

    const refundRes = await client.query(
      `SELECT COALESCE(SUM(ra.reversed_amount),0) AS s
       FROM refund_allocations ra
       JOIN payment_allocations pa ON pa.id = ra.payment_allocation_id AND pa.organization_id = ra.organization_id
       WHERE ra.organization_id=$1 AND pa.invoice_id=$2`,
      [organizationId, invoiceId],
    );
    const refunded = Number(refundRes.rows[0].s);

    const remaining = totalAmount - allocated + refunded;
    return { totalAmount, allocated, refunded, remaining };
  });
}

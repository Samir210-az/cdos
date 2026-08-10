import { withTenantTransaction } from '../../common/db/tenant-context';
import { resolveMemberScope } from '../../scope-cache/scope-resolver';

export class PaymentError extends Error {
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
    throw new PaymentError('ACCESS_DENIED', 'Maliyyə əməliyyatı üçün icazəniz yoxdur.');
  }
}

export async function recordPayment(
  actor: ActorContext,
  input: { childId: string; amount: number; method?: string },
): Promise<{ id: string }> {
  const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
  await assertFinanceRole(scope.roleCodes);
  if (input.amount <= 0) throw new PaymentError('INVALID', 'amount > 0 olmalidir.');

  return withTenantTransaction(actor.organizationId, async (client) => {
    const res = await client.query(
      'INSERT INTO payments (organization_id, child_id, amount, method) VALUES ($1,$2,$3,$4) RETURNING id',
      [actor.organizationId, input.childId, input.amount, input.method ?? null],
    );
    return { id: res.rows[0].id };
  });
}

export async function allocatePayment(
  actor: ActorContext,
  input: Array<{ paymentId: string; invoiceId: string; invoiceItemId?: string; amount: number }>,
): Promise<void> {
  const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
  await assertFinanceRole(scope.roleCodes);

  await withTenantTransaction(actor.organizationId, async (client) => {
    for (const alloc of input) {
      if (alloc.amount <= 0) throw new PaymentError('INVALID', 'allocated_amount > 0 olmalidir.');
      await client.query(
        'INSERT INTO payment_allocations (organization_id, payment_id, invoice_id, invoice_item_id, allocated_amount) VALUES ($1,$2,$3,$4,$5)',
        [actor.organizationId, alloc.paymentId, alloc.invoiceId, alloc.invoiceItemId ?? null, alloc.amount],
      );
    }
  });
}

export async function convertOverpaymentToCredit(
  actor: ActorContext,
  paymentId: string,
): Promise<{ id: string; amount: number } | null> {
  const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
  await assertFinanceRole(scope.roleCodes);

  return withTenantTransaction(actor.organizationId, async (client) => {
    const payRes = await client.query('SELECT amount, child_id FROM payments WHERE id=$1 AND organization_id=$2', [
      paymentId,
      actor.organizationId,
    ]);
    if (payRes.rowCount === 0) throw new PaymentError('NOT_FOUND', 'Payment tapilmadi.');
    const payment = payRes.rows[0];

    const allocRes = await client.query(
      'SELECT COALESCE(SUM(allocated_amount),0) AS s FROM payment_allocations WHERE organization_id=$1 AND payment_id=$2',
      [actor.organizationId, paymentId],
    );
    const allocated = Number(allocRes.rows[0].s);
    const unallocated = Number(payment.amount) - allocated;

    if (unallocated <= 0) return null;

    const res = await client.query(
      'INSERT INTO child_credits (organization_id, child_id, source_payment_id, amount) VALUES ($1,$2,$3,$4) RETURNING id',
      [actor.organizationId, payment.child_id, paymentId, unallocated],
    );
    return { id: res.rows[0].id, amount: unallocated };
  });
}

export async function useChildCredit(actor: ActorContext, creditId: string, amount: number): Promise<void> {
  const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
  await assertFinanceRole(scope.roleCodes);
  if (amount <= 0) throw new PaymentError('INVALID', 'amount > 0 olmalidir.');

  await withTenantTransaction(actor.organizationId, async (client) => {
    const res = await client.query(
      'UPDATE child_credits SET used_amount = used_amount + $1, updated_at = now() WHERE id=$2 AND organization_id=$3 RETURNING id',
      [amount, creditId, actor.organizationId],
    );
    if (res.rowCount === 0) throw new PaymentError('NOT_FOUND', 'Credit tapilmadi (ve ya CHECK constraint pozuntusu).');
  });
}

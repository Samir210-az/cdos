import { withTenantTransaction } from '../../common/db/tenant-context';
import { resolveMemberScope } from '../../scope-cache/scope-resolver';

export class RefundError extends Error {
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
    throw new RefundError('ACCESS_DENIED', 'Maliyye emeliyyati ucun icazeniz yoxdur.');
  }
}

export async function createRefund(
  actor: ActorContext,
  input: { paymentId: string; amount: number; reason?: string },
): Promise<{ id: string }> {
  const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
  await assertFinanceRole(scope.roleCodes);
  if (input.amount <= 0) throw new RefundError('INVALID', 'amount > 0 olmalidir.');

  return withTenantTransaction(actor.organizationId, async (client) => {
    const res = await client.query(
      'INSERT INTO refunds (organization_id, payment_id, amount, reason) VALUES ($1,$2,$3,$4) RETURNING id',
      [actor.organizationId, input.paymentId, input.amount, input.reason ?? null],
    );
    return { id: res.rows[0].id };
  });
}

export async function allocateRefund(
  actor: ActorContext,
  input: Array<{ refundId: string; paymentAllocationId: string; reversedAmount: number }>,
): Promise<void> {
  const scope = await resolveMemberScope(actor.organizationId, actor.memberId);
  await assertFinanceRole(scope.roleCodes);

  await withTenantTransaction(actor.organizationId, async (client) => {
    for (const r of input) {
      if (r.reversedAmount <= 0) throw new RefundError('INVALID', 'reversed_amount > 0 olmalidir.');
      await client.query(
        'INSERT INTO refund_allocations (organization_id, refund_id, payment_allocation_id, reversed_amount) VALUES ($1,$2,$3,$4)',
        [actor.organizationId, r.refundId, r.paymentAllocationId, r.reversedAmount],
      );
    }
  });
}

export async function getRefundableAmount(organizationId: string, paymentId: string): Promise<number> {
  return withTenantTransaction(organizationId, async (client) => {
    const payRes = await client.query('SELECT amount FROM payments WHERE id=$1 AND organization_id=$2', [
      paymentId,
      organizationId,
    ]);
    if (payRes.rowCount === 0) throw new RefundError('NOT_FOUND', 'Payment tapilmadi.');
    const refundedRes = await client.query(
      'SELECT COALESCE(SUM(amount),0) AS s FROM refunds WHERE organization_id=$1 AND payment_id=$2',
      [organizationId, paymentId],
    );
    return Number(payRes.rows[0].amount) - Number(refundedRes.rows[0].s);
  });
}

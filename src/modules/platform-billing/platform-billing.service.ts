import { Pool } from 'pg';
import { getAppPool } from '../../common/db/pool';
import { resolveMemberScope } from '../../scope-cache/scope-resolver';

export class PlatformBillingError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

interface PlatformActor {
  organizationId: string; // rol yoxlaması üçün (PLATFORM_ADMIN membership-i hansı org-dadırsa)
  memberId: string;
}

/**
 * QEYD (Faz 3.10 bənd 9, KRİTİK): platform_billing schema-sı tenant RLS-ə
 * TABE DEYİL (Faz 3.1 FINAL qərarı) — DB səviyyəsində əlavə izolyasiya
 * YOXDUR. İzolyasiya BURADA, application-layer-də təmin olunur: hər çağırış
 * əvvəlcə PLATFORM_ADMIN rolunu yoxlayır. Bu, layihədəki yeganə "DB-səviyyəli
 * RLS-siz, tam app-layer-asılı" domendir — açıq şəkildə sənədləşdirilir.
 *
 * QEYD 2: platform_billing sorğuları withTenantTransaction() İSTİFADƏ ETMİR
 * (o, "app.current_org" tək-tenant kontekstini tələb edir — platform billing
 * çox-tenant görünürlüyə malikdir). Əvəzinə birbaşa pool istifadə olunur.
 */
async function assertPlatformAdmin(organizationId: string, memberId: string): Promise<void> {
  const scope = await resolveMemberScope(organizationId, memberId);
  if (!scope.roleCodes.includes('PLATFORM_ADMIN')) {
    throw new PlatformBillingError('ACCESS_DENIED', 'Platform billing yalnız PLATFORM_ADMIN üçün əlçatandır.');
  }
}

function pool(): Pool {
  return getAppPool();
}

export async function createSubscriptionPlan(
  actor: PlatformActor,
  input: { code: string; name: string; price?: number },
): Promise<{ id: string }> {
  await assertPlatformAdmin(actor.organizationId, actor.memberId);
  const res = await pool().query(
    `INSERT INTO platform_billing.subscription_plans (code, name, price) VALUES ($1,$2,$3) RETURNING id`,
    [input.code, input.name, input.price ?? null],
  );
  return { id: res.rows[0].id };
}

export async function createOrganizationSubscription(
  actor: PlatformActor,
  input: { organizationId: string; planId: string; seatsLimit?: number; expiresAt?: string },
): Promise<{ id: string }> {
  await assertPlatformAdmin(actor.organizationId, actor.memberId);
  const res = await pool().query(
    `INSERT INTO platform_billing.organization_subscriptions (organization_id, plan_id, seats_limit, expires_at)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [input.organizationId, input.planId, input.seatsLimit ?? null, input.expiresAt ?? null],
  );
  return { id: res.rows[0].id };
}

export async function createSubscriptionInvoice(
  actor: PlatformActor,
  input: { organizationId: string; organizationSubscriptionId: string; amount: number; dueDate?: string },
): Promise<{ id: string }> {
  await assertPlatformAdmin(actor.organizationId, actor.memberId);
  const res = await pool().query(
    `INSERT INTO platform_billing.subscription_invoices (organization_id, organization_subscription_id, amount, due_date)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [input.organizationId, input.organizationSubscriptionId, input.amount, input.dueDate ?? null],
  );
  return { id: res.rows[0].id };
}

export async function recordSubscriptionPayment(
  actor: PlatformActor,
  input: { organizationId: string; subscriptionInvoiceId?: string; amount: number; method?: string },
): Promise<{ id: string }> {
  await assertPlatformAdmin(actor.organizationId, actor.memberId);
  const res = await pool().query(
    `INSERT INTO platform_billing.subscription_payments (organization_id, subscription_invoice_id, amount, method)
     VALUES ($1,$2,$3,$4) RETURNING id`,
    [input.organizationId, input.subscriptionInvoiceId ?? null, input.amount, input.method ?? null],
  );
  return { id: res.rows[0].id };
}

export async function listOrganizationSubscriptions(actor: PlatformActor, organizationId?: string): Promise<any[]> {
  await assertPlatformAdmin(actor.organizationId, actor.memberId);
  if (organizationId) {
    const res = await pool().query(
      `SELECT * FROM platform_billing.organization_subscriptions WHERE organization_id=$1`,
      [organizationId],
    );
    return res.rows;
  }
  const res = await pool().query(`SELECT * FROM platform_billing.organization_subscriptions`);
  return res.rows;
}

import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/http/jwt-auth.guard';
import { CurrentActor, ActorContext } from '../../../common/http/current-actor.decorator';
import { requireBody, requireString, requireUUID, requireNumber } from '../../../common/http/validation';
import * as platformBillingService from '../platform-billing.service';

/** Faz 3.15 bənd III: PlatformBilling — yalnız mövcud PLATFORM_ADMIN authorization qaydası (servisin özündə). */
@ApiTags('Platform Billing')
@Controller('platform-billing')
@UseGuards(JwtAuthGuard)
export class PlatformBillingController {
  @Post('subscription-plans')
  async createPlan(@CurrentActor() actor: ActorContext, @Body() body: unknown) {
    const b = requireBody(body);
    return platformBillingService.createSubscriptionPlan(actor, {
      code: requireString(b.code, 'code'),
      name: requireString(b.name, 'name'),
      price: b.price as number | undefined,
    });
  }

  @Post('organization-subscriptions')
  async createOrgSubscription(@CurrentActor() actor: ActorContext, @Body() body: unknown) {
    const b = requireBody(body);
    return platformBillingService.createOrganizationSubscription(actor, {
      organizationId: requireUUID(b.organizationId, 'organizationId'),
      planId: requireUUID(b.planId, 'planId'),
      seatsLimit: b.seatsLimit as number | undefined,
      expiresAt: b.expiresAt as string | undefined,
    });
  }

  @Post('subscription-invoices')
  async createSubscriptionInvoice(@CurrentActor() actor: ActorContext, @Body() body: unknown) {
    const b = requireBody(body);
    return platformBillingService.createSubscriptionInvoice(actor, {
      organizationId: requireUUID(b.organizationId, 'organizationId'),
      organizationSubscriptionId: requireUUID(b.organizationSubscriptionId, 'organizationSubscriptionId'),
      amount: requireNumber(b.amount, 'amount', { min: 0 }),
      dueDate: b.dueDate as string | undefined,
    });
  }

  @Post('subscription-payments')
  async recordSubscriptionPayment(@CurrentActor() actor: ActorContext, @Body() body: unknown) {
    const b = requireBody(body);
    return platformBillingService.recordSubscriptionPayment(actor, {
      organizationId: requireUUID(b.organizationId, 'organizationId'),
      subscriptionInvoiceId: b.subscriptionInvoiceId as string | undefined,
      amount: requireNumber(b.amount, 'amount', { min: 0.01 }),
      method: b.method as string | undefined,
    });
  }

  @Get('organization-subscriptions')
  async list(@CurrentActor() actor: ActorContext, @Query('organizationId') organizationId?: string) {
    return platformBillingService.listOrganizationSubscriptions(actor, organizationId);
  }
}

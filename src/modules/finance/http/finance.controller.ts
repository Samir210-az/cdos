import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/http/jwt-auth.guard';
import { CurrentActor, ActorContext } from '../../../common/http/current-actor.decorator';
import { requireBody, requireArray, requireUUID, requireNumber } from '../../../common/http/validation';
import * as invoiceService from '../invoice.service';
import * as paymentService from '../payment.service';
import * as refundService from '../refund.service';

@ApiTags('Finance')
@Controller('finance')
@UseGuards(JwtAuthGuard)
export class FinanceController {
  @Post('invoices')
  async createInvoice(@CurrentActor() actor: ActorContext, @Body() body: unknown) {
    const b = requireBody(body);
    const items = requireArray(b.items, 'items') as Array<{ serviceId?: string; packageId?: string; description?: string; quantity: number; unitPrice: number }>;
    return invoiceService.createInvoice(actor, { childId: requireUUID(b.childId, 'childId'), items });
  }

  @Post('invoices/:id/issue')
  async issue(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    await invoiceService.issueInvoice(actor, id);
    return { success: true };
  }

  @Post('invoices/:id/void')
  async void_(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    await invoiceService.voidInvoice(actor, id);
    return { success: true };
  }

  @Get('invoices/:id/balance')
  async balance(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    return invoiceService.getInvoiceBalance(actor.organizationId, id);
  }

  @Post('payments')
  async recordPayment(@CurrentActor() actor: ActorContext, @Body() body: unknown) {
    const b = requireBody(body);
    return paymentService.recordPayment(actor, {
      childId: requireUUID(b.childId, 'childId'),
      amount: requireNumber(b.amount, 'amount', { min: 0.01 }),
      method: b.method as string | undefined,
    });
  }

  @Post('payments/allocations')
  async allocate(@CurrentActor() actor: ActorContext, @Body() body: unknown) {
    const b = requireBody(body);
    const allocations = requireArray(b.allocations, 'allocations') as Array<{
      paymentId: string; invoiceId: string; invoiceItemId?: string; amount: number;
    }>;
    await paymentService.allocatePayment(actor, allocations);
    return { success: true };
  }

  @Post('payments/:id/convert-overpayment-to-credit')
  async convertToCredit(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    return paymentService.convertOverpaymentToCredit(actor, id);
  }

  @Post('credits/:id/use')
  async useCredit(@CurrentActor() actor: ActorContext, @Param('id') id: string, @Body() body: unknown) {
    requireUUID(id, 'id');
    const b = requireBody(body);
    await paymentService.useChildCredit(actor, id, requireNumber(b.amount, 'amount', { min: 0.01 }));
    return { success: true };
  }

  @Post('refunds')
  async createRefund(@CurrentActor() actor: ActorContext, @Body() body: unknown) {
    const b = requireBody(body);
    return refundService.createRefund(actor, {
      paymentId: requireUUID(b.paymentId, 'paymentId'),
      amount: requireNumber(b.amount, 'amount', { min: 0.01 }),
      reason: b.reason as string | undefined,
    });
  }

  @Post('refunds/allocations')
  async allocateRefund(@CurrentActor() actor: ActorContext, @Body() body: unknown) {
    const b = requireBody(body);
    const allocations = requireArray(b.allocations, 'allocations') as Array<{
      refundId: string; paymentAllocationId: string; reversedAmount: number;
    }>;
    await refundService.allocateRefund(actor, allocations);
    return { success: true };
  }

  @Get('payments/:id/refundable')
  async refundable(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    const amount = await refundService.getRefundableAmount(actor.organizationId, id);
    return { amount };
  }
}

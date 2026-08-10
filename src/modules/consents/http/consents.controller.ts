import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, ForbiddenException, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/http/jwt-auth.guard';
import { CurrentActor, ActorContext } from '../../../common/http/current-actor.decorator';
import { requireBody, requireArray, requireUUID } from '../../../common/http/validation';
import { withTenantTransaction } from '../../../common/db/tenant-context';
import * as consentService from '../consent.service';
import * as dataShareService from '../data-share.service';

/** actor.userId → parents.id (yalnız PARENT rolu ilə çağırılan endpoint-lər üçün). */
async function resolveParentId(organizationId: string, userId: string): Promise<string> {
  return withTenantTransaction(organizationId, async (client) => {
    const res = await client.query(`SELECT id FROM parents WHERE organization_id=$1 AND user_id=$2`, [
      organizationId,
      userId,
    ]);
    if (res.rowCount === 0) {
      throw new ForbiddenException('Bu istifadəçi parent kimi qeydə alınmayıb.');
    }
    return res.rows[0].id;
  });
}

@ApiTags('Consents & Data Shares')
@Controller('consents')
@UseGuards(JwtAuthGuard)
export class ConsentsController {
  @Post()
  async create(@CurrentActor() actor: ActorContext, @Body() body: unknown) {
    const b = requireBody(body);
    const dataScope = requireArray(b.dataScope, 'dataScope') as string[];
    return consentService.createConsentRequest(actor.organizationId, {
      childId: requireUUID(b.childId, 'childId'),
      grantedByParentId: requireUUID(b.grantedByParentId, 'grantedByParentId'),
      toOrganizationId: requireUUID(b.toOrganizationId, 'toOrganizationId'),
      dataScope,
      purpose: b.purpose as string | undefined,
      startDate: b.startDate as string | undefined,
      endDate: b.endDate as string | undefined,
    });
  }

  @Post(':id/approve')
  async approve(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    const parentId = await resolveParentId(actor.organizationId, actor.userId);
    await consentService.approveConsent({ organizationId: actor.organizationId, parentId }, id);
    return { success: true };
  }

  @Post(':id/decline')
  async decline(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    const parentId = await resolveParentId(actor.organizationId, actor.userId);
    await consentService.declineConsent({ organizationId: actor.organizationId, parentId }, id);
    return { success: true };
  }

  @Post(':id/revoke')
  async revoke(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    const parentId = await resolveParentId(actor.organizationId, actor.userId);
    await consentService.revokeConsent({ organizationId: actor.organizationId, parentId }, id);
    return { success: true };
  }

  @Post(':id/shares')
  async share(@CurrentActor() actor: ActorContext, @Param('id') id: string, @Body() body: unknown) {
    requireUUID(id, 'id');
    const b = requireBody(body);
    return dataShareService.shareEntity(actor.organizationId, {
      consentId: id,
      entityType: b.entityType as any,
      entityId: requireUUID(b.entityId, 'entityId'),
    });
  }
}

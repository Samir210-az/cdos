import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/http/jwt-auth.guard';
import { CurrentActor, ActorContext } from '../../../common/http/current-actor.decorator';
import { requireBody, requireString, requireUUID, optionalString } from '../../../common/http/validation';
import * as ecService from '../emergency-contact.service';

@ApiTags('Emergency Contacts')
@Controller()
@UseGuards(JwtAuthGuard)
export class EmergencyContactsController {
  @Post('emergency-contacts')
  async create(@CurrentActor() actor: ActorContext, @Body() body: unknown) {
    const b = requireBody(body);
    return ecService.createEmergencyContact(actor, {
      childId: requireUUID(b.childId, 'childId'),
      name: requireString(b.name, 'name'),
      relation: optionalString(b.relation, 'relation'),
      phone: requireString(b.phone, 'phone'),
      priority: b.priority as number | undefined,
    });
  }

  @Patch('emergency-contacts/:id')
  async update(@CurrentActor() actor: ActorContext, @Param('id') id: string, @Body() body: unknown) {
    requireUUID(id, 'id');
    const b = requireBody(body);
    await ecService.updateEmergencyContact(actor, id, {
      name: optionalString(b.name, 'name'),
      relation: optionalString(b.relation, 'relation'),
      phone: optionalString(b.phone, 'phone'),
      priority: b.priority as number | undefined,
    });
    return { success: true };
  }

  @Delete('emergency-contacts/:id')
  async remove(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    await ecService.deleteEmergencyContact(actor, id);
    return { success: true };
  }

  @Get('children/:childId/emergency-contacts')
  async list(@CurrentActor() actor: ActorContext, @Param('childId') childId: string) {
    requireUUID(childId, 'childId');
    return ecService.listEmergencyContacts(actor, childId);
  }
}

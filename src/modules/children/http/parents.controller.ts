import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/http/jwt-auth.guard';
import { CurrentActor, ActorContext } from '../../../common/http/current-actor.decorator';
import { requireBody, requireUUID, requireEnum, optionalString } from '../../../common/http/validation';
import * as parentService from '../parent.service';

@ApiTags('Parents')
@Controller('parents')
@UseGuards(JwtAuthGuard)
export class ParentsController {
  @Post()
  async create(@CurrentActor() actor: ActorContext, @Body() body: unknown) {
    const b = requireBody(body);
    return parentService.createParent(actor, {
      userId: requireUUID(b.userId, 'userId'),
      phone: optionalString(b.phone, 'phone'),
      address: optionalString(b.address, 'address'),
    });
  }

  @Get(':id')
  async get(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    return parentService.getParent(actor, id);
  }

  @Patch(':id')
  async update(@CurrentActor() actor: ActorContext, @Param('id') id: string, @Body() body: unknown) {
    requireUUID(id, 'id');
    const b = requireBody(body);
    await parentService.updateParent(actor, id, {
      phone: optionalString(b.phone, 'phone'),
      address: optionalString(b.address, 'address'),
      status: b.status !== undefined ? requireEnum(b.status, 'status', ['ACTIVE', 'SUSPENDED', 'DEACTIVATED'] as const) : undefined,
    });
    return { success: true };
  }

  @Get()
  async list(@CurrentActor() actor: ActorContext) {
    return parentService.listParents(actor);
  }
}

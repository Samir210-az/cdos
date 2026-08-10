import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/http/jwt-auth.guard';
import { CurrentActor, ActorContext } from '../../../common/http/current-actor.decorator';
import { requireBody, requireString, requireUUID, requireEnum, optionalString, optionalUUID } from '../../../common/http/validation';
import * as childService from '../child.service';

@ApiTags('Children')
@Controller('children')
@UseGuards(JwtAuthGuard)
export class ChildrenController {
  @Post()
  async create(@CurrentActor() actor: ActorContext, @Body() body: unknown) {
    const b = requireBody(body);
    return childService.createChild(actor, {
      branchId: optionalUUID(b.branchId, 'branchId'),
      localCode: requireString(b.localCode, 'localCode'),
      firstName: requireString(b.firstName, 'firstName'),
      lastName: requireString(b.lastName, 'lastName'),
      dob: requireString(b.dob, 'dob'),
      gender: optionalString(b.gender, 'gender'),
    });
  }

  @Get(':id')
  async get(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    return childService.getChild(actor, id);
  }

  @Patch(':id')
  async update(@CurrentActor() actor: ActorContext, @Param('id') id: string, @Body() body: unknown) {
    requireUUID(id, 'id');
    const b = requireBody(body);
    await childService.updateChild(actor, id, {
      branchId: optionalUUID(b.branchId, 'branchId'),
      localCode: optionalString(b.localCode, 'localCode'),
      firstName: optionalString(b.firstName, 'firstName'),
      lastName: optionalString(b.lastName, 'lastName'),
      dob: optionalString(b.dob, 'dob'),
      gender: optionalString(b.gender, 'gender'),
      status: b.status !== undefined ? requireEnum(b.status, 'status', ['ACTIVE', 'ARCHIVED'] as const) : undefined,
    });
    return { success: true };
  }

  @Get()
  async list(@CurrentActor() actor: ActorContext, @Query('branchId') branchId?: string, @Query('status') status?: string) {
    return childService.listChildren(actor, {
      branchId: branchId ? requireUUID(branchId, 'branchId') : undefined,
      status: status ? requireEnum(status, 'status', ['ACTIVE', 'ARCHIVED'] as const) : undefined,
    });
  }
}

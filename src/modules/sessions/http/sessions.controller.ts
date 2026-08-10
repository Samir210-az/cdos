import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/http/jwt-auth.guard';
import { CurrentActor, ActorContext } from '../../../common/http/current-actor.decorator';
import { requireBody, requireString, requireUUID, requireArray } from '../../../common/http/validation';
import * as sessionService from '../session.service';

@ApiTags('Sessions')
@Controller('sessions')
@UseGuards(JwtAuthGuard)
export class SessionsController {
  @Post()
  async create(@CurrentActor() actor: ActorContext, @Body() body: unknown) {
    const b = requireBody(body);
    const goalIds = b.goalIds !== undefined ? (requireArray(b.goalIds, 'goalIds') as string[]) : undefined;
    return sessionService.createSession(actor, {
      childId: requireUUID(b.childId, 'childId'),
      specialistId: requireUUID(b.specialistId, 'specialistId'),
      goalIds,
    });
  }

  @Post(':id/start')
  async start(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    await sessionService.startSession(actor, id);
    return { success: true };
  }

  @Post(':id/complete')
  async complete(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    await sessionService.completeSession(actor, id);
    return { success: true };
  }

  @Post(':id/lock')
  async lock(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    await sessionService.lockSession(actor, id);
    return { success: true };
  }

  @Post(':id/amend')
  async amend(@CurrentActor() actor: ActorContext, @Param('id') id: string, @Body() body: unknown) {
    requireUUID(id, 'id');
    const b = requireBody(body);
    return sessionService.amendSession(actor, {
      sessionId: id,
      newData: requireBody(b.newData),
      reason: requireString(b.reason, 'reason'),
    });
  }

  @Get(':id')
  async get(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    return sessionService.getSession(actor, id);
  }

  @Get(':id/amendments')
  async amendments(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    return sessionService.getSessionAmendments(actor, id);
  }

  @Get('children/:childId')
  async byChild(@CurrentActor() actor: ActorContext, @Param('childId') childId: string) {
    requireUUID(childId, 'childId');
    return sessionService.getChildSessions(actor, childId);
  }
}

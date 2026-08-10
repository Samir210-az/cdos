import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/http/jwt-auth.guard';
import { CurrentActor, ActorContext } from '../../../common/http/current-actor.decorator';
import { requireBody, requireUUID } from '../../../common/http/validation';
import * as assignmentService from '../assignment.service';

@ApiTags('Assignments')
@Controller('assignments')
@UseGuards(JwtAuthGuard)
export class AssignmentsController {
  @Post()
  async create(@CurrentActor() actor: ActorContext, @Body() body: unknown) {
    const b = requireBody(body);
    const specialistId = requireUUID(b.specialistId, 'specialistId');
    const childId = requireUUID(b.childId, 'childId');
    return assignmentService.createAssignment(actor, { specialistId, childId });
  }

  @Delete(':id')
  async end(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    await assignmentService.endAssignment(actor, id);
    return { success: true };
  }

  @Get('specialists/:specialistId/children')
  async listAssignedChildren(@CurrentActor() actor: ActorContext, @Param('specialistId') specialistId: string) {
    requireUUID(specialistId, 'specialistId');
    const children = await assignmentService.listActiveAssignedChildren(actor.organizationId, specialistId);
    return { children };
  }
}

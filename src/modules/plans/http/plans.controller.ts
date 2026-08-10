import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/http/jwt-auth.guard';
import { CurrentActor, ActorContext } from '../../../common/http/current-actor.decorator';
import { requireBody, requireString, requireUUID, requireEnum } from '../../../common/http/validation';
import * as planService from '../plan.service';
import * as goalService from '../goal.service';

@ApiTags('Plans & Goals')
@Controller()
@UseGuards(JwtAuthGuard)
export class PlansController {
  @Post('plans')
  async createDraft(@CurrentActor() actor: ActorContext, @Body() body: unknown) {
    const b = requireBody(body);
    return planService.createDraft(actor, {
      childId: requireUUID(b.childId, 'childId'),
      assessorSpecialistId: b.assessorSpecialistId as string | undefined,
      sourceAssessmentInstanceId: b.sourceAssessmentInstanceId as string | undefined,
    });
  }

  @Post('plans/:id/review')
  async review(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    await planService.reviewPlan(actor, id);
    return { success: true };
  }

  @Post('plans/:id/activate')
  async activate(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    await planService.activatePlan(actor, id);
    return { success: true };
  }

  @Post('plans/:id/pause')
  async pause(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    await planService.pausePlan(actor, id);
    return { success: true };
  }

  @Post('plans/:id/resume')
  async resume(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    await planService.resumePlan(actor, id);
    return { success: true };
  }

  @Post('plans/:id/complete')
  async complete(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    await planService.completePlan(actor, id);
    return { success: true };
  }

  @Post('plans/:id/archive')
  async archive(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    await planService.archivePlan(actor, id);
    return { success: true };
  }

  @Post('plans/:id/revise')
  async revise(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    return planService.createRevision(actor, id);
  }

  @Get('plans/:id/version-chain')
  async versionChain(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    return planService.getVersionChain(actor, id);
  }

  @Post('goals')
  async createGoal(@CurrentActor() actor: ActorContext, @Body() body: unknown) {
    const b = requireBody(body);
    return goalService.createGoal(actor, {
      planId: requireUUID(b.planId, 'planId'),
      title: requireString(b.title, 'title'),
      metricType: requireEnum(b.metricType, 'metricType', [
        'numeric', 'percentage', 'frequency', 'duration', 'binary', 'rating', 'rubric', 'custom',
      ] as const),
      baselineValue: b.baselineValue,
      targetValue: b.targetValue,
      measurementMethod: b.measurementMethod as string | undefined,
      responsibleSpecialistId: b.responsibleSpecialistId as string | undefined,
      domainId: b.domainId as string | undefined,
    });
  }

  @Post('goals/:id/complete')
  async completeGoal(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    await goalService.completeGoal(actor, id);
    return { success: true };
  }

  @Post('goals/:id/pause')
  async pauseGoal(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    await goalService.pauseGoal(actor, id);
    return { success: true };
  }

  @Post('goals/:id/cancel')
  async cancelGoal(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    await goalService.cancelGoal(actor, id);
    return { success: true };
  }

  @Post('goals/:id/measurements')
  async addMeasurement(@CurrentActor() actor: ActorContext, @Param('id') id: string, @Body() body: unknown) {
    requireUUID(id, 'id');
    const b = requireBody(body);
    return goalService.addMeasurement(actor, {
      goalId: id,
      value: b.value,
      sessionId: b.sessionId as string | undefined,
    });
  }

  @Get('plans/:id/goals')
  async listGoals(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    return goalService.listGoalsForPlan(actor, id);
  }

  @Get('goals/:id/measurements')
  async listMeasurements(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    return goalService.listMeasurements(actor, id);
  }
}

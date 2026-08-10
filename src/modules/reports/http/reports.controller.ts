import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/http/jwt-auth.guard';
import { CurrentActor, ActorContext } from '../../../common/http/current-actor.decorator';
import { requireBody, requireUUID } from '../../../common/http/validation';
import * as reportService from '../report.service';

@ApiTags('Reports')
@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  @Post()
  async create(@CurrentActor() actor: ActorContext, @Body() body: unknown) {
    const b = requireBody(body);
    return reportService.createDraft(actor, {
      childId: requireUUID(b.childId, 'childId'),
      assessorSpecialistId: b.assessorSpecialistId as string | undefined,
      periodStart: b.periodStart as string | undefined,
      periodEnd: b.periodEnd as string | undefined,
      content: b.content,
    });
  }

  @Post(':id/review')
  async review(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    await reportService.reviewReport(actor, id);
    return { success: true };
  }

  @Post(':id/approve')
  async approve(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    await reportService.approveReport(actor, id);
    return { success: true };
  }

  @Post(':id/revise')
  async revise(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    return reportService.reviseReport(actor, id);
  }

  @Get(':id')
  async get(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    return reportService.getReport(actor, id);
  }

  @Get('children/:childId')
  async byChild(@CurrentActor() actor: ActorContext, @Param('childId') childId: string) {
    requireUUID(childId, 'childId');
    return reportService.getChildReports(actor, childId);
  }
}

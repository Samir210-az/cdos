import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/http/jwt-auth.guard';
import { CurrentActor, ActorContext } from '../../../common/http/current-actor.decorator';
import { requireBody, requireString, requireUUID, requireEnum, optionalUUID } from '../../../common/http/validation';
import * as templateService from '../template.service';
import * as instanceService from '../instance.service';

@ApiTags('Assessments')
@Controller('assessments')
@UseGuards(JwtAuthGuard)
export class AssessmentsController {
  @Post('templates')
  async createTemplate(@CurrentActor() actor: ActorContext, @Body() body: unknown) {
    const b = requireBody(body);
    return templateService.createTemplate(actor, {
      name: requireString(b.name, 'name'),
      specialization: b.specialization as string | undefined,
    });
  }

  @Post('templates/:templateId/versions')
  async createVersion(@CurrentActor() actor: ActorContext, @Param('templateId') templateId: string) {
    requireUUID(templateId, 'templateId');
    return templateService.createTemplateVersion(actor, templateId);
  }

  @Post('template-versions/:versionId/sections')
  async addSection(@CurrentActor() actor: ActorContext, @Param('versionId') versionId: string, @Body() body: unknown) {
    requireUUID(versionId, 'versionId');
    const b = requireBody(body);
    return templateService.addSection(actor, {
      templateVersionId: versionId,
      title: requireString(b.title, 'title'),
      orderIndex: b.orderIndex as number | undefined,
    });
  }

  @Post('template-versions/:versionId/subscales')
  async addSubscale(@CurrentActor() actor: ActorContext, @Param('versionId') versionId: string, @Body() body: unknown) {
    requireUUID(versionId, 'versionId');
    const b = requireBody(body);
    return templateService.addSubscale(actor, {
      templateVersionId: versionId,
      name: requireString(b.name, 'name'),
      calculationRule: b.calculationRule,
    });
  }

  @Post('sections/:sectionId/items')
  async addItem(@CurrentActor() actor: ActorContext, @Param('sectionId') sectionId: string, @Body() body: unknown) {
    requireUUID(sectionId, 'sectionId');
    const b = requireBody(body);
    return templateService.addItem(actor, {
      sectionId,
      code: requireString(b.code, 'code'),
      label: requireString(b.label, 'label'),
      fieldType: requireEnum(b.fieldType, 'fieldType', [
        'numeric', 'scale', 'boolean', 'single_select', 'multi_select', 'text',
      ] as const),
      options: b.options,
      subscaleId: optionalUUID(b.subscaleId, 'subscaleId'),
      weight: b.weight as number | undefined,
    });
  }

  @Post('template-versions/:versionId/publish')
  async publish(@CurrentActor() actor: ActorContext, @Param('versionId') versionId: string) {
    requireUUID(versionId, 'versionId');
    return templateService.publishTemplateVersion(actor, versionId);
  }

  @Post('template-versions/:versionId/archive')
  async archive(@CurrentActor() actor: ActorContext, @Param('versionId') versionId: string) {
    requireUUID(versionId, 'versionId');
    await templateService.archiveTemplateVersion(actor, versionId);
    return { success: true };
  }

  @Post('instances')
  async createInstance(@CurrentActor() actor: ActorContext, @Body() body: unknown) {
    const b = requireBody(body);
    return instanceService.createInstance(actor, {
      childId: requireUUID(b.childId, 'childId'),
      templateVersionId: requireUUID(b.templateVersionId, 'templateVersionId'),
      assessorSpecialistId: requireUUID(b.assessorSpecialistId, 'assessorSpecialistId'),
    });
  }

  @Post('instances/:instanceId/answers')
  async submitAnswer(@CurrentActor() actor: ActorContext, @Param('instanceId') instanceId: string, @Body() body: unknown) {
    requireUUID(instanceId, 'instanceId');
    const b = requireBody(body);
    await instanceService.submitAnswer(actor, {
      instanceId,
      itemId: requireUUID(b.itemId, 'itemId'),
      value: b.value,
    });
    return { success: true };
  }

  @Post('instances/:instanceId/lock')
  async lock(@CurrentActor() actor: ActorContext, @Param('instanceId') instanceId: string) {
    requireUUID(instanceId, 'instanceId');
    return instanceService.lockInstanceAndCalculate(actor, instanceId);
  }

  @Get('instances/:instanceId/results')
  async getResults(@CurrentActor() actor: ActorContext, @Param('instanceId') instanceId: string) {
    requireUUID(instanceId, 'instanceId');
    return instanceService.getResults(actor, instanceId);
  }
}

import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Get, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/http/jwt-auth.guard';
import { CurrentActor, ActorContext } from '../../../common/http/current-actor.decorator';
import { requireBody, requireUUID, optionalString } from '../../../common/http/validation';
import * as profileService from '../clinical-profile.service';

@ApiTags('Clinical Profiles')
@Controller('children/:childId')
@UseGuards(JwtAuthGuard)
export class ClinicalProfilesController {
  @Put('medical-background')
  async upsertMedical(@CurrentActor() actor: ActorContext, @Param('childId') childId: string, @Body() body: unknown) {
    requireUUID(childId, 'childId');
    const b = requireBody(body);
    await profileService.upsertMedicalBackground(actor, childId, {
      allergies: optionalString(b.allergies, 'allergies'),
      medications: b.medications,
      conditions: b.conditions,
      notes: optionalString(b.notes, 'notes'),
    });
    return { success: true };
  }
  @Get('medical-background')
  async getMedical(@CurrentActor() actor: ActorContext, @Param('childId') childId: string) {
    requireUUID(childId, 'childId');
    return profileService.getMedicalBackground(actor, childId);
  }

  @Put('developmental-history')
  async upsertDevelopmental(@CurrentActor() actor: ActorContext, @Param('childId') childId: string, @Body() body: unknown) {
    requireUUID(childId, 'childId');
    const b = requireBody(body);
    await profileService.upsertDevelopmentalHistory(actor, childId, { milestones: b.milestones, notes: optionalString(b.notes, 'notes') });
    return { success: true };
  }
  @Get('developmental-history')
  async getDevelopmental(@CurrentActor() actor: ActorContext, @Param('childId') childId: string) {
    requireUUID(childId, 'childId');
    return profileService.getDevelopmentalHistory(actor, childId);
  }

  @Put('communication-profile')
  async upsertCommunication(@CurrentActor() actor: ActorContext, @Param('childId') childId: string, @Body() body: unknown) {
    requireUUID(childId, 'childId');
    const b = requireBody(body);
    await profileService.upsertCommunicationProfile(actor, childId, {
      primaryLanguage: optionalString(b.primaryLanguage, 'primaryLanguage'),
      communicationMethod: optionalString(b.communicationMethod, 'communicationMethod'),
      notes: optionalString(b.notes, 'notes'),
    });
    return { success: true };
  }
  @Get('communication-profile')
  async getCommunication(@CurrentActor() actor: ActorContext, @Param('childId') childId: string) {
    requireUUID(childId, 'childId');
    return profileService.getCommunicationProfile(actor, childId);
  }

  @Put('behavior-profile')
  async upsertBehavior(@CurrentActor() actor: ActorContext, @Param('childId') childId: string, @Body() body: unknown) {
    requireUUID(childId, 'childId');
    const b = requireBody(body);
    await profileService.upsertBehaviorProfile(actor, childId, {
      triggers: b.triggers,
      calmingStrategies: b.calmingStrategies,
      notes: optionalString(b.notes, 'notes'),
    });
    return { success: true };
  }
  @Get('behavior-profile')
  async getBehavior(@CurrentActor() actor: ActorContext, @Param('childId') childId: string) {
    requireUUID(childId, 'childId');
    return profileService.getBehaviorProfile(actor, childId);
  }

  @Put('sensory-profile')
  async upsertSensory(@CurrentActor() actor: ActorContext, @Param('childId') childId: string, @Body() body: unknown) {
    requireUUID(childId, 'childId');
    const b = requireBody(body);
    await profileService.upsertSensoryProfile(actor, childId, { sensitivities: b.sensitivities, notes: optionalString(b.notes, 'notes') });
    return { success: true };
  }
  @Get('sensory-profile')
  async getSensory(@CurrentActor() actor: ActorContext, @Param('childId') childId: string) {
    requireUUID(childId, 'childId');
    return profileService.getSensoryProfile(actor, childId);
  }

  @Put('educational-info')
  async upsertEducational(@CurrentActor() actor: ActorContext, @Param('childId') childId: string, @Body() body: unknown) {
    requireUUID(childId, 'childId');
    const b = requireBody(body);
    await profileService.upsertEducationalInfo(actor, childId, {
      schoolName: optionalString(b.schoolName, 'schoolName'),
      grade: optionalString(b.grade, 'grade'),
      iepStatus: optionalString(b.iepStatus, 'iepStatus'),
      notes: optionalString(b.notes, 'notes'),
    });
    return { success: true };
  }
  @Get('educational-info')
  async getEducational(@CurrentActor() actor: ActorContext, @Param('childId') childId: string) {
    requireUUID(childId, 'childId');
    return profileService.getEducationalInfo(actor, childId);
  }
}

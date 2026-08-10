import { ApiTags } from '@nestjs/swagger';
import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/http/jwt-auth.guard';
import { CurrentActor, ActorContext } from '../../../common/http/current-actor.decorator';
import { requireUUID } from '../../../common/http/validation';
import * as aiService from '../ai.service';

/**
 * Faz 3.15 bənd III: AI — yalnız "case_summary" generation (bu, hazırda tək
 * tam implementasiya edilmiş use-case-dir, bax Faz 3.14 SPEC GAP qeydi).
 * AI heç vaxt birbaşa clinical entity-ni APPROVED/LOCKED etmir — yalnız
 * ai_generations.status idarə olunur (mövcud servis qaydası dəyişmədən).
 */
@ApiTags('AI Generation')
@Controller('ai')
@UseGuards(JwtAuthGuard)
export class AIController {
  @Post('case-summary/:childId')
  async generateCaseSummary(@CurrentActor() actor: ActorContext, @Param('childId') childId: string) {
    requireUUID(childId, 'childId');
    return aiService.generateCaseSummary(actor, childId);
  }

  @Post('generations/:id/review')
  async review(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    await aiService.markReviewed(actor, id);
    return { success: true };
  }

  @Post('generations/:id/approve')
  async approve(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    await aiService.approveGeneration(actor, id);
    return { success: true };
  }

  @Post('generations/:id/reject')
  async reject(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    await aiService.rejectGeneration(actor, id);
    return { success: true };
  }

  @Get('generations/:id')
  async get(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    return aiService.getGeneration(actor, id);
  }

  @Get('generations/:id/claims')
  async claims(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    return aiService.getGenerationClaims(actor, id);
  }
}

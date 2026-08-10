import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/http/jwt-auth.guard';
import { CurrentActor, ActorContext } from '../../../common/http/current-actor.decorator';
import { requireBody, requireString, requireUUID } from '../../../common/http/validation';
import * as guardianService from '../child-guardian.service';

@ApiTags('Child Guardians')
@Controller()
@UseGuards(JwtAuthGuard)
export class ChildGuardiansController {
  @Post('child-guardians')
  async attach(@CurrentActor() actor: ActorContext, @Body() body: unknown) {
    const b = requireBody(body);
    return guardianService.attachGuardian(actor, {
      childId: requireUUID(b.childId, 'childId'),
      parentId: requireUUID(b.parentId, 'parentId'),
      relationType: requireString(b.relationType, 'relationType'),
      isPrimary: b.isPrimary as boolean | undefined,
    });
  }

  @Delete('child-guardians/:id')
  async detach(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    await guardianService.detachGuardian(actor, id);
    return { success: true };
  }

  @Get('children/:childId/guardians')
  async list(@CurrentActor() actor: ActorContext, @Param('childId') childId: string) {
    requireUUID(childId, 'childId');
    return guardianService.listGuardians(actor, childId);
  }
}

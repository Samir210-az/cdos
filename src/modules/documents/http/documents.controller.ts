import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../../common/http/jwt-auth.guard';
import { CurrentActor, ActorContext } from '../../../common/http/current-actor.decorator';
import { requireBody, requireString, requireUUID, requireEnum } from '../../../common/http/validation';
import * as documentService from '../document.service';

@ApiTags('Documents')
@Controller('documents')
@UseGuards(JwtAuthGuard)
export class DocumentsController {
  @Post()
  async upload(@CurrentActor() actor: ActorContext, @Body() body: unknown) {
    const b = requireBody(body);
    return documentService.uploadDocument(actor, {
      childId: requireUUID(b.childId, 'childId'),
      storageKey: requireString(b.storageKey, 'storageKey'),
      mimeType: b.mimeType as string | undefined,
      sizeBytes: b.sizeBytes as number | undefined,
      ownerType: b.ownerType as string | undefined,
      assessorSpecialistId: b.assessorSpecialistId as string | undefined,
      parentVisible: b.parentVisible as boolean | undefined,
    });
  }

  @Post(':id/delete')
  async softDelete(@CurrentActor() actor: ActorContext, @Param('id') id: string) {
    requireUUID(id, 'id');
    await documentService.softDeleteDocument(actor, id);
    return { success: true };
  }

  @Post(':id/access')
  async logAccess(@CurrentActor() actor: ActorContext, @Param('id') id: string, @Body() body: unknown) {
    requireUUID(id, 'id');
    const b = requireBody(body);
    await documentService.logDocumentAccess(actor, {
      documentId: id,
      action: requireEnum(b.action, 'action', ['view', 'download', 'denied'] as const),
    });
    return { success: true };
  }

  @Get('children/:childId')
  async byChild(@CurrentActor() actor: ActorContext, @Param('childId') childId: string) {
    requireUUID(childId, 'childId');
    return documentService.getChildDocuments(actor, childId);
  }
}

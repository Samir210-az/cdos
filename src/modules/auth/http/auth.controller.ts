import { ApiTags } from '@nestjs/swagger';
import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { Public } from '../../../common/http/public.decorator';
import { CurrentActor, ActorContext } from '../../../common/http/current-actor.decorator';
import { JwtAuthGuard } from '../../../common/http/jwt-auth.guard';
import { requireBody, requireString, requireUUID } from '../../../common/http/validation';
import * as authService from '../auth.service';

/**
 * Faz 3.15 bənd I: mövcud auth.service.ts üzərində NAZIK HTTP qatı.
 * Heç bir biznes qaydası burada TƏKRAR yazılmayıb.
 */
@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  @Public()
  @Post('login')
  async login(@Body() body: unknown) {
    const b = requireBody(body);
    const email = requireString(b.email, 'email');
    const password = requireString(b.password, 'password');
    return authService.login(email, password);
  }

  @Public()
  @Post('login/select-organization')
  async selectOrganization(@Body() body: unknown) {
    const b = requireBody(body);
    const userId = requireUUID(b.userId, 'userId');
    const organizationId = requireUUID(b.organizationId, 'organizationId');
    const tokens = await authService.completeLoginWithOrgChoice(userId, organizationId);
    return tokens;
  }

  @Public()
  @Post('refresh')
  async refresh(@Body() body: unknown) {
    const b = requireBody(body);
    const refreshToken = requireString(b.refreshToken, 'refreshToken');
    const activeOrganizationId = requireUUID(b.activeOrganizationId, 'activeOrganizationId');
    return authService.refresh(refreshToken, activeOrganizationId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('switch-organization')
  async switchOrganization(@Req() req: Request, @Body() body: unknown) {
    const authHeader = req.headers['authorization'] as string;
    const currentAccessToken = authHeader.slice('Bearer '.length);
    const b = requireBody(body);
    const targetOrganizationId = requireUUID(b.targetOrganizationId, 'targetOrganizationId');
    return authService.switchOrganization(currentAccessToken, targetOrganizationId);
  }

  @UseGuards(JwtAuthGuard)
  @Post('logout')
  async logout(@CurrentActor() actor: ActorContext) {
    await authService.logout(actor.sessionId);
    return { success: true };
  }
}

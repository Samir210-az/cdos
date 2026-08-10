import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { verifyAccessToken } from '../../modules/auth/jwt.service';
import { resolveMemberIdForUser } from '../../scope-cache/scope-resolver';
import { IS_PUBLIC_KEY } from './public.decorator';

/**
 * Faz 3.15 bənd II: qlobal authentication guard.
 * JWT-dən YALNIZ minimal payload (user_id/active_organization_id/session_id)
 * çıxarır (Faz 3.1 FINAL JWT modeli dəyişdirilmir) — rol/icazə HƏR ZAMAN
 * server-side (resolveMemberScope) həll olunur, JWT-də saxlanmır.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest();
    const authHeader: string | undefined = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Bearer token tələb olunur.');
    }
    const token = authHeader.slice('Bearer '.length);

    let payload;
    try {
      payload = verifyAccessToken(token);
    } catch {
      throw new UnauthorizedException('Etibarsız və ya vaxtı bitmiş access token.');
    }

    let memberId: string;
    try {
      memberId = await resolveMemberIdForUser(payload.active_organization_id, payload.user_id);
    } catch {
      throw new UnauthorizedException('Aktiv membership tapılmadı.');
    }

    req.actor = {
      organizationId: payload.active_organization_id,
      memberId,
      userId: payload.user_id,
      sessionId: payload.session_id,
    };
    return true;
  }
}

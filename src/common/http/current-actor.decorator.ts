import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export interface ActorContext {
  organizationId: string;
  memberId: string;
  userId: string;
  sessionId: string;
  requestId?: string;
}

/** Faz 3.15: JwtAuthGuard tərəfindən request-ə əlavə olunan actor context-i çıxarır. */
export const CurrentActor = createParamDecorator((_data: unknown, ctx: ExecutionContext): ActorContext => {
  const req = ctx.switchToHttp().getRequest();
  return req.actor;
});

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../../src/app.module';
import { signAccessToken } from '../../src/modules/auth/jwt.service';

export async function bootstrapTestApp(): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule, { logger: false });
  await app.init();
  return app;
}

/** Real login axını çağırmadan, birbaşa (test üçün) etibarlı access token yaradır. */
export function issueTestToken(userId: string, organizationId: string, sessionId = 'test-session'): string {
  return signAccessToken({ user_id: userId, active_organization_id: organizationId, session_id: sessionId });
}

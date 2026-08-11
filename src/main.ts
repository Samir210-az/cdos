import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { validateEnvironment } from './common/config/env-validation';

async function bootstrap() {
  // Faz 3.18 bənd 2: kritik config yoxdursa/production-da insecure-dursa,
  // tətbiq HEÇ BAŞLAMIR (fail-fast, sükutla davam etmir).
  validateEnvironment();

  const app = await NestFactory.create(AppModule);

  // Faz 3.18 bənd 4: minimal security headers (mövcud Express stack-ə uyğun, əlavə ağır asılılıq yoxdur).
  app.use(helmet());

  // Faz 3.18 bənd 5: CORS — yalnız explicit CORS_ALLOWED_ORIGINS env dəyişəni
  // təyin olunubsa məhdudlaşdırılır; təyin olunmayıbsa development davranışı
  // (bütün origin-lərə açıq) qorunur ki, mövcud test/development axını pozulmasın.
  const allowedOrigins = process.env.CORS_ALLOWED_ORIGINS;
  app.enableCors({
    origin: allowedOrigins ? allowedOrigins.split(',').map((o) => o.trim()) : true,
    credentials: true,
  });

  // Faz 3.18 bənd 9: graceful shutdown (SIGTERM/SIGINT) — Nest-in built-in mexanizmi,
  // custom/riskli shutdown logic YAZILMAYIB.
  app.enableShutdownHooks();

  // Faz 3.15 bənd VII: yalnız REAL qeydə alınmış controller/endpoint-lər
  // əsasında avtomatik OpenAPI sənədləşdirməsi — uydurma endpoint yoxdur.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('CDOS API')
    .setDescription(
      'Child Development OS — backend HTTP API. Bearer JWT (Authorization: Bearer <access_token>) tələb olunur ' +
        '(login/refresh/switch-organization/health endpoint-ləri istisna olmaqla).',
    )
    .setVersion('3.18')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.APP_PORT || 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`CDOS backend started on port ${port} (OpenAPI: /docs, health: /health/live, /health/ready)`);
}

if (require.main === module) {
  bootstrap();
}

import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Faz 3.15 bənd VII: yalnız REAL qeydə alınmış controller/endpoint-lər
  // əsasında avtomatik OpenAPI sənədləşdirməsi — uydurma endpoint yoxdur.
  const swaggerConfig = new DocumentBuilder()
    .setTitle('CDOS API')
    .setDescription(
      'Child Development OS — backend HTTP API. Bearer JWT (Authorization: Bearer <access_token>) tələb olunur ' +
        '(login/refresh/switch-organization endpoint-ləri istisna olmaqla).',
    )
    .setVersion('3.15')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const port = process.env.APP_PORT || 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`CDOS backend started on port ${port} (OpenAPI: /docs)`);
}

if (require.main === module) {
  bootstrap();
}

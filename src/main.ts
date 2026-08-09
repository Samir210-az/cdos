import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const port = process.env.APP_PORT || 3000;
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`CDOS backend (Faz 3.2 skeleton) started on port ${port}`);
}

if (require.main === module) {
  bootstrap();
}

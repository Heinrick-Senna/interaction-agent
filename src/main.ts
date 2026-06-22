import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import * as fs from 'fs';

async function bootstrap() {
  fs.mkdirSync('./data', { recursive: true });

  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(require('express').json({ limit: '10mb' }));
  app.use(require('express').urlencoded({ limit: '10mb', extended: true }));
  app.useGlobalPipes(new ValidationPipe({ transform: true, whitelist: true }));
  app.setGlobalPrefix('api');

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  console.log(`Interaction agent running on port ${port}`);
}
bootstrap();

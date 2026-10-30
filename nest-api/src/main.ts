import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { loadConfig } from './config/config';

async function bootstrap(): Promise<void> {
  const cfg = loadConfig();
  // rawBody keeps the exact bytes the webhook signature is computed over
  const app = await NestFactory.create(AppModule.register(cfg), { rawBody: true });
  configureApp(app, cfg);
  await app.listen(cfg.port);
  new Logger('bootstrap').log(`listening on :${cfg.port}`);
}

void bootstrap();

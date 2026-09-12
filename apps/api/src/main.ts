import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { json } from 'express';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.use(json({ limit: '5mb' }));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  // WEB_ORIGIN is a comma-separated list so a deployed frontend (Vercel) and
  // local dev can both talk to one API. A browser on an origin not listed
  // here gets a CORS block, which surfaces in the app as "Failed to fetch".
  const origins = (process.env.WEB_ORIGIN ?? 'http://localhost:5173')
    .split(',')
    .map((value) => value.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  app.enableCors({
    origin: (
      origin: string | undefined,
      callback: (err: Error | null, allow?: boolean) => void,
    ) => {
      // No Origin header: curl, health checks, same-origin. Allow.
      if (!origin || origins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error(`Origin ${origin} is not in WEB_ORIGIN`), false);
    },
    credentials: true,
  });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

void bootstrap();

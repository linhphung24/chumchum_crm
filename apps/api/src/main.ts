import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { DomainsService } from './domains/domains.service';
import type { Express } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { cors: false, rawBody: true });

  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins.length ? origins : true, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: false,
    }),
  );

  const port = Number(process.env.PORT ?? 4000);
  await app.init();

  // Route public phục vụ xác thực domain của nhà cung cấp (Zalo Platform):
  //   GET /zalo_verifier<mã>.html — file xác thực chuẩn Zalo
  //   GET /                       — trang chủ chứa meta tag xác thực
  const domains = app.get(DomainsService);
  const express = app.getHttpAdapter().getInstance() as Express;
  express.get(/^\/zalo_verifier[A-Za-z0-9_-]+\.html$/, (req, res) => {
    const code = (req.path.match(/^\/zalo_verifier([A-Za-z0-9_-]+)\.html$/) ?? [])[1];
    if (!code) return res.status(404).send('Not found');
    res.type('html').send(domains.zaloVerifierHtml(code));
  });
  express.get('/', async (_req, res) => {
    res.type('html').send(await domains.rootHtml());
  });

  await app.listen(port, '0.0.0.0');
  console.log(`🚀 ChumChum API chạy tại http://localhost:${port}`);
}
bootstrap();

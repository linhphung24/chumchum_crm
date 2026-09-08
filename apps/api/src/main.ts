import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { static as serveStatic } from 'express';
import { join } from 'path';
import { mkdirSync } from 'fs';
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

  // ---- Xác thực domain nhà cung cấp (Zalo Platform) ----
  // Đăng ký TRƯỚC khi Nest init route để chắc chắn chạy trước bộ 404 của Nest.
  // 1) File tĩnh trong apps/api/public/ (thêm trực tiếp vào code — chắc chắn 100%)
  // 2) File động /zalo_verifier<mã>.html + meta tag ở "/" cho mã thêm qua UI (lưu DB)
  const expressApp = app.getHttpAdapter().getInstance() as Express;
  const domains = app.get(DomainsService);
  expressApp.use(serveStatic(join(__dirname, '..', 'public')));
  expressApp.get(/^\/zalo_verifier[A-Za-z0-9_-]+\.html$/, (req, res) => {
    const code = (req.path.match(/^\/zalo_verifier([A-Za-z0-9_-]+)\.html$/) ?? [])[1];
    if (!code) return res.status(404).send('Not found');
    res.type('html').send(domains.zaloVerifierHtml(code));
  });
  expressApp.get('/', async (_req, res) => {
    res.type('html').send(await domains.rootHtml());
  });

  // File đính kèm chat (ảnh/video/tệp) — lưu ở UPLOAD_DIR, phục vụ công khai qua /uploads
  const uploadDir = process.env.UPLOAD_DIR ?? './uploads';
  mkdirSync(uploadDir, { recursive: true });
  expressApp.use('/uploads', serveStatic(join(process.cwd(), uploadDir)));

  await app.init();
  await app.listen(port, '0.0.0.0');
  console.log(`🚀 ChumChum API chạy tại http://localhost:${port}`);
}
bootstrap();

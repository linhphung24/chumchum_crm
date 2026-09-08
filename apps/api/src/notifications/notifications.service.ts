import { Injectable, Logger } from '@nestjs/common';
import * as webpush from 'web-push';
import { PrismaService } from '../prisma/prisma.service';

export interface PushPayload {
  title: string;
  body: string;
  /** Đường dẫn mở khi bấm vào thông báo (vd: /inbox) */
  url?: string;
}

/**
 * Gửi Web Push (PWA) tới các thiết bị đã đăng ký.
 * Cần env VAPID_PUBLIC_KEY + VAPID_PRIVATE_KEY (sinh bằng: npm run gen:vapid -w apps/api).
 * Chưa cấu hình key → bỏ qua im lặng (không ảnh hưởng luồng chính).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private readonly configured: boolean;

  constructor(private prisma: PrismaService) {
    const pub = process.env.VAPID_PUBLIC_KEY;
    const priv = process.env.VAPID_PRIVATE_KEY;
    if (pub && priv) {
      this.configured = true;
      webpush.setVapidDetails(process.env.VAPID_SUBJECT ?? 'mailto:admin@chumchum.vn', pub, priv);
    } else {
      this.configured = false;
      this.logger.warn('Chưa cấu hình VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY — Web Push tắt (không gửi được thông báo)');
    }
  }

  get vapidPublicKey(): string | null {
    return this.configured ? (process.env.VAPID_PUBLIC_KEY as string) : null;
  }

  async subscribe(userId: string, dto: { endpoint: string; keys: { p256dh: string; auth: string } }) {
    await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      update: { userId, p256dh: dto.keys.p256dh, auth: dto.keys.auth },
      create: { userId, endpoint: dto.endpoint, p256dh: dto.keys.p256dh, auth: dto.keys.auth },
    });
    return { ok: true };
  }

  async unsubscribe(userId: string, endpoint: string) {
    await this.prisma.pushSubscription.deleteMany({ where: { endpoint, userId } });
    return { ok: true };
  }

  /** Gửi tới mọi thiết bị đã đăng ký. Endpoint chết (404/410) tự xoá. Không bao giờ throw. */
  async notifyAll(payload: PushPayload) {
    if (!this.configured) return;
    let subs: { id: string; endpoint: string; p256dh: string; auth: string }[];
    try {
      subs = await this.prisma.pushSubscription.findMany();
    } catch {
      return;
    }
    await Promise.allSettled(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            JSON.stringify(payload),
          );
        } catch (err) {
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await this.prisma.pushSubscription.delete({ where: { id: s.id } }).catch(() => undefined);
          }
        }
      }),
    );
  }
}

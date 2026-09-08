import { BadRequestException, Controller, Get, Headers, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelIngestService } from '../channels/channel-ingest.service';
import { EventsGateway } from '../realtime/events.gateway';
import type { NormalizedIncomingMessage } from '../channels/channel-adapter';
import { hmacSha256Hex } from '../common/utils';

@Controller('webhooks')
export class WebhooksController {
  constructor(
    private prisma: PrismaService,
    private ingest: ChannelIngestService,
    private events: EventsGateway,
  ) {}

  // ================= Meta verify (Messenger / Instagram) =================

  @Get('messenger')
  verifyMessenger(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string) {
    return this.verifyMeta(process.env.FB_VERIFY_TOKEN, mode, token, challenge);
  }

  @Get('instagram')
  verifyInstagram(@Query('hub.mode') mode: string, @Query('hub.verify_token') token: string, @Query('hub.challenge') challenge: string) {
    return this.verifyMeta(process.env.IG_VERIFY_TOKEN ?? process.env.FB_VERIFY_TOKEN, mode, token, challenge);
  }

  private verifyMeta(expected: string | undefined, mode: string, token: string, challenge: string) {
    if (mode === 'subscribe' && expected && token === expected) return challenge;
    throw new BadRequestException('Verify token không khớp');
  }

  // ================= Meta POST (Messenger) =================

  @Post('messenger')
  async messengerPost(@Req() req: Request, @Headers('x-hub-signature-256') signature?: string) {
    this.assertMetaSignature(req, signature);
    const body = req.body as MetaWebhookBody;
    const results: unknown[] = [];
    for (const entry of body?.entry ?? []) {
      const pageId = entry.id;
      for (const m of entry.messaging ?? []) {
        if (!m.message || !m.sender?.id) continue; // bỏ qua delivery/read/postback events
        results.push(
          await this.ingest.handleIncoming({
            channelType: 'FACEBOOK',
            accountExternalId: pageId,
            externalUserId: m.sender.id,
            text: m.message.text,
            attachmentUrl: m.message.attachments?.[0]?.payload?.url,
            attachmentType: this.mapAttachment(m.message.attachments?.[0]?.type),
            externalMessageId: m.message.mid,
            timestamp: m.timestamp ? new Date(m.timestamp) : undefined,
          }),
        );
      }
      for (const change of entry.changes ?? []) {
        if (change?.field === 'feed' && change.value) results.push(await this.handleFeedChange(pageId, change.value));
      }
    }
    return { ok: true, received: results.length };
  }

  private mapAttachment(type?: string): 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE' | 'STICKER' | undefined {
    switch (type) {
      case 'image':
        return 'IMAGE';
      case 'video':
        return 'VIDEO';
      case 'audio':
        return 'AUDIO';
      case 'file':
        return 'FILE';
      case 'sticker':
        return 'STICKER';
      default:
        return undefined;
    }
  }

  // ================= Meta POST (Instagram) =================

  @Post('instagram')
  async instagramPost(@Req() req: Request, @Headers('x-hub-signature-256') signature?: string) {
    this.assertMetaSignature(req, signature);
    const body = req.body as MetaWebhookBody;
    let count = 0;
    for (const entry of body?.entry ?? []) {
      for (const m of entry.messaging ?? []) {
        if (!m.message || !m.sender?.id) continue;
        await this.ingest.handleIncoming({
          channelType: 'INSTAGRAM',
          accountExternalId: entry.id,
          externalUserId: m.sender.id,
          text: m.message.text,
          attachmentUrl: m.message.attachments?.[0]?.payload?.url,
          externalMessageId: m.message.mid,
          timestamp: m.timestamp ? new Date(m.timestamp) : undefined,
        });
        count++;
      }
    }
    return { ok: true, received: count };
  }

  /** Comment Facebook trên bài viết Page → lưu SocialComment */
  private async handleFeedChange(pageId: string, value: FeedChangeValue) {
    if (value?.item !== 'comment' || value?.verb !== 'add') return null;
    if (!value.comment_id) return null;

    const account = await this.prisma.channelAccount.findUnique({
      where: { type_externalId: { type: 'FACEBOOK', externalId: pageId } },
    });
    if (!account) return null;

    // Nếu comment trên comment của chính Page → chỉ lưu làm phản hồi, không tạo mới
    const isReplyToUs = value.parent_id ? !!(await this.prisma.socialComment.findUnique({ where: { externalId: value.parent_id } })) : false;
    if (isReplyToUs) return null;

    const comment = await this.prisma.socialComment.upsert({
      where: { externalId: value.comment_id },
      update: { message: value.message ?? '' },
      create: {
        channelAccountId: account.id,
        postId: value.post_id ?? '',
        postPermalink: value.permalink_url ?? null,
        externalId: value.comment_id,
        parentId: value.parent_id ?? null,
        authorExternalId: value.from?.id ?? '',
        authorName: value.from?.name ?? 'Khách Facebook',
        message: value.message ?? '',
        status: 'NEW',
        createdAt: value.created_time ? new Date(value.created_time * 1000) : new Date(),
      },
    });
    this.events.emitCommentNew({ comment });
    return comment;
  }

  // ================= Zalo OA =================

  @Post('zalo')
  async zaloPost(@Req() req: Request) {
    const body = req.body as ZaloWebhookBody;
    await this.log('zalo', body?.event_name, body);
    if (!body?.event_name?.startsWith('user_send')) return { ok: true };

    const attachment = this.extractZaloAttachment(body);
    await this.ingest.handleIncoming({
      channelType: 'ZALO_OA',
      accountExternalId: process.env.ZALO_OA_ID ?? 'default',
      externalUserId: body.sender?.id ?? '',
      userDisplayName: body.info?.sender_name,
      text: body.message?.text,
      attachmentUrl: attachment?.url,
      attachmentType: attachment?.type,
      externalMessageId: body.message?.msg_id,
    });
    return { ok: true };
  }

  private extractZaloAttachment(body: ZaloWebhookBody): { url?: string; type?: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE' } | null {
    const att = body.message?.attachment ?? body.message?.attachments?.[0];
    if (!att?.url) return null;
    const typeMap: Record<string, 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE'> = {
      image: 'IMAGE',
      photo: 'IMAGE',
      video: 'VIDEO',
      audio: 'AUDIO',
      file: 'FILE',
      gif: 'IMAGE',
      sticker: 'IMAGE',
    };
    return { url: att.url, type: typeMap[att.type ?? ''] ?? 'FILE' };
  }

  // ================= Zalo cá nhân (bridge không chính thức) =================

  @Post('zalo-personal')
  async zaloPersonalPost(@Req() req: Request) {
    // Bridge tự viết, payload đã chuẩn hoá NormalizedIncomingMessage
    const body = req.body as Partial<NormalizedIncomingMessage> & { senderName?: string; userId?: string };
    await this.log('zalo-personal', 'message', body);
    await this.ingest.handleIncoming({
      channelType: 'ZALO_PERSONAL',
      accountExternalId: body.accountExternalId ?? 'default',
      externalUserId: body.externalUserId ?? body.userId ?? '',
      userDisplayName: body.userDisplayName ?? body.senderName,
      text: body.text,
      attachmentUrl: body.attachmentUrl,
      externalMessageId: body.externalMessageId,
    });
    return { ok: true };
  }

  // ================= TikTok =================

  @Post('tiktok')
  async tiktokPost(@Req() req: Request) {
    const body = req.body as TikTokWebhookBody;
    await this.log('tiktok', body?.event ?? 'message', body);
    let count = 0;
    const messages = this.extractTikTokMessages(body);
    for (const m of messages) {
      await this.ingest.handleIncoming({
        channelType: 'TIKTOK',
        accountExternalId: m.accountExternalId,
        externalUserId: m.externalUserId,
        userDisplayName: m.userDisplayName,
        text: m.text,
        externalMessageId: m.externalMessageId,
      });
      count++;
    }
    return { ok: true, received: count };
  }

  /** TikTok Business Messaging webhook có nhiều biến thể theo phiên bản — bóc các field phổ biến */
  private extractTikTokMessages(body: TikTokWebhookBody): NormalizedIncomingMessage[] {
    const out: NormalizedIncomingMessage[] = [];
    const rawList: Record<string, unknown>[] = Array.isArray(body?.data?.messages)
      ? (body.data.messages as Record<string, unknown>[])
      : Array.isArray(body?.messages)
        ? (body.messages as Record<string, unknown>[])
        : Array.isArray(body?.events)
          ? (body.events as Record<string, unknown>[])
          : [];
    for (const raw of rawList) {
      const content = raw.content as Record<string, unknown> | undefined;
      const from = raw.from as Record<string, unknown> | undefined;
      const text = (raw.text as string) ?? (content?.text as string) ?? undefined;
      const externalUserId =
        (from?.id as string) ??
        (raw.user_id as string) ??
        (raw.recipient_id as string) ??
        (raw.sender_id as string) ??
        '';
      if (!externalUserId || (!text && !raw.message_id && !raw.id)) continue;
      out.push({
        channelType: 'TIKTOK',
        accountExternalId: (raw.audience_client_id as string) ?? (raw.sender_id as string) ?? 'default',
        externalUserId,
        userDisplayName: (from?.name as string) ?? undefined,
        text,
        externalMessageId: (raw.message_id as string) ?? (raw.id as string) ?? undefined,
      });
    }
    return out;
  }

  // ================= Shopee =================

  @Post('shopee')
  async shopeePost(@Req() req: Request, @Headers('authorization') authorization?: string) {
    const body = req.body as ShopeeWebhookBody;
    await this.log('shopee', body?.code?.toString(), body);

    const webhookKey = process.env.SHOPEE_WEBHOOK_KEY;
    if (webhookKey && req.originalUrl) {
      const expected = hmacSha256Hex(webhookKey, `https://${req.headers.host}${req.originalUrl}${JSON.stringify(body)}`);
      if (authorization && authorization !== expected) {
        await this.log('shopee', 'signature_mismatch', { expected });
        throw new BadRequestException('Chữ ký Shopee không hợp lệ');
      }
    }

    // Đồng bộ trạng thái đơn từ Shopee
    if (body?.code === 3 && body.data?.orders?.length) {
      for (const o of body.data.orders) {
        const order = await this.prisma.order.findFirst({ where: { externalOrderId: o.order_sn } });
        if (!order) continue;
        const mapped = mapShopeeStatus(o.status);
        if (mapped && mapped !== order.status) {
          const updated = await this.prisma.order.update({
            where: { id: order.id },
            data: {
              status: mapped,
              events: { create: { fromStatus: order.status, toStatus: mapped, note: 'Tự động từ Shopee' } },
            },
          });
          this.events.emitOrderUpdated({ order: updated });
        }
      }
    }
    return { ok: true };
  }

  // ================= helpers =================

  private assertMetaSignature(req: Request, signature?: string) {
    const secret = process.env.FB_APP_SECRET;
    const raw = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!secret || !signature || !raw) return; // chưa cấu hình → bỏ qua (dev)
    const expected = `sha256=${hmacSha256Hex(secret, raw.toString('utf8'))}`;
    if (expected !== signature) throw new BadRequestException('Chữ ký Meta không hợp lệ');
  }

  private async log(provider: string, event: string | undefined, payload: unknown) {
    try {
      await this.prisma.webhookLog.create({
        data: {
          provider,
          event: event ?? null,
          status: 'OK',
          payload: JSON.stringify(payload).slice(0, 10_000),
        },
      });
    } catch {
      /* log không được phép làm hỏng webhook */
    }
  }
}

// ================= Types =================

interface MetaWebhookBody {
  object?: string;
  entry?: {
    id: string;
    time?: number;
    messaging?: {
      sender?: { id?: string };
      recipient?: { id?: string };
      timestamp?: number;
      message?: {
        mid?: string;
        text?: string;
        attachments?: { type?: string; payload?: { url?: string } }[];
      };
    }[];
    changes?: { field?: string; value?: FeedChangeValue }[];
  }[];
}

interface FeedChangeValue {
  item?: string;
  verb?: string;
  comment_id?: string;
  parent_id?: string;
  post_id?: string;
  created_time?: number;
  permalink_url?: string;
  from?: { id?: string; name?: string };
  message?: string;
}

interface ZaloWebhookBody {
  event_name?: string;
  sender?: { id?: string };
  info?: { sender_name?: string; sender_avatar?: string };
  message?: {
    msg_id?: string;
    text?: string;
    attachment?: { url?: string; type?: string };
    attachments?: { url?: string; type?: string }[];
  };
}

interface TikTokWebhookBody {
  event?: string;
  data?: { messages?: Record<string, unknown>[] };
  messages?: Record<string, unknown>[];
  events?: Record<string, unknown>[];
}

interface ShopeeWebhookBody {
  code?: number;
  shop_id?: number;
  data?: { orders?: { order_sn: string; status: string }[] };
}

function mapShopeeStatus(s: string): string | null {
  const map: Record<string, string> = {
    UNPAID: 'NEW',
    TO_CONFIRM: 'NEW',
    TO_CANCEL: 'CANCELLED',
    CANCELLED: 'CANCELLED',
    IN_CANCEL: 'CANCELLED',
    PROCESS_SHIP: 'CONFIRMED',
    SHIPPED: 'SHIPPING',
    TO_RETURN: 'SHIPPING',
    COMPLETED: 'COMPLETED',
  };
  return map[s] ?? null;
}

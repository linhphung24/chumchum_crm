import { BadRequestException, Controller, Get, Headers, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelIngestService } from '../channels/channel-ingest.service';
import { ChannelsService } from '../channels/channels.service';
import { EventsGateway } from '../realtime/events.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import type { NormalizedIncomingMessage } from '../channels/channel-adapter';
import { hmacSha256Hex } from '../common/utils';

@Controller('webhooks')
export class WebhooksController {
  constructor(
    private prisma: PrismaService,
    private ingest: ChannelIngestService,
    private channels: ChannelsService,
    private events: EventsGateway,
    private notifications: NotificationsService,
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
    void this.notifications.notifyAll({
      title: `🗣️ ${comment.authorName} vừa bình luận`,
      body: (comment.message ?? '').slice(0, 120),
      url: '/comments',
    });
    return comment;
  }

  // ================= Zalo OA =================

  /**
   * GET /webhooks/zalo — nhận redirect từ luồng OAuth v4 cấp quyền OA
   * (dùng chính URL webhook đã đăng ký trong app làm redirect_uri → khỏi ô callback riêng).
   */
  @Get('zalo')
  async zaloOAuthRedirect(@Query('code') code: string, @Query('oa_id') oaId: string, @Query('state') state: string, @Res() res: Response) {
    const frontend = (process.env.FRONTEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    if (!code || !state) {
      // Không phải luồng OAuth (vd kiểm tra sức khoẻ) → trả OK cho an toàn
      return res.status(200).json({ ok: true });
    }
    try {
      const r = await this.channels.zaloOaOAuthCallback(code, oaId, state);
      return res.redirect(`${frontend}/settings?zalo-oa=ok&name=${encodeURIComponent(r.name)}`);
    } catch (err) {
      return res.redirect(`${frontend}/settings?zalo-oa=fail&msg=${encodeURIComponent((err as Error).message)}`);
    }
  }

  @Post('zalo')
  async zaloPost(@Req() req: Request) {
    const body = req.body as ZaloWebhookBody;
    await this.log('zalo', body?.event_name, body);
    if (!body?.event_name?.startsWith('user_send')) return { ok: true };

    const attachment = this.extractZaloAttachment(body);
    const externalUserId = body.sender?.id ?? '';

    // Luôn dồn tin về tài khoản ZALO_OA đã kết nối (ưu tiên cái CÓ token) — tránh tách thành
    // hội thoại rời rạc giữa tài khoản OAuth và tài khoản "default".
    const zaloAccounts = await this.prisma.channelAccount.findMany({ where: { type: 'ZALO_OA' } });
    const account = zaloAccounts.find((a) => a.credentials) ?? zaloAccounts[0];
    const accountExternalId = process.env.ZALO_OA_ID || account?.externalId || 'default';

    // Webhook Zalo nhiều khi không kèm tên/ảnh người gửi → lấy qua API profile nếu đã kết nối
    let displayName = (body.info as { sender_name?: string } | undefined)?.sender_name;
    let avatarUrl = (body.info as { sender_avatar?: string } | undefined)?.sender_avatar;
    if ((!displayName || !avatarUrl) && externalUserId && account?.credentials) {
      try {
        const profile = await this.channels.getAdapter('ZALO_OA').fetchUserProfile?.(account, externalUserId);
        displayName = displayName ?? profile?.displayName;
        avatarUrl = avatarUrl ?? profile?.avatarUrl;
      } catch {
        /* profile là tuỳ chọn — bỏ qua nếu lỗi */
      }
    }

    await this.ingest.handleIncoming({
      channelType: 'ZALO_OA',
      accountExternalId,
      externalUserId,
      userDisplayName: displayName,
      userAvatarUrl: avatarUrl,
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
    const body = req.body as Partial<NormalizedIncomingMessage> & { senderName?: string; userId?: string; direction?: string };
    await this.log('zalo-personal', 'message', body);
    const externalUserId = body.externalUserId ?? body.userId ?? '';

    // Tin MÌNH gửi từ app Zalo (direction=OUT) → lưu vào hội thoại, không bật unread/thông báo
    if (body.direction === 'OUT' && externalUserId && body.externalMessageId) {
      // Nhiều nick Zalo: ưu tiên đúng nick theo accountExternalId, thiếu thì về nick đầu tiên
      const account = body.accountExternalId
        ? await this.prisma.channelAccount.findUnique({
            where: { type_externalId: { type: 'ZALO_PERSONAL', externalId: body.accountExternalId } },
          })
        : await this.prisma.channelAccount.findFirst({ where: { type: 'ZALO_PERSONAL' } });
      if (account) {
        const identity = await this.prisma.channelIdentity.findUnique({
          where: { channelAccountId_externalUserId: { channelAccountId: account.id, externalUserId: String(externalUserId) } },
        });
        if (identity) {
          const conversation = await this.prisma.conversation.findUnique({
            where: { customerId_channelAccountId: { customerId: identity.customerId, channelAccountId: account.id } },
          });
          if (conversation) {
            const dup = await this.prisma.message.findFirst({
              where: { conversationId: conversation.id, externalId: String(body.externalMessageId) },
            });
            if (!dup && body.text) {
              const message = await this.prisma.message.create({
                data: {
                  conversationId: conversation.id,
                  direction: 'OUT',
                  type: 'TEXT',
                  text: body.text,
                  externalId: String(body.externalMessageId),
                  status: 'SENT',
                },
              });
              await this.prisma.conversation.update({
                where: { id: conversation.id },
                data: { lastMessageAt: message.createdAt, lastMessageText: body.text, lastDirection: 'OUT' },
              });
              this.events.emitMessageSent({ conversationId: conversation.id, message });
              this.events.emitConversationUpdated({
                conversation: await this.prisma.conversation.findUnique({ where: { id: conversation.id } }),
              });
            }
          }
        }
      }
      return { ok: true };
    }

    await this.ingest.handleIncoming({
      channelType: 'ZALO_PERSONAL',
      accountExternalId: body.accountExternalId ?? 'default',
      externalUserId,
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

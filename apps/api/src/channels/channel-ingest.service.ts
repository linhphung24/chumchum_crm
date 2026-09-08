import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../realtime/events.gateway';
import { NotificationsService } from '../notifications/notifications.service';
import { CHANNEL_LABELS } from '../common/constants';
import { ChannelAdapter, NormalizedIncomingMessage } from './channel-adapter';

/**
 * Pipeline hợp nhất: mọi tin nhắn đến từ bất kỳ kênh nào đều đi qua đây:
 * tin nhắn → tìm/tạo tài khoản kênh → ánh xạ danh tính → khách hàng → hội thoại
 */
@Injectable()
export class ChannelIngestService {
  private readonly logger = new Logger(ChannelIngestService.name);

  constructor(
    private prisma: PrismaService,
    private events: EventsGateway,
    private notifications: NotificationsService,
  ) {}

  async handleIncoming(raw: NormalizedIncomingMessage) {
    const msg = normalize(raw);

    // 1) Tài khoản kênh (tự tạo nếu chưa có — hỗ trợ chế độ mock/webhook mới)
    const account =
      (await this.prisma.channelAccount.findUnique({
        where: { type_externalId: { type: msg.channelType, externalId: msg.accountExternalId } },
      })) ??
      (await this.prisma.channelAccount.create({
        data: {
          type: msg.channelType,
          externalId: msg.accountExternalId,
          name: msg.accountName ?? `${CHANNEL_LABELS[msg.channelType]} ${msg.accountExternalId}`,
        },
      }));
    if (!account.isActive) {
      this.logger.warn(`Kênh ${account.name} đang tắt, bỏ tin nhắn`);
      return null;
    }

    // 2) Danh tính + khách hàng
    let identity = await this.prisma.channelIdentity.findUnique({
      where: {
        channelAccountId_externalUserId: { channelAccountId: account.id, externalUserId: msg.externalUserId },
      },
    });
    if (!identity) {
      const customer = await this.prisma.customer.create({
        data: { name: msg.userDisplayName ?? `Khách ${CHANNEL_LABELS[msg.channelType]}`, avatarUrl: msg.userAvatarUrl },
      });
      identity = await this.prisma.channelIdentity.create({
        data: {
          customerId: customer.id,
          channelAccountId: account.id,
          externalUserId: msg.externalUserId,
          displayName: msg.userDisplayName,
          avatarUrl: msg.userAvatarUrl,
        },
      });
    } else if (msg.userDisplayName || msg.userAvatarUrl) {
      await this.prisma.channelIdentity.update({
        where: { id: identity.id },
        data: {
          displayName: msg.userDisplayName ?? identity.displayName,
          avatarUrl: msg.userAvatarUrl ?? identity.avatarUrl,
        },
      });
    }

    // 3) Hội thoại
    let conversation = await this.prisma.conversation.findUnique({
      where: { customerId_channelAccountId: { customerId: identity.customerId, channelAccountId: account.id } },
    });
    if (!conversation) {
      conversation = await this.prisma.conversation.create({
        data: { customerId: identity.customerId, channelAccountId: account.id },
      });
    }

    // 4) Lưu tin (chống trùng lặp theo externalMessageId)
    if (msg.externalMessageId) {
      const dup = await this.prisma.message.findFirst({
        where: { conversationId: conversation.id, externalId: msg.externalMessageId },
      });
      if (dup) return null;
    }
    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'IN',
        type: msg.attachmentUrl ? msg.attachmentType ?? 'IMAGE' : 'TEXT',
        text: msg.text,
        attachmentUrl: msg.attachmentUrl,
        externalId: msg.externalMessageId,
        status: 'SENT',
        createdAt: msg.timestamp ?? new Date(),
      },
    });

    conversation = await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: message.createdAt,
        lastMessageText: msg.text ?? `[${labelOf(msg.attachmentType ?? 'IMAGE')}]`,
        lastDirection: 'IN',
        unreadCount: { increment: 1 },
        status: 'OPEN',
      },
      include: {
        customer: { select: { id: true, name: true, avatarUrl: true } },
        channelAccount: { select: { id: true, type: true, name: true } },
        assignedUser: { select: { id: true, name: true } },
      },
    });

    this.events.emitMessageNew({ conversationId: conversation.id, message });
    this.events.emitConversationUpdated({ conversation });
    // Thông báo push cho các thiết bị đã đăng ký (người bán trên điện thoại)
    const customerName = await this.prisma.customer
      .findUnique({ where: { id: conversation.customerId }, select: { name: true } })
      .then((c) => c?.name ?? 'Khách');
    void this.notifications.notifyAll({
      title: `💬 ${customerName} · ${CHANNEL_LABELS[msg.channelType]}`,
      body: msg.text?.slice(0, 120) ?? `[${labelOf(msg.attachmentType ?? 'IMAGE')}]`,
      url: '/inbox',
    });
    this.logger.log(`Tin mới từ ${CHANNEL_LABELS[msg.channelType]}: ${(msg.text ?? '[media]').slice(0, 50)}`);
    return { conversation, message };
  }

  /** Gửi tin đi qua adapter tương ứng; trả về message đã lưu */
  async sendOutgoing(conversationId: string, text: string, sentById: string | null, adapter: ChannelAdapter, accountExternalId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { channelAccount: true },
    });
    if (!conversation) return null;

    const identity = await this.prisma.channelIdentity.findFirst({
      where: {
        customerId: conversation.customerId,
        channelAccountId: conversation.channelAccountId,
      },
    });

    const account = conversation.channelAccount;
    let sendResult: { externalId?: string; mocked?: boolean; error?: string } = {};
    try {
      sendResult = await adapter.sendText(account, identity?.externalUserId ?? 'unknown', text);
    } catch (err) {
      sendResult = { error: String((err as Error).message ?? err) };
    }

    const message = await this.prisma.message.create({
      data: {
        conversationId: conversation.id,
        direction: 'OUT',
        type: 'TEXT',
        text,
        externalId: sendResult.externalId,
        status: sendResult.error ? 'FAILED' : sendResult.mocked ? 'MOCKED' : 'SENT',
        sentById,
      },
    });

    const updated = await this.prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        lastMessageAt: message.createdAt,
        lastMessageText: text,
        lastDirection: 'OUT',
      },
      include: {
        customer: { select: { id: true, name: true, avatarUrl: true } },
        channelAccount: { select: { id: true, type: true, name: true } },
        assignedUser: { select: { id: true, name: true } },
      },
    });

    this.events.emitMessageSent({ conversationId: conversation.id, message });
    this.events.emitConversationUpdated({ conversation: updated });
    return message;
  }
}

function labelOf(type: string): string {
  const map: Record<string, string> = {
    IMAGE: 'Hình ảnh',
    VIDEO: 'Video',
    AUDIO: 'Âm thanh',
    FILE: 'Tệp',
    STICKER: 'Sticker',
  };
  return map[type] ?? 'Tệp đính kèm';
}

function normalize(msg: NormalizedIncomingMessage): NormalizedIncomingMessage {
  return {
    ...msg,
    accountExternalId: msg.accountExternalId || 'default',
    externalUserId: String(msg.externalUserId),
    text: msg.text?.slice(0, 4000),
  };
}

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelsService } from '../channels/channels.service';
import { ChannelIngestService } from '../channels/channel-ingest.service';
import { EventsGateway } from '../realtime/events.gateway';

const CONVERSATION_INCLUDE = {
  customer: { select: { id: true, name: true, phone: true, avatarUrl: true, tags: true } },
  channelAccount: { select: { id: true, type: true, name: true } },
  assignedUser: { select: { id: true, name: true } },
} as const;

@Injectable()
export class ConversationsService {
  private readonly logger = new Logger(ConversationsService.name);
  constructor(
    private prisma: PrismaService,
    private channels: ChannelsService,
    private ingest: ChannelIngestService,
    private events: EventsGateway,
  ) {}

  list(opts: { channelType?: string; status?: string; assignedUserId?: string; unassigned?: boolean; q?: string }) {
    return this.prisma.conversation.findMany({
      where: {
        AND: [
          opts.channelType ? { channelAccount: { type: opts.channelType } } : {},
          opts.status ? { status: opts.status } : {},
          opts.assignedUserId ? { assignedUserId: opts.assignedUserId } : {},
          opts.unassigned ? { assignedUserId: null } : {},
          opts.q ? { customer: { name: { contains: opts.q } } } : {},
        ],
      },
      orderBy: { lastMessageAt: 'desc' },
      take: 100,
      include: CONVERSATION_INCLUDE,
    });
  }

  async detail(id: string) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id },
      include: {
        ...CONVERSATION_INCLUDE,
        customer: {
          select: {
            id: true,
            name: true,
            phone: true,
            email: true,
            address: true,
            avatarUrl: true,
            tags: true,
            note: true,
            orders: {
              orderBy: { createdAt: 'desc' },
              take: 10,
              select: { id: true, code: true, status: true, total: true, createdAt: true },
            },
          },
        },
      },
    });
    if (!conv) throw new NotFoundException('Không tìm thấy hội thoại');
    return conv;
  }

  async messages(conversationId: string, opts: { take?: number; before?: string }) {
    const take = Math.min(opts.take ?? 50, 100);
    const rows = await this.prisma.message.findMany({
      where: {
        conversationId,
        ...(opts.before ? { id: { lt: opts.before } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take,
      include: { conversation: { select: { customer: { select: { name: true } } } } },
    });
    return rows.reverse();
  }

  async sendMessage(conversationId: string, text: string, sentById: string) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { channelAccount: true },
    });
    if (!conv) throw new NotFoundException('Không tìm thấy hội thoại');
    const adapter = this.channels.getAdapter(conv.channelAccount.type);
    const message = await this.ingest.sendOutgoing(conversationId, text, sentById, adapter, conv.channelAccount.externalId);
    if (!message) throw new NotFoundException('Không tìm thấy hội thoại');
    return message;
  }

  /** Gửi file đính kèm: lưu vào /uploads → gửi qua adapter (Zalo upload token / FB url), kênh khác lưu nội bộ */
  async sendAttachment(conversationId: string, file: { filename: string; mimetype: string }, caption: string | undefined, sentById: string) {
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
      include: { channelAccount: true },
    });
    if (!conv) throw new NotFoundException('Không tìm thấy hội thoại');

    const extType: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE' = file.mimetype.startsWith('image/')
      ? 'IMAGE'
      : file.mimetype.startsWith('video/')
        ? 'VIDEO'
        : file.mimetype.startsWith('audio/')
          ? 'AUDIO'
          : 'FILE';
    const base = (process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');
    const publicUrl = `${base}/uploads/${file.filename}`;

    const identity = await this.prisma.channelIdentity.findFirst({
      where: { customerId: conv.customerId, channelAccountId: conv.channelAccountId },
    });

    let sendResult: { externalId?: string; mocked?: boolean; error?: string } = {};
    const adapter = this.channels.getAdapter(conv.channelAccount.type);
    if (adapter.sendAttachment && identity) {
      try {
        sendResult = await adapter.sendAttachment(conv.channelAccount, identity.externalUserId, {
          url: publicUrl,
          type: extType,
          filename: file.filename,
        });
      } catch (err) {
        sendResult = { error: String((err as Error).message ?? err) };
      }
      if (sendResult.error) {
        this.logger.warn(`Gửi file qua ${conv.channelAccount.type} lỗi: ${sendResult.error}`);
      }
    } else {
      sendResult = { mocked: true };
    }

    const message = await this.prisma.message.create({
      data: {
        conversationId,
        direction: 'OUT',
        type: extType,
        text: caption || null,
        attachmentUrl: publicUrl,
        externalId: sendResult.externalId,
        status: sendResult.error ? 'FAILED' : sendResult.mocked ? 'MOCKED' : 'SENT',
        sentById,
      },
    });

    const label = { IMAGE: 'Hình ảnh', VIDEO: 'Video', AUDIO: 'Âm thanh', FILE: 'Tệp' }[extType];
    const updated = await this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        lastMessageAt: message.createdAt,
        lastMessageText: caption || `[${label}]`,
        lastDirection: 'OUT',
      },
      include: CONVERSATION_INCLUDE,
    });
    this.events.emitMessageSent({ conversationId, message });
    this.events.emitConversationUpdated({ conversation: updated });
    return message;
  }

  async markRead(id: string) {
    await this.ensure(id);
    const conv = await this.prisma.conversation.update({
      where: { id },
      data: { unreadCount: 0 },
      include: CONVERSATION_INCLUDE,
    });
    this.events.emitConversationUpdated({ conversation: conv });
    return conv;
  }

  async assign(id: string, userId: string | null) {
    await this.ensure(id);
    const conv = await this.prisma.conversation.update({
      where: { id },
      data: { assignedUserId: userId },
      include: CONVERSATION_INCLUDE,
    });
    this.events.emitConversationUpdated({ conversation: conv });
    return conv;
  }

  async setStatus(id: string, status: string) {
    await this.ensure(id);
    const conv = await this.prisma.conversation.update({
      where: { id },
      data: { status },
      include: CONVERSATION_INCLUDE,
    });
    this.events.emitConversationUpdated({ conversation: conv });
    return conv;
  }

  private async ensure(id: string) {
    const found = await this.prisma.conversation.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Không tìm thấy hội thoại');
  }
}

import { Injectable, NotFoundException } from '@nestjs/common';
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

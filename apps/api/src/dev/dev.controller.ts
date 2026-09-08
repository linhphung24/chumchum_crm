import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { ChannelIngestService } from '../channels/channel-ingest.service';
import { EventsGateway } from '../realtime/events.gateway';
import { CHANNEL_TYPES } from '../common/constants';

export class SimulateIncomingDto {
  @IsIn(CHANNEL_TYPES as unknown as string[])
  channelType: string;

  @IsOptional()
  @IsString()
  accountExternalId?: string;

  @IsString()
  @MaxLength(100)
  userName: string;

  @IsString()
  @MaxLength(2000)
  text: string;
}

/**
 * Công cụ dev/test: giả lập tin nhắn đến từ kênh bất kỳ (kể cả kênh chưa kết nối thật)
 * để demo toàn bộ luồng inbox + realtime mà không cần credentials.
 * Tự tắt khi NODE_ENV=production.
 */
@Controller('dev')
export class DevController {
  constructor(
    private prisma: PrismaService,
    private ingest: ChannelIngestService,
    private events: EventsGateway,
  ) {}

  @Post('simulate-incoming')
  async simulateIncoming(@Body() dto: SimulateIncomingDto) {
    this.assertNotProduction();
    const accountExternalId = dto.accountExternalId ?? `mock-${dto.channelType.toLowerCase()}-1`;
    const result = await this.ingest.handleIncoming({
      channelType: dto.channelType as never,
      accountExternalId,
      accountName: `${dto.channelType} (Mock)`,
      externalUserId: `sim-${slug(dto.userName)}`,
      userDisplayName: dto.userName,
      text: dto.text,
    });
    return { ok: true, created: !!result };
  }

  @Post('simulate-comment')
  async simulateComment(@Body() dto: { author?: string; message?: string; postId?: string }) {
    this.assertNotProduction();
    const fbAccount =
      (await this.prisma.channelAccount.findFirst({ where: { type: 'FACEBOOK' } })) ??
      (await this.prisma.channelAccount.create({
        data: { type: 'FACEBOOK', externalId: 'mock-fb-page-1', name: 'Messenger ChumChum (Mock)' },
      }));
    const comment = await this.prisma.socialComment.create({
      data: {
        channelAccountId: fbAccount.id,
        postId: dto.postId ?? 'post_10294',
        postPermalink: 'https://facebook.com/chumchum/posts/10294',
        externalId: `sim-cmt-${Date.now()}`,
        authorExternalId: `sim-${slug(dto.author ?? 'Khách Facebook')}`,
        authorName: dto.author ?? 'Khách Facebook',
        message: dto.message ?? 'Mình muốn đặt hàng',
        status: 'NEW',
      },
    });
    this.events.emitCommentNew({ comment });
    return comment;
  }

  private assertNotProduction() {
    if (process.env.NODE_ENV === 'production') throw new BadRequestException('Không khả dụng ở production');
  }
}

function slug(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]/g, '-')
    .toLowerCase();
}

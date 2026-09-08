import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../realtime/events.gateway';
import { CHANNEL_TYPES, isChannelType } from '../common/constants';
import { FacebookAdapter, InstagramAdapter, ShopeeAdapter, TikTokAdapter, ZaloOaAdapter, ZaloPersonalAdapter } from './adapters';
import type { ChannelAdapter } from './channel-adapter';
import type { ChannelType } from '../common/constants';

@Injectable()
export class ChannelsService {
  private readonly adapters = new Map<ChannelType, ChannelAdapter>();

  constructor(
    private prisma: PrismaService,
    private events: EventsGateway,
    zaloOa: ZaloOaAdapter,
    zaloPersonal: ZaloPersonalAdapter,
    facebook: FacebookAdapter,
    instagram: InstagramAdapter,
    tiktok: TikTokAdapter,
    shopee: ShopeeAdapter,
  ) {
    for (const a of [zaloOa, zaloPersonal, facebook, instagram, tiktok, shopee]) {
      this.adapters.set(a.type, a);
    }
  }

  getAdapter(type: string): ChannelAdapter {
    const adapter = this.adapters.get(type as ChannelType);
    if (!adapter) throw new BadRequestException(`Không hỗ trợ kênh ${type}`);
    return adapter;
  }

  adapterMeta() {
    const devMode = process.env.NODE_ENV !== 'production';
    return CHANNEL_TYPES.map((t) => {
      const a = this.adapters.get(t);
      return {
        type: t,
        requiresApproval: a?.requiresApproval ?? false,
        envBridge: t === 'ZALO_PERSONAL' ? !!process.env.ZALO_PERSONAL_BRIDGE_URL : undefined,
        // true = môi trường dev/test (hiện nút giả lập); production tự ẩn
        devMode,
      };
    });
  }

  /** Danh sách tài khoản kênh đã kết nối (che credentials) */
  listAccounts() {
    return this.prisma.channelAccount.findMany({
      orderBy: { createdAt: 'asc' },
      include: { _count: { select: { conversations: true, identities: true } } },
    }).then((rows) =>
      rows.map(({ credentials, ...rest }) => ({
        ...rest,
        hasCredentials: !!credentials,
      })),
    );
  }

  async createAccount(dto: { type: string; externalId: string; name: string; credentials?: Record<string, string> }) {
    if (!isChannelType(dto.type)) throw new BadRequestException('Loại kênh không hợp lệ');
    const exists = await this.prisma.channelAccount.findUnique({
      where: { type_externalId: { type: dto.type, externalId: dto.externalId } },
    });
    if (exists) throw new BadRequestException('Tài khoản kênh này đã tồn tại');
    return this.prisma.channelAccount
      .create({
        data: {
          type: dto.type,
          externalId: dto.externalId,
          name: dto.name,
          credentials: dto.credentials && Object.keys(dto.credentials).length ? JSON.stringify(dto.credentials) : null,
        },
      })
      .then((a) => ({ ...a, credentials: undefined, hasCredentials: !!a.credentials }));
  }

  async updateAccount(id: string, dto: { name?: string; isActive?: boolean; credentials?: Record<string, string> }) {
    await this.ensureAccount(id);
    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.credentials !== undefined) {
      data.credentials = Object.keys(dto.credentials).length ? JSON.stringify(dto.credentials) : null;
    }
    return this.prisma.channelAccount
      .update({ where: { id }, data })
      .then((a) => ({ ...a, credentials: undefined, hasCredentials: !!a.credentials }));
  }

  async removeAccount(id: string) {
    await this.ensureAccount(id);
    await this.prisma.channelAccount.delete({ where: { id } });
    return { ok: true };
  }

  private async ensureAccount(id: string) {
    const found = await this.prisma.channelAccount.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Không tìm thấy tài khoản kênh');
  }
}

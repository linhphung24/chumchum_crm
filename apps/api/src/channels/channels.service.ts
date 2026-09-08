import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../realtime/events.gateway';
import { CHANNEL_TYPES, isChannelType } from '../common/constants';
import { FacebookAdapter, InstagramAdapter, ShopeeAdapter, TikTokAdapter, ZaloOaAdapter, ZaloPersonalAdapter } from './adapters';
import { getJson, postJson } from './channel-adapter';
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

  /** Wizard: kiểm tra credentials bằng cách gọi API thật của nền tảng (không lưu gì) */
  async testConnection(dto: { type: string; credentials: Record<string, string> }) {
    if (!isChannelType(dto.type)) throw new BadRequestException('Loại kênh không hợp lệ');
    const adapter = this.getAdapter(dto.type);
    if (!adapter.testConnection) {
      return { ok: true, message: 'Kênh này chưa hỗ trợ kiểm tra tự động — lưu rồi dùng thử' };
    }
    return adapter.testConnection(dto.credentials ?? {});
  }

  // ================= Zalo OA — OAuth khung sẵn (bật khi có env ZALO_OA_APP_ID) =================
  // ⚠️ Endpoint đổi token theo tài liệu Zalo OAuth; có thể cần hiệu chỉnh chi tiết sau khi
  // đăng ký app thật với Zalo (thủ tục doanh nghiệp). Chưa có env → trả null, UI hiện hướng dẫn dán token.

  zaloOaOAuthStart(): { url: string } | { url: null } {
    const appId = process.env.ZALO_OA_APP_ID;
    if (!appId) return { url: null };
    const base = (process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');
    const redirectUri = `${base}/channels/zalo-oa/oauth/callback`;
    return { url: `https://oauth.zalo.me/permissions?app_id=${appId}&redirect_uri=${encodeURIComponent(redirectUri)}` };
  }

  /** Zalo redirect về callback kèm code → đổi lấy accessToken → lưu thẳng vào ChannelAccount ZALO_OA */
  async zaloOaOAuthCallback(code: string) {
    const appId = process.env.ZALO_OA_APP_ID;
    const appSecret = process.env.ZALO_OA_APP_SECRET;
    if (!appId || !appSecret) throw new BadRequestException('Chưa cấu hình ZALO_OA_APP_ID / ZALO_OA_APP_SECRET');

    const tokenRes = await postJson('https://oauth.zalo.me/v4/oa/access_token', {
      app_id: Number(appId),
      app_secret: appSecret,
      code,
    }).catch((err) => {
      throw new BadRequestException(`Đổi token Zalo thất bại: ${(err as Error).message}`);
    });
    const accessToken = (tokenRes?.access_token as string) ?? ((tokenRes?.data as Record<string, unknown>)?.access_token as string);
    if (!accessToken) throw new BadRequestException(`Zalo không trả access_token: ${JSON.stringify(tokenRes).slice(0, 200)}`);

    // Lấy thông tin OA để đặt tên + externalId
    let name = 'Zalo OA';
    let externalId = 'oauth';
    const oa = await getJson(`https://openapi.zalo.me/v2.0/oa/getoa?access_token=${accessToken}`).catch(() => null);
    const data = oa?.data as Record<string, unknown> | undefined;
    if (data) {
      name = (data.name as string) ?? name;
      externalId = String(data.oa_id ?? externalId);
    }

    await this.prisma.channelAccount.upsert({
      where: { type_externalId: { type: 'ZALO_OA', externalId } },
      update: { credentials: JSON.stringify({ accessToken }), isActive: true, name },
      create: { type: 'ZALO_OA', externalId, name, credentials: JSON.stringify({ accessToken }) },
    });
    return { ok: true, name };
  }

  // ================= Zalo cá nhân — proxy bridge QR (tránh CORS từ trình duyệt) =================
  // Bridge contract v2 (mở rộng của contract /send hiện có):
  //   GET {bridge}/qr      header x-api-key → { qr: <chuỗi QR / dataURL> }
  //   GET {bridge}/status  header x-api-key → { connected: boolean }

  private bridgeHeaders(apiKey?: string) {
    return { 'x-api-key': apiKey ?? '' };
  }

  async bridgeQr(dto: { bridgeUrl: string; apiKey?: string }) {
    try {
      const res = await fetch(`${dto.bridgeUrl.replace(/\/$/, '')}/qr`, { headers: this.bridgeHeaders(dto.apiKey) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { qr?: string };
      if (!json.qr) throw new Error('Bridge không trả mã QR');
      return { qr: json.qr };
    } catch (err) {
      throw new BadRequestException(`Không lấy được mã QR từ bridge — ${(err as Error).message}`);
    }
  }

  async bridgeStatus(dto: { bridgeUrl: string; apiKey?: string }) {
    try {
      const res = await fetch(`${dto.bridgeUrl.replace(/\/$/, '')}/status`, { headers: this.bridgeHeaders(dto.apiKey) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json().catch(() => ({}))) as { connected?: boolean };
      return { connected: json.connected === true };
    } catch (err) {
      throw new BadRequestException(`Không gọi được bridge — ${(err as Error).message}`);
    }
  }

  private async ensureAccount(id: string) {
    const found = await this.prisma.channelAccount.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Không tìm thấy tài khoản kênh');
  }
}

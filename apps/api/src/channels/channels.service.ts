import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, createHmac } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../realtime/events.gateway';
import { CHANNEL_TYPES, isChannelType } from '../common/constants';
import { randomToken } from '../common/utils';
import { FacebookAdapter, InstagramAdapter, ShopeeAdapter, TikTokAdapter, ZaloOaAdapter, ZaloPersonalAdapter } from './adapters';
import { getJson } from './channel-adapter';
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
      // Gộp với credentials cũ: ô để trống = giữ giá trị đã lưu (vd refresh token không mất khi chỉ đổi access token)
      const current = await this.prisma.channelAccount.findUnique({ where: { id }, select: { credentials: true } });
      let existing: Record<string, string> = {};
      try {
        existing = current?.credentials ? JSON.parse(current.credentials) : {};
      } catch {
        existing = {};
      }
      const merged = { ...existing, ...dto.credentials };
      data.credentials = Object.keys(merged).length ? JSON.stringify(merged) : null;
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

  /** Làm mới access token bằng refresh token (Zalo OA) — lưu credentials mới quay vòng */
  async refreshAccount(id: string) {
    const account = await this.prisma.channelAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException('Không tìm thấy tài khoản kênh');
    const adapter = this.getAdapter(account.type);
    if (!adapter.refreshCredentials) throw new BadRequestException('Kênh này không hỗ trợ làm mới token');
    let result: { ok: boolean; message: string; credentials?: Record<string, string> };
    try {
      result = await adapter.refreshCredentials(account);
    } catch (err) {
      throw new BadRequestException(`Làm mới token lỗi: ${(err as Error).message}`);
    }
    if (result.ok && result.credentials) {
      await this.prisma.channelAccount.update({
        where: { id },
        data: { credentials: JSON.stringify(result.credentials), isActive: true },
      });
    }
    return result;
  }

  // ================= Zalo OA — OAuth v4 PKCE (1-cú-click, cần env ZALO_OA_APP_ID + ZALO_OA_APP_SECRET) =================
  // Luồng theo tài liệu chính thức:
  //   1) GET /channels/zalo-oa/oauth/start → trả URL https://oauth.zaloapp.com/v4/oa/permission?...
  //      kèm code_challenge = Base64Url(SHA-256(code_verifier)); code_verifier giấu trong state (đã ký HMAC)
  //   2) Admin OA chọn OA → Cho phép → Zalo redirect về /channels/zalo-oa/oauth/callback?code&oa_id&state
  //   3) Server đổi code lấy access_token + refresh_token (POST form-urlencoded, header secret_key)
  //      rồi lưu thẳng vào ChannelAccount ZALO_OA

  private zaloOAuthState(verifier: string): string {
    const payload = Buffer.from(JSON.stringify({ v: verifier, t: Date.now() })).toString('base64url');
    const sig = createHmac('sha256', process.env.JWT_SECRET ?? 'dev-secret').update(payload).digest('base64url');
    return `${payload}.${sig}`;
  }

  private verifyZaloOAuthState(state: string): string | null {
    const [payload, sig] = (state ?? '').split('.');
    if (!payload || !sig) return null;
    const expect = createHmac('sha256', process.env.JWT_SECRET ?? 'dev-secret').update(payload).digest('base64url');
    if (expect !== sig) return null;
    try {
      const data = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { v: string; t: number };
      if (Date.now() - data.t > 15 * 60_000) return null; // quá 15 phút
      return data.v;
    } catch {
      return null;
    }
  }

  zaloOaOAuthStart(): { url: string | null } {
    const appId = process.env.ZALO_OA_APP_ID;
    const secret = process.env.ZALO_OA_APP_SECRET;
    if (!appId || !secret) return { url: null };
    // code_verifier 43-128 ký tự hex; code_challenge = Base64Url(SHA-256(verifier)) bỏ padding
    const verifier = randomToken(32);
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    // Dùng chính URL webhook đã đăng ký trong app Zalo làm redirect (GET = OAuth, POST = nhận tin)
    // → khỏi cần ô callback riêng. Ghi đè được qua env nếu app yêu cầu URL khác.
    const redirectUri =
      process.env.ZALO_OA_REDIRECT_URI ??
      `${(process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '')}/webhooks/zalo`;
    const url =
      `https://oauth.zaloapp.com/v4/oa/permission?app_id=${encodeURIComponent(appId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&code_challenge=${encodeURIComponent(challenge)}` +
      `&state=${encodeURIComponent(this.zaloOAuthState(verifier))}`;
    return { url };
  }

  /** Zalo redirect trình duyệt về callback → đổi code lấy cặp token → lưu vào ChannelAccount */
  async zaloOaOAuthCallback(code: string, oaId: string | undefined, state: string) {
    const appId = process.env.ZALO_OA_APP_ID;
    const appSecret = process.env.ZALO_OA_APP_SECRET;
    if (!appId || !appSecret) throw new BadRequestException('Chưa cấu hình ZALO_OA_APP_ID / ZALO_OA_APP_SECRET trên server (.env)');
    const verifier = this.verifyZaloOAuthState(state);
    if (!verifier) throw new BadRequestException('State không hợp lệ hoặc đã hết hạn — bấm "Đăng nhập Zalo" lại từ đầu');

    // Đổi authorization_code (10 phút, dùng 1 lần) lấy access_token + refresh_token
    const tokenRes = await fetch('https://oauth.zaloapp.com/v4/oa/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', secret_key: appSecret },
      body: new URLSearchParams({
        code,
        app_id: appId,
        grant_type: 'authorization_code',
        code_verifier: verifier,
      }),
    });
    const token = (await tokenRes.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; error?: number; error_description?: string };
    if (!token.access_token) {
      throw new BadRequestException(`Zalo không cấp token: ${token.error_description ?? token.error ?? 'không rõ lỗi'}`);
    }

    // Lấy tên OA để hiển thị (oa_id ưu tiên từ callback)
    let name = 'Zalo OA';
    let externalId = oaId ?? '';
    const oa = await getJson(`https://openapi.zalo.me/v2.0/oa/getoa?access_token=${token.access_token}`).catch(() => null);
    const data = oa?.data as Record<string, unknown> | undefined;
    if (data) {
      name = (data.name as string) ?? name;
      externalId = String(data.oa_id ?? externalId ?? '');
    }
    if (!externalId) externalId = `oauth-${Date.now()}`;

    const credentials = JSON.stringify({
      accessToken: token.access_token,
      refreshToken: token.refresh_token ?? '',
      appId,
    });
    await this.prisma.channelAccount.upsert({
      where: { type_externalId: { type: 'ZALO_OA', externalId } },
      update: { credentials, isActive: true, name },
      create: { type: 'ZALO_OA', externalId, name, credentials },
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

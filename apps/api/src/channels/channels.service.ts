import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, createHmac } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../realtime/events.gateway';
import { CHANNEL_TYPES, isChannelType } from '../common/constants';
import { randomToken } from '../common/utils';
import { FacebookAdapter, InstagramAdapter, ShopeeAdapter, TikTokAdapter, ZaloOaAdapter, ZaloPersonalAdapter } from './adapters';
import { getJson } from './channel-adapter';
import type { ChannelAdapter } from './channel-adapter';
import { ChannelIngestService } from './channel-ingest.service';
import type { ChannelType } from '../common/constants';

@Injectable()
export class ChannelsService {
  private readonly adapters = new Map<ChannelType, ChannelAdapter>();

  constructor(
    private prisma: PrismaService,
    private events: EventsGateway,
    private ingest: ChannelIngestService,
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

  async removeAccount(id: string, purgeCustomers = false) {
    await this.ensureAccount(id);
    const account = await this.prisma.channelAccount.findUnique({
      where: { id },
      include: { identities: { select: { customerId: true } } },
    });
    // Zalo cá nhân: báo bridge ngắt phiên Zalo luôn (khỏi giữ nick ảo sau khi CRM ngắt kết nối)
    if (account?.type === 'ZALO_PERSONAL' && account.credentials) {
      try {
        const cred = JSON.parse(account.credentials) as { bridgeUrl?: string; apiKey?: string };
        if (cred.bridgeUrl) {
          await fetch(`${cred.bridgeUrl.replace(/\/$/, '')}/logout`, {
            method: 'POST',
            headers: { 'x-api-key': cred.apiKey ?? '' },
          }).catch(() => undefined);
        }
      } catch {
        /* bridge có thể offline — bỏ qua */
      }
    }
    const customerIds = [...new Set((account?.identities ?? []).map((i) => i.customerId))];

    // Xoá tài khoản — cascade xoá hội thoại + tin nhắn + danh tính của kênh này
    await this.prisma.channelAccount.delete({ where: { id } });

    // purge=true: xoá nốt khách hàng chỉ tồn tại nhờ kênh này (khách còn danh tính ở kênh khác sẽ giữ lại).
    // Lưu ý: đơn hàng của những khách bị xoá cũng bị xoá theo (cascade).
    let purgedCustomers = 0;
    if (purgeCustomers) {
      for (const cid of customerIds) {
        const remaining = await this.prisma.channelIdentity.count({ where: { customerId: cid } });
        if (remaining === 0) {
          await this.prisma.customer.delete({ where: { id: cid } }).catch(() => undefined);
          purgedCustomers++;
        }
      }
    }
    return { ok: true, purgedCustomers };
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

  /**
   * Đồng bộ hội thoại Zalo OA theo API v3 (chuẩn mới):
   *  1) GET /v3.0/oa/user/getlist?data={"offset","count","is_follower"} — chạy CẢ is_follower=true/false
   *  2) GET /v3.0/oa/chat/szv2?data={"user_id","offset"} — tối đa 10 tin gần nhất mỗi hội thoại
   *  Header chuẩn: ZALO_OA_ACCESS_TOKEN. Chống trùng bằng message_id.
   */
  async syncZaloChats(id: string) {
    const account = await this.prisma.channelAccount.findUnique({ where: { id } });
    if (!account || account.type !== 'ZALO_OA') throw new BadRequestException('Chỉ hỗ trợ đồng bộ cho kênh Zalo OA');
    if (!account.credentials?.includes('accessToken')) throw new BadRequestException('Kênh chưa kết nối (thiếu access token)');
    const token = (JSON.parse(account.credentials) as { accessToken?: string }).accessToken as string;

    // Đã kiểm chứng thực tế: header `access_token` + tham số gói trong query data (JSON string)
    const headers = { access_token: token } as Record<string, string>;
    const v3Get = async (path: string, payload: Record<string, unknown>) =>
      fetch(`https://openapi.zalo.me/v3.0/oa/${path}?data=${encodeURIComponent(JSON.stringify(payload))}`, { headers })
        .then((r) => r.json().catch(() => null))
        .catch(() => null) as Promise<Record<string, unknown> | null>;

    // 1) Danh sách user đã tương tác — chạy cả follower (true) và đã unfollow (false)
    // (getlist chỉ trả user_id — tên/ảnh lấy bằng user/detail ở dưới)
    const users = new Set<string>();
    let listError = '';
    for (const isFollower of [true, false]) {
      for (let offset = 0; offset < 150; offset += 50) {
        const json = await v3Get('user/getlist', { offset, count: 50, is_follower: isFollower });
        if (!json) {
          if (!listError) listError = 'Không gọi được API Zalo (mạng lỗi)';
          break;
        }
        const errCode = Number(json?.error ?? json?.error_code ?? 0);
        const data = json?.data as { users?: { user_id?: string }[] } | undefined;
        if (errCode !== 0 || !Array.isArray(data?.users)) {
          if (errCode !== 0 && !listError) listError = `Zalo ${errCode}: ${json?.message ?? json?.error_message ?? 'lỗi không rõ'}`;
          break;
        }
        for (const u of data?.users ?? []) {
          if (u.user_id) users.add(String(u.user_id));
        }
        if ((data?.users?.length ?? 0) < 50) break;
      }
    }
    if (users.size === 0) {
      throw new BadRequestException(listError || 'Zalo trả về 0 người đã tương tác');
    }

    let created = 0;
    for (const externalUserId of users) {
      // Tên/ảnh qua user/detail (đã kiểm chứng: display_name, avatar, user_is_follower...)
      const detail = await v3Get('user/detail', { user_id: externalUserId });
      const d = (detail?.data ?? {}) as Record<string, unknown>;
      const displayName = (d.display_name as string) ?? '';
      const avatar = (d.avatar as string) ?? '';

      const identity = await this.prisma.channelIdentity.findUnique({
        where: { channelAccountId_externalUserId: { channelAccountId: account.id, externalUserId } },
        include: { customer: true },
      });
      let customerId: string;
      if (!identity) {
        const customer = await this.prisma.customer.create({
          data: { name: displayName || `Khách Zalo ${externalUserId.slice(-4)}`, avatarUrl: avatar || null },
        });
        await this.prisma.channelIdentity.create({
          data: {
            customerId: customer.id,
            channelAccountId: account.id,
            externalUserId,
            displayName: displayName || null,
            avatarUrl: avatar || null,
          },
        });
        customerId = customer.id;
      } else {
        customerId = identity.customerId;
        const needName = !identity.customer.name || identity.customer.name.startsWith('Khách');
        if (needName && displayName) {
          await this.prisma.customer.update({
            where: { id: customerId },
            data: { name: displayName, avatarUrl: avatar || identity.customer.avatarUrl },
          }).catch(() => undefined);
        }
      }

      const conversation =
        (await this.prisma.conversation.findUnique({
          where: { customerId_channelAccountId: { customerId, channelAccountId: account.id } },
        })) ??
        (await this.prisma.conversation.create({ data: { customerId, channelAccountId: account.id } }));

      // 2) Tin nhắn gần nhất (chat/szv2) — API này cần đăng ký riêng trong app Zalo;
      // nếu app chưa có (404/-114) thì bỏ qua âm thầm, tin mới vẫn về qua webhook + cron
      const chatJson = await v3Get('chat/szv2', { user_id: externalUserId, offset: 0 });
      const chatErr = Number(chatJson?.error ?? chatJson?.error_code ?? 0);
      if (chatErr === 0) {
        const chatData = chatJson?.data as { messages?: Record<string, unknown>[] } | undefined;
        for (const m of chatData?.messages ?? []) {
          const messageId = String(m.message_id ?? m.msg_id ?? '');
          const contentRaw = (m.content ?? m.text ?? '') as unknown;
          const text = typeof contentRaw === 'string' ? contentRaw : ((contentRaw as { text?: string })?.text ?? '');
          if (!messageId || !text) continue;
          const direction = String(m.from_uid ?? '') === externalUserId ? 'IN' : 'OUT';
          const dup = await this.prisma.message.findFirst({ where: { conversationId: conversation.id, externalId: messageId } });
          if (dup) continue;
          await this.prisma.message.create({
            data: {
              conversationId: conversation.id,
              direction,
              type: 'TEXT',
              text,
              externalId: messageId,
              status: 'SENT',
              createdAt: m.timestamp ? new Date(Number(m.timestamp) * (Number(m.timestamp) > 1e12 ? 1 : 1000)) : new Date(),
            },
          });
          created++;
        }
        const last = await this.prisma.message.findFirst({ where: { conversationId: conversation.id }, orderBy: { createdAt: 'desc' } });
        if (last) {
          await this.prisma.conversation.update({
            where: { id: conversation.id },
            data: { lastMessageAt: last.createdAt, lastMessageText: last.text ?? '', lastDirection: last.direction, status: 'OPEN' },
          }).catch(() => undefined);
        }
      }
    }
    return { ok: true, created, total: users.size };
  }

  /**
   * Đồng bộ DANH SÁCH BẠN BÈ từ bridge Zalo cá nhân về làm khách hàng
   * (không cần có tin nhắn cũ — khi bạn bè nhắn tin sau này sẽ tự vào đúng khách).
   */
  async syncZaloPersonalFriends(id: string) {
    const account = await this.prisma.channelAccount.findUnique({ where: { id } });
    if (!account || account.type !== 'ZALO_PERSONAL') throw new BadRequestException('Chỉ hỗ trợ cho kênh Zalo cá nhân');
    const cred = account.credentials
      ? (JSON.parse(account.credentials) as { bridgeUrl?: string; apiKey?: string })
      : {};
    const bridgeUrl = cred.bridgeUrl ?? process.env.ZALO_PERSONAL_BRIDGE_URL;
    const apiKey = cred.apiKey ?? process.env.ZALO_PERSONAL_BRIDGE_API_KEY;
    if (!bridgeUrl) throw new BadRequestException('Chưa cấu hình Bridge URL cho kênh Zalo cá nhân');

    const res = await fetch(`${bridgeUrl.replace(/\/$/, '')}/friends`, {
      headers: { 'x-api-key': apiKey ?? '' },
    });
    const json = (await res.json().catch(() => ({}))) as {
      friends?: Record<string, unknown>[];
      error?: string;
    };
    if (!res.ok) throw new BadRequestException(`Bridge lỗi: ${json?.error ?? res.status}`);
    const friends = Array.isArray(json.friends) ? json.friends : [];

    const pick = (f: Record<string, unknown>, keys: string[]): string => {
      for (const k of keys) {
        const v = f[k];
        if (typeof v === 'string' && v) return v;
        if (typeof v === 'number' && v) return String(v);
      }
      return '';
    };

    let created = 0;
    for (const f of friends) {
      const externalUserId = pick(f, ['userId', 'user_id', 'uid', 'id']);
      if (!externalUserId) continue;
      const displayName = pick(f, ['displayName', 'display_name', 'name']);
      const avatar = pick(f, ['avatar', 'avatarUrl', 'avatar_url']);
      const existed = await this.prisma.channelIdentity.findUnique({
        where: { channelAccountId_externalUserId: { channelAccountId: account.id, externalUserId } },
      });
      if (existed) continue;
      const customer = await this.prisma.customer.create({
        data: { name: displayName || `Bạn bè Zalo ${externalUserId.slice(-4)}`, avatarUrl: avatar || null },
      });
      await this.prisma.channelIdentity.create({
        data: {
          customerId: customer.id,
          channelAccountId: account.id,
          externalUserId,
          displayName: displayName || null,
          avatarUrl: avatar || null,
        },
      });
      created++;
    }
    return { ok: true, created, total: friends.length };
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

  // ================= Facebook Page — OAuth 1-cú-click (Login with Facebook) =================
  // Cần env FB_APP_ID + FB_APP_SECRET (FB_VERIFY_TOKEN dùng cho webhook verify).
  // Luồng: dialog OAuth (scopes pages_*) → code → user token (gia hạn dài hạn) → /me/accounts
  // lấy Page Access Token (vĩnh viễn) → lưu ChannelAccount + tự subscribe webhook từng page.

  facebookOAuthStart(): { url: string | null } {
    const appId = process.env.FB_APP_ID;
    const appSecret = process.env.FB_APP_SECRET;
    if (!appId || !appSecret) return { url: null };
    const base = (process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');
    const redirectUri = `${base}/channels/facebook/oauth/callback`;
    const url =
      `https://www.facebook.com/v21.0/dialog/oauth?client_id=${encodeURIComponent(appId)}` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&state=${encodeURIComponent(this.zaloOAuthState(`fb-${randomToken(8)}`))}` +
      `&scope=${encodeURIComponent('pages_show_list,pages_messaging,pages_read_engagement,pages_manage_metadata')}`;
    return { url };
  }

  /** Facebook redirect về callback kèm code → đổi token → lấy danh sách Page → lưu + tự subscribe webhook */
  async facebookOAuthCallback(code: string, state: string) {
    const appId = process.env.FB_APP_ID;
    const appSecret = process.env.FB_APP_SECRET;
    if (!appId || !appSecret) throw new BadRequestException('Chưa cấu hình FB_APP_ID / FB_APP_SECRET trên server (.env)');
    if (!this.verifyZaloOAuthState(state)) throw new BadRequestException('State không hợp lệ — bấm "Đăng nhập Facebook" lại từ đầu');
    const base = (process.env.PUBLIC_API_BASE_URL ?? 'http://localhost:4000').replace(/\/$/, '');

    // 1) code → short-lived user token
    const tokenJson = await getJson(
      `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${appId}&client_secret=${appSecret}&redirect_uri=${encodeURIComponent(
        `${base}/channels/facebook/oauth/callback`,
      )}&code=${encodeURIComponent(code)}`,
    ).catch(() => null);
    const shortToken = tokenJson?.access_token as string | undefined;
    if (!shortToken) throw new BadRequestException(`Facebook không cấp token: ${JSON.stringify(tokenJson).slice(0, 200)}`);

    // 2) gia hạn dài hạn (60 ngày — Page token sinh ra từ cái này là VĨNH VIỄN)
    const longJson = await getJson(
      `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`,
    ).catch(() => null);
    const userToken = (longJson?.access_token as string) ?? shortToken;

    // 3) danh sách Page + Page Access Token
    const pagesJson = await getJson(
      `https://graph.facebook.com/v21.0/me/accounts?fields=name,access_token,picture.type(large)&limit=50&access_token=${userToken}`,
    ).catch(() => null);
    const pages = (pagesJson?.data as { id: string; name: string; access_token: string; picture?: { data?: { url?: string } } }[]) ?? [];
    if (!pages.length) throw new BadRequestException('Tài khoản Facebook chưa quản lý Page nào (hoặc thiếu quyền pages_show_list)');

    // 4) lưu từng Page + tự subscribe webhook nhận tin nhắn/comment
    const saved: string[] = [];
    for (const p of pages) {
      await this.prisma.channelAccount.upsert({
        where: { type_externalId: { type: 'FACEBOOK', externalId: p.id } },
        update: { credentials: JSON.stringify({ pageAccessToken: p.access_token }), isActive: true, name: p.name },
        create: { type: 'FACEBOOK', externalId: p.id, name: p.name, credentials: JSON.stringify({ pageAccessToken: p.access_token }) },
      });
      await fetch(`https://graph.facebook.com/v21.0/${p.id}/subscribed_apps?subscribed_fields=messages,messaging_postbacks,message_reactions,feed&access_token=${p.access_token}`, {
        method: 'POST',
      }).catch(() => undefined);
      saved.push(p.name);
    }
    return { ok: true, pages: saved };
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
    const kept = await this.prisma.channelAccount.upsert({
      where: { type_externalId: { type: 'ZALO_OA', externalId } },
      update: { credentials, isActive: true, name },
      create: { type: 'ZALO_OA', externalId, name, credentials },
    });

    // Hợp nhất: dồn toàn bộ hội thoại/danh tính về tài khoản vừa cấp quyền,
    // XOÁ các tài khoản ZALO_OA khác (token cũ chết nằm ở đó là nguyên nhân -216 dai dẳng)
    const others = await this.prisma.channelAccount.findMany({ where: { type: 'ZALO_OA', id: { not: kept.id } } });
    for (const old of others) {
      const identities = await this.prisma.channelIdentity.findMany({ where: { channelAccountId: old.id } });
      for (const idt of identities) {
        await this.prisma.channelIdentity
          .update({ where: { id: idt.id }, data: { channelAccountId: kept.id } })
          .catch(() => this.prisma.channelIdentity.delete({ where: { id: idt.id } }).catch(() => undefined));
      }
      const convs = await this.prisma.conversation.findMany({ where: { channelAccountId: old.id } });
      for (const cv of convs) {
        const moved = await this.prisma.conversation
          .update({ where: { id: cv.id }, data: { channelAccountId: kept.id } })
          .catch(() => null);
        if (!moved) {
          // Trùng khách (đã có hội thoại ở tài khoản kept) → chuyển messages sang rồi xoá hội thoại trùng
          const target = await this.prisma.conversation.findUnique({
            where: { customerId_channelAccountId: { customerId: cv.customerId, channelAccountId: kept.id } },
          });
          if (target) {
            await this.prisma.message.updateMany({ where: { conversationId: cv.id }, data: { conversationId: target.id } });
            await this.prisma.conversation.delete({ where: { id: cv.id } }).catch(() => undefined);
          }
        }
      }
      await this.prisma.channelAccount.delete({ where: { id: old.id } }).catch(() => undefined);
    }
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
      const json = (await res.json()) as { qr?: string; connected?: boolean };
      // Bridge còn phiên cũ (đã đăng nhập) → không có QR, báo cho UI biết để lưu thẳng
      if (json.connected && !json.qr) return { qr: null, connected: true };
      if (!json.qr) throw new Error('Bridge không trả mã QR');
      return { qr: json.qr, connected: false };
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

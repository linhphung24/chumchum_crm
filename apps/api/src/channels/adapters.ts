import { Injectable, Logger } from '@nestjs/common';
import { createHmac } from 'crypto';
import {
  ChannelAdapter,
  SendResult,
  TestConnectionResult,
  getJson,
  mockSendResult,
  parseCredentials,
  postJson,
} from './channel-adapter';
import { CHANNEL_LABELS, type ChannelType } from '../common/constants';

const GRAPH_VERSION = 'v21.0';

/** Gửi tin qua Graph API của Meta (Messenger + Instagram dùng chung) */
async function sendViaGraph(
  pageAccessToken: string,
  recipientId: string,
  text: string,
): Promise<SendResult> {
  const json = await postJson(`https://graph.facebook.com/${GRAPH_VERSION}/me/messages?access_token=${pageAccessToken}`, {
    recipient: { id: recipientId },
    message: { text },
  });
  return { externalId: (json?.message_id as string) ?? undefined };
}

@Injectable()
export class FacebookAdapter implements ChannelAdapter {
  readonly type = 'FACEBOOK' as ChannelType;
  readonly label = CHANNEL_LABELS.FACEBOOK;

  async sendText(account: { credentials?: string | null }, to: string, text: string): Promise<SendResult> {
    const cred = parseCredentials<{ pageAccessToken?: string }>(account.credentials);
    if (!cred?.pageAccessToken) return mockSendResult();
    return sendViaGraph(cred.pageAccessToken, to, text);
  }

  /** Trả lời 1 comment: dùng chung cho CommentsService */
  async replyComment(account: { credentials?: string | null }, commentId: string, message: string): Promise<SendResult> {
    const cred = parseCredentials<{ pageAccessToken?: string }>(account.credentials);
    if (!cred?.pageAccessToken) return mockSendResult();
    const json = await postJson(
      `https://graph.facebook.com/${GRAPH_VERSION}/${commentId}/comments?access_token=${cred.pageAccessToken}`,
      { message },
    );
    return { externalId: (json?.id as string) ?? undefined };
  }

  async fetchUserProfile(account: { credentials?: string | null }, externalUserId: string) {
    const cred = parseCredentials<{ pageAccessToken?: string }>(account.credentials);
    if (!cred?.pageAccessToken) return null;
    const json = await getJson(
      `https://graph.facebook.com/${GRAPH_VERSION}/${externalUserId}?fields=name,profile_pic&access_token=${cred.pageAccessToken}`,
    );
    return { displayName: json?.name as string | undefined, avatarUrl: json?.profile_pic as string | undefined };
  }

  /** Gửi ảnh/video/audio/file qua URL công khai (Graph API tự tải về) */
  async sendAttachment(
    account: { credentials?: string | null; externalId: string },
    to: string,
    att: { url: string; type: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE'; filename: string },
  ): Promise<SendResult> {
    const cred = parseCredentials<{ pageAccessToken?: string }>(account.credentials);
    if (!cred?.pageAccessToken) return mockSendResult();
    const type = att.type === 'IMAGE' ? 'image' : att.type === 'VIDEO' ? 'video' : att.type === 'AUDIO' ? 'audio' : 'file';
    const json = await postJson(`https://graph.facebook.com/${GRAPH_VERSION}/me/messages?access_token=${cred.pageAccessToken}`, {
      recipient: { id: to },
      message: { attachment: { type, payload: { url: att.url, is_reusable: true } } },
    });
    return { externalId: (json?.message_id as string) ?? undefined };
  }

  async testConnection(credentials: Record<string, string>): Promise<TestConnectionResult> {
    if (!credentials.pageAccessToken) return { ok: false, message: 'Chưa nhập Page Access Token' };
    try {
      const json = await getJson(
        `https://graph.facebook.com/${GRAPH_VERSION}/me?fields=name,picture.type(large)&access_token=${credentials.pageAccessToken}`,
      );
      return {
        ok: true,
        name: json?.name as string | undefined,
        avatarUrl: ((json?.picture as { data?: { url?: string } })?.data?.url) as string | undefined,
        externalId: json?.id as string | undefined,
        message: `Kết nối thành công: ${json?.name ?? 'Page'}`,
      };
    } catch (err) {
      return { ok: false, message: `Token không hợp lệ — ${(err as Error).message}` };
    }
  }
}

@Injectable()
export class InstagramAdapter implements ChannelAdapter {
  readonly type = 'INSTAGRAM' as ChannelType;
  readonly label = CHANNEL_LABELS.INSTAGRAM;

  async sendText(account: { credentials?: string | null }, to: string, text: string): Promise<SendResult> {
    const cred = parseCredentials<{ pageAccessToken?: string }>(account.credentials);
    if (!cred?.pageAccessToken) return mockSendResult();
    // Instagram Messaging API: cùng endpoint /me/messages, recipient là IG-scoped ID
    return sendViaGraph(cred.pageAccessToken, to, text);
  }

  async testConnection(credentials: Record<string, string>): Promise<TestConnectionResult> {
    if (!credentials.pageAccessToken) return { ok: false, message: 'Chưa nhập Page Access Token' };
    try {
      const json = await getJson(
        `https://graph.facebook.com/${GRAPH_VERSION}/me?fields=name,picture.type(large)&access_token=${credentials.pageAccessToken}`,
      );
      return {
        ok: true,
        name: json?.name as string | undefined,
        avatarUrl: ((json?.picture as { data?: { url?: string } })?.data?.url) as string | undefined,
        externalId: json?.id as string | undefined,
        message: `Kết nối thành công: ${json?.name ?? 'Tài khoản'}`,
      };
    } catch (err) {
      return { ok: false, message: `Token không hợp lệ — ${(err as Error).message}` };
    }
  }

  /** Gửi ảnh/video/file qua URL công khai (giống Messenger) */
  async sendAttachment(
    account: { credentials?: string | null; externalId: string },
    to: string,
    att: { url: string; type: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE'; filename: string },
  ): Promise<SendResult> {
    const cred = parseCredentials<{ pageAccessToken?: string }>(account.credentials);
    if (!cred?.pageAccessToken) return mockSendResult();
    const type = att.type === 'IMAGE' ? 'image' : att.type === 'VIDEO' ? 'video' : att.type === 'AUDIO' ? 'audio' : 'file';
    const json = await postJson(`https://graph.facebook.com/${GRAPH_VERSION}/me/messages?access_token=${cred.pageAccessToken}`, {
      recipient: { id: to },
      message: { attachment: { type, payload: { url: att.url, is_reusable: true } } },
    });
    return { externalId: (json?.message_id as string) ?? undefined };
  }
}

@Injectable()
export class ZaloOaAdapter implements ChannelAdapter {
  readonly type = 'ZALO_OA' as ChannelType;
  readonly label = CHANNEL_LABELS.ZALO_OA;

  /**
   * Chuẩn API v3 của Zalo (đã kiểm chứng thực tế 09/2026):
   *  - Header: `access_token: <token>` (KHÔNG phải Bearer/ZALO_OA_ACCESS_TOKEN — những kiểu đó bị -216)
   *  - Tham số gói trong query `data` (JSON string)
   */
  private v3Headers(accessToken: string): Record<string, string> {
    return { access_token: accessToken, 'Content-Type': 'application/json' };
  }
  private async v3Get<T = Record<string, unknown>>(accessToken: string, path: string, payload: Record<string, unknown>): Promise<T | null> {
    const url = `https://openapi.zalo.me/v3.0/oa/${path}?data=${encodeURIComponent(JSON.stringify(payload))}`;
    return fetch(url, { headers: this.v3Headers(accessToken) })
      .then((r) => r.json().catch(() => null))
      .catch(() => null) as Promise<T | null>;
  }
  private v3Error(json: Record<string, unknown> | null): string | null {
    const errCode = Number(json?.error ?? json?.error_code ?? 0);
    if (errCode === 0 && json) return null;
    return `Zalo ${errCode}: ${json?.message ?? json?.error_message ?? 'lỗi không rõ'}`;
  }

  /** Gửi tin text — POST /v3.0/oa/message/cs */
  async sendText(account: { credentials?: string | null }, to: string, text: string): Promise<SendResult> {
    const cred = parseCredentials<{ accessToken?: string }>(account.credentials);
    if (!cred?.accessToken) return mockSendResult();
    const res = await fetch('https://openapi.zalo.me/v3.0/oa/message/cs', {
      method: 'POST',
      headers: this.v3Headers(cred.accessToken),
      body: JSON.stringify({ recipient: { user_id: to }, message: { text } }),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const err = this.v3Error(json);
    if (err) throw new Error(err);
    const data = json?.data as Record<string, unknown> | undefined;
    return { externalId: (data?.message_id as string) ?? undefined };
  }

  async fetchUserProfile(account: { credentials?: string | null; externalId: string }, externalUserId: string) {
    const cred = parseCredentials<{ accessToken?: string }>(account.credentials);
    if (!cred?.accessToken) return null;
    // v3: GET /v3.0/oa/user/detail?data={"user_id":"..."}
    const json = await this.v3Get(cred.accessToken, 'user/detail', { user_id: externalUserId });
    const data = json?.data as Record<string, unknown> | undefined;
    return {
      displayName: ((data?.display_name ?? data?.name) as string) ?? undefined,
      avatarUrl: (data?.avatar as string) ?? undefined,
    };
  }

  /** Kiểm tra token: ưu tiên getoa (lấy tên), fallback v3 getlist (chỉ xác nhận token sống) */
  async testConnection(credentials: Record<string, string>): Promise<TestConnectionResult> {
    if (!credentials.accessToken) return { ok: false, message: 'Chưa nhập OA Access Token' };
    try {
      // Thử v3 user/getlist trước (token mới chỉ chạy v3) — nếu có user nào thì lấy tên từ user/detail luôn
      const list = await this.v3Get(credentials.accessToken, 'user/getlist', { offset: 0, count: 1, is_follower: true });
      const err = this.v3Error(list);
      if (err) return { ok: false, message: `${err} (phản hồi: ${JSON.stringify(list).slice(0, 200)})` };
      const users = ((list?.data as { users?: { user_id?: string }[] })?.users ?? []);
      if (users[0]?.user_id) {
        const detail = await this.v3Get(credentials.accessToken, 'user/detail', { user_id: users[0].user_id });
        const d = detail?.data as Record<string, unknown> | undefined;
        return {
          ok: true,
          name: ((d?.display_name ?? d?.name) as string) ?? undefined,
          avatarUrl: (d?.avatar as string) ?? undefined,
          message: `Token hợp lệ (đã tương tác ${users.length >= 1 ? '≥1' : '0'} người)`,
        };
      }
      return { ok: true, message: 'Token hợp lệ — OA chưa có ai tương tác' };
    } catch (err) {
      return { ok: false, message: `Token không hợp lệ — ${(err as Error).message}` };
    }
  }

  /**
   * Làm mới access token bằng refresh token theo OAuth v4 của Zalo:
   * POST https://oauth.zaloapp.com/v4/oa/access_token
   * headers: Content-Type form-urlencoded + secret_key (ZALO_OA_APP_SECRET)
   * body: app_id, grant_type=refresh_token, refresh_token
   * Access token 25 giờ / refresh token 3 tháng (dùng 1 lần, mỗi lần làm mới trả cặp mới).
   * Cron 2h sáng mỗi ngày gọi để giữ token luôn sống.
   */
  async refreshCredentials(account: { credentials?: string | null }) {
    const cred = parseCredentials<{ accessToken?: string; refreshToken?: string; appId?: string; [k: string]: string | undefined }>(account.credentials);
    if (!cred?.refreshToken || !cred?.appId) {
      return { ok: false, message: 'Chưa có Refresh Token + App ID (tự có khi kết nối bằng "Đăng nhập Zalo cấp quyền")' };
    }
    const appSecret = process.env.ZALO_OA_APP_SECRET;
    if (!appSecret) return { ok: false, message: 'Server chưa cấu hình ZALO_OA_APP_SECRET (.env)' };

    const res = await fetch('https://oauth.zaloapp.com/v4/oa/access_token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', secret_key: appSecret },
      body: new URLSearchParams({
        app_id: cred.appId,
        grant_type: 'refresh_token',
        refresh_token: cred.refreshToken,
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      access_token?: string;
      refresh_token?: string;
      error?: number;
      error_description?: string;
      error_message?: string;
      data?: { access_token?: string; refresh_token?: string };
    };
    // Zalo trả token ở top-level hoặc bọc trong data (tuỳ phiên bản) — nhận cả hai
    const accessToken = json?.access_token ?? json?.data?.access_token;
    const newRefresh = json?.refresh_token ?? json?.data?.refresh_token;
    if (!accessToken) {
      return { ok: false, message: `Zalo từ chối làm mới token: ${json?.error_description ?? json?.error_message ?? json?.error ?? 'không rõ lỗi'}` };
    }
    const next: Record<string, string> = { ...cred, accessToken } as Record<string, string>;
    if (newRefresh) next.refreshToken = newRefresh; // refresh token cũ hết hiệu lực — thay bằng cái mới
    return { ok: true, message: 'Đã làm mới access token', credentials: next };
  }

  /** Gửi ảnh/video/file — v3 message/cs dạng template media với URL công khai (khỏi upload nhận token như v2) */
  async sendAttachment(
    account: { credentials?: string | null; externalId: string },
    to: string,
    att: { url: string; type: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE'; filename: string },
  ): Promise<SendResult> {
    const cred = parseCredentials<{ accessToken?: string }>(account.credentials);
    if (!cred?.accessToken) return mockSendResult();
    const mediaType = att.type === 'IMAGE' ? 'image' : att.type === 'VIDEO' ? 'video' : 'file';
    const res = await fetch('https://openapi.zalo.me/v3.0/oa/message/cs', {
      method: 'POST',
      headers: this.v3Headers(cred.accessToken),
      body: JSON.stringify({
        recipient: { user_id: to },
        message: {
          attachment: {
            type: 'template',
            payload: {
              template_type: 'media',
              elements: [{ media_type: mediaType, url: att.url }],
            },
          },
        },
      }),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    const err = this.v3Error(json);
    if (err) return { error: err };
    const data = json?.data as Record<string, unknown> | undefined;
    return { externalId: (data?.message_id as string) ?? undefined };
  }
}

/**
 * ⚠️ KÊNH KHÔNG CHÍNH THỨC — Zalo cá nhân qua "bridge" tự host.
 * Zalo KHÔNG có API chính thức cho tài khoản cá nhân. Bridge là service bên ngoài
 * (vd: thư viện reverse-engineer tự chạy) tự chịu rủi ro vi phạm ToS / bị khoá nick.
 * Bridge contract:
 *   POST {ZALO_PERSONAL_BRIDGE_URL}/send   header x-api-key
 *   body { userId, text } → { messageId? }
 *   Bridge nhận tin từ Zalo rồi POST về /webhooks/zalo-personal với payload đã chuẩn hoá.
 * Chưa cấu hình bridge = mock.
 */
@Injectable()
export class ZaloPersonalAdapter implements ChannelAdapter {
  private readonly logger = new Logger(ZaloPersonalAdapter.name);
  readonly type = 'ZALO_PERSONAL' as ChannelType;
  readonly label = CHANNEL_LABELS.ZALO_PERSONAL;

  async sendText(account: { credentials?: string | null }, to: string, text: string): Promise<SendResult> {
    const cred = parseCredentials<{ bridgeUrl?: string; apiKey?: string }>(account.credentials);
    const bridgeUrl = cred?.bridgeUrl ?? process.env.ZALO_PERSONAL_BRIDGE_URL;
    const apiKey = cred?.apiKey ?? process.env.ZALO_PERSONAL_BRIDGE_API_KEY;
    if (!bridgeUrl) {
      this.logger.warn('Zalo cá nhân: chưa cấu hình bridge → mock');
      return mockSendResult();
    }
    const json = await postJson(`${bridgeUrl.replace(/\/$/, '')}/send`, { userId: to, text }, {
      'x-api-key': apiKey ?? '',
    });
    return { externalId: (json?.messageId as string) ?? undefined };
  }

  /**
   * Kiểm tra bridge theo contract v2:
   *   GET {bridgeUrl}/status  header x-api-key → { connected: boolean, ... }
   * (Bridge cũ không có /status → coi như chưa xác nhận, vẫn cho lưu.)
   */
  async testConnection(credentials: Record<string, string>): Promise<TestConnectionResult> {
    const bridgeUrl = credentials.bridgeUrl ?? process.env.ZALO_PERSONAL_BRIDGE_URL;
    const apiKey = credentials.apiKey ?? process.env.ZALO_PERSONAL_BRIDGE_API_KEY;
    if (!bridgeUrl) return { ok: false, message: 'Chưa nhập Bridge URL' };
    try {
      const res = await fetch(`${bridgeUrl.replace(/\/$/, '')}/status`, { headers: { 'x-api-key': apiKey ?? '' } });
      if (!res.ok) return { ok: false, message: `Bridge trả HTTP ${res.status} — kiểm tra URL/API key` };
      const json = (await res.json().catch(() => ({}))) as { connected?: boolean };
      return {
        ok: true,
        message: json.connected
          ? 'Bridge đang kết nối Zalo (đã đăng nhập)'
          : 'Bridge trả lời được nhưng chưa đăng nhập Zalo — dùng mã QR để đăng nhập',
      };
    } catch (err) {
      return { ok: false, message: `Không gọi được bridge — ${(err as Error).message}` };
    }
  }
}

@Injectable()
export class TikTokAdapter implements ChannelAdapter {
  readonly type = 'TIKTOK' as ChannelType;
  readonly label = CHANNEL_LABELS.TIKTOK;
  readonly requiresApproval = true;

  async sendText(account: { credentials?: string | null }, to: string, text: string): Promise<SendResult> {
    const cred = parseCredentials<{ accessToken?: string }>(account.credentials);
    if (!cred?.accessToken) return mockSendResult();
    const json = await postJson('https://business-api.tiktok.com/v3/business/message/send', {
      recipient_id: to,
      message: { content_type: 'text', content: { text } },
    }, {
      Authorization: `Bearer ${cred.accessToken}`,
      'Content-Type': 'application/json',
    });
    const data = json?.data as Record<string, unknown> | undefined;
    return { externalId: (data?.message_id as string) ?? undefined };
  }

  async testConnection(credentials: Record<string, string>): Promise<TestConnectionResult> {
    if (!credentials.accessToken) return { ok: false, message: 'Chưa nhập Access Token' };
    // TikTok Business Messaging không có endpoint kiểm tra token công khai — chỉ xác nhận đã nhập
    return { ok: true, message: 'Đã nhận token — TikTok chỉ xác nhận thật khi có tin nhắn đầu tiên' };
  }
}

@Injectable()
export class ShopeeAdapter implements ChannelAdapter {
  private readonly logger = new Logger(ShopeeAdapter.name);
  readonly type = 'SHOPEE' as ChannelType;
  readonly label = CHANNEL_LABELS.SHOPEE;
  readonly requiresApproval = true;

  async sendText(account: { credentials?: string | null }, to: string, text: string): Promise<SendResult> {
    const cred = parseCredentials<{ baseUrl?: string; partnerId?: string; partnerKey?: string; shopId?: string }>(account.credentials);
    if (!cred?.baseUrl || !cred.partnerId || !cred.partnerKey || !cred.shopId) return mockSendResult();
    const base = cred.baseUrl.replace(/\/$/, '');

    const path = '/api/v1/messages/push_message';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      shop_id: Number(cred.shopId),
      to_id: to,
      message_type: 'text',
      content: { text },
    });
    // Chữ ký chuẩn Shopee v2: HMAC-SHA256(partnerKey, partnerId + path + timestamp + body)
    const sign = createHmac('sha256', cred.partnerKey).update(cred.partnerId + path + timestamp + body).digest('hex');
    const json = await postJson(`${base}${path}?partner_id=${cred.partnerId}&timestamp=${timestamp}&sign=${sign}`, body, {
      'Content-Type': 'application/json',
    });
    return { externalId: (json?.request_id as string) ?? undefined };
  }

  /** Kiểm tra chữ ký + shop: GET /api/v1/shop/get_shop_info (cùng cơ chế ký HMAC v2) */
  async testConnection(credentials: Record<string, string>): Promise<TestConnectionResult> {
    const { baseUrl, partnerId, partnerKey, shopId } = credentials;
    if (!baseUrl || !partnerId || !partnerKey || !shopId) {
      return { ok: false, message: 'Cần đủ Base URL, Partner ID, Partner Key, Shop ID' };
    }
    const base = baseUrl.replace(/\/$/, '');
    const path = '/api/v1/shop/get_shop_info';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({ shop_id: Number(shopId) });
    try {
      const sign = createHmac('sha256', partnerKey).update(partnerId + path + timestamp + body).digest('hex');
      const json = await postJson(`${base}${path}?partner_id=${partnerId}&timestamp=${timestamp}&sign=${sign}`, body, {
        'Content-Type': 'application/json',
      });
      const data = json?.data as Record<string, unknown> | undefined;
      if (!data) return { ok: false, message: `Shopee trả lỗi: ${JSON.stringify(json).slice(0, 200)}` };
      return {
        ok: true,
        name: (data.shop_name as string) ?? undefined,
        externalId: String(shopId),
        message: `Kết nối thành công: ${data.shop_name ?? shopId}`,
      };
    } catch (err) {
      return { ok: false, message: `Không kết nối được Shopee — ${(err as Error).message}` };
    }
  }
}

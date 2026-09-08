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
}

@Injectable()
export class ZaloOaAdapter implements ChannelAdapter {
  readonly type = 'ZALO_OA' as ChannelType;
  readonly label = CHANNEL_LABELS.ZALO_OA;

  async sendText(account: { credentials?: string | null }, to: string, text: string): Promise<SendResult> {
    const cred = parseCredentials<{ accessToken?: string }>(account.credentials);
    if (!cred?.accessToken) return mockSendResult();
    const json = await postJson(`https://openapi.zalo.me/v2.0/oa/message?access_token=${cred.accessToken}`, {
      recipient: { user_id: to },
      message: { text },
    });
    const errorCode = Number(json?.error_code ?? -1);
    if (errorCode !== 0) throw new Error(`Zalo OA error ${errorCode}: ${JSON.stringify(json).slice(0, 200)}`);
    const data = json?.data as Record<string, unknown> | undefined;
    return { externalId: (data?.message_id as string) ?? undefined };
  }

  async fetchUserProfile(account: { credentials?: string | null; externalId: string }, externalUserId: string) {
    const cred = parseCredentials<{ accessToken?: string }>(account.credentials);
    if (!cred?.accessToken) return null;
    const json = await postJson(`https://openapi.zalo.me/v2.0/oa/user?access_token=${cred.accessToken}`, {
      user_id: externalUserId,
    });
    const data = json?.data as Record<string, unknown> | undefined;
    return {
      displayName: (data?.display_name as string) ?? undefined,
      avatarUrl: (data?.avatar as string) ?? undefined,
    };
  }

  /** Kiểm tra OA Access Token: GET /v2.0/oa/getoa trả tên + oa_id → tự điền */
  async testConnection(credentials: Record<string, string>): Promise<TestConnectionResult> {
    if (!credentials.accessToken) return { ok: false, message: 'Chưa nhập OA Access Token' };
    try {
      const json = await getJson(`https://openapi.zalo.me/v2.0/oa/getoa?access_token=${credentials.accessToken}`);
      const data = json?.data as Record<string, unknown> | undefined;
      if (Number(json?.error_code ?? 0) !== 0 || !data) {
        return { ok: false, message: `Zalo từ chối token (error_code ${json?.error_code})` };
      }
      return {
        ok: true,
        name: (data.name as string) ?? undefined,
        avatarUrl: (data.avatar as string) ?? undefined,
        externalId: String(data.oa_id ?? ''),
        message: `Kết nối thành công: ${data.name ?? 'OA'}`,
      };
    } catch (err) {
      return { ok: false, message: `Token không hợp lệ — ${(err as Error).message}` };
    }
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

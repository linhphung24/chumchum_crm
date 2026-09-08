import type { ChannelType } from '../common/constants';

/** Thông điệp vào đã chuẩn hoá — mọi adapter/webhook đều convert về dạng này */
export interface NormalizedIncomingMessage {
  channelType: ChannelType;
  /** ID tài khoản kênh (OA id / Page id / Shop id); ZALO_PERSONAL dùng 'default' */
  accountExternalId: string;
  accountName?: string;
  externalUserId: string;
  userDisplayName?: string;
  userAvatarUrl?: string;
  text?: string;
  attachmentUrl?: string;
  attachmentType?: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE' | 'STICKER';
  externalMessageId?: string;
  timestamp?: Date;
}

export interface SendResult {
  externalId?: string;
  /** MOCKED = chưa kết nối thật (chưa có credentials) */
  mocked?: boolean;
  error?: string;
}

/** Kết quả kiểm tra kết nối (wizard Cài đặt → Kênh → "Kiểm tra kết nối") */
export interface TestConnectionResult {
  ok: boolean;
  /** Tên kênh lấy tự động từ nền tảng (tự điền vào form) */
  name?: string;
  avatarUrl?: string;
  /** externalId (Page id / OA id / Shop id) lấy tự động */
  externalId?: string;
  /** Thông điệp hiển thị cho người dùng khi không ok */
  message?: string;
}

/** Interface chuẩn mọi kênh phải cài đặt */
export interface ChannelAdapter {
  readonly type: ChannelType;
  readonly label: string;
  /** true nếu kênh cần xét duyệt riêng từ nhà cung cấp */
  readonly requiresApproval?: boolean;
  /** Gửi tin nhắn văn bản tới khách. credentials rỗng → mock tự động. */
  sendText(account: { credentials?: string | null }, toExternalUserId: string, text: string): Promise<SendResult>;
  /** Lấy profile khách (nếu kênh hỗ trợ) để làm giàu thông tin */
  fetchUserProfile?(
    account: { credentials?: string | null; externalId: string },
    externalUserId: string,
  ): Promise<{ displayName?: string; avatarUrl?: string } | null>;
  /** Kiểm tra credentials có hợp lệ không (gọi API nền tảng) — dùng cho wizard kết nối */
  testConnection?(credentials: Record<string, string>): Promise<TestConnectionResult>;
  /** Làm mới access token bằng refresh token (nếu kênh hỗ trợ) — trả về credentials mới để lưu */
  refreshCredentials?(account: { credentials?: string | null }): Promise<{
    ok: boolean;
    message: string;
    /** credentials đầy đủ sau khi làm mới (đã quay vòng refresh token nếu nhà cung cấp trả về) */
    credentials?: Record<string, string>;
  }>;
  /** Gửi file đính kèm (ảnh/video/file) tới khách. Không hỗ trợ → lưu nội bộ, status MOCKED. */
  sendAttachment?(
    account: { credentials?: string | null; externalId: string },
    toExternalUserId: string,
    attachment: { url: string; type: 'IMAGE' | 'VIDEO' | 'AUDIO' | 'FILE'; filename: string },
  ): Promise<SendResult>;
}

export function mockSendResult(): SendResult {
  return { externalId: `mock-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, mocked: true };
}

export async function postJson(url: string, body: unknown, headers?: Record<string, string>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(headers ?? {}) },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* một số API trả text thuần */
  }
  if (!res.ok) {
    const errMsg = typeof json === 'object' && json ? JSON.stringify(json).slice(0, 300) : text.slice(0, 300);
    throw new Error(`HTTP ${res.status}: ${errMsg}`);
  }
  return json as Record<string, unknown>;
}

export async function getJson(url: string) {
  const res = await fetch(url);
  const json = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${json ? JSON.stringify(json).slice(0, 300) : ''}`);
  }
  return json as Record<string, unknown>;
}

export function parseCredentials<T = Record<string, string>>(credentials?: string | null): T | null {
  if (!credentials) return null;
  try {
    return JSON.parse(credentials) as T;
  } catch {
    return null;
  }
}

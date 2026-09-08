// Hằng số dùng chung (string để tương thích SQLite)
export const CHANNEL_TYPES = ['ZALO_OA', 'ZALO_PERSONAL', 'FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'SHOPEE'] as const;
export type ChannelType = (typeof CHANNEL_TYPES)[number];

export const CHANNEL_LABELS: Record<ChannelType, string> = {
  ZALO_OA: 'Zalo OA',
  ZALO_PERSONAL: 'Zalo cá nhân',
  FACEBOOK: 'Messenger',
  INSTAGRAM: 'Instagram',
  TIKTOK: 'TikTok',
  SHOPEE: 'Shopee',
};

export const ROLES = ['ADMIN', 'MANAGER', 'STAFF'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Quản trị viên',
  MANAGER: 'Quản lý',
  STAFF: 'Nhân viên',
};

export const ORDER_STATUSES = ['NEW', 'CONFIRMED', 'SHIPPING', 'COMPLETED', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  NEW: 'Chờ duyệt',
  CONFIRMED: 'Đã duyệt',
  SHIPPING: 'Đang giao',
  COMPLETED: 'Hoàn tất',
  CANCELLED: 'Đã huỷ',
};

export const ORDER_SOURCES = ['CHAT', 'COMMENT', 'SHOPEE', 'MANUAL'] as const;

export const CONVERSATION_STATUSES = ['OPEN', 'PENDING', 'CLOSED'] as const;

export const COMMENT_STATUSES = ['NEW', 'HANDLED'] as const;

export function isChannelType(v: string): v is ChannelType {
  return (CHANNEL_TYPES as readonly string[]).includes(v);
}

export function isOrderStatus(v: string): v is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(v);
}

// Types mirror từ API

export type Role = 'ADMIN' | 'MANAGER' | 'STAFF';
export type ChannelType = 'ZALO_OA' | 'ZALO_PERSONAL' | 'FACEBOOK' | 'INSTAGRAM' | 'TIKTOK' | 'SHOPEE';
export type OrderStatus = 'NEW' | 'CONFIRMED' | 'SHIPPING' | 'COMPLETED' | 'CANCELLED';

export interface User {
  id: string;
  email: string;
  name: string;
  role: Role;
  isActive: boolean;
  createdAt: string;
}

export interface AuthPayload {
  accessToken: string;
  refreshToken: string;
  user: Omit<User, 'isActive' | 'createdAt'>;
}

export interface Customer {
  id: string;
  name: string;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  avatarUrl?: string | null;
  tags: string;
  note?: string | null;
  createdAt: string;
  updatedAt: string;
  _count?: { orders: number; conversations: number };
  tagsList?: string[];
  identities?: { id: string; displayName?: string | null; channelAccount: { id: string; type: ChannelType; name: string } }[];
  orders?: { id: string; code: string; status: OrderStatus; total: number; createdAt: string; sourceType?: string; sourceChannel?: string | null }[];
  conversations?: { id: string; lastMessageAt: string; channelAccount: { type: ChannelType; name: string } }[];
}

export interface Conversation {
  id: string;
  status: string;
  lastMessageAt: string;
  lastMessageText: string;
  lastDirection: 'IN' | 'OUT';
  unreadCount: number;
  customer: { id: string; name: string; phone?: string | null; avatarUrl?: string | null; tags: string };
  channelAccount: { id: string; type: ChannelType; name: string };
  assignedUser?: { id: string; name: string } | null;
}

export interface ConversationDetail extends Conversation {
  customer: Customer & {
    orders?: { id: string; code: string; status: OrderStatus; total: number; createdAt: string }[];
  };
}

export interface Message {
  id: string;
  conversationId: string;
  direction: 'IN' | 'OUT';
  type: string;
  text?: string | null;
  attachmentUrl?: string | null;
  status: string;
  createdAt: string;
}

export interface OrderItem {
  id?: string;
  productName: string;
  variant?: string | null;
  quantity: number;
  price: number;
}

export interface OrderEvent {
  id: string;
  fromStatus?: string | null;
  toStatus: string;
  note?: string | null;
  createdAt: string;
  user?: { id: string; name: string } | null;
}

export interface Order {
  id: string;
  code: string;
  status: OrderStatus;
  total: number;
  note?: string | null;
  shippingAddress?: string | null;
  shippingPhone?: string | null;
  sourceType: string;
  sourceChannel?: string | null;
  trelloCardId?: string | null;
  trelloCardUrl?: string | null;
  createdAt: string;
  updatedAt: string;
  customer: { id: string; name: string; phone?: string | null; avatarUrl?: string | null };
  createdBy?: { id: string; name: string } | null;
  items?: OrderItem[];
  events?: OrderEvent[];
}

export interface SocialComment {
  id: string;
  postId: string;
  postPermalink?: string | null;
  externalId: string;
  authorName: string;
  message: string;
  status: 'NEW' | 'HANDLED';
  replyText?: string | null;
  repliedAt?: string | null;
  createdAt: string;
  customer?: { id: string; name: string; phone?: string | null } | null;
  order?: { id: string; code: string; status: OrderStatus; total: number } | null;
}

export interface ChannelAccount {
  id: string;
  type: ChannelType;
  externalId: string;
  name: string;
  isActive: boolean;
  hasCredentials: boolean;
  createdAt: string;
  _count?: { conversations: number; identities: number };
}

export interface ChannelMeta {
  type: ChannelType;
  requiresApproval: boolean;
  envBridge?: boolean;
  /** true = môi trường dev/test (được hiện nút giả lập); production = false */
  devMode?: boolean;
}

export interface AnalyticsSummary {
  unanswered: number;
  ordersToday: number;
  revenue7d: number;
  newCustomers7d: number;
  totalOrders: number;
  completedRate: number;
}

export const CHANNEL_LABELS: Record<ChannelType, string> = {
  ZALO_OA: 'Zalo OA',
  ZALO_PERSONAL: 'Zalo CN',
  FACEBOOK: 'Messenger',
  INSTAGRAM: 'Instagram',
  TIKTOK: 'TikTok',
  SHOPEE: 'Shopee',
};

export const CHANNEL_EMOJI: Record<ChannelType, string> = {
  ZALO_OA: '💬',
  ZALO_PERSONAL: '📱',
  FACEBOOK: '📘',
  INSTAGRAM: '📸',
  TIKTOK: '🎵',
  SHOPEE: '🛍️',
};

export const CHANNEL_COLORS: Record<ChannelType, string> = {
  ZALO_OA: 'bg-sky-100 text-sky-700',
  ZALO_PERSONAL: 'bg-indigo-100 text-indigo-700',
  FACEBOOK: 'bg-blue-100 text-blue-700',
  INSTAGRAM: 'bg-pink-100 text-pink-700',
  TIKTOK: 'bg-neutral-200 text-neutral-800',
  SHOPEE: 'bg-orange-100 text-orange-700',
};

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  NEW: 'Chờ duyệt',
  CONFIRMED: 'Đã duyệt',
  SHIPPING: 'Đang giao',
  COMPLETED: 'Hoàn tất',
  CANCELLED: 'Đã huỷ',
};

export const ORDER_STATUS_CLASSES: Record<OrderStatus, string> = {
  NEW: 'bg-amber-100 text-amber-700',
  CONFIRMED: 'bg-sky-100 text-sky-700',
  SHIPPING: 'bg-violet-100 text-violet-700',
  COMPLETED: 'bg-emerald-100 text-emerald-700',
  CANCELLED: 'bg-neutral-200 text-neutral-600',
};

export const ORDER_STATUSES: OrderStatus[] = ['NEW', 'CONFIRMED', 'SHIPPING', 'COMPLETED', 'CANCELLED'];

export const ROLE_LABELS: Record<Role, string> = {
  ADMIN: 'Quản trị viên',
  MANAGER: 'Quản lý',
  STAFF: 'Nhân viên',
};

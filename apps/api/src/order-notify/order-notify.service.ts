import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InternalBusService } from '../realtime/internal-bus.service';
import { ChannelsService } from '../channels/channels.service';
import { ChannelIngestService } from '../channels/channel-ingest.service';
import { ORDER_STATUS_LABELS, ORDER_STATUSES, type OrderStatus } from '../common/constants';

export interface StatusNotifyConfig {
  enabled: boolean;
  template: string;
}

export interface OrderNotifySettings {
  enabled: boolean;
  shopName: string;
  statuses: Record<OrderStatus, StatusNotifyConfig>;
}

const PROVIDER = 'ORDER_NOTIFY';

/**
 * Nội dung mẫu mặc định — giọng điệu tiệm bánh, ấm áp (sửa được trong Cài đặt → Thông báo).
 * Biến: {{khach}} {{ma}} {{tong}} {{sanPham}} {{diaChi}} {{shop}}
 */
export const DEFAULT_TEMPLATES: Record<OrderStatus, string> = {
  NEW:
    '🧾 {{shop}} cảm ơn {{khach}} đã đặt hàng!\n' +
    'Đơn {{ma}} đã được ghi nhận 🎉\n' +
    '🧁 {{sanPham}}\n' +
    '💰 Tổng: {{tong}}\n' +
    'Mình sẽ xác nhận với bạn trong ít phút nha! 💕',
  CONFIRMED:
    '👩‍🍳 Đơn {{ma}} của {{khach}} đang được {{shop}} xử lý rồi nè!\n' +
    'Bánh được chuẩn bị tươi ngon để giao đến bạn 🧁✨\n' +
    'Có gì mình sẽ nhắn liền tại đây nha!',
  SHIPPING:
    '🚚 Đơn {{ma}} ĐANG TRÊN ĐƯỜNG tới {{khach}} rồi nè!\n' +
    '📍 Địa chỉ: {{diaChi}}\n' +
    '📦 Nội dung: {{sanPham}}\n' +
    'Bạn nhớ để ý điện thoại để shipper liên hệ nha! 🥰',
  COMPLETED:
    '✅ Đơn {{ma}} đã giao thành công!\n' +
    'Cảm ơn {{khach}} đã tin tưởng {{shop}} 💖\n' +
    'Nếu thấy ưng ý, cho mình xin đánh giá 5⭐ nhé! Hẹn gặp lại bạn lần sau~ 🌸',
  CANCELLED:
    '😢 Đơn {{ma}} đã được huỷ theo yêu cầu.\n' +
    'Nếu bạn đổi ý hay cần hỗ trợ gì, cứ nhắn lại đây — {{shop}} luôn sẵn lòng giúp bạn nha!',
};

/** Bật mặc định: đang xử lý + đang giao + hoàn thành (NEW/CANCELLED tắt để tránh spam) */
const DEFAULT_ENABLED: Record<OrderStatus, boolean> = {
  NEW: false,
  CONFIRMED: true,
  SHIPPING: true,
  COMPLETED: true,
  CANCELLED: false,
};

@Injectable()
export class OrderNotifyService implements OnModuleInit {
  private readonly logger = new Logger(OrderNotifyService.name);

  constructor(
    private prisma: PrismaService,
    private bus: InternalBusService,
    private channels: ChannelsService,
    private ingest: ChannelIngestService,
  ) {}

  onModuleInit() {
    // Chỉ bắn khi đơn ĐỔI trạng thái (OrdersService.setStatus) — không bắn khi tạo/sửa đơn
    this.bus.safeOn('order.status-changed', (orderId) => {
      void this.notifyIfConfigured(orderId);
    });
  }

  // ================= Settings =================

  defaultSettings(): OrderNotifySettings {
    return {
      enabled: false,
      shopName: process.env.SHOP_NAME ?? 'ChumChum Bakery',
      statuses: Object.fromEntries(
        ORDER_STATUSES.map((s) => [s, { enabled: DEFAULT_ENABLED[s], template: DEFAULT_TEMPLATES[s] }]),
      ) as Record<OrderStatus, StatusNotifyConfig>,
    };
  }

  async getSettings(): Promise<OrderNotifySettings> {
    const row = await this.prisma.integrationSetting.findUnique({ where: { provider: PROVIDER } });
    if (!row) return this.defaultSettings();
    const saved = JSON.parse(row.data) as Partial<OrderNotifySettings>;
    const defaults = this.defaultSettings();
    return {
      enabled: saved.enabled ?? false,
      shopName: saved.shopName || defaults.shopName,
      statuses: Object.fromEntries(
        ORDER_STATUSES.map((s) => [
          s,
          {
            enabled: saved.statuses?.[s]?.enabled ?? defaults.statuses[s].enabled,
            template: saved.statuses?.[s]?.template || defaults.statuses[s].template,
          },
        ]),
      ) as Record<OrderStatus, StatusNotifyConfig>,
    };
  }

  async saveSettings(input: Partial<OrderNotifySettings>): Promise<OrderNotifySettings> {
    const current = await this.getSettings();
    const next: OrderNotifySettings = {
      enabled: input.enabled ?? current.enabled,
      shopName: (input.shopName || current.shopName).trim(),
      statuses: Object.fromEntries(
        ORDER_STATUSES.map((s) => [
          s,
          {
            enabled: input.statuses?.[s]?.enabled ?? current.statuses[s].enabled,
            template: (input.statuses?.[s]?.template || current.statuses[s].template).trim(),
          },
        ]),
      ) as Record<OrderStatus, StatusNotifyConfig>,
    };
    await this.prisma.integrationSetting.upsert({
      where: { provider: PROVIDER },
      update: { data: JSON.stringify(next) },
      create: { provider: PROVIDER, data: JSON.stringify(next) },
    });
    return next;
  }

  // ================= Render + gửi =================

  /** Thay biến trong template bằng dữ liệu đơn. Biến lạ giữ nguyên để dễ nhận ra khi sửa. */
  render(template: string, order: {
    code: string;
    total: number;
    shippingAddress?: string | null;
    customer?: { name?: string | null; address?: string | null } | null;
    items?: { productName: string; variant?: string | null; quantity: number }[];
  }, shopName: string): string {
    const items = (order.items ?? [])
      .map((i) => `${i.productName}${i.variant ? ` (${i.variant})` : ''} x${i.quantity}`)
      .join(', ');
    const vars: Record<string, string> = {
      khach: order.customer?.name || 'bạn',
      ten: order.customer?.name || 'bạn',
      ma: order.code,
      tong: `${order.total.toLocaleString('vi-VN')}đ`,
      sanPham: items || '(xem chi tiết trong đơn)',
      diaChi: order.shippingAddress || order.customer?.address || '(địa chỉ đã lưu trong đơn)',
      shop: shopName,
    };
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (full, key: string) => vars[key] ?? full);
  }

  /** Xem trước nội dung sẽ gửi cho 1 đơn cụ thể (không gửi ra kênh) */
  async preview(orderId: string, status: OrderStatus) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true, items: true },
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng');
    const settings = await this.getSettings();
    const text = this.render(settings.statuses[status]?.template ?? '', order, settings.shopName);
    return { text, willSend: settings.enabled && (settings.statuses[status]?.enabled ?? false) };
  }

  /** Gửi thử thông báo thật cho 1 đơn (dùng nút "Gửi thử" trong Cài đặt) */
  async sendTest(orderId: string, status: OrderStatus) {
    const settings = await this.getSettings();
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true, items: true },
    });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng');
    const cfg = settings.statuses[status];
    if (!cfg) throw new NotFoundException('Trạng thái không hợp lệ');

    const conversations = await this.prisma.conversation.findMany({
      where: { customerId: order.customerId },
      orderBy: { lastMessageAt: 'desc' },
      include: { channelAccount: true },
    });
    const target = conversations.find((c) => c.channelAccount.type === order.sourceChannel) ?? conversations[0];
    if (!target) return { ok: false, message: 'Khách chưa có hội thoại nào — tạo hội thoại trước (khách nhắn tin hoặc bấm giả lập) rồi gửi thử lại' };

    const text = this.render(cfg.template, order, settings.shopName);
    const adapter = this.channels.getAdapter(target.channelAccount.type);
    const message = await this.ingest.sendOutgoing(target.id, text, null, adapter, target.channelAccount.externalId);
    return {
      ok: message?.status !== 'FAILED',
      message:
        message?.status === 'FAILED'
          ? 'Gửi ra kênh lỗi — kiểm tra kết nối kênh'
          : `Đã gửi thử qua ${target.channelAccount.name}${message?.status === 'MOCKED' ? ' (chế độ mock)' : ''}`,
      text,
    };
  }

  /** Bus order.status-changed → gửi thông báo nếu cấu hình cho phép */
  private async notifyIfConfigured(orderId: string) {
    try {
      const settings = await this.getSettings();
      if (!settings.enabled) return;

      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { customer: true, items: true, events: { orderBy: { createdAt: 'desc' }, take: 1 } },
      });
      if (!order) return;
      const toStatus = order.events[0]?.toStatus as OrderStatus | undefined;
      const fromStatus = order.events[0]?.fromStatus;
      if (!toStatus || fromStatus == null) return; // không phải chuyển trạng thái
      const cfg = settings.statuses[toStatus];
      if (!cfg?.enabled || !cfg.template.trim()) return;

      // Ưu tiên hội thoại cùng kênh nguồn của đơn; không có thì lấy hội thoại gần nhất của khách
      const conversations = await this.prisma.conversation.findMany({
        where: { customerId: order.customerId },
        orderBy: { lastMessageAt: 'desc' },
        include: { channelAccount: true },
      });
      const target =
        conversations.find((c) => c.channelAccount.type === order.sourceChannel) ?? conversations[0];
      if (!target) {
        this.logger.log(`Đơn ${order.code}: khách chưa có hội thoại nào → bỏ qua gửi thông báo`);
        return;
      }

      const text = this.render(cfg.template, order, settings.shopName);
      const adapter = this.channels.getAdapter(target.channelAccount.type);
      const message = await this.ingest.sendOutgoing(target.id, text, null, adapter, target.channelAccount.externalId);
      this.logger.log(
        `Đơn ${order.code} → ${ORDER_STATUS_LABELS[toStatus]}: đã gửi thông báo qua ${target.channelAccount.name}` +
          (message?.status === 'MOCKED' ? ' (mock)' : message?.status === 'FAILED' ? ' (LỖI GỬI)' : ''),
      );
    } catch (err) {
      this.logger.warn(`Gửi thông báo đơn ${orderId} lỗi: ${(err as Error).message}`);
    }
  }
}

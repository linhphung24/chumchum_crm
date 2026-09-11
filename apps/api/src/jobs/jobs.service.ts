import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { OrdersService } from '../orders/orders.service';
import { ChannelsService } from '../channels/channels.service';
import { EventsGateway } from '../realtime/events.gateway';
import { parseJson } from '../common/utils';
import { getJson } from '../channels/channel-adapter';
import { createHmac } from 'crypto';

/**
 * Background jobs:
 * 1) Đồng bộ đơn Shopee mỗi 30 phút (nếu đã cấu hình credentials)
 * 2) Làm mới access token Zalo OA mỗi ngày (cần Refresh Token + App ID) — tránh hết hạn 45 ngày
 * 3) Đồng bộ hội thoại Zalo OA mỗi 15 phút — staff trả lời trực tiếp trên app Zalo vẫn về kịp CRM
 * 4) Đồng bộ tin nhắn Messenger/Instagram/Zalo cá nhân mỗi giờ (tự động, chống trùng)
 * 5) Đồng bộ bạn bè Zalo cá nhân + làm giàu SĐT khách mỗi ngày 4h sáng
 * 6) Dọn webhook log cũ mỗi ngày
 */
@Injectable()
export class JobsService {
  private readonly logger = new Logger(JobsService.name);

  constructor(
    private prisma: PrismaService,
    private orders: OrdersService,
    private channels: ChannelsService,
    private events: EventsGateway,
  ) {}

  /** Đồng bộ Zalo OA: kéo tin mới nhất mỗi hội thoại về (chống trùng tự động) */
  @Cron('*/15 * * * *')
  async syncZaloOaChats() {
    const accounts = await this.prisma.channelAccount.findMany({ where: { type: 'ZALO_OA', isActive: true } });
    for (const account of accounts) {
      if (!account.credentials?.includes('accessToken')) continue;
      try {
        const r = await this.channels.syncZaloChats(account.id);
        if (r.created) this.logger.log(`Zalo OA (${account.name}): đồng bộ thêm ${r.created} tin mới`);
      } catch (err) {
        this.logger.warn(`Zalo OA (${account.name}) đồng bộ lỗi: ${(err as Error).message}`);
      }
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async refreshZaloOaTokens() {
    const accounts = await this.prisma.channelAccount.findMany({ where: { type: 'ZALO_OA', isActive: true } });
    for (const account of accounts) {
      if (!account.credentials?.includes('refreshToken')) continue; // chưa nhập refresh token → bỏ qua
      try {
        const r = await this.channels.refreshAccount(account.id);
        this.logger.log(`Zalo OA (${account.name}): ${r.ok ? '✅ ' + r.message : '⚠️ ' + r.message}`);
      } catch (err) {
        this.logger.warn(`Zalo OA (${account.name}) làm mới token lỗi: ${(err as Error).message}`);
      }
    }
  }

  /** Tự động đồng bộ tin cũ: Messenger, Instagram, Zalo cá nhân (bridge) mỗi giờ */
  @Cron(CronExpression.EVERY_HOUR)
  async syncOtherChats() {
    const accounts = await this.prisma.channelAccount.findMany({
      where: { type: { in: ['FACEBOOK', 'INSTAGRAM', 'ZALO_PERSONAL'] }, isActive: true },
    });
    for (const account of accounts) {
      if (!account.credentials) continue; // chưa kết nối thật → bỏ qua
      try {
        const r = await this.channels.syncChats(account.id);
        if (r.created) this.logger.log(`${account.name}: đồng bộ thêm ${r.created} tin cũ`);
      } catch (err) {
        this.logger.warn(`${account.name} đồng bộ tin cũ lỗi: ${(err as Error).message}`);
      }
    }
  }

  /** Đồng bộ bạn bè Zalo cá nhân (kèm SĐT làm giàu hồ sơ) mỗi ngày */
  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async syncZaloFriends() {
    const accounts = await this.prisma.channelAccount.findMany({ where: { type: 'ZALO_PERSONAL', isActive: true } });
    for (const account of accounts) {
      if (!account.credentials) continue;
      try {
        const r = await this.channels.syncZaloPersonalFriends(account.id);
        if (r.created) this.logger.log(`${account.name}: thêm ${r.created} bạn bè Zalo`);
      } catch (err) {
        this.logger.warn(`${account.name} đồng bộ bạn bè lỗi: ${(err as Error).message}`);
      }
    }
  }

  @Cron(CronExpression.EVERY_30_MINUTES)
  async syncShopeeOrders() {
    const accounts = await this.prisma.channelAccount.findMany({ where: { type: 'SHOPEE', isActive: true } });
    for (const account of accounts) {
      const cred = parseJson<{ baseUrl?: string; partnerId?: string; partnerKey?: string; shopId?: string }>(account.credentials);
      if (!cred?.baseUrl || !cred.partnerId || !cred.partnerKey || !cred.shopId) continue; // mock → bỏ qua
      try {
        await this.pullShopeeOrders(account.id, {
          baseUrl: cred.baseUrl,
          partnerId: cred.partnerId,
          partnerKey: cred.partnerKey,
          shopId: cred.shopId,
        });
      } catch (err) {
        this.logger.warn(`Đồng bộ Shopee (${account.name}) lỗi: ${(err as Error).message}`);
      }
    }
  }

  private async pullShopeeOrders(
    accountId: string,
    cred: { baseUrl: string; partnerId: string; partnerKey: string; shopId: string },
  ) {
    const base = cred.baseUrl.replace(/\/$/, '');
    const path = '/api/v2/order/get_order_list';
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const body = JSON.stringify({
      page_size: 50,
      time_range_field: 'create_time',
      time_from: Math.floor(Date.now() / 1000) - 7 * 24 * 3600,
      time_to: Math.floor(Date.now() / 1000),
      order_status: 'ALL',
    });
    const sign = createHmac('sha256', cred.partnerKey)
      .update(cred.partnerId + path + timestamp + '' + cred.shopId + body)
      .digest('hex');
    const url = `${base}${path}?partner_id=${cred.partnerId}&shop_id=${cred.shopId}&timestamp=${timestamp}&sign=${sign}`;
    const json = (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).then((r) => r.json())) as {
      response?: { order_list?: ShopeeOrder[] };
    };
    const list = json?.response?.order_list ?? [];
    let created = 0;
    for (const o of list) {
      const exists = await this.prisma.order.findFirst({ where: { externalOrderId: o.order_sn } });
      if (exists) continue;
      // Tìm/tạo khách theo danh tính Shopee
      const identity = await this.prisma.channelIdentity.findUnique({
        where: { channelAccountId_externalUserId: { channelAccountId: accountId, externalUserId: String(o.buyer_user_id ?? o.order_sn) } },
      });
      let customerId = identity?.customerId;
      if (!customerId) {
        const customer = await this.prisma.customer.create({ data: { name: o.buyer_username ?? `Khách Shopee ${o.order_sn}` } });
        await this.prisma.channelIdentity.create({
          data: {
            customerId: customer.id,
            channelAccountId: accountId,
            externalUserId: String(o.buyer_user_id ?? o.order_sn),
            displayName: o.buyer_username ?? null,
          },
        });
        customerId = customer.id;
      }
      const order = await this.orders.create({
        customerId,
        items: [{ productName: o.item_list?.[0]?.item_name ?? 'Đơn Shopee', quantity: 1, price: Math.round((o.total_amount ?? 0) / 100000) }],
        sourceType: 'SHOPEE',
        sourceChannel: 'SHOPEE',
      });
      await this.orders.setExternalId(order.id, o.order_sn);
      created++;
    }
    if (created) this.logger.log(`Shopee: đồng bộ thêm ${created} đơn mới`);
  }

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async cleanupWebhookLogs() {
    const days = 14;
    const cutoff = new Date(Date.now() - days * 24 * 3600_000);
    const res = await this.prisma.webhookLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
    if (res.count) this.logger.log(`Đã dọn ${res.count} webhook log cũ`);
  }
}

interface ShopeeOrder {
  order_sn: string;
  order_status?: string;
  buyer_user_id?: number | string;
  buyer_username?: string;
  total_amount?: number;
  item_list?: { item_name?: string }[];
}

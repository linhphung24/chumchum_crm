import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { InternalBusService } from '../realtime/internal-bus.service';
import { OrdersService } from '../orders/orders.service';
import { ORDER_STATUS_LABELS, ORDER_STATUSES, type OrderStatus } from '../common/constants';
import { getJson, postJson } from '../channels/channel-adapter';

export interface TrelloSettings {
  apiKey?: string;
  token?: string;
  boardId?: string;
  /** status → list id */
  listMap: Partial<Record<OrderStatus, string>>;
}

const PROVIDER = 'TRELLO';

@Injectable()
export class TrelloService implements OnModuleInit {
  private readonly logger = new Logger(TrelloService.name);

  constructor(
    private prisma: PrismaService,
    private bus: InternalBusService,
    private orders: OrdersService,
  ) {}

  onModuleInit() {
    this.bus.safeOn('order.changed', (orderId) => this.syncOrder(orderId));
  }

  // ---------- Settings ----------

  async getSettings(): Promise<TrelloSettings & { connected: boolean }> {
    const row = await this.prisma.integrationSetting.findUnique({ where: { provider: PROVIDER } });
    const parsed = (row?.data ? JSON.parse(row.data) : {}) as TrelloSettings;
    const connected = !!(parsed.apiKey && parsed.token && parsed.boardId);
    return { ...parsed, listMap: parsed.listMap ?? {}, connected };
  }

  async saveSettings(input: Partial<TrelloSettings>): Promise<TrelloSettings & { connected: boolean }> {
    const current = await this.getSettings();
    const next: TrelloSettings = {
      apiKey: input.apiKey || current.apiKey,
      token: input.token || current.token,
      boardId: input.boardId || current.boardId,
      listMap: { ...current.listMap, ...(input.listMap ?? {}) },
    };
    await this.prisma.integrationSetting.upsert({
      where: { provider: PROVIDER },
      update: { data: JSON.stringify(next) },
      create: { provider: PROVIDER, data: JSON.stringify(next) },
    });
    return { ...next, connected: !!(next.apiKey && next.token && next.boardId) };
  }

  private async requireSettings(): Promise<Required<Pick<TrelloSettings, 'apiKey' | 'token'>> & TrelloSettings> {
    const s = await this.getSettings();
    if (!s.apiKey || !s.token) throw new Error('Chưa cấu hình Trello API key/token trong Cài đặt');
    return s as Required<Pick<TrelloSettings, 'apiKey' | 'token'>> & TrelloSettings;
  }

  // ---------- API helpers ----------

  private authQuery(s: { apiKey?: string; token?: string }): string {
    return `key=${s.apiKey}&token=${s.token}`;
  }

  /** Danh sách board + lists của board đã chọn (để chọn trong UI) */
  async listBoards() {
    const s = await this.requireSettings();
    const boards = (await getJson(`https://api.trello.com/1/members/me/boards?${this.authQuery(s)}&fields=name`)) as unknown as {
      id: string;
      name: string;
    }[];
    const boardId = s.boardId ?? boards[0]?.id;
    const lists = boardId
      ? ((await getJson(`https://api.trello.com/1/boards/${boardId}/lists?${this.authQuery(s)}&fields=name`)) as unknown as {
          id: string;
          name: string;
        }[])
      : [];
    return { boards, boardId, lists };
  }

  /** Đăng ký webhook Trello → callbackUrl (URL public của server) */
  async registerWebhook(callbackUrl: string) {
    const s = await this.requireSettings();
    if (!s.boardId) throw new Error('Chưa chọn board');
    const json = await postJson(`https://api.trello.com/1/webhooks?${this.authQuery(s)}`, {
      callbackURL: callbackUrl,
      idModel: s.boardId,
      description: 'ChumChum CRM — đồng bộ đơn hàng',
    });
    return { ok: true, webhook: json };
  }

  // ---------- Đồng bộ đơn → card ----------

  async syncOrder(orderId: string) {
    try {
      const s = await this.getSettings();
      if (!s.connected || !s.apiKey || !s.token) return; // chưa bật Trello
      const order = await this.prisma.order.findUnique({
        where: { id: orderId },
        include: { customer: true, items: true },
      });
      if (!order) return;

      const listId = s.listMap?.[order.status as OrderStatus];
      if (!listId) return; // trạng thái này chưa map list

      const name = `${order.code} — ${order.customer?.name ?? ''} (${(order.total / 1000).toFixed(0)}k)`;
      const desc = [
        `Khách: ${order.customer?.name ?? ''}`,
        `SĐT: ${order.customer?.phone ?? order.shippingPhone ?? ''}`,
        `Địa chỉ: ${order.shippingAddress ?? order.customer?.address ?? ''}`,
        `Trạng thái: ${ORDER_STATUS_LABELS[order.status as OrderStatus] ?? order.status}`,
        `Sản phẩm:`,
        ...order.items.map((i) => `- ${i.productName}${i.variant ? ` (${i.variant})` : ''} x${i.quantity} = ${(i.price * i.quantity).toLocaleString('vi-VN')}đ`),
        order.note ? `Ghi chú: ${order.note}` : '',
      ]
        .filter(Boolean)
        .join('\n');

      if (order.trelloCardId) {
        // Di chuyển card sang list tương ứng
        await fetch(
          `https://api.trello.com/1/cards/${order.trelloCardId}?${this.authQuery(s)}&idList=${listId}&name=${encodeURIComponent(name)}&desc=${encodeURIComponent(desc)}`,
          { method: 'PUT' },
        );
      } else {
        const card = (await postJson(
          `https://api.trello.com/1/cards?${this.authQuery(s)}&idList=${listId}`,
          { name, desc },
        )) as unknown as { id: string; url: string; shortUrl?: string };
        await this.orders.setTrello(order.id, card.id, card.shortUrl ?? card.url);
      }
    } catch (err) {
      this.logger.warn(`Đồng bộ Trello đơn ${orderId} lỗi: ${(err as Error).message}`);
    }
  }

  /** Webhook từ Trello: card được kéo sang list khác → cập nhật lại trạng thái đơn */
  async handleWebhook(body: TrelloWebhookBody) {
    const actionType = body?.action?.type;
    const cardId = body?.action?.data?.card?.id;
    const listAfterId = body?.action?.data?.listAfter?.id;
    if (actionType !== 'updateCard' || !cardId || !listAfterId) return { ok: true, ignored: true };

    const s = await this.getSettings();
    const reverseMap: Record<string, OrderStatus> = {};
    for (const status of ORDER_STATUSES) {
      const mapped = s.listMap?.[status];
      if (mapped) reverseMap[mapped] = status;
    }
    const newStatus = reverseMap[listAfterId];
    if (!newStatus) return { ok: true, ignored: true };

    const order = await this.orders.findByTrelloCard(cardId);
    if (!order || order.status === newStatus) return { ok: true, ignored: true };
    await this.orders.setStatus(order.id, newStatus, 'Đồng bộ từ Trello', null);
    return { ok: true, updated: true };
  }

  async forceSyncOrder(orderId: string) {
    await this.syncOrder(orderId);
    return this.orders.detail(orderId);
  }
}

interface TrelloWebhookBody {
  action?: {
    type?: string;
    data?: {
      card?: { id?: string };
      listAfter?: { id?: string };
    };
  };
}

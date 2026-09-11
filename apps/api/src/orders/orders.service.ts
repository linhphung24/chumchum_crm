import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EventsGateway } from '../realtime/events.gateway';
import { InternalBusService } from '../realtime/internal-bus.service';
import { isOrderStatus, ORDER_SOURCES, type OrderStatus } from '../common/constants';

export interface OrderItemInput {
  productName: string;
  variant?: string;
  quantity: number;
  price: number;
}

export interface CreateOrderInput {
  customerId: string;
  items: OrderItemInput[];
  shippingAddress?: string;
  shippingPhone?: string;
  note?: string;
  sourceType?: string;
  sourceChannel?: string;
  createdById?: string;
}

const ORDER_INCLUDE = {
  customer: { select: { id: true, name: true, phone: true, avatarUrl: true, address: true } },
  items: true,
  events: {
    orderBy: { createdAt: 'asc' as const },
    include: { user: { select: { id: true, name: true } } },
  },
  createdBy: { select: { id: true, name: true } },
};

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService,
    private events: EventsGateway,
    private bus: InternalBusService,
  ) {}

  async nextCode(): Promise<string> {
    const count = await this.prisma.order.count();
    return `DH-${1001 + count}`;
  }

  list(opts: { status?: string; sourceChannel?: string; q?: string; from?: string; to?: string }) {
    const fromDate = opts.from ? new Date(opts.from) : null;
    const toDate = opts.to ? new Date(`${opts.to}T23:59:59`) : null;
    return this.prisma.order.findMany({
      where: {
        AND: [
          opts.status ? { status: opts.status } : {},
          opts.sourceChannel ? { sourceChannel: opts.sourceChannel } : {},
          opts.q
            ? {
                OR: [
                  { code: { contains: opts.q } },
                  { customer: { name: { contains: opts.q } } },
                  { customer: { phone: { contains: opts.q } } },
                ],
              }
            : {},
          fromDate || toDate
            ? { createdAt: { ...(fromDate ? { gte: fromDate } : {}), ...(toDate ? { lte: toDate } : {}) } }
            : {},
        ],
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
      include: {
        customer: { select: { id: true, name: true, phone: true, avatarUrl: true } },
        createdBy: { select: { id: true, name: true } },
        items: true,
      },
    });
  }

  async detail(id: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: ORDER_INCLUDE });
    if (!order) throw new NotFoundException('Không tìm thấy đơn hàng');
    return order;
  }

  async create(input: CreateOrderInput) {
    if (!input.items?.length) throw new BadRequestException('Đơn cần ít nhất 1 sản phẩm');
    const total = input.items.reduce((s, i) => s + i.price * i.quantity, 0);
    const order = await this.prisma.order.create({
      data: {
        code: await this.nextCode(),
        customerId: input.customerId,
        total,
        shippingAddress: input.shippingAddress,
        shippingPhone: input.shippingPhone,
        note: input.note,
        sourceType: ORDER_SOURCES.includes(input.sourceType as never) ? input.sourceType ?? 'MANUAL' : 'MANUAL',
        sourceChannel: input.sourceChannel,
        createdById: input.createdById,
        items: { create: input.items },
        events: { create: { toStatus: 'NEW', createdById: input.createdById ?? null } },
      },
      include: ORDER_INCLUDE,
    });
    this.events.emitOrderUpdated({ order });
    this.bus.emitOrderChanged(order.id);
    return order;
  }

  async update(
    id: string,
    input: {
      shippingAddress?: string;
      shippingPhone?: string;
      note?: string;
      items?: OrderItemInput[];
    },
  ) {
    await this.ensure(id);
    const data: Record<string, unknown> = {};
    if (input.shippingAddress !== undefined) data.shippingAddress = input.shippingAddress;
    if (input.shippingPhone !== undefined) data.shippingPhone = input.shippingPhone;
    if (input.note !== undefined) data.note = input.note;
    if (input.items?.length) {
      data.items = { deleteMany: {}, create: input.items };
      data.total = input.items.reduce((s, i) => s + i.price * i.quantity, 0);
    }
    const order = await this.prisma.order.update({ where: { id }, data, include: ORDER_INCLUDE });
    this.events.emitOrderUpdated({ order });
    this.bus.emitOrderChanged(order.id);
    return order;
  }

  async setStatus(id: string, status: string, note: string | null, userId: string | null) {
    if (!isOrderStatus(status)) throw new BadRequestException('Trạng thái không hợp lệ');
    const current = await this.ensure(id);
    if (current.status === status) return this.detail(id);
    const order = await this.prisma.order.update({
      where: { id },
      data: {
        status,
        events: { create: { fromStatus: current.status, toStatus: status, note, createdById: userId } },
      },
      include: ORDER_INCLUDE,
    });
    this.events.emitOrderUpdated({ order });
    this.bus.emitOrderChanged(order.id);
    this.bus.emitOrderStatusChanged(order.id);
    return order;
  }

  async setTrello(id: string, cardId: string, cardUrl: string | null) {
    await this.prisma.order.update({ where: { id }, data: { trelloCardId: cardId, trelloCardUrl: cardUrl } });
  }

  async findByTrelloCard(cardId: string) {
    return this.prisma.order.findFirst({ where: { trelloCardId: cardId } });
  }

  async setExternalId(id: string, externalOrderId: string) {
    await this.prisma.order.update({ where: { id }, data: { externalOrderId } });
  }

  private async ensure(id: string): Promise<{ id: string; status: string }> {
    const found = await this.prisma.order.findUnique({ where: { id }, select: { id: true, status: true } });
    if (!found) throw new NotFoundException('Không tìm thấy đơn hàng');
    return found;
  }
}

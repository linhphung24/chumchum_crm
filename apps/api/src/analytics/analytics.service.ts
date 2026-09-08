import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CHANNEL_TYPES, ORDER_STATUSES, type OrderStatus } from '../common/constants';

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  /** Số liệu dashboard chính */
  async summary() {
    const now = new Date();
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const weekAgo = new Date(now.getTime() - 7 * 24 * 3600_000);

    const [unanswered, ordersToday, revenueAgg, newCustomers, totalOrders, completedOrders] = await Promise.all([
      // Hội thoại tin cuối đến từ khách mà chưa trả lời
      this.prisma.conversation.count({ where: { lastDirection: 'IN' } }),
      this.prisma.order.count({ where: { createdAt: { gte: startToday } } }),
      this.prisma.order.aggregate({
        where: { createdAt: { gte: weekAgo }, status: { not: 'CANCELLED' } },
        _sum: { total: true },
      }),
      this.prisma.customer.count({ where: { createdAt: { gte: weekAgo } } }),
      this.prisma.order.count(),
      this.prisma.order.count({ where: { status: 'COMPLETED' } }),
    ]);

    return {
      unanswered,
      ordersToday,
      revenue7d: revenueAgg._sum.total ?? 0,
      newCustomers7d: newCustomers,
      totalOrders,
      completedRate: totalOrders ? Math.round((completedOrders / totalOrders) * 100) : 0,
    };
  }

  /** Doanh thu theo ngày (mặc định 14 ngày) */
  async revenueByDay(days = 14) {
    const from = new Date(Date.now() - (days - 1) * 24 * 3600_000);
    from.setHours(0, 0, 0, 0);
    const orders = await this.prisma.order.findMany({
      where: { createdAt: { gte: from }, status: { not: 'CANCELLED' } },
      select: { createdAt: true, total: true },
    });
    const buckets = new Map<string, number>();
    for (let i = 0; i < days; i++) {
      const d = new Date(from.getTime() + i * 24 * 3600_000);
      buckets.set(this.key(d), 0);
    }
    for (const o of orders) {
      const k = this.key(o.createdAt);
      if (buckets.has(k)) buckets.set(k, (buckets.get(k) ?? 0) + o.total);
    }
    return [...buckets.entries()].map(([date, total]) => ({ date, total }));
  }

  /** Đơn + doanh thu theo kênh */
  async ordersByChannel() {
    const rows = await this.prisma.order.groupBy({
      by: ['sourceChannel'],
      _count: { _all: true },
      _sum: { total: true },
    });
    const totals = rows.reduce((s, r) => s + r._count._all, 0) || 1;
    return rows
      .map((r) => ({
        channel: r.sourceChannel ?? 'KHÁC',
        count: r._count._all,
        total: r._sum.total ?? 0,
        percent: Math.round((r._count._all / totals) * 100),
      }))
      .sort((a, b) => b.count - a.count);
  }

  /** Số lượng tin nhắn theo kênh */
  async messagesByChannel(days = 30) {
    const from = new Date(Date.now() - days * 24 * 3600_000);
    const messages = await this.prisma.message.findMany({
      where: { createdAt: { gte: from } },
      include: { conversation: { include: { channelAccount: { select: { type: true } } } } },
    });
    const counter = new Map<string, number>();
    for (const m of messages) {
      const t = m.conversation.channelAccount.type;
      counter.set(t, (counter.get(t) ?? 0) + 1);
    }
    return [...counter.entries()].map(([channel, count]) => ({ channel, count })).sort((a, b) => b.count - a.count);
  }

  async ordersByStatus() {
    const rows = await this.prisma.order.groupBy({
      by: ['status'],
      _count: { _all: true },
    });
    const map = Object.fromEntries(
      ORDER_STATUSES.map((s) => [s, 0]),
    ) as Record<OrderStatus, number>;
    for (const r of rows) map[r.status as OrderStatus] = r._count._all;
    return map;
  }

  /** Hiệu suất nhân viên theo đơn đã tạo / hoàn tất */
  async staffPerformance() {
    const users = await this.prisma.user.findMany({ select: { id: true, name: true } });
    const rows = await this.prisma.order.groupBy({
      by: ['createdById', 'status'],
      _count: { _all: true },
      _sum: { total: true },
    });
    const agg = new Map<string, { created: number; completed: number; revenue: number }>();
    for (const r of rows) {
      if (!r.createdById) continue;
      const cur = agg.get(r.createdById) ?? { created: 0, completed: 0, revenue: 0 };
      cur.created += r._count._all;
      if (r.status === 'COMPLETED') {
        cur.completed += r._count._all;
        cur.revenue += r._sum.total ?? 0;
      }
      agg.set(r.createdById, cur);
    }
    return users.map((u) => ({ userId: u.id, name: u.name, ...(agg.get(u.id) ?? { created: 0, completed: 0, revenue: 0 }) }));
  }

  private key(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
}

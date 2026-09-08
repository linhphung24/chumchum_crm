import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { parseTags } from '../common/utils';

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  list(opts: { q?: string; tag?: string; take?: number; skip?: number }) {
    const q = opts.q?.trim();
    return this.prisma.customer.findMany({
      where: {
        AND: [
          q
            ? {
                OR: [{ name: { contains: q } }, { phone: { contains: q } }, { email: { contains: q } }],
              }
            : {},
          opts.tag ? { tags: { contains: opts.tag } } : {},
        ],
      },
      orderBy: { updatedAt: 'desc' },
      take: Math.min(opts.take ?? 50, 200),
      skip: opts.skip ?? 0,
      include: {
        _count: { select: { orders: true, conversations: true } },
      },
    });
  }

  async detail(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      include: {
        identities: {
          include: { channelAccount: { select: { id: true, type: true, name: true } } },
        },
        orders: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          select: { id: true, code: true, status: true, total: true, createdAt: true, sourceType: true, sourceChannel: true },
        },
        conversations: {
          orderBy: { lastMessageAt: 'desc' },
          include: { channelAccount: { select: { type: true, name: true } } },
        },
      },
    });
    if (!customer) throw new NotFoundException('Không tìm thấy khách hàng');
    return { ...customer, tagsList: parseTags(customer.tags) };
  }

  create(data: { name: string; phone?: string; email?: string; address?: string; tags?: string; note?: string }) {
    return this.prisma.customer.create({ data });
  }

  async update(id: string, data: { name?: string; phone?: string; email?: string; address?: string; tags?: string; note?: string }) {
    await this.ensureExists(id);
    return this.prisma.customer.update({ where: { id }, data });
  }

  async remove(id: string) {
    await this.ensureExists(id);
    await this.prisma.customer.delete({ where: { id } });
    return { ok: true };
  }

  private async ensureExists(id: string) {
    const found = await this.prisma.customer.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Không tìm thấy khách hàng');
  }
}

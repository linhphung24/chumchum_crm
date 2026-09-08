import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { FacebookAdapter } from '../channels/adapters';
import { OrdersService } from '../orders/orders.service';
import type { OrderItemInput } from '../orders/orders.service';

@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    private prisma: PrismaService,
    private facebook: FacebookAdapter,
    private orders: OrdersService,
  ) {}

  list(opts: { status?: string; q?: string }) {
    return this.prisma.socialComment.findMany({
      where: {
        AND: [opts.status ? { status: opts.status } : {}, opts.q ? { message: { contains: opts.q } } : {}],
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        order: { select: { id: true, code: true, status: true, total: true } },
      },
    });
  }

  /** Trả lời comment ngay trên bài Facebook (hoặc mock nếu chưa kết nối) */
  async reply(id: string, message: string) {
    const comment = await this.ensure(id);
    const account = await this.prisma.channelAccount.findUnique({
      where: { id: comment.channelAccountId },
    });
    let mocked = false;
    try {
      const result = await this.facebook.replyComment(account ?? {}, comment.externalId, message);
      mocked = !!result.mocked;
    } catch (err) {
      this.logger.warn(`Trả lời comment lỗi: ${(err as Error).message}`);
      throw new BadRequestException(`Không gửi được lên Facebook: ${(err as Error).message}`);
    }
    return this.prisma.socialComment.update({
      where: { id },
      data: { replyText: message, repliedAt: new Date() },
    }).then((c) => ({ ...c, mocked }));
  }

  async markHandled(id: string) {
    await this.ensure(id);
    return this.prisma.socialComment.update({ where: { id }, data: { status: 'HANDLED' } });
  }

  /** Chuyển comment thành đơn hàng: tìm/tạo khách + tạo đơn nguồn COMMENT */
  async convert(
    id: string,
    input: {
      items: OrderItemInput[];
      shippingAddress?: string;
      shippingPhone?: string;
      createdById: string;
    },
    existingCustomerId?: string,
  ) {
    const comment = await this.ensure(id);

    let customerId = existingCustomerId ?? comment.customerId ?? null;
    if (!customerId) {
      const account = await this.prisma.channelAccount.findUnique({ where: { id: comment.channelAccountId } });
      // Tìm khách theo danh tính FB, không có thì tạo mới
      const identity = account
        ? await this.prisma.channelIdentity.findUnique({
            where: { channelAccountId_externalUserId: { channelAccountId: account.id, externalUserId: comment.authorExternalId } },
          })
        : null;
      if (identity) {
        customerId = identity.customerId;
      } else {
        const customer = await this.prisma.customer.create({ data: { name: comment.authorName } });
        if (account) {
          await this.prisma.channelIdentity.create({
            data: {
              customerId: customer.id,
              channelAccountId: account.id,
              externalUserId: comment.authorExternalId,
              displayName: comment.authorName,
            },
          });
        }
        customerId = customer.id;
      }
    }

    const order = await this.orders.create({
      customerId,
      items: input.items,
      shippingAddress: input.shippingAddress,
      shippingPhone: input.shippingPhone,
      sourceType: 'COMMENT',
      sourceChannel: 'FACEBOOK',
      createdById: input.createdById,
    });

    const updated = await this.prisma.socialComment.update({
      where: { id },
      data: { status: 'HANDLED', customerId, orderId: order.id },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        order: { select: { id: true, code: true, status: true, total: true } },
      },
    });
    return { comment: updated, order };
  }

  private async ensure(id: string) {
    const found = await this.prisma.socialComment.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Không tìm thấy bình luận');
    return found;
  }
}

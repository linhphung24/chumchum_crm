import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter } from 'events';

/**
 * Event bus nội bộ (process-level) — tách rời các module:
 * OrdersService bắn 'order.changed', TrelloService nghe để đồng bộ card...
 */
@Injectable()
export class InternalBusService extends EventEmitter {
  private readonly logger = new Logger(InternalBusService.name);

  emitOrderChanged(orderId: string) {
    this.emit('order.changed', orderId);
  }

  /**
   * Chỉ bắn khi đơn ĐỔI TRẠNG THÁI (không bắn khi tạo/sửa thông tin đơn).
   * OrderNotifyService nghe sự kiện này để gửi tin thông báo cho khách —
   * tách riêng với 'order.changed' (Trello nghe) để tránh gửi trùng khi sửa đơn.
   */
  emitOrderStatusChanged(orderId: string) {
    this.emit('order.status-changed', orderId);
  }

  safeOn(event: string, handler: (payload: string) => void) {
    this.on(event, async (payload: string) => {
      try {
        await handler(payload);
      } catch (err) {
        this.logger.error(`Lỗi xử lý sự kiện ${event}: ${(err as Error).message}`);
      }
    });
  }
}

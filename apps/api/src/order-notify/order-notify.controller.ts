import { Body, Controller, Get, Param, Post, Put, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsObject, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/decorators';
import { isOrderStatus, type OrderStatus } from '../common/constants';
import { OrderNotifyService } from './order-notify.service';
import type { OrderNotifySettings, StatusNotifyConfig } from './order-notify.service';

export class SaveNotifyDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  shopName?: string;

  @IsOptional()
  @IsObject()
  statuses?: Record<string, StatusNotifyConfig>;
}

@Controller('order-notify')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrderNotifyController {
  constructor(private notify: OrderNotifyService) {}

  @Get('settings')
  settings() {
    return this.notify.getSettings();
  }

  @Put('settings')
  @Roles('ADMIN', 'MANAGER')
  save(@Body() dto: SaveNotifyDto) {
    return this.notify.saveSettings(dto as Partial<OrderNotifySettings>);
  }

  /** Xem trước nội dung thông báo cho 1 đơn (không gửi). ?send=1 để gửi thử thật */
  @Post('test/:orderId')
  test(@Param('orderId') orderId: string, @Query('status') status: string, @Query('send') send?: string) {
    if (!isOrderStatus(status ?? '')) return { error: 'Thiếu ?status= hợp lệ (NEW/CONFIRMED/SHIPPING/COMPLETED/CANCELLED)' };
    const st = status as OrderStatus;
    if (send === '1') {
      return this.notify.sendTest(orderId, st);
    }
    return this.notify.preview(orderId, st);
  }
}

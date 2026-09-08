import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
@UseGuards(JwtAuthGuard, RolesGuard)
export class AnalyticsController {
  constructor(private analytics: AnalyticsService) {}

  @Get('summary')
  summary() {
    return this.analytics.summary();
  }

  @Get('revenue')
  revenue(@Query('days') days?: string) {
    return this.analytics.revenueByDay(Math.min(Number(days ?? 14) || 14, 90));
  }

  @Get('orders-by-channel')
  ordersByChannel() {
    return this.analytics.ordersByChannel();
  }

  @Get('messages-by-channel')
  messagesByChannel(@Query('days') days?: string) {
    return this.analytics.messagesByChannel(Math.min(Number(days ?? 30) || 30, 90));
  }

  @Get('orders-by-status')
  ordersByStatus() {
    return this.analytics.ordersByStatus();
  }

  @Get('staff')
  staff() {
    return this.analytics.staffPerformance();
  }
}

import { Module } from '@nestjs/common';
import { OrderNotifyController } from './order-notify.controller';
import { OrderNotifyService } from './order-notify.service';
import { ChannelsModule } from '../channels/channels.module';

@Module({
  imports: [ChannelsModule],
  controllers: [OrderNotifyController],
  providers: [OrderNotifyService],
  exports: [OrderNotifyService],
})
export class OrderNotifyModule {}

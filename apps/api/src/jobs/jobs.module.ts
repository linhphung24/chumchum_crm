import { Module } from '@nestjs/common';
import { JobsService } from './jobs.service';
import { OrdersModule } from '../orders/orders.module';
import { ChannelsModule } from '../channels/channels.module';

@Module({
  imports: [OrdersModule, ChannelsModule],
  providers: [JobsService],
})
export class JobsModule {}

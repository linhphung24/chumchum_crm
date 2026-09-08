import { Module } from '@nestjs/common';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { ChannelsModule } from '../channels/channels.module';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [ChannelsModule, OrdersModule],
  controllers: [CommentsController],
  providers: [CommentsService],
})
export class CommentsModule {}

import { Module } from '@nestjs/common';
import { TrelloController, TrelloWebhookController } from './trello.controller';
import { TrelloService } from './trello.service';
import { OrdersModule } from '../orders/orders.module';

@Module({
  imports: [OrdersModule],
  controllers: [TrelloController, TrelloWebhookController],
  providers: [TrelloService],
  exports: [TrelloService],
})
export class TrelloModule {}

import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { ChannelsModule } from '../channels/channels.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [ChannelsModule, NotificationsModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}

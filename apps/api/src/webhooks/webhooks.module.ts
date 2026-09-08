import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { ChannelsModule } from '../channels/channels.module';

@Module({
  imports: [ChannelsModule],
  controllers: [WebhooksController],
})
export class WebhooksModule {}

import { Module } from '@nestjs/common';
import { ChannelsController } from './channels.controller';
import { ChannelsOauthController } from './channels-oauth.controller';
import { ChannelsService } from './channels.service';
import { ChannelIngestService } from './channel-ingest.service';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  FacebookAdapter,
  InstagramAdapter,
  ShopeeAdapter,
  TikTokAdapter,
  ZaloOaAdapter,
  ZaloPersonalAdapter,
} from './adapters';

@Module({
  imports: [NotificationsModule],
  controllers: [ChannelsController, ChannelsOauthController],
  providers: [
    ChannelsService,
    ChannelIngestService,
    ZaloOaAdapter,
    ZaloPersonalAdapter,
    FacebookAdapter,
    InstagramAdapter,
    TikTokAdapter,
    ShopeeAdapter,
  ],
  exports: [ChannelsService, ChannelIngestService, FacebookAdapter],
})
export class ChannelsModule {}

import { Module } from '@nestjs/common';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';
import { ChannelIngestService } from './channel-ingest.service';
import {
  FacebookAdapter,
  InstagramAdapter,
  ShopeeAdapter,
  TikTokAdapter,
  ZaloOaAdapter,
  ZaloPersonalAdapter,
} from './adapters';

@Module({
  controllers: [ChannelsController],
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

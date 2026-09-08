import { Module } from '@nestjs/common';
import { DevController } from './dev.controller';
import { ChannelsModule } from '../channels/channels.module';

@Module({
  imports: [ChannelsModule],
  controllers: [DevController],
})
export class DevModule {}

import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsBoolean, IsNotEmpty, IsObject, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/decorators';
import { ChannelsService } from './channels.service';

export class SaveChannelAccountDto {
  @IsString()
  @IsNotEmpty()
  type: string;

  @IsString()
  @IsNotEmpty()
  externalId: string;

  @IsString()
  @IsNotEmpty()
  name: string;

  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>;
}

export class UpdateChannelAccountDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsObject()
  credentials?: Record<string, string>;
}

export class TestConnectionDto {
  @IsString()
  @IsNotEmpty()
  type: string;

  @IsObject()
  credentials: Record<string, string>;
}

@Controller('channel-accounts')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ChannelsController {
  constructor(private channels: ChannelsService) {}

  @Get('meta')
  meta() {
    return this.channels.adapterMeta();
  }

  @Get()
  list() {
    return this.channels.listAccounts();
  }

  /** Wizard: kiểm tra token với API thật của nền tảng trước khi lưu */
  @Post('test')
  @Roles('ADMIN', 'MANAGER')
  test(@Body() dto: TestConnectionDto) {
    return this.channels.testConnection(dto);
  }

  /** Làm mới access token bằng refresh token (Zalo OA) */
  @Post(':id/refresh')
  @Roles('ADMIN', 'MANAGER')
  refresh(@Param('id') id: string) {
    return this.channels.refreshAccount(id);
  }

  /** Đồng bộ hội thoại/tin nhắn cũ về inbox (Zalo OA, Messenger, Instagram, Zalo cá nhân qua bridge) */
  @Post(':id/sync-chats')
  @Roles('ADMIN', 'MANAGER')
  syncChats(@Param('id') id: string) {
    return this.channels.syncChats(id);
  }

  /** Đồng bộ danh sách bạn bè từ Zalo cá nhân (bridge) về làm khách hàng */
  @Post(':id/sync-friends')
  @Roles('ADMIN', 'MANAGER')
  syncFriends(@Param('id') id: string) {
    return this.channels.syncZaloPersonalFriends(id);
  }

  @Post()
  @Roles('ADMIN', 'MANAGER')
  create(@Body() dto: SaveChannelAccountDto) {
    return this.channels.createAccount(dto);
  }

  @Patch(':id')
  @Roles('ADMIN', 'MANAGER')
  update(@Param('id') id: string, @Body() dto: UpdateChannelAccountDto) {
    return this.channels.updateAccount(id, dto);
  }

  /** Xoá kênh. ?purge=true → xoá luôn khách hàng chỉ tồn tại nhờ kênh này (kèm đơn của họ) */
  @Delete(':id')
  @Roles('ADMIN')
  remove(@Param('id') id: string, @Query('purge') purge?: string) {
    return this.channels.removeAccount(id, purge === 'true');
  }
}

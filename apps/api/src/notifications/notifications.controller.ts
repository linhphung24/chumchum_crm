import { Body, Controller, Delete, Get, Post, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsObject, IsString, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, JwtUser } from '../common/decorators';
import { NotificationsService } from './notifications.service';

// Lưu ý: PushKeysDto phải khai báo TRƯỚC SubscribePushDto (tham chiếu trong metadata)
export class PushKeysDto {
  @IsString()
  @IsNotEmpty()
  p256dh: string;

  @IsString()
  @IsNotEmpty()
  auth: string;
}

export class SubscribePushDto {
  @IsString()
  @IsNotEmpty()
  endpoint: string;

  @IsObject()
  @ValidateNested()
  @Type(() => PushKeysDto)
  keys: PushKeysDto;
}

export class UnsubscribePushDto {
  @IsString()
  @IsNotEmpty()
  endpoint: string;
}

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  /** Khóa công khai VAPID để client đăng ký push (null = server chưa bật push) */
  @Get('vapid-key')
  vapidKey() {
    return { publicKey: this.notifications.vapidPublicKey };
  }

  @Post('subscribe')
  subscribe(@CurrentUser() user: JwtUser, @Body() dto: SubscribePushDto) {
    return this.notifications.subscribe(user.id, dto);
  }

  @Delete('subscribe')
  unsubscribe(@CurrentUser() user: JwtUser, @Body() dto: UnsubscribePushDto) {
    return this.notifications.unsubscribe(user.id, dto.endpoint);
  }
}

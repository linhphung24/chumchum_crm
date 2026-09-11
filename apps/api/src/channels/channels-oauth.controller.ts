import { Body, Controller, Get, Post, Query, Res, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/decorators';
import { ChannelsService } from './channels.service';

export class BridgeDto {
  @IsString()
  @IsNotEmpty()
  bridgeUrl: string;

  @IsOptional()
  @IsString()
  apiKey?: string;

  /** Nick Zalo nào trên bridge (nhiều nick: mỗi nick 1 accountId riêng) */
  @IsOptional()
  @IsString()
  accountId?: string;
}

/**
 * Luồng kết nối đặc biệt (wizard Cài đặt → Kênh):
 *  - Zalo OA OAuth: /channels/zalo-oa/oauth/start|callback (khung sẵn — bật khi có env ZALO_OA_APP_ID)
 *  - Zalo cá nhân bridge QR: /channels/zalo-personal/bridge/qr|status (proxy qua server tránh CORS)
 */
@Controller('channels')
export class ChannelsOauthController {
  constructor(private channels: ChannelsService) {}

  @Get('zalo-oa/oauth/start')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  zaloOaStart() {
    return this.channels.zaloOaOAuthStart();
  }

  /** Facebook Page 1-cú-click: mở dialog Login with Facebook (cần env FB_APP_ID + FB_APP_SECRET) */
  @Get('facebook/oauth/start')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  facebookStart() {
    return this.channels.facebookOAuthStart();
  }

  /** Facebook redirect trình duyệt về đây → lưu Page token + tự subscribe webhook → về Cài đặt */
  @Get('facebook/oauth/callback')
  async facebookCallback(@Query('code') code: string, @Query('state') state: string, @Query('error_description') error: string, @Res() res: Response) {
    const frontend = (process.env.FRONTEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    try {
      if (!code) throw new Error(error || 'Thiếu mã code');
      const r = await this.channels.facebookOAuthCallback(code, state);
      return res.redirect(`${frontend}/settings?fb=ok&name=${encodeURIComponent(r.pages.join(', '))}`);
    } catch (err) {
      return res.redirect(`${frontend}/settings?fb=fail&msg=${encodeURIComponent((err as Error).message)}`);
    }
  }

  /** Zalo redirect trình duyệt về đây (không có JWT) → xử lý xong chuyển về trang Cài đặt */
  @Get('zalo-oa/oauth/callback')
  async zaloOaCallback(
    @Query('code') code: string,
    @Query('oa_id') oaId: string,
    @Query('state') state: string,
    @Query('error_message') error: string,
    @Res() res: Response,
  ) {
    const frontend = (process.env.FRONTEND_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    try {
      if (!code) throw new Error(error || 'Thiếu mã code');
      const r = await this.channels.zaloOaOAuthCallback(code, oaId, state);
      return res.redirect(`${frontend}/settings?zalo-oa=ok&name=${encodeURIComponent(r.name)}`);
    } catch (err) {
      return res.redirect(`${frontend}/settings?zalo-oa=fail&msg=${encodeURIComponent((err as Error).message)}`);
    }
  }

  /**
   * Một số ô đăng ký URL trên developers.zalo.me kiểm tra bằng cách POST tới URL
   * (thông báo "gửi http post request... phải trả về 200") — nhận POST trả 200 để URL này
   * đăng ký được ở ô nào của app Zalo cũng chạy.
   */
  @Post('zalo-oa/oauth/callback')
  zaloOaCallbackPing() {
    return { ok: true };
  }

  @Post('zalo-personal/bridge/qr')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  bridgeQr(@Body() dto: BridgeDto) {
    return this.channels.bridgeQr(dto);
  }

  @Post('zalo-personal/bridge/status')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  bridgeStatus(@Body() dto: BridgeDto) {
    return this.channels.bridgeStatus(dto);
  }
}

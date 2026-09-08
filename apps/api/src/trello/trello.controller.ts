import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { IsObject, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/decorators';
import { TrelloService } from './trello.service';

export class SaveTrelloDto {
  @IsOptional()
  @IsString()
  apiKey?: string;

  @IsOptional()
  @IsString()
  token?: string;

  @IsOptional()
  @IsString()
  boardId?: string;

  /** { NEW: 'listId', ... } */
  @IsOptional()
  @IsObject()
  listMap?: Record<string, string>;
}

export class RegisterWebhookDto {
  @IsString()
  callbackUrl: string;
}

@Controller('trello')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TrelloController {
  constructor(private trello: TrelloService) {}

  @Get('settings')
  settings() {
    return this.trello.getSettings();
  }

  @Put('settings')
  @Roles('ADMIN', 'MANAGER')
  save(@Body() dto: SaveTrelloDto) {
    return this.trello.saveSettings(dto);
  }

  @Get('boards')
  boards() {
    return this.trello.listBoards();
  }

  @Post('webhook')
  @Roles('ADMIN', 'MANAGER')
  registerWebhook(@Body() dto: RegisterWebhookDto) {
    return this.trello.registerWebhook(dto.callbackUrl);
  }

  @Post('sync-order/:orderId')
  syncOrder(@Param('orderId') orderId: string) {
    return this.trello.forceSyncOrder(orderId);
  }
}

/** Webhook công khai từ Trello (không cần JWT — HEAD/POST do Trello gọi) */
@Controller('webhooks/trello')
export class TrelloWebhookController {
  constructor(private trello: TrelloService) {}

  @Get()
  verify() {
    return 'ok'; // Trello gửi HEAD/GET kiểm tra callbackURL
  }

  @Post()
  handle(@Body() body: unknown) {
    return this.trello.handleWebhook(body as never);
  }
}

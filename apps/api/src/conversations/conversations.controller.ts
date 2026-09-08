import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { CurrentUser, JwtUser } from '../common/decorators';
import { CONVERSATION_STATUSES } from '../common/constants';
import { ConversationsService } from './conversations.service';

export class SendMessageDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(4000)
  text: string;
}

export class AssignDto {
  @IsOptional()
  @IsString()
  userId?: string | null;
}

export class SetStatusDto {
  @IsIn(CONVERSATION_STATUSES as unknown as string[])
  status: string;
}

@Controller('conversations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ConversationsController {
  constructor(private conversations: ConversationsService) {}

  @Get()
  list(
    @CurrentUser() user: JwtUser,
    @Query('channelType') channelType?: string,
    @Query('status') status?: string,
    @Query('mine') mine?: string,
    @Query('unassigned') unassigned?: string,
    @Query('q') q?: string,
  ) {
    return this.conversations.list({
      channelType,
      status,
      assignedUserId: mine === '1' ? user.id : undefined,
      unassigned: unassigned === '1',
      q,
    });
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.conversations.detail(id);
  }

  @Get(':id/messages')
  messages(@Param('id') id: string, @Query('take') take?: string, @Query('before') before?: string) {
    return this.conversations.messages(id, {
      take: take ? Number(take) : undefined,
      before,
    });
  }

  @Post(':id/messages')
  send(@Param('id') id: string, @Body() dto: SendMessageDto, @CurrentUser() user: JwtUser) {
    return this.conversations.sendMessage(id, dto.text, user.id);
  }

  @Patch(':id/read')
  markRead(@Param('id') id: string) {
    return this.conversations.markRead(id);
  }

  @Patch(':id/assign')
  assign(@Param('id') id: string, @Body() dto: AssignDto) {
    return this.conversations.assign(id, dto.userId ?? null);
  }

  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body() dto: SetStatusDto) {
    return this.conversations.setStatus(id, dto.status);
  }
}

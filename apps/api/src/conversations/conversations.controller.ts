import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { IsIn, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { randomBytes } from 'crypto';
import { mkdirSync } from 'fs';
import { extname } from 'path';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { CurrentUser, JwtUser } from '../common/decorators';
import { CONVERSATION_STATUSES } from '../common/constants';
import { ConversationsService } from './conversations.service';

const UPLOAD_DIR = process.env.UPLOAD_DIR ?? './uploads';
const ALLOWED_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.webm', '.mp3', '.m4a', '.ogg', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.zip', '.txt']);

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

  /** Gửi file đính kèm (ảnh/video/audio/tệp) — multipart/form-data: field "file" */
  @Post(':id/attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
      storage: diskStorage({
        destination: (_req, _file, cb) => {
          mkdirSync(UPLOAD_DIR, { recursive: true });
          cb(null, UPLOAD_DIR);
        },
        filename: (_req, file, cb) => {
          const ext = extname(file.originalname || '').toLowerCase();
          if (!ALLOWED_EXT.has(ext)) return cb(new BadRequestException(`Không hỗ trợ tệp ${ext || 'này'}`), '');
          return cb(null, `${Date.now()}-${randomBytes(6).toString('hex')}${ext}`);
        },
      }),
    }),
  )
  uploadAttachment(
    @Param('id') id: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: JwtUser,
  ) {
    if (!file) throw new BadRequestException('Chưa chọn tệp');
    return this.conversations.sendAttachment(id, { filename: file.filename, mimetype: file.mimetype }, undefined, user.id);
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

import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMinSize, IsArray, IsInt, IsNotEmpty, IsOptional, IsString, Min, ValidateNested } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { CurrentUser, JwtUser } from '../common/decorators';
import { CommentsService } from './comments.service';

export class ReplyCommentDto {
  @IsString()
  @IsNotEmpty()
  message: string;
}

export class ConvertItemDto {
  @IsString()
  @IsNotEmpty()
  productName: string;

  @IsOptional()
  @IsString()
  variant?: string;

  @IsInt()
  @Min(1)
  quantity: number;

  @IsInt()
  @Min(0)
  price: number;
}

export class ConvertCommentDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ConvertItemDto)
  items: ConvertItemDto[];

  @IsOptional()
  @IsString()
  shippingAddress?: string;

  @IsOptional()
  @IsString()
  shippingPhone?: string;

  @IsOptional()
  @IsString()
  existingCustomerId?: string;
}

@Controller('comments')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CommentsController {
  constructor(private comments: CommentsService) {}

  @Get()
  list(@Query('status') status?: string, @Query('q') q?: string) {
    return this.comments.list({ status, q });
  }

  @Post(':id/reply')
  reply(@Param('id') id: string, @Body() dto: ReplyCommentDto) {
    return this.comments.reply(id, dto.message);
  }

  @Post(':id/handle')
  handle(@Param('id') id: string) {
    return this.comments.markHandled(id);
  }

  @Post(':id/convert')
  convert(@Param('id') id: string, @Body() dto: ConvertCommentDto, @CurrentUser() user: JwtUser) {
    return this.comments.convert(
      id,
      {
        items: dto.items,
        shippingAddress: dto.shippingAddress,
        shippingPhone: dto.shippingPhone,
        createdById: user.id,
      },
      dto.existingCustomerId,
    );
  }
}

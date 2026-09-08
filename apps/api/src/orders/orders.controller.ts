import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { CurrentUser, JwtUser } from '../common/decorators';
import { ORDER_SOURCES, ORDER_STATUSES } from '../common/constants';
import { OrdersService } from './orders.service';
import type { OrderItemInput } from './orders.service';

export class OrderItemDto implements OrderItemInput {
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

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  customerId: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items: OrderItemDto[];

  @IsOptional()
  @IsString()
  shippingAddress?: string;

  @IsOptional()
  @IsString()
  shippingPhone?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsIn(ORDER_SOURCES as unknown as string[])
  sourceType?: string;

  @IsOptional()
  @IsString()
  sourceChannel?: string;
}

export class UpdateOrderDto {
  @IsOptional()
  @IsString()
  shippingAddress?: string;

  @IsOptional()
  @IsString()
  shippingPhone?: string;

  @IsOptional()
  @IsString()
  note?: string;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => OrderItemDto)
  items?: OrderItemDto[];
}

export class SetStatusDto {
  @IsIn(ORDER_STATUSES as unknown as string[])
  status: string;

  @IsOptional()
  @IsString()
  note?: string;
}

@Controller('orders')
@UseGuards(JwtAuthGuard, RolesGuard)
export class OrdersController {
  constructor(private orders: OrdersService) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('channel') channel?: string,
    @Query('q') q?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.orders.list({ status, sourceChannel: channel, q, from, to });
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.orders.detail(id);
  }

  @Post()
  create(@Body() dto: CreateOrderDto, @CurrentUser() user: JwtUser) {
    return this.orders.create({ ...dto, createdById: user.id });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateOrderDto) {
    return this.orders.update(id, dto);
  }

  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body() dto: SetStatusDto, @CurrentUser() user: JwtUser) {
    return this.orders.setStatus(id, dto.status, dto.note ?? null, user.id);
  }
}

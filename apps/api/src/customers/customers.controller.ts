import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/decorators';
import { CustomersService } from './customers.service';

export class SaveCustomerDto {
  @IsString()
  name: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsOptional()
  @IsString()
  email?: string;

  @IsOptional()
  @IsString()
  address?: string;

  /** comma-separated */
  @IsOptional()
  @IsString()
  tags?: string;

  @IsOptional()
  @IsString()
  note?: string;
}

@Controller('customers')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CustomersController {
  constructor(private customers: CustomersService) {}

  @Get()
  list(@Query('q') q?: string, @Query('tag') tag?: string) {
    return this.customers.list({ q, tag });
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.customers.detail(id);
  }

  @Post()
  create(@Body() dto: SaveCustomerDto) {
    return this.customers.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: SaveCustomerDto) {
    return this.customers.update(id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN', 'MANAGER')
  remove(@Param('id') id: string) {
    return this.customers.remove(id);
  }
}

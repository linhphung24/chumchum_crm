import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { IsNotEmpty, IsString } from 'class-validator';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/decorators';
import { DomainsService } from './domains.service';

export class AddDomainDto {
  @IsString()
  @IsNotEmpty()
  domain: string;
}

@Controller('domains')
export class DomainsController {
  constructor(private domains: DomainsService) {}

  @Get()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  list() {
    return this.domains.list();
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  add(@Body() dto: AddDomainDto) {
    return this.domains.add(dto.domain);
  }

  @Post(':id/check')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'MANAGER')
  check(@Param('id') id: string) {
    return this.domains.check(id);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN')
  remove(@Param('id') id: string) {
    return this.domains.remove(id);
  }

  /** Public: nhà cung cấp (Zalo/Meta) gọi để xác nhận — mỗi domain 1 key, trả JSON */
  @Get('verify/:key')
  verify(@Param('key') key: string) {
    return this.domains.publicStatus(key);
  }
}

import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../common/roles.guard';
import { Roles } from '../common/decorators';
import { UsersService } from './users.service';
import { CreateUserDto, UpdateUserDto } from '../auth/dto';
import { CurrentUser, JwtUser } from '../common/decorators';

@Controller('users')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'MANAGER')
export class UsersController {
  constructor(private users: UsersService) {}

  @Get()
  list() {
    return this.users.list();
  }

  @Post()
  @Roles('ADMIN')
  create(@Body() dto: CreateUserDto) {
    return this.users.create(dto);
  }

  @Patch(':id')
  @Roles('ADMIN')
  update(@CurrentUser() actor: JwtUser, @Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.users.update(actor.id, id, dto);
  }

  @Delete(':id')
  @Roles('ADMIN')
  remove(@CurrentUser() actor: JwtUser, @Param('id') id: string) {
    return this.users.remove(actor.id, id);
  }
}

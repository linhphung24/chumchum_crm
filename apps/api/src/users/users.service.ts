import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { ROLES, type Role } from '../common/constants';
import { CreateUserDto, UpdateUserDto } from '../auth/dto';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  private validateRole(role: string): Role {
    if (!(ROLES as readonly string[]).includes(role)) throw new BadRequestException('Vai trò không hợp lệ');
    return role as Role;
  }

  /** Đếm ADMIN khác (không tính user đang xét) còn đang hoạt động */
  private countOtherActiveAdmins(excludeUserId: string) {
    return this.prisma.user.count({
      where: { role: 'ADMIN', isActive: true, id: { not: excludeUserId } },
    });
  }

  list() {
    return this.prisma.user.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        isActive: true,
        createdAt: true,
      },
    });
  }

  async create(dto: CreateUserDto) {
    this.validateRole(dto.role);
    const exists = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (exists) throw new ConflictException('Email đã tồn tại');
    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        role: dto.role,
        passwordHash: await bcrypt.hash(dto.password, 10),
      },
      select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
    });
    return user;
  }

  async update(actorId: string, id: string, dto: UpdateUserDto) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');
    if (dto.role) this.validateRole(dto.role);

    // Không cho tự khoá / tự hạ quyền chính mình
    if (id === actorId) {
      if (dto.isActive === false) throw new BadRequestException('Không thể tự khoá chính mình');
      if (dto.role && dto.role !== user.role) throw new BadRequestException('Không thể tự đổi vai trò của chính mình');
    }

    // Khoá / hạ quyền / xoá ADMIN cuối cùng sẽ khiến hệ thống không còn ai quản trị
    const losingAdmin = user.role === 'ADMIN' && (dto.isActive === false || (dto.role && dto.role !== 'ADMIN'));
    if (losingAdmin && (await this.countOtherActiveAdmins(id)) === 0) {
      throw new BadRequestException('Phải còn ít nhất một ADMIN đang hoạt động');
    }

    const data: Record<string, unknown> = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.role !== undefined) data.role = dto.role;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (dto.password) data.passwordHash = await bcrypt.hash(dto.password, 10);
    // Đổi mật khẩu / khoá tài khoản → thu hồi phiên đăng nhập cũ
    if (dto.password || dto.isActive === false) {
      await this.prisma.refreshToken.updateMany({
        where: { userId: id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }

    return this.prisma.user.update({
      where: { id },
      data,
      select: { id: true, email: true, name: true, role: true, isActive: true, createdAt: true },
    });
  }

  async remove(actorId: string, id: string) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundException('Không tìm thấy người dùng');
    if (id === actorId) throw new BadRequestException('Không thể tự xoá chính mình');
    if (user.role === 'ADMIN' && (await this.countOtherActiveAdmins(id)) === 0) {
      throw new BadRequestException('Phải còn ít nhất một ADMIN đang hoạt động');
    }
    await this.prisma.user.delete({ where: { id } });
    return { ok: true };
  }
}

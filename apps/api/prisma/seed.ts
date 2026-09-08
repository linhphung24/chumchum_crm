/* Seed ChumChum CRM — chỉ tạo tài khoản quản trị, KHÔNG tạo dữ liệu mock.
 * Đăng nhập: admin@chumchum.vn / Admin@123
 * Hướng dẫn kết nối kênh thật: docs/HUONG-DAN-KET-NOI.md
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  await prisma.user.upsert({
    where: { email: 'admin@chumchum.vn' },
    update: {},
    create: {
      email: 'admin@chumchum.vn',
      name: 'Quản trị viên',
      role: 'ADMIN',
      passwordHash: await bcrypt.hash('Admin@123', 10),
    },
  });
  console.log('✅ Seed xong — Đăng nhập: admin@chumchum.vn / Admin@123');
  console.log('📚 Kết nối kênh thật: xem docs/HUONG-DAN-KET-NOI.md (thao tác trong Cài đặt → Kênh)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

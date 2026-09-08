/* Seed ChumChum CRM — tài khoản + dữ liệu mẫu (idempotent: chạy lại không đè dữ liệu đã có,
 * kể cả mật khẩu đã đổi hay token kênh đã điền trong UI).
 * Đăng nhập: admin@chumchum.vn / Admin@123 — nhân viên: lan@chumchum.vn / Lan@123
 * Hướng dẫn kết nối kênh thật: docs/HUONG-DAN-KET-NOI.md
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  // ---- Tài khoản (không cập nhật nếu đã tồn tại → không reset mật khẩu đã đổi) ----
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
  await prisma.user.upsert({
    where: { email: 'lan@chumchum.vn' },
    update: {},
    create: {
      email: 'lan@chumchum.vn',
      name: 'Lan (sale)',
      role: 'STAFF',
      passwordHash: await bcrypt.hash('Lan@123', 10),
    },
  });

  // ---- Dữ liệu mẫu: CHỈ tạo ở môi trường dev (NODE_ENV !== production).
  // Production giữ DB sạch — chỉ có tài khoản ở trên.
  if (process.env.NODE_ENV === 'production') {
    console.log('✅ Seed xong (production — chỉ tài khoản, không có dữ liệu mẫu)');
    console.log('👤 Đăng nhập: admin@chumchum.vn (đổi mật khẩu ngay lần đầu)');
    return;
  }

  // ---- Kênh (credentials rỗng = chế độ MOCK; không đè token đã điền) ----
  const channels = [
    { type: 'ZALO_OA', externalId: 'zalo-oa-demo', name: 'Zalo OA ChumChum' },
    { type: 'FACEBOOK', externalId: 'mock-fb-page-1', name: 'Fanpage ChumChum Bakery' },
    { type: 'INSTAGRAM', externalId: 'ig-demo', name: 'Instagram ChumChum' },
    { type: 'TIKTOK', externalId: 'tiktok-demo', name: 'TikTok ChumChum' },
    { type: 'SHOPEE', externalId: 'shopee-demo', name: 'Gian hàng Shopee' },
  ] as const;
  for (const ch of channels) {
    await prisma.channelAccount.upsert({
      where: { type_externalId: { type: ch.type, externalId: ch.externalId } },
      update: {},
      create: { ...ch },
    });
  }
  const zalo = await prisma.channelAccount.findFirstOrThrow({ where: { type: 'ZALO_OA' } });
  const facebook = await prisma.channelAccount.findFirstOrThrow({ where: { type: 'FACEBOOK' } });

  // ---- Khách + hội thoại mẫu (3 hội thoại, mỗi cái vài tin nhắn) ----
  const demos = [
    {
      phone: '0900000001',
      name: 'Minh Anh',
      channel: zalo,
      channelUserId: 'demo-zalo-user-1',
      tags: 'VIP',
      messages: [
        { direction: 'IN', text: 'Chào shop, bánh còn không ạ?' },
        { direction: 'OUT', text: 'Dạ còn nha chị, hôm nay vừa ra lò ạ 🐹' },
      ],
    },
    {
      phone: '0900000002',
      name: 'Thu Hà',
      channel: facebook,
      channelUserId: 'demo-fb-user-1',
      tags: 'khach-moi',
      messages: [
        { direction: 'IN', text: 'Bánh sinh nhật đặt trước 1 ngày được không shop?' },
        { direction: 'OUT', text: 'Được ạ, chị inbox số điện thoại giúp shop nha!' },
        { direction: 'IN', text: '0900000002 đây ạ' },
      ],
    },
    {
      phone: '0900000003',
      name: 'Hoàng Nam',
      channel: zalo,
      channelUserId: 'demo-zalo-user-2',
      tags: '',
      messages: [{ direction: 'IN', text: 'Cho mình hỏi giá hộp 6 bánh?' }],
    },
  ];

  const customers: { id: string; name: string }[] = [];
  for (const d of demos) {
    let customer = await prisma.customer.findFirst({ where: { phone: d.phone } });
    if (!customer) {
      customer = await prisma.customer.create({
        data: { name: d.name, phone: d.phone, tags: d.tags, note: 'Khách hàng mẫu (seed)' },
      });
    }
    customers.push({ id: customer.id, name: customer.name });

    const existed = await prisma.conversation.findFirst({
      where: { customerId: customer.id, channelAccountId: d.channel.id },
    });
    if (!existed) {
      const last = d.messages[d.messages.length - 1];
      await prisma.conversation.create({
        data: {
          customerId: customer.id,
          channelAccountId: d.channel.id,
          status: 'OPEN',
          lastDirection: last.direction,
          lastMessageText: last.text,
          messages: {
            create: d.messages.map((m) => ({
              direction: m.direction,
              text: m.text,
              status: m.direction === 'OUT' ? 'MOCKED' : 'SENT',
            })),
          },
        },
      });
    }
  }

  // ---- 2 đơn hàng mẫu (cho dashboard có số) ----
  const orderDemos = [
    { code: 'DH-DEMO-001', customer: customers[0], total: 350000, status: 'COMPLETED' },
    { code: 'DH-DEMO-002', customer: customers[1], total: 720000, status: 'SHIPPING' },
  ];
  for (const o of orderDemos) {
    await prisma.order.upsert({
      where: { code: o.code },
      update: {},
      create: {
        code: o.code,
        customerId: o.customer.id,
        status: o.status,
        total: o.total,
        sourceType: 'CHAT',
        sourceChannel: 'ZALO_OA',
        items: { create: [{ productName: 'Bánh sẽ-lan hộp quà', quantity: 1, price: o.total }] },
        events: { create: [{ toStatus: o.status, note: 'Đơn mẫu (seed)' }] },
      },
    });
  }

  console.log('✅ Seed xong — Đăng nhập: admin@chumchum.vn / Admin@123 (nhân viên: lan@chumchum.vn / Lan@123)');
  console.log('📊 Đã tạo dữ liệu mẫu (dev): 5 kênh mock, 3 hội thoại, 2 đơn hàng');
  console.log('📚 Kết nối kênh thật: xem docs/HUONG-DAN-KET-NOI.md (thao tác trong Cài đặt → Kênh)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

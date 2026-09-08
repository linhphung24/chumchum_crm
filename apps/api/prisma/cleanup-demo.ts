/* Xoá dữ liệu mẫu (demo/mock) khỏi database — chạy khi đã lên production:
 *   npm run clean:demo -w apps/api        (hoặc trong container: docker compose exec api npm run clean:demo)
 * Chỉ xoá các bản ghi demo nhận diện được theo externalId/phone/code cố định —
 * KHÔNG đụng dữ liệu thật (kênh đã có token, khách thật, đơn thật).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const DEMO_CHANNEL_IDS = ['zalo-oa-demo', 'mock-fb-page-1', 'ig-demo', 'tiktok-demo', 'shopee-demo', 'default', 'manual-ZALO_OA', 'manual-FACEBOOK', 'manual-ZALO_PERSONAL', 'manual-TIKTOK', 'manual-SHOPEE', 'manual-INSTAGRAM'];
const DEMO_PHONES = ['0900000001', '0900000002', '0900000003'];

async function main() {
  // 1) Hội thoại + tin nhắn của khách demo (cascade theo customer)
  const demoCustomers = await prisma.customer.findMany({ where: { phone: { in: DEMO_PHONES } }, select: { id: true, name: true } });

  // 2) Đơn DH-DEMO-% (chống cascade loop: xoá comment liên kết trước qua order? SocialComment set null nên không cần)
  const demoOrders = await prisma.order.findMany({ where: { code: { startsWith: 'DH-DEMO-' } }, select: { id: true } });

  // 3) Kênh demo/mock (không có credentials)
  const demoChannels = await prisma.channelAccount.findMany({
    where: { externalId: { in: DEMO_CHANNEL_IDS } },
    select: { id: true, name: true, credentials: true },
  });
  const mockChannels = demoChannels.filter((c) => !c.credentials);

  console.log(`Tìm thấy: ${demoCustomers.length} khách demo, ${demoOrders.length} đơn demo, ${mockChannels.length} kênh mock`);

  // Xoá khách demo (cascade: conversations, messages, identities, orders)
  if (demoCustomers.length) {
    await prisma.customer.deleteMany({ where: { id: { in: demoCustomers.map((c) => c.id) } } });
    console.log(`🗑 Đã xoá ${demoCustomers.length} khách demo (+ hội thoại/tin nhắn/đơn liên quan)`);
  }

  // Xoá đơn demo còn sót (nếu khách đã bị xoá trước đó thì đơn đã cascade)
  if (demoOrders.length) {
    const del = await prisma.order.deleteMany({ where: { id: { in: demoOrders.map((o) => o.id) } } });
    if (del.count) console.log(`🗑 Đã xoá ${del.count} đơn demo`);
  }

  // Xoá kênh mock (chỉ khi KHÔNG có credentials — kênh đã kết nối thật sẽ được giữ)
  if (mockChannels.length) {
    await prisma.channelAccount.deleteMany({ where: { id: { in: mockChannels.map((c) => c.id) } } });
    console.log(`🗑 Đã xoá ${mockChannels.length} kênh mock: ${mockChannels.map((c) => c.name).join(', ')}`);
  }

  // Dọn comment giả lập còn lại (nếu có)
  const cmt = await prisma.socialComment.deleteMany({ where: { authorName: { in: ['Bình Luận Test', 'Khách Webhook'] } } });
  if (cmt.count) console.log(`🗑 Đã xoá ${cmt.count} comment test`);

  console.log('✅ Dọn dữ liệu demo xong — DB giờ chỉ còn dữ liệu thật.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

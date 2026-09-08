/* Smoke test toàn bộ luồng chính của ChumChum CRM API (chạy khi API đang mở ở :4000) */
const BASE = process.env.API_BASE ?? 'http://localhost:4000';
let token = '';

async function api(method, path, body, auth = true) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(auth && token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status}: ${JSON.stringify(json).slice(0, 200)}`);
  return json;
}

const check = (name, ok, extra = '') => {
  console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
};

(async () => {
  // 1) Đăng nhập
  const login = await api('POST', '/auth/login', { email: 'admin@chumchum.vn', password: 'Admin@123' }, false);
  token = login.accessToken;
  check('Đăng nhập admin', !!login.accessToken && login.user.role === 'ADMIN');

  const me = await api('GET', '/auth/me');
  check('GET /auth/me', me.email === 'admin@chumchum.vn');

  // 2) Danh sách hội thoại (seed)
  const convs = await api('GET', '/conversations');
  check('GET /conversations (seed)', convs.length >= 3, `${convs.length} hội thoại`);
  const conv = convs[0];

  // 3) Mở hội thoại + đọc tin nhắn
  const detail = await api('GET', `/conversations/${conv.id}`);
  const msgs = await api('GET', `/conversations/${conv.id}/messages`);
  check('Chi tiết hội thoại + tin nhắn', msgs.length >= 1, `${msgs.length} tin`);

  // 4) Gửi tin nhắn (mock mode)
  const sent = await api('POST', `/conversations/${conv.id}/messages`, { text: 'Smoke test gửi tin 🐹' });
  check('Gửi tin nhắn (mock)', sent.direction === 'OUT' && sent.status === 'MOCKED');

  // 5) Giả lập tin nhắn đến từ Zalo OA (chỉ dev — /dev/* tự tắt ở production)
  let devMode = true;
  let newConv = null;
  try {
    const sim = await api('POST', '/dev/simulate-incoming', {
      channelType: 'ZALO_OA',
      userName: 'Khách Smoke Test',
      text: 'Xin chào từ Zalo OA!',
    });
    check('Giả lập tin đến (Zalo OA)', sim.ok === true);
    const convs2 = await api('GET', '/conversations');
    newConv = convs2.find((c) => c.customer.name === 'Khách Smoke Test');
    check('Hội thoại mới xuất hiện', !!newConv);
  } catch (e) {
    if (String(e).includes('Không khả dụng ở production')) {
      devMode = false;
      console.log('⏭️  /dev tắt ở production — bỏ qua các bước giả lập (bình thường)');
    } else throw e;
  }

  // 6) Phân công hội thoại
  if (newConv) {
    const users = await api('GET', '/users');
    const assigned = await api('PATCH', `/conversations/${newConv.id}/assign`, { userId: users[0].id });
    check('Phân công hội thoại', assigned.assignedUser?.id === users[0].id);
  }

  // 7) Comment FB: giả lập → trả lời → chuyển đơn (chỉ dev)
  if (devMode) {
    const cmt = await api('POST', '/dev/simulate-comment', { author: 'Bình Luận Test', message: 'Mình đặt 2 cái size L' });
    check('Giả lập comment FB', !!cmt.id);
    const replied = await api('POST', `/comments/${cmt.id}/reply`, { message: 'Dạ shop ib hỗ trợ nha' });
    check('Trả lời comment (mock)', replied.mocked === true);
    const converted = await api('POST', `/comments/${cmt.id}/convert`, {
      items: [{ productName: 'Áo len pastel', variant: 'Hồng/L', quantity: 2, price: 350000 }],
      shippingPhone: '0912345678',
      shippingAddress: '123 Test Q1',
    });
    check('Chuyển comment → đơn hàng', converted.order.code.startsWith('DH-'), `đơn ${converted.order.code}`);
  }

  // 8) Tạo đơn trực tiếp cho khách có sẵn
  const customers = await api('GET', '/customers');
  const order = await api('POST', '/orders', {
    customerId: customers[0].id,
    items: [{ productName: 'Sản phẩm test', quantity: 1, price: 100000 }],
    sourceType: 'CHAT',
  });
  check('Tạo đơn trực tiếp', order.total === 100000);

  // 9) Đổi trạng thái đơn
  const moved = await api('PATCH', `/orders/${order.id}/status`, { status: 'SHIPPING', note: 'test' });
  check('Đổi trạng thái đơn', moved.status === 'SHIPPING');

  // 10) Thống kê (production không có đơn từ comment giả lập nên ngưỡng thấp hơn)
  const summary = await api('GET', '/analytics/summary');
  check('Analytics summary', summary.totalOrders >= (devMode ? 4 : 3), `${summary.totalOrders} đơn`);
  const revenue = await api('GET', '/analytics/revenue?days=7');
  check('Analytics revenue', Array.isArray(revenue) && revenue.length === 7);
  const byChannel = await api('GET', '/analytics/orders-by-channel');
  check('Analytics theo kênh', Array.isArray(byChannel));

  // 11) Trello settings (chưa kết nối)
  const trello = await api('GET', '/trello/settings');
  check('Trello settings (chưa kết nối)', trello.connected === false);
  const trelloSaved = await api('PUT', '/trello/settings', { apiKey: 'test-key', token: 'test-token' });
  check('Lưu Trello settings', trelloSaved.connected === false); // chưa có boardId

  // 12) Kênh
  const accounts = await api('GET', '/channel-accounts');
  check('Danh sách kênh', accounts.length >= 3, `${accounts.length} kênh`);
  const meta = await api('GET', '/channel-accounts/meta');
  check('Meta kênh (6 loại)', meta.length === 6);

  // 13) Webhook Zalo OA (payload chuẩn)
  const zaloHook = await api('POST', '/webhooks/zalo', {
    event_name: 'user_send_text',
    sender: { id: 'zalo-hook-user-1' },
    message: { msg_id: `msg-${Date.now()}`, text: 'Tin từ webhook Zalo' },
  }, false);
  check('Webhook Zalo OA nhận tin', zaloHook.ok === true);

  // 14) Webhook Messenger (payload chuẩn Meta)
  const msgHook = await api('POST', '/webhooks/messenger', {
    object: 'page',
    entry: [
      {
        id: 'mock-fb-page-1',
        messaging: [
          { sender: { id: 'psid-hook-1' }, timestamp: Date.now(), message: { mid: `m-${Date.now()}`, text: 'Tin từ webhook Messenger' } },
        ],
        changes: [
          {
            field: 'feed',
            value: {
              item: 'comment',
              verb: 'add',
              comment_id: `cmt-hook-${Date.now()}`,
              post_id: 'post_10294',
              from: { id: 'fb-hook-user', name: 'Khách Webhook' },
              message: 'Comment từ webhook',
            },
          },
        ],
      },
    ],
  }, false);
  check('Webhook Messenger + comment', msgHook.ok === true);
  const comments = await api('GET', '/comments?status=NEW');
  check('Comment webhook vào danh sách', comments.some((c) => c.authorName === 'Khách Webhook'));

  // 15) RBAC: nhân viên không tạo được user
  const lanLogin = await api('POST', '/auth/login', { email: 'lan@chumchum.vn', password: 'Lan@123' }, false);
  const saveToken = token;
  token = lanLogin.accessToken;
  let forbidden = true;
  try {
    await api('POST', '/users', { email: 'x@x.vn', name: 'X', password: '123456', role: 'STAFF' });
    forbidden = false;
  } catch {
    /* kỳ vọng bị chặn */
  }
  check('RBAC: STAFF không tạo được user', forbidden);
  token = saveToken;

  console.log('\n🏁 Smoke test hoàn tất!');
})().catch((err) => {
  console.error('💥', err.message);
  process.exit(1);
});

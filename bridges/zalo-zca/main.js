// Bridge Zalo cá nhân cho ChumChum CRM — dùng thư viện zca-js (https://tdung.gitbook.io/zca-js)
//
// ⚠️ KHÔNG CHÍNH THỨC: Zalo không cấp API cho tài khoản cá nhân. Service này đăng nhập
// nick Zalo của bạn như một thiết bị ảo — vi phạm điều khoản Zalo, CÓ THỂ BỊ KHÓA NICK.
// Khuyến nghị dùng Zalo OA. Chỉ dùng khi bạn chấp nhận rủi ro.
//
// Contract với ChumChum CRM (ZaloPersonalAdapter):
//   POST /send    header x-api-key, body {userId, text}   → {messageId}
//   GET  /status  header x-api-key                         → {connected}
//   GET  /qr      header x-api-key                         → {qr: "data:image/png;base64,..."}
//   GET  /friends header x-api-key                         → {friends: [{userId, displayName, avatar, phoneNumber}]}
//
// Đăng nhập bằng QR: bấm "Lấy mã QR" trong CRM → quét bằng app Zalo.
// (Sau mỗi lần restart bridge cần quét lại — zca-js không lưu được đủ bộ đăng nhập.)
import { Zalo, ThreadType } from 'zca-js';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';

const API_KEY = process.env.API_KEY ?? '';
const WEBHOOK_URL = process.env.CRM_WEBHOOK_URL ?? '';
const PORT = Number(process.env.PORT ?? 4100);
const DATA_DIR = process.env.DATA_DIR ?? '.';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

if (!API_KEY || !WEBHOOK_URL) {
  console.error('Thiếu env API_KEY hoặc CRM_WEBHOOK_URL');
  process.exit(1);
}
mkdirSync(DATA_DIR, { recursive: true });

let api = null; // instance zca-js sau đăng nhập
let loginPromise = null;
let qrError = '';
let currentQrDataUrl = null; // ảnh QR (dataURL) do chính Zalo sinh trong callback loginQR
let lastQrEvent = -1; // 0=Generated, 1=Expired, 2=Scanned, 3=Declined, 4=GotLoginInfo

/** Đẩy tin về webhook ChumChum CRM — cả tin khách gửi (IN) lẫn tin mình gửi từ app Zalo (OUT) */
function onMessage(msg) {
  try {
    if (msg.type !== ThreadType.User) return; // bỏ tin nhóm
    const content = msg.data?.content;
    if (typeof content !== 'string' || !content) return; // ảnh/file qua zca: chưa hỗ trợ đẩy về
    const payload = JSON.stringify({
      accountExternalId: 'default',
      externalUserId: String(msg.data.uidFrom ?? ''),
      userDisplayName: msg.isSelf ? undefined : msg.data.dName,
      text: content,
      externalMessageId: String(msg.data.msgId ?? ''),
      direction: msg.isSelf ? 'OUT' : 'IN',
    });
    fetch(WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload })
      .then((r) => r.body?.cancel?.())
      .catch(() => undefined);
  } catch (err) {
    console.error('onMessage lỗi:', err?.message ?? err);
  }
}

/** Bắt đầu luồng đăng nhập QR (idempotent). Callback đưa ẢNH QR do Zalo sinh (data.image base64). */
function ensureLogin() {
  if (api || loginPromise) return;
  qrError = '';
  currentQrDataUrl = null;
  lastQrEvent = -1;
  loginPromise = (async () => {
    const zalo = new Zalo({ selfListen: true, logging: true }); // selfListen để bắt cả tin MÌNH gửi từ app Zalo (đồng bộ về CRM)
    const a = await zalo.loginQR(
      { userAgent: USER_AGENT },
      (qrEvent) => {
        lastQrEvent = qrEvent?.type ?? -1;
        // type 0 = QRCodeGenerated: data.image là PNG base64 (thư viện đã strip prefix)
        if (qrEvent?.type === 0 && qrEvent?.data?.image) {
          currentQrDataUrl = `data:image/png;base64,${qrEvent.data.image}`;
          console.log('Mã QR đã sẵn sàng — quét bằng app Zalo (Cài đặt → Đăng nhập thiết bị khác)...');
        }
        if (qrEvent?.type === 1) console.log('QR hết hạn — bấm Lấy mã QR lại');
        if (qrEvent?.type === 2) console.log('📱 Đã quét QR — chờ xác nhận trên điện thoại...');
        if (qrEvent?.type === 3) qrError = 'Bạn đã từ chối đăng nhập trên điện thoại';
      },
    );
    api = a;
    api.listener.on('message', onMessage);
    api.listener.start();
    console.log(`✅ Đã đăng nhập Zalo qua QR (uid: ${api.getOwnId?.() ?? '?'}) — đang lắng nghe tin nhắn`);
    currentQrDataUrl = null; // QR đã dùng xong
  })()
    .catch((err) => {
      qrError = err?.message ?? String(err);
      console.error('Đăng nhập QR thất bại:', qrError);
    })
    .finally(() => {
      loginPromise = null;
    });
}

function json(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  try {
    return JSON.parse(raw || '{}');
  } catch {
    return {};
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (req.headers['x-api-key'] !== API_KEY) return json(res, 401, { error: 'sai api key' });

  if (req.method === 'GET' && url.pathname === '/status') {
    return json(res, 200, { connected: !!api });
  }

  // Ngắt phiên Zalo trên bridge (CRM gọi khi người dùng "Ngắt kết nối" kênh)
  if (req.method === 'POST' && url.pathname === '/logout') {
    if (api) {
      try {
        api.listener.stop();
      } catch {
        /* bỏ qua */
      }
      api = null;
      console.log('🔌 Đã ngắt phiên Zalo trên bridge theo yêu cầu từ CRM');
    }
    return json(res, 200, { ok: true });
  }

  if (req.method === 'GET' && url.pathname === '/qr') {
    if (api) return json(res, 200, { connected: true });
    ensureLogin();
    // Chờ QR được render (tối đa 30 giây)
    for (let i = 0; i < 30 && !currentQrDataUrl && !qrError; i++) {
      await new Promise((r) => setTimeout(r, 1000));
    }
    if (qrError) return json(res, 502, { error: `lấy QR lỗi: ${qrError}` });
    if (!currentQrDataUrl) return json(res, 504, { error: 'QR chưa được tạo sau 30 giây — thử lại' });
    return json(res, 200, { qr: currentQrDataUrl });
  }

  if (req.method === 'GET' && url.pathname === '/friends') {
    if (!api) return json(res, 401, { error: 'bridge chưa đăng nhập — quét mã QR từ CRM trước' });
    try {
      const friends = await api.getAllFriends();
      const list = (friends ?? []).map((f) => ({
        userId: f.userId,
        displayName: f.displayName,
        avatar: f.avatar,
        phoneNumber: f.phoneNumber,
      }));
      return json(res, 200, { friends: list, total: list.length });
    } catch (err) {
      return json(res, 502, { error: err?.message ?? String(err) });
    }
  }

  if (req.method === 'POST' && url.pathname === '/send') {
    if (!api) return json(res, 401, { error: 'bridge chưa đăng nhập — quét mã QR từ CRM trước' });
    const body = await readBody(req);
    if (!body.userId) return json(res, 400, { error: 'thiếu userId' });
    if (!body.text && !body.imageUrl) return json(res, 400, { error: 'cần text hoặc imageUrl' });
    try {
      let result;
      if (body.imageUrl) {
        // zca-js cần Buffer file (không nhận URL) → tải về rồi gửi kèm attachment
        const imgRes = await fetch(body.imageUrl);
        if (!imgRes.ok) return json(res, 400, { error: `không tải được ảnh từ ${body.imageUrl} (${imgRes.status})` });
        const buf = Buffer.from(await imgRes.arrayBuffer());
        result = await api.sendMessage(
          { msg: body.text || '', attachments: [{ data: buf, filename: body.filename || 'image.png', metadata: { totalSize: buf.length } }] },
          String(body.userId),
          ThreadType.User,
        );
      } else {
        result = await api.sendMessage(body.text, String(body.userId), ThreadType.User);
      }
      return json(res, 200, { messageId: result?.msgId ?? `${Date.now()}-${randomBytes(3).toString('hex')}` });
    } catch (err) {
      return json(res, 502, { error: err?.message ?? String(err) });
    }
  }

  json(res, 404, { error: 'không hỗ trợ' });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`🌉 Zalo bridge (zca-js) chạy tại :${PORT} — chờ quét QR từ CRM`);
});

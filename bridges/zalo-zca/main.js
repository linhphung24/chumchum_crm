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
import QRCode from 'qrcode';
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
let currentQrDataUrl = null; // QR mới nhất dạng dataURL (zca-js callback lại mỗi khi QR đổi)

/** Đẩy tin khách gửi về webhook ChumChum CRM */
function onMessage(msg) {
  try {
    if (msg.type !== ThreadType.User || msg.isSelf) return; // bỏ tin nhóm + tin của chính mình
    const content = msg.data?.content;
    if (typeof content !== 'string' || !content) return;
    const payload = JSON.stringify({
      accountExternalId: 'default',
      externalUserId: String(msg.data.uidFrom ?? ''),
      userDisplayName: msg.data.dName ?? undefined,
      text: content,
      externalMessageId: String(msg.data.msgId ?? ''),
    });
    fetch(WEBHOOK_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: payload })
      .then((r) => r.body?.cancel?.())
      .catch(() => undefined);
  } catch (err) {
    console.error('onMessage lỗi:', err?.message ?? err);
  }
}

/** Bắt đầu luồng đăng nhập QR (idempotent). zca-js đưa chuỗi code QR → tự render PNG dataURL. */
function ensureLogin() {
  if (api || loginPromise) return;
  qrError = '';
  currentQrDataUrl = null;
  loginPromise = (async () => {
    const zalo = new Zalo({ selfListen: false, logging: true });
    const a = await zalo.loginQR(
      { userAgent: USER_AGENT },
      async (qrEvent) => {
        // qrEvent = { type, data: { code, token }, actions } — bắn mỗi khi có QR mới
        try {
          const code = qrEvent?.data?.code ?? '';
          if (code) {
            currentQrDataUrl = await QRCode.toDataURL(code, { width: 300, margin: 1 });
            console.log('Mã QR đã sẵn sàng — chờ quét bằng app Zalo...');
          }
        } catch (err) {
          qrError = `render QR lỗi: ${err?.message ?? err}`;
          console.error(qrError);
        }
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
    if (!body.userId || !body.text) return json(res, 400, { error: 'body sai định dạng {userId, text}' });
    try {
      const result = await api.sendMessage(body.text, String(body.userId), ThreadType.User);
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

# 🐹 ChumChum CRM

**Inbox đa kênh + quản lý khách hàng & đơn hàng** — chạy trên cả điện thoại và máy tính qua trình duyệt (PWA, cài được lên màn hình chính).

Đồng bộ tin nhắn từ các kênh về **một nguồn duy nhất**:

| Kênh | Trạng thái tích hợp | Ghi chú |
|---|---|---|
| 💬 Zalo OA | ✅ API chính thức (webhook + gửi tin) | [developers.zalo.me](https://developers.zalo.me/docs/api/official-account-api-230) |
| 📱 Zalo cá nhân | ⚠️ Qua bridge **không chính thức** (mặc định TẮT) | Zalo không có API chính thức — **rủi ro khóa tài khoản** |
| 📘 Messenger | ✅ API chính thức (Meta) | Cần Meta App + Page Access Token |
| 🗣️ Comment Facebook | ✅ API chính thức (webhook `feed`) | Lấy comment về → trả lời → **tạo đơn ngay** |
| 📸 Instagram | ✅ Instagram Messaging API | IG Business gắn vào Page |
| 🎵 TikTok | ⚙️ Code sẵn — chờ xét duyệt | [Nộp đơn TikTok](https://business-api.tiktok.com/portal/docs/access-to-business-messaging-api/v1.3) |
| 🛍️ Shopee | ✅ Đơn hàng · ⚙️ Chat chờ whitelist | [Xin quyền Chat API](https://open.shopee.com/faq/56) |
| 🗂 Trello | ✅ API + webhook 2 chiều | Tạo card từ đơn / kéo card → đổi trạng thái đơn |

> **Không có token nào? Không sao!** Mọi kênh đều có **chế độ MOCK** — bấm "🧪 Giả lập tin nhắn" trong Inbox để test toàn bộ luồng ngay lập tức.

---

## 🚀 Chạy dự án (dev)

Yêu cầu: **Node.js ≥ 20** và **Docker** (chạy PostgreSQL qua docker-compose).

```bash
npm install          # cài dependencies cho cả monorepo
docker compose up -d # khởi động PostgreSQL (chạy nền)
npm run setup        # migrate + seed dữ liệu mẫu
npm run dev          # chạy song song API (:4000) + Web (:3000)
```

Mở **http://localhost:3000** và đăng nhập:

| Tài khoản | Mật khẩu | Vai trò |
|---|---|---|
| `admin@chumchum.vn` | `Admin@123` | Quản trị viên |
| `lan@chumchum.vn` | `Lan@123` | Nhân viên (sale) |

> Dùng trên điện thoại: mở http://ip-máy-tính:3000 → trình duyệt sẽ gợi ý **"Thêm vào màn hình chính"** để dùng như app.

## 📦 Cấu trúc

```
chumchum_crm/
├── apps/
│   ├── api/          # NestJS — REST API + Socket.io + webhooks các kênh
│   │   ├── prisma/   # schema + migrations + seed (PostgreSQL)
│   │   └── src/
│   │       ├── auth/         # JWT + refresh token + RBAC (ADMIN/MANAGER/STAFF)
│   │       ├── channels/     # ChannelAdapter + 6 adapter kênh + pipeline hợp nhất
│   │       ├── webhooks/     # Endpoint nhận webhook từ Zalo/Meta/TikTok/Shopee
│   │       ├── conversations/# Inbox: hội thoại, tin nhắn, phân công
│   │       ├── comments/     # Comment FB → trả lời → tạo đơn
│   │       ├── orders/       # Đơn hàng + lịch sử trạng thái
│   │       ├── trello/       # Tạo card, map cột, webhook ngược
│   │       ├── analytics/    # Thống kê
│   │       ├── realtime/     # Socket.io + event bus nội bộ
│   │       ├── jobs/         # Cron đồng bộ đơn Shopee, dọn log
│   │       └── dev/          # Giả lập tin nhắn/comment (tự tắt ở production)
│   └── web/          # Next.js 15 (App Router) + Tailwind — PWA hồng đào
├── docker-compose.yml  # PostgreSQL + api + web (Docker, production)
├── deploy/nginx.conf   # reverse proxy nginx cho VPS
└── scripts/smoke.js    # Test end-to-end toàn bộ luồng
```

## 🧪 Kiểm tra nhanh

API đang chạy (`npm run dev:api`):

```bash
node scripts/smoke.js   # 24 bài test: login, inbox, comment→đơn, webhook, RBAC...
```

## 🔗 Kết nối kênh thật

Vào **Cài đặt → Kênh** trong app, điền token của kênh muốn bật (để trống = mock). **Hướng dẫn từng bước cho từng kênh: [`docs/HUONG-DAN-KET-NOI.md`](docs/HUONG-DAN-KET-NOI.md)**. Webhook URL trỏ về server của bạn:

| Kênh | Webhook URL đặt trên nhà cung cấp | Lấy credentials ở đâu |
|---|---|---|
| Zalo OA | `https://your-domain/webhooks/zalo` | developers.zalo.me → OA của bạn → Access Token |
| Messenger + Comment FB | `https://your-domain/webhooks/messenger` | Meta for Developers → App → Page Access Token (quyền `pages_messaging` + `pages_read_engagement`) |
| Instagram | `https://your-domain/webhooks/instagram` | Như Messenger (tài khoản IG Business) |
| TikTok | `https://your-domain/webhooks/tiktok` | Sau khi được duyệt Business Messaging |
| Shopee | `https://your-domain/webhooks/shopee` | open.shopee.com → Partner (đơn hàng chạy ngay; chat cần whitelist) |
| Trello | `https://your-domain/webhooks/trello` | trello.com/power-ups/admin → API Key + Token |

Trello dùng qua UI: **Cài đặt → Trello** → dán Key/Token → chọn board → map cột trạng thái → đơn mới tự tạo card; kéo card trên Trello thì trạng thái đơn đổi theo (cần đăng ký webhook bằng URL public).

### ⚠️ Zalo cá nhân (bridge không chính thức)

Zalo **không cung cấp API chính thức** cho tài khoản cá nhân. Kênh này kết nối qua "bridge" service tự host:

- Cấu hình `ZALO_PERSONAL_BRIDGE_URL` + `ZALO_PERSONAL_BRIDGE_API_KEY` (file `apps/api/.env`)
- Bridge contract: `POST {url}/send` body `{ userId, text }` header `x-api-key`; nhận tin thì bridge POST payload chuẩn hoá về `/webhooks/zalo-personal`
- **Rủi ro**: vi phạm điều khoản Zalo, tài khoản có thể bị khóa bất cứ lúc nào — hãy cân nhắc dùng Zalo OA thay thế

## 🏭 Production (VPS Ubuntu)

Hướng dẫn đầy đủ từng bước (Docker + Nginx + HTTPS): **[`docs/DEPLOY-VPS.md`](docs/DEPLOY-VPS.md)**

Tóm tắt: `docker compose --profile app up -d --build` (postgres + api + web) → seed admin → nginx + certbot cho `chat.<domain>` (web) và `api.<domain>` (API). HTTPS bắt buộc để nhận webhook từ Meta/Zalo/Shopee/Trello và cài PWA trên điện thoại.

## 🛠 Công nghệ

NestJS 11 · Prisma 6 (SQLite/PostgreSQL) · Next.js 15 · TailwindCSS · Socket.io · Recharts · JWT + RBAC · @nestjs/schedule (cron)

## 📋 Phạm vi MVP đã có

- [x] Đăng nhập/đăng xuất, refresh token, phân quyền 3 vai trò, quản lý người dùng
- [x] Inbox hợp nhất 3 cột (desktop) / 1 cột + bottom-sheet (mobile), realtime Socket.io
- [x] 6 adapter kênh + webhook chuẩn hoá + chế độ mock toàn bộ
- [x] Comment Facebook: trả lời, chuyển thành đơn hàng
- [x] Khách hàng hợp nhất danh tính đa kênh, tags, ghi chú, lịch sử chat + đơn
- [x] Đơn hàng: tạo từ chat/comment/manual/Shopee, lịch sử trạng thái, mã tự sinh
- [x] Trello: tạo card tự động, map cột ↔ trạng thái, webhook đồng bộ ngược
- [x] Thống kê: doanh thu, kênh, trạng thái, hiệu suất nhân viên
- [x] Cron đồng bộ đơn Shopee (Open Platform)

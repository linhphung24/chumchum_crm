# ChumChum CRM — hướng dẫn cho AI agent

Monorepo npm workspaces: `apps/api` (NestJS 11 + Prisma + Socket.io) và `apps/web` (Next.js 15 App Router + Tailwind, PWA). Thông tin đầy đủ (kết nối kênh, production, tài khoản mẫu) trong `README.md`.

## Lệnh

- `npm run dev` — chạy song song API (:4000) + Web (:3000)
- `docker compose up -d` — khởi động PostgreSQL (bắt buộc trước khi setup/dev)
- `npm run setup` — prisma generate + migrate + seed (cần PostgreSQL đang chạy)
- `npm run build` — build cả api + web
- `node scripts/smoke.js` — smoke test 24 luồng, cần API đang chạy (đổi địa chỉ qua env `API_BASE`)
- Deploy VPS: `docker compose --profile app up -d --build` — hướng dẫn đầy đủ trong `docs/DEPLOY-VPS.md`

## Quy tắc tiết kiệm token

- KHÔNG đọc các thư mục/file sinh ra: `node_modules/`, `apps/api/dist/`, `apps/web/.next/`, `*.db`, `*.tsbuildinfo`, `.env` (chỉ đọc `.env.example` khi cần).
- Khi tìm code, ưu tiên grep chính xác trong `apps/api/src/` hoặc `apps/web/src/` thay vì đọc toàn bộ file lớn.
- Bản đồ module chính ở `apps/api/src/app.module.ts` và cấu trúc trang ở `apps/web/src/app/(app)/`.

## Quy ước code

- TypeScript strict; UI và nội dung hiển thị dùng **tiếng Việt**; màu thương hiệu = Tailwind palette `brand` (hồng đào).
- Sửa CSDL: chỉnh `apps/api/prisma/schema.prisma` → `npx prisma migrate dev --name <ten>` → restart API. KHÔNG sửa file migration cũ.
- Thêm kênh chat mới: tạo adapter theo interface `ChannelAdapter` trong `apps/api/src/channels/adapters.ts`, đăng ký ở `channels.service.ts` + `channels.module.ts`, nhận tin qua `webhooks/` → luôn gọi `ChannelIngestService.handleIncoming()` (pipeline hợp nhất). Không có credentials = trả `mockSendResult()`.
- Kênh cần accessToken lấy từ `ChannelAccount.credentials` (JSON string) hoặc env tương ứng.
- Đơn hàng đổi trạng thái qua `OrdersService.setStatus` (bắn event → Trello tự sync qua `InternalBusService`); KHÔNG gọi Trello trực tiếp từ nơi khác.
- Realtime: push sự kiện qua `EventsGateway` (`message:new`, `message:sent`, `conversation:updated`, `order:updated`, `comment:new`).
- Endpoint `/dev/*` chỉ dùng cho test, tự chặn khi `NODE_ENV=production`.

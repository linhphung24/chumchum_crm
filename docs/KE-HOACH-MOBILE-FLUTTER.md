# 📱 Kế hoạch phát triển mobile app bằng Flutter

Tài liệu lộ trình cho app ChumChum CRM trên iOS/Android, **tái sử dụng toàn bộ backend hiện có** (không viết API mới trừ phần push device token).

## Nguyên tắc kiến trúc

| Thành phần | Cách dùng | Ghi chú |
|---|---|---|
| REST API | Dùng nguyên `https://api.chumchumbakery.com` | Đã có JWT + refresh token xoay vòng |
| Realtime | `socket_io_client` (Dart) | Gateway sẵn `message:new`, `conversation:updated`, `order:updated`, `comment:new`; auth bằng `{ auth: { token } }` như web |
| Push notify | **FCM** (Firebase Cloud Messaging) | Khác Web Push của PWA — cần thêm bảng `DeviceToken` (userId, fcmToken, platform) + endpoint đăng ký/xoá + gửi qua FCM trong `NotificationsService` (đặt cạnh `notifyAll` hiện có) |
| Auth | Lưu access + refresh bằng `flutter_secure_storage` | Tự refresh khi 401 (làm lại `lib/api.ts` của web) |
| State | Riverpod hoặc Bloc | Gợi ý Riverpod cho team nhỏ |
| Cấu trúc | `feature-first`: `features/auth`, `features/inbox`, `features/orders`, `features/customers`, `features/settings` | |

## Lộ trình theo mốc

### M1 — Nền tảng + Inbox realtime (ước lượng 2–3 tuần)
- Khung app: navigation dưới (Inbox / Bình luận / Đơn / Khách / Cài đặt), theme hồng đào brand.
- Đăng nhập/đăng xuất, refresh token nền, chặn khi bị khoá (`isActive`).
- Inbox: danh sách hội thoại, mở chat, gửi tin, realtime socket, unread badge.
- *Definition of done: nhận tin từ kênh thật hiện trên app dưới 2 giây.*

### M2 — Khách hàng + Đơn hàng (1.5–2 tuần)
- Danh sách/chi tiết khách (tags, ghi chú, lịch sử chat + đơn).
- Tạo đơn từ chat, đổi trạng thái đơn, xem lịch sử trạng thái.

### M3 — Push FCM + Bình luận (1.5–2 tuần)
- Backend: bảng `DeviceToken` + endpoint + gửi FCM (song song giữ Web Push PWA hiện có).
- App: nhận notify, bấm mở đúng hội thoại/comment.
- Trang Bình luận FB: trả lời, chuyển đơn.

### M4 — Hoàn thiện + lên store (1.5–2 tuần)
- Cài đặt: đổi mật khẩu, quản lý kênh (đơn giản hoá — chỉ xem trạng thái).
- Icon/splash brand, localized tiếng Việt, crash reporting (Sentry).
- TestFlight + Google Play internal testing → publish.
- Lưu ý: đăng ký nhà phát triển Apple ($99/năm) + Google Play ($25 một lần).

## Tổng ước lượng
~7–9 tuần cho 1 lập trình viên Flutter quen tay; M1 có thể demo sau 2–3 tuần.

## Quyết định cần chốt trước khi bắt đầu
1. **Có thay PWA không?** Khuyến nghị: giữ song song cả hai — PWA cho nhân viên ít dùng, app native cho người chính (notify ổn định hơn trên iOS).
2. **Push iOS**: FCM cần certificate APNs — làm khi tới M3.
3. **Bắt đầu khi nào**: nên để web ổn định 2–4 tuần dùng thật trước, thu thập feedback rồi mới làm M1.

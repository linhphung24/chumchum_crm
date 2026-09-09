# 🌉 Bridge Zalo cá nhân (zca-js) cho ChumChum CRM

> ## ⚠️ ĐỌC TRƯỚC KHI DÙNG
> Zalo **KHÔNG có API chính thức** cho tài khoản cá nhân. Bridge đăng nhập nick Zalo của bạn
> như một thiết bị ảo (qua thư viện [zca-js](https://tdung.gitbook.io/zca-js)) — **vi phạm điều khoản
> Zalo, nick CÓ THỂ BỊ KHÓA**. Ưu tiên dùng **Zalo OA**. Chỉ bật khi chấp nhận rủi ro.

## Kiến trúc

```
Zalo app ──(zca-js websocket)──> bridge (service này) ──HTTP──> ChumChum API /webhooks/zalo-personal
Nhân viên ──> ChumChum CRM ──> ChumChum API ──POST /send──> bridge ──> gửi tin qua Zalo
```

## Chạy (trên VPS)

1. Đảm bảo `.env` có: `ZALO_BRIDGE_API_KEY=<mật khẩu tự đặt>`
2. Khởi động:
   ```bash
   cd /opt/chumchum_crm
   docker compose --profile zalo-personal up -d --build zalo-bridge
   docker compose logs -f zalo-bridge   # thấy "chờ quét QR từ CRM" là chạy đúng
   ```
3. Trong app: **Cài đặt → Kênh → Zalo cá nhân → Kết nối**:
   - Bridge URL: `http://zalo-bridge:4100`
   - Bridge API Key: giá trị `ZALO_BRIDGE_API_KEY`
4. Bấm **📱 Lấy mã QR** → QR hiện trong app → mở **app Zalo trên điện thoại** → quét → xác nhận.
5. Log hiện `✅ Đã đăng nhập Zalo qua QR` → **💾 Lưu kết nối**.
6. (Tuỳ chọn) **👥 Đồng bộ danh sách bạn bè Zalo** — kéo toàn bộ bạn bè vào Khách hàng (kèm SĐT nếu có).

## API của bridge

| Endpoint | Auth | Ý nghĩa |
|---|---|---|
| `POST /send` `{userId, text}` | `x-api-key` | Gửi tin text |
| `GET /status` | `x-api-key` | `{connected}` |
| `GET /qr` | `x-api-key` | QR đăng nhập dạng dataURL |
| `GET /friends` | `x-api-key` | Danh sách bạn bè (userId, displayName, avatar, phoneNumber) |

## Ghi chú

- **Restart bridge = quét QR lại** (zca-js không lưu đủ bộ đăng nhập: cookie + imei). Hạn chế restart container.
- Gửi ảnh/file từ CRM qua kênh cá nhân: zca-js hỗ trợ attachments — chưa bật ở bridge v1, sẽ thêm nếu cần.
- Lỗi gì xem `docker compose logs zalo-bridge` và báo lại.

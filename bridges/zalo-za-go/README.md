# 🌉 Bridge Zalo cá nhân (za-go) cho ChumChum CRM

> ## ⚠️ ĐỌC TRƯỚC KHI DÙNG
> Zalo **KHÔNG có API chính thức** cho tài khoản cá nhân. Bridge này đăng nhập nick Zalo của
> bạn như một "thiết bị ảo" (qua thư viện không chính thức [za-go](https://github.com/tranhaonguyendev/Za-go)) —
> **vi phạm điều khoản Zalo, nick CÓ THỂ BỊ KHÓA bất cứ lúc nào**. Hãy dùng **Zalo OA** nếu có thể
> (CRM đã hỗ trợ đầy đủ). Chỉ bật bridge này khi bạn chấp nhận rủi ro.

## Kiến trúc

```
Zalo app ──(socket, za-go)──> bridge (service này) ──HTTP──> ChumChum API /webhooks/zalo-personal
Nhân viên ──> ChumChum CRM ──> ChumChum API ──POST /send──> bridge ──> gửi tin qua Zalo
```

## Chạy (trên VPS, qua docker-compose của repo)

1. Thêm vào `/opt/chumchum_crm/.env`:
   ```
   ZALO_BRIDGE_API_KEY=<mật khẩu bất kỳ bạn tự đặt>
   ```
2. Khởi động:
   ```bash
   cd /opt/chumchum_crm
   docker compose --profile zalo-personal up -d --build zalo-bridge
   docker compose logs zalo-bridge   # thấy "Chưa có phiên — dùng nút 'Lấy mã QR'..." là đang chạy đúng
   ```
3. Trong app: **Cài đặt → Kênh → Zalo cá nhân → Kết nối** → điền:
   - Bridge URL: `http://zalo-bridge:4100`
   - Bridge API Key: giá trị `ZALO_BRIDGE_API_KEY` ở trên
4. Bấm **📱 Lấy mã QR** → mã QR hiện ngay trong app → mở **app Zalo trên điện thoại** →
   *Cài đặt → Đăng nhập trên thiết bị khác → Quét mã QR* → quét → bấm **⏳ Chờ quét QR** (hoặc để tự chờ).
5. Khi bridge log `✅ Đã đăng nhập Zalo qua QR` → bấm **💾 Lưu kết nối**. Phiên được lưu trong
   volume `zalo-bridge-data` — restart container khỏi quét lại.

## API của bridge

| Endpoint | Auth | Ý nghĩa |
|---|---|---|
| `POST /send` `{userId, text}` | header `x-api-key` | Gửi tin text tới khách (cá nhân) |
| `GET /status` | header `x-api-key` | `{connected}` — đã đăng nhập + đang lắng nghe |
| `GET /qr` | header `x-api-key` | Chưa hỗ trợ (za-go chưa có QR flow ổn định) — đăng nhập bằng SĐT/mật khẩu |

## Ghi chú

- IMEI được sinh 1 lần và lưu trong volume `zalo-bridge-data` — giữ thiết bị ổn định qua các lần restart để giảm nguy cơ bị Zalo chú ý.
- Session đăng nhập được za-go giữ trong bộ nhớ; nếu container restart phải đăng nhập lại bằng SĐT/mật khẩu (tự động).
- Đây là phần MỚI, chưa được kiểm chứng trên tài khoản thật — nếu lỗi compile/chạy, xem `docker compose logs zalo-bridge` và báo lại để sửa.

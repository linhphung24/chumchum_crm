# 🔌 Hướng dẫn kết nối từng kênh — ChumChum CRM

Sau khi kết nối xong kênh nào, vào **Cài đặt → Kênh** trong app để nhập thông tin. Trạng thái chuyển thành **"✅ Đã kết nối"** nghĩa là kênh đó bắt đầu nhận/gửi tin thật.

## ⚠️ Yêu cầu chung trước khi kết nối

**Webhook cần URL công khai (HTTPS).** Zalo/Meta/Shopee/Trello gọi về server của bạn, nên `localhost` sẽ không nhận được tin nhắn thật.

- **Đang test trên máy cá nhân**: dùng tunnel — ví dụ [ngrok](https://ngrok.com):
  ```bash
  ngrok http 4000        # tạo HTTPS URL trỏ tới API local
  ```
  Lấy URL dạng `https://xxxx.ngrok-free.app` và dùng nó cho các bước "Webhook URL" bên dưới.
- **Đã deploy**: dùng domain thật của bạn, ví dụ `https://api.ten-mien-cua-ban.vn`.

**Bảng webhook URL của ChumChum** (thay `https://your-domain` bằng URL của bạn):

| Kênh | Webhook URL |
|---|---|
| Zalo OA | `https://your-domain/webhooks/zalo` |
| Messenger + Comment FB | `https://your-domain/webhooks/messenger` |
| Instagram | `https://your-domain/webhooks/instagram` |
| TikTok | `https://your-domain/webhooks/tiktok` |
| Shopee | `https://your-domain/webhooks/shopee` |
| Trello (đăng ký trong app) | `https://your-domain/webhooks/trello` |

---

## 1. 💬 Zalo OA (API chính thức — hoạt động ngay)

**Điều kiện**: đã có Zalo OA (đăng ký tại [oa.zalo.me](https://oa.zalo.me) hoặc zalo.cloud — OA phải đã duyệt và đang hoạt động).

### Cách A — Cấp quyền 1-cú-click (khuyên dùng, token tự động)

1. Vào **[developers.zalo.me](https://developers.zalo.me)** → **Quản lý ứng dụng** → tạo app → copy **App ID** + **Secret Key**.
2. Điền vào file `.env` trên server rồi restart API (làm 1 lần):
   ```
   ZALO_OA_APP_ID=...
   ZALO_OA_APP_SECRET=...
   ```
3. Vào app → **Cài đặt → Kênh → Zalo OA → Kết nối** → bấm **"🔗 Đăng nhập Zalo để cấp quyền"** → chọn OA → **Cho phép**.
4. Hệ thống tự lưu access token + refresh token và **tự làm mới mỗi ngày lúc 2h sáng** (access token Zalo sống 25 giờ, refresh token 3 tháng dùng 1 lần — cron quay vòng liên tục nên không bao giờ hết).

### Cách B — Dán token thủ công (test nhanh, không cần app)

1. Trên developers.zalo.me → **API Explorer** (Công cụ → API Explorer) → chọn app, Token loại **OA Token**, chọn OA → tích quyền nhắn tin/quản lý → **Sinh Access Token** → copy `access_token` + `refresh_token`.
2. Vào **Cài đặt → Kênh → Zalo OA → Kết nối** → dán Access Token (+ Refresh Token + App ID nếu muốn tự làm mới) → **Kiểm tra kết nối** → **Lưu**.
   - Token tay sống 25 giờ — nếu có Refresh Token + App ID thì cron vẫn tự làm mới được.

### Webhook (cả 2 cách đều phải làm)

Tại trang quản lý OA trên developers.zalo.me → mục **Webhook** → dán:
`https://api.chumchumbakery.com/webhooks/zalo`
Chọn nhận sự kiện **Tin nhắn khách gửi** (user_send_text, user_send_image, user_send_attachment...).
Nếu Zalo yêu cầu **xác thực domain**: vào tab **🌐 Domain** trong Cài đặt → thêm domain → dán mã Zalo cấp (hệ thống tự phục vụ file xác thực).

✅ Kiểm tra: dùng Zalo cá nhân **quan tâm OA** rồi nhắn tin → tin hiện trong Inbox.

> Lưu ý: người dùng phải **quan tâm (follow) OA** thì mới chat 2 chiều được — đây là quy định của Zalo với mọi nền tảng CRM.

## 2. 📘 Messenger + 🗣️ Comment Facebook (chung 1 Meta App)

**Điều kiện**: có Facebook Page + tài khoản Facebook quản trị Page.

1. Vào **[developers.facebook.com](https://developers.facebook.com)** → **My Apps → Create App** → loại **Business**.
2. Trong App → **Add Product → Messenger → Set up**.
3. Tab **Settings** của Messenger:
   - **Page Access Token**: chọn Page của bạn → **Generate access token** → copy (cấp đủ quyền khi hỏi).
   - **Webhooks → Callback URL**: dán `https://your-domain/webhooks/messenger`
   - **Verify Token**: nhập đúng giá trị `FB_VERIFY_TOKEN` trong `apps/api/.env` (mặc định `chumchum-verify`) → **Verify and save**.
   - Tick đăng ký field: **messages**, **messaging_postbacks**.
4. **Để nhận comment**: App → **Add Product → Webhooks** → mục **Page** → cấu hình callback tương tự → tick field **feed**.
5. Vào app → **Cài đặt → Kênh → Messenger → Kết nối**:
   - Tên: tên Page
   - ID kênh: **Page ID** (xem trong trang Giới thiệu của Page, hoặc mục Page settings trên Meta)
   - Page Access Token: token bước 3 → **Lưu kết nối**.

✅ Kiểm tra: nhắn tin vào Page → tin vào Inbox; comment bài viết Page → hiện ở trang **Bình luận**.

> Khi App còn chế độ **Dev**, chỉ admin/tester của App nhắn được. Muốn mọi người dùng được → chuyển App sang **Live**.

## 3. 📸 Instagram (Messaging API)

**Điều kiện**: tài khoản Instagram **Business/Creator** đã liên kết với Facebook Page (làm trong Settings của Instagram → Business tools).

1. Dùng **cùng Meta App** ở trên → **Add Product → Instagram**.
2. Cấu hình **Webhooks của Instagram**: callback `https://your-domain/webhooks/instagram`, Verify Token = `IG_VERIFY_TOKEN` trong `.env` → đăng ký field **messages**.
3. Vào app → **Cài đặt → Kênh → Instagram → Kết nối**:
   - Tên: tên tài khoản IG
   - ID kênh: ID của Page liên kết
   - Page Access Token: token của Page liên kết (từ bước Messenger) → **Lưu kết nối**.

✅ Kiểm tra: nhắn tin trực tiếp (DM) cho tài khoản IG → tin vào Inbox.

## 4. 🎵 TikTok (cần xét duyệt — code đã sẵn)

TikTok Business Messaging **không mở tự do**, phải nộp đơn:

1. Vào **[business-api.tiktok.com](https://business-api.tiktok.com/portal)** → đăng ký developer account.
2. Tạo app → chọn sản phẩm **Business Messaging** → điền mô tả use case (CRM chăm sóc khách hàng) → **nộp đơn xét duyệt** (có thể mất vài ngày~vài tuần, tuỳ khu vực).
3. Khi được duyệt: lấy **Access Token** trong app của bạn trên TikTok portal.
4. Cấu hình webhook trên TikTok portal: `https://your-domain/webhooks/tiktok`.
5. Vào app → **Cài đặt → Kênh → TikTok → Kết nối** → dán token → Lưu.

> Bán hàng trên **TikTok Shop**: dùng **Partner Center** ([partner.tiktokshop.com](https://partner.tiktokshop.com)) để xin API Customer Service (chat người mua).

## 5. 🛍️ Shopee (đơn hàng ngay — chat cần whitelist)

**Điều kiện**: có shop Shopee, đăng ký **Open Platform Partner**.

1. Vào **[open.shopee.com](https://open.shopee.com)** → **Register** với email shop → xác minh.
2. Tạo **App** trong Partner Center → nhận **Partner ID** + **Partner Key**.
3. **Gắn shop vào app**: dùng link authorize của Shopee (trong Partner Center → App → Authorize) → đăng nhập shop → sau đó lấy được **Shop ID**.
4. **Base URL**: `https://partner.shopeemobile.com` (chính thức) hoặc `https://partner.test-stable.shopeemobile.com` (sandbox test).
5. Vào app → **Cài đặt → Kênh → Shopee → Kết nối**: điền Base URL, Partner ID, Partner Key, Shop ID → **Lưu kết nối**.
   → Đơn hàng Shopee sẽ **tự đồng bộ mỗi 30 phút** (và tạo khách hàng tương ứng).
6. **Muốn nhận/trao đổi chat Shopee**: nộp ticket xin quyền **Chat API** (hướng dẫn: [open.shopee.com/faq/56](https://open.shopee.com/faq/56)) — Shopee xét duyệt dùng case CRM như của bạn.

## 6. 🗂 Trello (task đơn hàng)

1. Lấy **API Key**: vào **[trello.com/power-ups/admin](https://trello.com/power-ups/admin)** → đăng nhập Trello → tạo/chọn workspace → copy **API Key**.
2. Tạo **Token**: mở trình duyệt URL sau (thay `YOUR_API_KEY`):
   ```
   https://trello.com/1/authorize?expiration=30days&name=ChumChumCRM&scope=read,write&response_type=token&key=YOUR_API_KEY
   ```
   → **Allow** → copy token.
3. Vào app → **Cài đặt → Trello**:
   - Dán API Key + Token → **Lưu & tải boards**
   - Chọn **board** quản lý đơn
   - **Map cột** cho 5 trạng thái: Chờ duyệt / Đã duyệt / Đang giao / Hoàn tất / Đã huỷ → tương ứng với các list trên board → **Lưu map cột**.
4. **Đồng bộ ngược** (kéo card trên Trello → đơn đổi trạng thái): cần server public → ô "Webhook Trello" dán `https://your-domain/webhooks/trello` → **Đăng ký webhook**.

✅ Kiểm tra: tạo 1 đơn hàng mới → trên board Trello xuất hiện card; kéo card sang list "Đang giao" → đơn đổi trạng thái tương ứng.

## 7. ⚠️ 📱 Zalo cá nhân (bridge KHÔNG chính thức)

> **Zalo không có API chính thức cho tài khoản cá nhân.** Kênh này chạy qua "bridge" tự host — vi phạm điều khoản Zalo, **tài khoản có thể bị khoá bất cứ lúc nào**. Khuyến nghị dùng Zalo OA thay thế. Chỉ bật nếu bạn chấp nhận rủi ro.

### 7.1. Kết nối 1 nick

1. Tự host một bridge service (service trung gian đăng nhập Zalo cá nhân và nhận/gửi tin) — hợp đồng API bridge:
   - `POST {BRIDGE_URL}/send` — body `{ accountId, userId, text }`, header `x-api-key: BRIDGE_API_KEY` → trả `{ messageId }`
   - `GET {BRIDGE_URL}/qr` — header `x-api-key` → trả `{ qr: "<dataURL hoặc chuỗi QR>" }` — **mã QR để đăng nhập Zalo (như Zalo Web)**
   - `GET {BRIDGE_URL}/status` — header `x-api-key` → trả `{ connected: true|false }` — trạng thái đã quét QR đăng nhập chưa
   - Khi có tin đến: bridge POST payload chuẩn hoá về `https://api.chumchumbakery.com/webhooks/zalo-personal`:
     ```json
     { "accountExternalId": "zalo-1", "externalUserId": "...", "userDisplayName": "...", "text": "..." }
     ```
2. Kết nối ngay trong app: **Cài đặt → Kênh → Zalo cá nhân → Kết nối** → điền Bridge URL + API key → bấm **"📱 Lấy mã QR"** → quét bằng app Zalo trên điện thoại → chờ trạng thái "đã đăng nhập" → **Lưu kết nối**. (Không cần sửa .env.)
3. Hoặc cấu hình mặc định qua `apps/api/.env`:
   ```
   ZALO_PERSONAL_BRIDGE_URL=https://bridge-cua-ban.xxx
   ZALO_PERSONAL_BRIDGE_API_KEY=ma-bao-mat
   ```

### 7.2. Nhiều tài khoản Zalo cá nhân (nhiều nick)

Hệ thống hỗ trợ **không giới hạn số nick** — mỗi nick là một "tài khoản kênh" riêng, hội thoại tách độc lập. Cách làm:

**Bước 1 — Bridge giữ nhiều phiên:** bridge của bạn phải duy trì nhiều phiên đăng nhập Zalo cùng lúc, mỗi nick gán một mã định danh riêng (accountId). Ví dụ: `zalo-0987`, `zalo-0903` (hoặc dùng luôn số điện thoại). Mọi endpoint nhận thêm query `?accountId=...`:
- `GET {BRIDGE_URL}/qr?accountId=zalo-0987` → QR riêng cho nick đó
- `GET {BRIDGE_URL}/status?accountId=zalo-0987`
- `GET {BRIDGE_URL}/friends?accountId=zalo-0987`
- `POST {BRIDGE_URL}/send` body `{ "accountId": "zalo-0987", "userId": "...", "text": "..." }`
- `GET {BRIDGE_URL}/chats?accountId=zalo-0987&limit=20` — **đồng bộ tin nhắn cũ** về inbox, trả:
  ```json
  { "chats": [ { "userId": "...", "displayName": "...", "avatar": "...", "phone": "09...",
      "messages": [ { "id": "msg-id", "text": "...", "timestamp": 1690000000000, "direction": "IN" } ] } ] }
  ```
  (`displayName/avatar/phone` dùng tự điền hồ sơ khách; `direction: "OUT"` = tin mình gửi từ app Zalo)

(Bridge chỉ 1 nick thì bỏ qua accountId — mọi thứ vẫn chạy như cũ.)

**Bước 1b — Đồng bộ tin cũ về inbox:** trong wizard kết nối (✏️ Sửa tài khoản) có nút **"⬇️ Đồng bộ tin nhắn cũ về inbox"** — gọi `/chats` của bridge. Messenger/Instagram cũng có nút tương tự (qua Graph API `/conversations`, giới hạn ~25 hội thoại gần nhất mỗi lần). Ngoài ra hệ thống **tự động đồng bộ mỗi giờ** cho các kênh đã kết nối, và **tự làm giàu hồ sơ khách** (tên thật, ảnh, SĐT nếu kênh cung cấp) cả khi sync lẫn khi nhận tin mới.

**Bước 2 — Thêm từng nick vào ChumChum:** vào **Cài đặt → Kênh → Zalo cá nhân**:
1. Bấm **"➕ Thêm nick"** (hiện ra sau khi đã có ít nhất 1 tài khoản)
2. Bước 2 của wizard: điền tên nick, **Account ID trên bridge** (vd `zalo-0987`) — trường này vừa là accountId gửi cho bridge, vừa thành ID kênh để webhook gắn đúng hội thoại
3. Bấm **"📱 Lấy mã QR"** → quét bằng app Zalo của **nick đó** trên điện thoại → chờ "đã đăng nhập" → **Lưu kết nối**
4. Lặp lại cho từng nick tiếp theo.

**Bước 3 — Bridge đẩy tin về đúng nick:** payload webhook của nick nào phải kèm `accountExternalId` của nick đó:
```json
{ "accountExternalId": "zalo-0987", "externalUserId": "...", "text": "..." }
```
Tin mình gửi từ app Zalo trên điện thoại (echo đi) cũng truyền kèm `accountExternalId` + `"direction": "OUT"` + `externalMessageId` để ghép vào đúng hội thoại, tránh nhân đôi tin.

**Quản lý:** trong Cài đặt → Kênh, mỗi nick có hàng riêng với nút **Bật/Tắt** và **✏️ Sửa** (lấy lại QR khi bridge hết phiên); nút "👥 Đồng bộ bạn bè Zalo" ở wizard cũng lấy bạn bè của đúng nick đang sửa.

**Lưu ý quan trọng:**
- Hội thoại, khách hàng của từng nick tách riêng. **Cùng 1 người nhắn vào 2 nick sẽ thành 2 khách hàng khác nhau** (chưa có nút gộp khách — nếu cần, yêu cầu thêm).
- Mỗi nick đăng nhập Zalo Web riêng → Zalo giới hạn số phiên đăng nhập web của cùng tài khoản, nhưng **các nick khác nhau thì độc lập**.
- Rủi ro khóa nick nhân theo số nick — nick nào bị khóa chỉ ảnh hưởng nick đó (tắt nick đó trong Cài đặt, các kênh khác vẫn chạy).

---

## 🧪 Vẫn muốn test không có kênh nào?

Trong **Inbox** có nút **"🧪 Giả lập tin nhắn đến"** và trang **Bình luận** có nút giả lập — dùng để demo luồng khi chưa có token. Các nút và endpoint này **tự ẩn/khoá khi `NODE_ENV=production`**. Dữ liệu demo khi cần dọn: `npm run clean:demo -w apps/api`.

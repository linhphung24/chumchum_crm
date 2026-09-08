# 🚀 Deploy ChumChum CRM lên VPS Ubuntu

Tài liệu này đưa hệ thống từ máy dev lên VPS với HTTPS:

| Dịch vụ | Địa chỉ |
|---|---|
| Web (Next.js) | `https://chat.chumchumbakery.com` |
| API (NestJS + socket.io) | `https://api.chumchumbakery.com` |
| PostgreSQL 16 | container Docker (chỉ nội bộ) |

Kiến trúc: **Docker Compose** chạy postgres + api + web (bind `127.0.0.1`), **Nginx** trên VPS làm reverse proxy, **Certbot** cấp HTTPS.

---

## Bước 0 — Chuẩn bị (5 phút)

- VPS Ubuntu 22.04/24.04, biết IP public (lấy bằng `curl ifconfig.me` trên VPS).
- DNS: tạo **2 record A** trỏ về IP VPS (đã có `chat`, cần thêm `api`):

| Loại | Tên | Giá trị |
|---|---|---|
| A | `chat.chumchumbakery.com` | IP VPS |
| A | `api.chumchumbakery.com` | IP VPS |

Đợi DNS cập nhật rồi kiểm tra (chạy ở máy bất kỳ):

```bash
nslookup chat.chumchumbakery.com
nslookup api.chumchumbakery.com
# Cả 2 phải trả về đúng IP VPS
```

## Bước 1 — Đưa code lên GitHub (làm ở MÁY LOCAL)

Repo chưa có remote thì tạo **private repo** trên GitHub rồi:

```bash
git remote add origin git@github.com:<tai-khoan>/chumchum_crm.git
git push -u origin main
```

## Bước 2 — Cài Docker trên VPS

```bash
# Đăng nhập VPS: ssh root@IP-VPS
curl -fsSL https://get.docker.com | sh
docker compose version   # kiểm tra compose plugin đã có
```

## Bước 3 — Lấy code + tạo .env production

```bash
apt update && apt install -y git nginx certbot python3-certbot-nginx
mkdir -p /opt && cd /opt
git clone https://github.com/<tai-khoan>/chumchum_crm.git
cd chumchum_crm

cp .env.example .env
nano .env    # hoặc vim
```

Sửa các dòng quan trọng trong `.env`:

```env
NODE_ENV=production
POSTGRES_PASSWORD=<mật khẩu DB mạnh>          # tạo: openssl rand -hex 16
DATABASE_URL="postgresql://chumchum:<mật khẩu DB vừa tạo>@postgres:5432/chumchum?schema=public"
JWT_SECRET=<chuỗi ngẫu nhiên>                 # tạo: openssl rand -hex 32
CORS_ORIGINS=https://chat.chumchumbakery.com
NEXT_PUBLIC_API_URL=https://api.chumchumbakery.com
```

> ⚠️ `DATABASE_URL` phải **đồng bộ mật khẩu** với `POSTGRES_PASSWORD` (host là `postgres` — tên service trong docker, không phải localhost).

## Bước 4 — Khởi động hệ thống

```bash
docker compose --profile app up -d --build    # build lần đầu ~3-5 phút
docker compose --profile app ps               # 3 service đều Up/healthy
docker compose logs -f api                    # Ctrl+C để thoát; chờ dòng "🚀 ChumChum API"
```

API container **tự chạy `prisma migrate deploy`** trước khi khởi động — schema được tạo tự động.

Tạo tài khoản admin (chạy 1 lần):

```bash
docker compose exec api npm run seed
```

## Bước 5 — Nginx + HTTPS

```bash
cp deploy/nginx.conf /etc/nginx/sites-available/chumchum
ln -s /etc/nginx/sites-available/chumchum /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

# Cấp chứng chỉ SSL cho cả 2 domain (tự gia hạn)
certbot --nginx -d chat.chumchumbakery.com -d api.chumchumbakery.com
```

## Bước 6 — Firewall

```bash
ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

## Bước 7 — Kiểm tra

1. Mở `https://chat.chumchumbakery.com` → đăng nhập `admin@chumchum.vn` / `Admin@123` → **đổi mật khẩu ngay**.
2. Chạy smoke test 24 luồng (ở máy local, API_BASE trỏ ra domain thật):

```bash
API_BASE=https://api.chumchumbakery.com node scripts/smoke.js
```

## Bước 8 — Webhook các kênh thật

Sau khi HTTPS chạy, cập nhật webhook trên các nền tảng (thay `your-domain` cũ trong README):

| Kênh | Webhook URL |
|---|---|
| Zalo OA | `https://api.chumchumbakery.com/webhooks/zalo` |
| Messenger + Comment FB | `https://api.chumchumbakery.com/webhooks/messenger` |
| Instagram | `https://api.chumchumbakery.com/webhooks/instagram` |
| TikTok | `https://api.chumchumbakery.com/webhooks/tiktok` |
| Shopee | `https://api.chumchumbakery.com/webhooks/shopee` |
| Trello | `https://api.chumchumbakery.com/webhooks/trello` |

---

## Vận hành hằng ngày

**Cập nhật code mới:**

```bash
cd /opt/chumchum_crm
git pull
docker compose --profile app up -d --build
```

**Backup database hằng ngày 2h sáng** (cron):

```bash
mkdir -p /opt/chumchum_crm/backups
crontab -e
# Thêm dòng:
# 0 2 * * * cd /opt/chumchum_crm && mkdir -p backups && docker compose exec -T postgres pg_dump -U chumchum chumchum | gzip > backups/chumchum-$(date +\%F).sql.gz
```

Phục hồi:

```bash
gunzip -c backups/chumchum-2026-09-08.sql.gz | docker compose exec -T postgres psql -U chumchum -d chumchum
```

**Lệnh hữu ích:**

```bash
docker compose --profile app ps            # trạng thái
docker compose logs -f api                 # log API
docker compose logs -f web                 # log Web
docker compose restart api                 # khởi động lại API
docker compose exec api npx prisma migrate deploy   # chạy tay migration nếu cần
```

## Xử lý sự cố thường gặp

| Triệu chứng | Nguyên nhân / cách xử lý |
|---|---|
| `docker compose ps` api liên tục restart | `docker compose logs api` — thường do `DATABASE_URL` lệch mật khẩu với `POSTGRES_PASSWORD` |
| Web mở được nhưng đăng nhập không xong | Kiểm tra `NEXT_PUBLIC_API_URL` đã đúng `https://api.chumchumbakery.com` khi **build** (phải rebuild: `docker compose --profile app up -d --build web`) |
| Realtime không nhận tin nhắn | `CORS_ORIGINS` thiếu `https://chat.chumchumbakery.com`; xem `docker compose logs api \| grep Socket` |
| Certbot báo DNS chưa trỏ | Đợi DNS cập nhật (5-30 phút), test `nslookup api.chumchumbakery.com` |
| 502 Bad Gateway | Container chưa lên — `docker compose --profile app ps` và xem logs |

'use client';

import { useEffect, useState } from 'react';
import { api, getStoredUser, logout, API_URL } from '@/lib/api';
import { disablePush, enablePush, getPushState, type PushState } from '@/lib/push';
import { ROLE_LABELS, CHANNEL_LABELS, type ChannelAccount, type ChannelMeta, type ChannelType, type Role, type User } from '@/lib/types';
import { Badge, Modal, PageHeader, Spinner } from '@/components/ui';
import { ChannelPill } from '@/components/charts';

const TABS = [
  { key: 'channels', label: '🔗 Kênh' },
  { key: 'domains', label: '🌐 Domain' },
  { key: 'users', label: '👥 Người dùng' },
  { key: 'trello', label: '🗂 Trello' },
] as const;

export default function SettingsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('channels');
  const [me, setMe] = useState(getStoredUser());
  const [pwOpen, setPwOpen] = useState(false);
  const [zaloMsg, setZaloMsg] = useState('');

  // Kết quả redirect về từ luồng OAuth Zalo OA (?zalo-oa=ok|fail)
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const status = q.get('zalo-oa');
    if (status === 'ok') setZaloMsg(`✅ Đã kết nối Zalo OA "${q.get('name') ?? ''}" qua cấp quyền nhanh`);
    if (status === 'fail') setZaloMsg(`❌ Cấp quyền Zalo OA thất bại: ${q.get('msg') ?? ''}`);
    if (status) window.history.replaceState({}, '', '/settings');
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4 md:p-6">
        <PageHeader title="Cài đặt" subtitle={`Xin chào ${me?.name ?? ''} · ${me ? ROLE_LABELS[me.role as Role] : ''}`} actions={
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => setPwOpen(true)}>🔑 Đổi mật khẩu</button>
            <button className="btn-secondary" onClick={logout}>Đăng xuất</button>
          </div>
        } />

        {zaloMsg && (
          <p className={`mb-3 rounded-xl px-3 py-2 text-xs font-semibold ${zaloMsg.startsWith('✅') ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
            {zaloMsg}
          </p>
        )}

        <div className="mb-4 flex flex-wrap gap-1.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-full px-4 py-2 text-sm font-bold ${tab === t.key ? 'bg-brand-500 text-white shadow-float' : 'bg-white text-ink-soft border border-brand-200 hover:bg-brand-50'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        <NotificationsCard />

        {tab === 'channels' && <ChannelsTab />}
        {tab === 'domains' && <DomainsTab />}
        {tab === 'users' && <UsersTab canEdit={me?.role === 'ADMIN'} meId={me?.id} />}
        {tab === 'trello' && <TrelloTab />}

        <ChangePasswordModal open={pwOpen} onClose={() => setPwOpen(false)} onDone={() => { setMe(getStoredUser()); }} />
      </div>
    </div>
  );
}

/** Đăng ký Web Push: nhận thông báo tin nhắn/comment mới ngay trên điện thoại (qua PWA) */
function NotificationsCard() {
  const [state, setState] = useState<PushState | 'loading'>('loading');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getPushState()
      .then(setState)
      .catch(() => setState('off'));
  }, []);

  async function toggle() {
    setBusy(true);
    try {
      setState(await (state === 'on' ? disablePush() : enablePush()));
    } catch {
      setState(await getPushState().catch(() => 'off'));
    } finally {
      setBusy(false);
    }
  }

  const info: Record<PushState, string> = {
    on: '✅ Đang bật — bạn sẽ nhận thông báo khi có tin nhắn / bình luận mới.',
    off: 'Chưa bật. Bật để nhận thông báo ngay trên điện thoại khi khách nhắn tin.',
    denied: '⚠️ Trình duyệt đang chặn thông báo — vào Cài đặt trình duyệt → cho phép Thông báo cho trang này, rồi bật lại.',
    unsupported: '⚠️ Thiết bị/trình duyệt chưa hỗ trợ push (iOS cần "Thêm vào màn hình chính" trước).',
    'no-vapid': '⚠️ Server chưa cấu hình VAPID — chạy `npm run gen:vapid -w apps/api` và thêm 2 biến VAPID vào .env.',
  };

  return (
    <div className="card mb-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-extrabold">🔔 Thông báo trên điện thoại</h2>
          <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">{state === 'loading' ? 'Đang kiểm tra…' : info[state]}</p>
        </div>
        {state !== 'loading' && state !== 'no-vapid' && state !== 'unsupported' && (
          <button className={state === 'on' ? 'btn-secondary' : 'btn-primary'} disabled={busy || state === 'denied'} onClick={toggle}>
            {busy ? <Spinner className="border-white/40 border-t-white" /> : state === 'on' ? 'Tắt thông báo' : '🔔 Bật thông báo'}
          </button>
        )}
      </div>
    </div>
  );
}

/** Đổi mật khẩu cá nhân (mọi vai trò). Sau khi đổi, mọi phiên đăng nhập bị thu hồi → đăng nhập lại. */
function ChangePasswordModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [form, setForm] = useState({ oldPassword: '', newPassword: '', confirm: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setForm({ oldPassword: '', newPassword: '', confirm: '' });
      setError('');
    }
  }, [open]);

  return (
    <Modal open={open} onClose={onClose} title="🔑 Đổi mật khẩu">
      <div className="space-y-3">
        <div>
          <label className="label">Mật khẩu hiện tại</label>
          <input className="input" type="password" value={form.oldPassword} onChange={(e) => setForm({ ...form, oldPassword: e.target.value })} />
        </div>
        <div>
          <label className="label">Mật khẩu mới (tối thiểu 6 ký tự)</label>
          <input className="input" type="password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
        </div>
        <div>
          <label className="label">Nhập lại mật khẩu mới</label>
          <input className="input" type="password" value={form.confirm} onChange={(e) => setForm({ ...form, confirm: e.target.value })} />
        </div>
        {error && <p className="text-xs font-medium text-red-600">{error}</p>}
        <p className="text-[11px] leading-relaxed text-ink-faint">
          Sau khi đổi, các thiết bị khác sẽ bị đăng xuất và bạn cần đăng nhập lại.
        </p>
        <button
          className="btn-primary w-full py-2.5"
          disabled={busy || form.newPassword.length < 6 || form.newPassword !== form.confirm}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await api('/auth/change-password', {
                method: 'POST',
                body: { oldPassword: form.oldPassword, newPassword: form.newPassword },
              });
              onClose();
              onDone();
              // Refresh token đã bị thu hồi → đăng nhập lại ngay cho sạch
              await logout();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Spinner className="border-white/40 border-t-white" /> : 'Đổi mật khẩu'}
        </button>
      </div>
    </Modal>
  );
}

// ================= KÊNH =================

/** Cấu hình wizard từng kênh: hướng dẫn từng bước + trường cần điền + có kiểm tra được token không */
const CHANNEL_GUIDES: Record<
  ChannelType,
  {
    intro: string;
    risk?: string;
    steps: { text: string; link?: { label: string; href: string } }[];
    /** path webhook (ghép sau API_URL) — hiện kèm nút copy */
    webhook?: string;
    webhookNote?: string;
    fields: { key: string; label: string; placeholder?: string; secret?: boolean }[];
  }
> = {
  ZALO_OA: {
    intro: 'Zalo Official Account — nhận & trả lời tin nhắn khách hàng qua API chính thức của Zalo.',
    steps: [
      { text: 'Đăng nhập developers.zalo.me bằng tài khoản Zalo đang quản lý OA', link: { label: 'Mở developers.zalo.me →', href: 'https://developers.zalo.me' } },
      { text: 'Tạo Ứng dụng (App) trong mục Quản lý ứng dụng → copy App ID và Secret Key', link: { label: 'Hướng dẫn tạo app →', href: 'https://developers.zalo.me/docs/official-account/bat-dau/kham-pha' } },
      { text: 'Nhờ quản trị server điền ZALO_OA_APP_ID + ZALO_OA_APP_SECRET vào file .env rồi restart API (làm 1 lần)' },
      { text: 'Quay lại đây bấm "🔗 Đăng nhập Zalo để cấp quyền" (bước 2) → chọn OA → Cho phép → xong! Token tự làm mới mỗi ngày, không cần dán lại bao giờ' },
      { text: 'Chưa có app? Dán Access Token thủ công ở bước 2 vẫn dùng được (token 25 giờ — nên tạo app để tự động)' },
      { text: 'Cuối cùng: developers.zalo.me → Webhook → dán URL webhook bên dưới' },
    ],
    webhook: '/webhooks/zalo',
    fields: [
      { key: 'accessToken', label: 'OA Access Token (dán tay nếu chưa có app)', secret: true },
      { key: 'refreshToken', label: 'Refresh Token (tự làm mới access token)', secret: true },
      { key: 'appId', label: 'App ID (của OA trên developers.zalo.me)' },
    ],
  },
  FACEBOOK: {
    intro: 'Messenger + Comment Facebook qua Graph API chính thức của Meta.',
    steps: [
      { text: 'Tạo app loại Business tại Meta for Developers', link: { label: 'Mở developers.facebook.com →', href: 'https://developers.facebook.com/apps' } },
      { text: 'Thêm sản phẩm Messenger + Webhooks; xin quyền pages_messaging, pages_read_engagement, feed' },
      { text: 'Tạo Page Access Token cho Page của bạn (Access Token Tool → Page token)' },
      { text: 'Dán token → bấm "Kiểm tra kết nối" (tên Page tự điền)' },
      { text: 'Webhooks → Callback URL = link bên dưới; Verify token = giá trị FB_VERIFY_TOKEN trong file .env' },
    ],
    webhook: '/webhooks/messenger',
    fields: [{ key: 'pageAccessToken', label: 'Page Access Token', secret: true }],
  },
  INSTAGRAM: {
    intro: 'Instagram Messaging — cần tài khoản IG Business đã gắn vào Fanpage Facebook.',
    steps: [
      { text: 'Dùng chung app Meta với Facebook (xem bước kết nối Facebook phía trên)' },
      { text: 'Trong app → Instagram → Webhooks, đăng ký trường messages' },
      { text: 'Dán Page Access Token (của Page mà IG gắn vào) → "Kiểm tra kết nối"' },
      { text: 'Webhook URL dùng link bên dưới' },
    ],
    webhook: '/webhooks/instagram',
    fields: [{ key: 'pageAccessToken', label: 'Page Access Token (của Page gắn IG)', secret: true }],
  },
  TIKTOK: {
    intro: 'TikTok Business Messaging — cần nộp đơn xét duyệt trước khi dùng.',
    steps: [
      { text: 'Nộp đơn xin quyền Business Messaging tại TikTok', link: { label: 'Mở business-api.tiktok.com →', href: 'https://business-api.tiktok.com/portal/docs/access-to-business-messaging-api/v1.3' } },
      { text: 'Sau khi được duyệt, tạo Business Messaging Access Token' },
      { text: 'Dán token vào bên dưới rồi lưu; webhook URL dùng link bên dưới' },
    ],
    webhook: '/webhooks/tiktok',
    fields: [{ key: 'accessToken', label: 'Business Messaging Access Token', secret: true }],
  },
  SHOPEE: {
    intro: 'Shopee Open Platform — đồng bộ đơn hàng (chat cần xin whitelist riêng từ Shopee).',
    steps: [
      { text: 'Đăng ký Partner tại Shopee Open Platform', link: { label: 'Mở open.shopee.com →', href: 'https://open.shopee.com' } },
      { text: 'Lấy Partner ID + Partner Key; ủy quyền shop để lấy Shop ID' },
      { text: 'Điền 4 thông tin bên dưới → "Kiểm tra kết nối" (tên shop tự điền)' },
      { text: 'Đơn hàng tự đồng bộ mỗi 30 phút sau khi kết nối' },
    ],
    fields: [
      { key: 'baseUrl', label: 'Base URL', placeholder: 'https://partner.shopeemobile.com' },
      { key: 'partnerId', label: 'Partner ID' },
      { key: 'partnerKey', label: 'Partner Key', secret: true },
      { key: 'shopId', label: 'Shop ID' },
    ],
  },
  ZALO_PERSONAL: {
    intro: 'Zalo cá nhân qua "bridge" tự host — kết nối bằng mã QR như đăng nhập Zalo Web.',
    risk: 'Zalo KHÔNG có API chính thức cho tài khoản cá nhân. Bridge vi phạm điều khoản Zalo — tài khoản CÓ THỂ BỊ KHÓA. Ưu tiên dùng Zalo OA nếu có thể.',
    steps: [
      { text: 'Tự host 1 bridge service hỗ trợ contract /qr + /status (xem docs/HUONG-DAN-KET-NOI.md)' },
      { text: 'Điền Bridge URL + API key bên dưới, bấm "Lấy mã QR"' },
      { text: 'Mở Zalo trên điện thoại → quét mã QR hiển thị → chờ trạng thái "đã đăng nhập"' },
    ],
    fields: [
      { key: 'bridgeUrl', label: 'Bridge URL', placeholder: 'https://bridge.cua-ban.com' },
      { key: 'apiKey', label: 'Bridge API Key', secret: true },
    ],
  },
};

function ChannelsTab() {
  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [meta, setMeta] = useState<ChannelMeta[]>([]);
  const [open, setOpen] = useState(false);
  const [wizType, setWizType] = useState<ChannelType>('ZALO_OA');
  const [editing, setEditing] = useState<ChannelAccount | null>(null);

  async function load() {
    const [a, m] = await Promise.all([api<ChannelAccount[]>('/channel-accounts'), api<ChannelMeta[]>('/channel-accounts/meta')]);
    setAccounts(a);
    setMeta(m);
  }
  useEffect(() => {
    load();
  }, []);

  return (
    <div className="space-y-3">
      {(Object.keys(CHANNEL_GUIDES) as ChannelType[]).map((type) => {
        const m = meta.find((x) => x.type === type);
        const accs = accounts.filter((a) => a.type === type);
        // Ưu tiên tài khoản đã có token (nhiều account cùng loại: OAuth + default cũ)
        const main = accs.find((a) => a.hasCredentials) ?? accs[0];
        return (
          <div key={type} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ChannelPill type={type} />
                {m?.requiresApproval && <Badge className="bg-amber-100 text-amber-700">Cần xét duyệt</Badge>}
                {type === 'ZALO_PERSONAL' && <Badge className="bg-red-100 text-red-700">Không chính thức</Badge>}
              </div>
              <div className="flex gap-2">
                {main && (
                  <button
                    className="btn-secondary px-3 py-1.5 text-xs"
                    onClick={async () => {
                      await api(`/channel-accounts/${main.id}`, { method: 'PATCH', body: { isActive: !main.isActive } });
                      load();
                    }}
                  >
                    {main.isActive ? '⏸ Tạm tắt' : '▶️ Bật'}
                  </button>
                )}
                <button
                  className="btn-primary px-3 py-1.5 text-xs"
                  onClick={() => {
                    setWizType(type);
                    setEditing(main ?? null);
                    setOpen(true);
                  }}
                >
                  ⚙️ {main?.hasCredentials ? 'Sửa kết nối' : 'Kết nối'}
                </button>
              </div>
            </div>
            {accs.length > 0 ? (
              <div className="mt-2 space-y-1 text-xs text-ink-soft">
                {accs.map((a) => (
                  <div key={a.id} className="flex items-center gap-2">
                    <span className={a.hasCredentials ? 'text-emerald-600' : 'text-amber-600'}>
                      {a.hasCredentials ? '✅ Đã kết nối' : '🟡 Chưa có token'}
                    </span>
                    <span>· {a.name}</span>
                    <span>· {a._count?.conversations ?? 0} hội thoại</span>
                    {!a.isActive && <span className="font-bold text-neutral-500">· ĐÃ TẮT</span>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-ink-faint">Chưa kết nối — bấm "Kết nối" để làm theo hướng dẫn từng bước</p>
            )}
          </div>
        );
      })}

      {meta.some((m) => m.envBridge !== undefined) && (
        <div className="card border-amber-300 bg-amber-50/60 p-4">
          <div className="flex items-center gap-2">
            <ChannelPill type="ZALO_PERSONAL" />
            <Badge className="bg-red-100 text-red-700">Không chính thức</Badge>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-amber-800">
            ⚠️ Zalo KHÔNG cấp API cho tài khoản cá nhân. Kênh này chạy qua &quot;bridge&quot; tự host —{' '}
            <b>vi phạm điều khoản Zalo, tài khoản có thể bị khóa bất cứ lúc nào</b>. Mặc định tắt cho tới khi bạn chủ động bật.
          </p>
        </div>
      )}

      <ChannelWizard
        open={open}
        initialType={wizType}
        editing={editing}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          load();
        }}
      />
    </div>
  );
}

/** Wizard kết nối kênh: B1 hướng dẫn từng bước (link + copy webhook) → B2 điền token + kiểm tra kết nối */
function ChannelWizard({
  open,
  initialType,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  initialType: ChannelType;
  editing: ChannelAccount | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [step, setStep] = useState<1 | 2>(1);
  const [type, setType] = useState<ChannelType>('ZALO_OA');
  const [name, setName] = useState('');
  const [externalId, setExternalId] = useState('');
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [testResult, setTestResult] = useState<{ ok: boolean; name?: string; avatarUrl?: string; externalId?: string; message?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);
  // Zalo OA OAuth
  const [oauthUrl, setOauthUrl] = useState<string | null | undefined>(undefined);
  // Zalo cá nhân QR
  const [qr, setQr] = useState<string | null>(null);
  const [qrWaiting, setQrWaiting] = useState(false);

  const guide = CHANNEL_GUIDES[type];
  const webhookUrl = guide?.webhook ? `${API_URL}${guide.webhook}` : null;

  useEffect(() => {
    if (open) {
      setType(editing?.type ?? initialType);
      setName(editing?.name ?? '');
      setExternalId(editing?.externalId ?? '');
      setCreds({});
      setStep(1);
      setTestResult(null);
      setError('');
      setQr(null);
      setQrWaiting(false);
      setOauthUrl(undefined);
    }
  }, [open, editing, initialType]);

  // Zalo OA: hỏi server có URL cấp quyền OAuth không (chỉ khi đã đăng ký app Zalo)
  useEffect(() => {
    if (open && type === 'ZALO_OA' && oauthUrl === undefined) {
      api<{ url: string | null }>('/channels/zalo-oa/oauth/start')
        .then((r) => setOauthUrl(r.url))
        .catch(() => setOauthUrl(null));
    }
  }, [open, type, oauthUrl]);

  async function runTest() {
    setBusy(true);
    setError('');
    setTestResult(null);
    try {
      const r = await api<{ ok: boolean; name?: string; avatarUrl?: string; externalId?: string; message?: string }>('/channel-accounts/test', {
        method: 'POST',
        body: { type, credentials: creds },
      });
      setTestResult(r);
      if (r.ok) {
        if (r.name && !name) setName(r.name);
        if (r.externalId && !externalId) setExternalId(r.externalId);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function fetchQr() {
    setBusy(true);
    setError('');
    setQr(null);
    try {
      const r = await api<{ qr: string | null; connected: boolean }>('/channels/zalo-personal/bridge/qr', {
        method: 'POST',
        body: { bridgeUrl: creds.bridgeUrl ?? '', apiKey: creds.apiKey },
      });
      if (r.connected && !r.qr) {
        setTestResult({ ok: true, message: '✅ Bridge vẫn còn phiên Zalo từ lần trước — KHÔNG cần quét QR, bấm "💾 Lưu kết nối" luôn' });
        return;
      }
      setQr(r.qr);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  /** Poll trạng thái bridge cho tới khi quét QR xong */
  async function waitQrLogin() {
    setQrWaiting(true);
    for (let i = 0; i < 40; i++) {
      try {
        const r = await api<{ connected: boolean }>('/channels/zalo-personal/bridge/status', {
          method: 'POST',
          body: { bridgeUrl: creds.bridgeUrl ?? '', apiKey: creds.apiKey },
        });
        if (r.connected) {
          setTestResult({ ok: true, message: '✅ Bridge đã đăng nhập Zalo — bấm "Lưu kết nối"' });
          setQrWaiting(false);
          return;
        }
      } catch {
        /* bridge đang khởi động — thử lại */
      }
      await new Promise((res) => setTimeout(res, 3000));
    }
    setQrWaiting(false);
    setError('Hết thời gian chờ quét QR (~2 phút). Bấm "Lấy mã QR" để thử lại.');
  }

  return (
    <Modal open={open} onClose={onClose} title={`Kết nối ${editing?.name ?? CHANNEL_LABELS[type]} — Bước ${step}/2`}>
      {step === 1 ? (
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-ink-soft">{guide?.intro}</p>
          {guide?.risk && (
            <p className="rounded-xl bg-red-50 px-3 py-2 text-xs font-medium leading-relaxed text-red-600">⚠️ {guide.risk}</p>
          )}
          <ol className="space-y-2.5">
            {guide?.steps.map((s, i) => (
              <li key={i} className="flex gap-2.5 text-sm leading-relaxed">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-[11px] font-extrabold text-brand-700">{i + 1}</span>
                <span>
                  {s.text}{' '}
                  {s.link && (
                    <a href={s.link.href} target="_blank" rel="noreferrer" className="font-bold text-brand-600 underline">
                      {s.link.label}
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ol>
          {webhookUrl && (
            <div className="rounded-xl bg-brand-50 p-3">
              <p className="text-xs font-bold text-ink-soft">Webhook URL (copy rồi dán vào trang của kênh):</p>
              <div className="mt-1.5 flex items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-2 py-1.5 text-xs">{webhookUrl}</code>
                <button
                  className="btn-secondary shrink-0 px-3 py-1.5 text-xs"
                  onClick={async () => {
                    await navigator.clipboard.writeText(webhookUrl);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  }}
                >
                  {copied ? '✅ Đã copy' : '📋 Copy'}
                </button>
              </div>
            </div>
          )}
          <button className="btn-primary w-full py-2.5" onClick={() => setStep(2)}>
            Tiếp tục →
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {type === 'ZALO_OA' && (
            <div className="rounded-xl bg-brand-50 p-3">
              {oauthUrl ? (
                <>
                  <p className="mb-2 text-xs font-bold text-ink-soft">Cấp quyền nhanh (không cần dán token):</p>
                  <a href={oauthUrl} className="btn-primary flex items-center justify-center py-2 text-sm">
                    🔗 Đăng nhập Zalo để cấp quyền
                  </a>
                  <p className="mt-1.5 text-[11px] leading-relaxed text-ink-faint">
                    Zalo sẽ hỏi bạn chọn OA → bấm Cho phép → hệ thống tự lưu token và <b>tự làm mới mỗi ngày</b>.
                  </p>
                </>
              ) : (
                <p className="text-xs leading-relaxed text-ink-soft">
                  Để bật nút <b>&quot;Đăng nhập Zalo cấp quyền&quot;</b> (1-cú-click, token tự động): tạo app trên developers.zalo.me →
                  điền <code>ZALO_OA_APP_ID</code> + <code>ZALO_OA_APP_SECRET</code> vào file .env trên server → restart API.
                  Chưa có app thì dán token thủ công bên dưới vẫn dùng được.
                </p>
              )}
            </div>
          )}

          <div>
            <label className="label">Tên hiển thị</label>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="vd: Zalo OA ChumChum" />
          </div>
          <div>
            <label className="label">ID kênh (tự điền sau khi kiểm tra kết nối)</label>
            <input className="input" value={externalId} onChange={(e) => setExternalId(e.target.value)} placeholder="vd: OA id / Page id / Shop id" />
          </div>

          <div className="rounded-xl bg-brand-50 p-3">
            <p className="mb-2 text-xs font-bold text-ink-soft">Thông tin đăng nhập {editing && <span className="font-normal text-ink-faint">(để trống = giữ giá trị đã lưu)</span>}</p>
            <div className="space-y-2">
              {guide?.fields.map((f) => (
                <div key={f.key}>
                  <label className="label">{f.label}</label>
                  <input
                    className="input"
                    type={f.secret ? 'password' : 'text'}
                    placeholder={f.placeholder}
                    value={creds[f.key] ?? ''}
                    onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
                  />
                </div>
              ))}
            </div>
            {type !== 'ZALO_PERSONAL' && (
              <button className="btn-secondary mt-2.5 w-full py-2 text-sm" disabled={busy} onClick={runTest}>
                {busy ? <Spinner className="border-brand-300 border-t-brand-600" /> : '🔌 Kiểm tra kết nối'}
              </button>
            )}
            {type === 'ZALO_OA' && editing && (
              <div className="space-y-2">
                <button
                  className="btn-secondary w-full py-2 text-sm"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    setTestResult(null);
                    try {
                      const r = await api<{ ok: boolean; message?: string }>(`/channel-accounts/${editing.id}/refresh`, { method: 'POST' });
                      setTestResult({ ok: r.ok, message: r.ok ? `🔄 ${r.message}` : r.message });
                    } catch (err) {
                      setError((err as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  🔄 Làm mới access token ngay
                </button>
                <button
                  className="btn-secondary w-full py-2 text-sm"
                  disabled={busy}
                  onClick={async () => {
                    setBusy(true);
                    setError('');
                    setTestResult(null);
                    try {
                      const r = await api<{ ok: boolean; created: number; total: number }>(`/channel-accounts/${editing.id}/sync-chats`, { method: 'POST' });
                      setTestResult({ ok: true, message: `⬇️ Đã đồng bộ ${r.total} người đã chat về inbox (nhập thêm ${r.created} tin cũ)` });
                    } catch (err) {
                      setError((err as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  ⬇️ Đồng bộ hội thoại gần đây từ Zalo
                </button>
              </div>
            )}
            {type === 'ZALO_PERSONAL' && editing && (
              <button
                className="btn-secondary w-full py-2 text-sm"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  setTestResult(null);
                  try {
                    const r = await api<{ ok: boolean; created: number; total: number }>(`/channel-accounts/${editing.id}/sync-friends`, { method: 'POST' });
                    setTestResult({ ok: true, message: `👥 Đã thêm ${r.created}/${r.total} bạn bè Zalo vào danh sách khách hàng` });
                  } catch (err) {
                    setError((err as Error).message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                👥 Đồng bộ danh sách bạn bè Zalo
              </button>
            )}
          </div>

          {testResult && (
            <div className={`flex items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm ${testResult.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
              {testResult.avatarUrl && <img src={testResult.avatarUrl} alt="" className="h-8 w-8 rounded-lg object-cover" />}
              <span className="font-semibold">{testResult.message}</span>
            </div>
          )}

          {type === 'ZALO_PERSONAL' && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-3">
              <p className="mb-2 text-xs font-bold text-ink-soft">Đăng nhập Zalo bằng mã QR</p>
              <div className="flex flex-wrap gap-2">
                <button className="btn-secondary px-3 py-1.5 text-xs" disabled={busy || !creds.bridgeUrl} onClick={fetchQr}>
                  📱 Lấy mã QR
                </button>
                {qr && !qrWaiting && !testResult?.ok && (
                  <button className="btn-secondary px-3 py-1.5 text-xs" onClick={waitQrLogin}>
                    ⏳ Chờ quét QR
                  </button>
                )}
              </div>
              {qr && (
                <div className="mt-2.5 text-center">
                  {qr.startsWith('data:') || qr.startsWith('http') ? (
                    <img src={qr} alt="QR Zalo" className="mx-auto h-44 w-44 rounded-xl bg-white p-1.5" />
                  ) : (
                    <code className="block break-all rounded-lg bg-white px-2 py-2 text-[11px]">{qr}</code>
                  )}
                  {qrWaiting && <p className="mt-1.5 text-xs font-semibold text-amber-700">Đang chờ quét trên điện thoại…</p>}
                </div>
              )}
            </div>
          )}

          {error && <p className="text-xs font-medium text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button className="btn-secondary flex-1 py-2.5" onClick={() => setStep(1)}>← Hướng dẫn</button>
            <button
              className="btn-primary flex-[2] py-2.5"
              disabled={busy || !name}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  const finalExternalId = externalId || testResult?.externalId || `manual-${type}`;
                  if (editing) {
                    await api(`/channel-accounts/${editing.id}`, { method: 'PATCH', body: { name, credentials: creds } });
                  } else {
                    await api('/channel-accounts', { method: 'POST', body: { type, name, externalId: finalExternalId, credentials: creds } });
                  }
                  onSaved();
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {busy ? <Spinner className="border-white/40 border-t-white" /> : '💾 Lưu kết nối'}
            </button>
          </div>
          {editing && (
            <button
              className="w-full rounded-xl border border-red-200 bg-red-50 py-2 text-xs font-bold text-red-600 hover:bg-red-100"
              disabled={busy}
              onClick={async () => {
                const ok1 = window.confirm(
                  `Ngắt kết nối "${editing.name}"?\n\nSẽ XOÁ VĨNH VIỄN: toàn bộ hội thoại + tin nhắn của kênh này, và những khách hàng chỉ tồn tại nhờ kênh này (kèm ĐƠN HÀNG của họ).`,
                );
                if (!ok1) return;
                if (!window.confirm('Chắc chắn? Hành động này không thể hoàn tác.')) return;
                setBusy(true);
                setError('');
                try {
                  await api(`/channel-accounts/${editing.id}?purge=true`, { method: 'DELETE' });
                  onSaved();
                } catch (err) {
                  setError((err as Error).message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              🗑 Ngắt kết nối & xoá dữ liệu kênh (hội thoại, tin nhắn, khách riêng của kênh)
            </button>
          )}
        </div>
      )}
    </Modal>
  );
}

// ================= DOMAIN (xác thực sở hữu — Zalo/Meta yêu cầu khi đăng ký OA/app) =================

interface DomainRow {
  id: string;
  domain: string;
  verificationKey: string;
  status: 'PENDING' | 'VERIFIED' | string;
  method?: string | null;
  verifiedAt?: string | null;
  externalCodes?: string[];
}

function DomainsTab() {
  const [rows, setRows] = useState<DomainRow[]>([]);
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<Record<string, { method: string; ok: boolean; detail: string }[]>>({});
  const [codeInput, setCodeInput] = useState<Record<string, string>>({});

  async function load() {
    const raw = await api<(Omit<DomainRow, 'externalCodes'> & { externalCodes: string })[]>('/domains');
    setRows(
      raw.map((r) => {
        let codes: string[] = [];
        try {
          codes = JSON.parse(r.externalCodes || '[]');
        } catch {
          codes = [];
        }
        return { ...r, externalCodes: codes };
      }),
    );
  }
  useEffect(() => {
    load();
  }, []);

  async function act(fn: () => Promise<unknown>) {
    setError('');
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="card p-4">
        <h2 className="text-sm font-extrabold">🌐 Xác thực domain</h2>
        <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">
          Zalo/Meta yêu cầu chứng minh bạn sở hữu website khi đăng ký OA hoặc app. Thêm domain ở đây — với domain đang chạy
          trên server ChumChum (vd api.chumchumbakery.com), chỉ cần <b>dán mã Zalo cấp</b> là hệ thống tự phục vụ file xác thực.
        </p>
        <div className="mt-3 flex gap-2">
          <input
            className="input flex-1"
            placeholder="vd: api.chumchumbakery.com"
            value={domain}
            onChange={(e) => setDomain(e.target.value)}
          />
          <button
            className="btn-primary"
            disabled={busy || !domain}
            onClick={() =>
              act(async () => {
                await api('/domains', { method: 'POST', body: { domain } });
                setDomain('');
              })
            }
          >
            ➕ Thêm
          </button>
        </div>
        {error && <p className="mt-2 text-xs font-medium text-red-600">{error}</p>}
      </div>

      {rows.map((r) => (
        <div key={r.id} className="card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-sm font-extrabold">{r.domain}</span>
                {r.status === 'VERIFIED' ? (
                  <Badge className="bg-emerald-100 text-emerald-700">✅ Đã xác thực{r.method ? ` · ${r.method}` : ''}</Badge>
                ) : (
                  <Badge className="bg-amber-100 text-amber-700">⏳ Chờ xác thực</Badge>
                )}
              </div>
              <p className="mt-0.5 text-[11px] text-ink-faint">Mã nội bộ: <code>{r.verificationKey}</code></p>
            </div>
            <div className="flex gap-1.5">
              <button
                className="btn-secondary px-3 py-1.5 text-xs"
                disabled={busy}
                onClick={() =>
                  act(async () => {
                    const res = await api<DomainRow & { attempts?: { method: string; ok: boolean; detail: string }[] }>(`/domains/${r.id}/check`, { method: 'POST' });
                    if (res.attempts) setAttempts((a) => ({ ...a, [r.id]: res.attempts! }));
                  })
                }
              >
                🔄 Kiểm tra
              </button>
              <button
                className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-100"
                onClick={() => {
                  if (window.confirm(`Xoá domain "${r.domain}"?`)) act(() => api(`/domains/${r.id}`, { method: 'DELETE' }));
                }}
              >
                🗑
              </button>
            </div>
          </div>

          {/* ===== Mã nhà cung cấp (Zalo) — hệ thống tự serve file/meta ===== */}
          <div className="mt-3 rounded-xl border border-brand-100 bg-cream/60 p-3">
            <p className="text-xs font-bold text-ink-soft">📎 Mã xác thực từ nhà cung cấp (Zalo Platform)</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-ink-faint">
              Trên trang Zalo, copy nguyên dòng Zalo đưa (giá trị TXT / thẻ meta / tên file) rồi dán vào đây — hệ thống tự tách mã
              và phục vụ file xác thực ngay trên domain này.
            </p>
            <div className="mt-2 flex gap-2">
              <input
                className="input flex-1 text-xs"
                placeholder="vd: zalo-platform-site-verification=UlYFSx_... hoặc <meta name=...>"
                value={codeInput[r.id] ?? ''}
                onChange={(e) => setCodeInput((s) => ({ ...s, [r.id]: e.target.value }))}
              />
              <button
                className="btn-secondary shrink-0 px-3 py-1.5 text-xs"
                disabled={busy || !(codeInput[r.id] ?? '').trim()}
                onClick={() =>
                  act(async () => {
                    await api(`/domains/${r.id}/external-code`, { method: 'POST', body: { raw: codeInput[r.id] } });
                    setCodeInput((s) => ({ ...s, [r.id]: '' }));
                  })
                }
              >
                ➕ Thêm mã
              </button>
            </div>
            {(r.externalCodes ?? []).map((code) => (
              <div key={code} className="mt-2.5 space-y-1.5 rounded-lg bg-white p-2.5">
                <div className="flex items-center justify-between gap-2">
                  <code className="truncate text-[11px] font-bold">{code}</code>
                  <button
                    className="shrink-0 text-[11px] font-bold text-red-500 hover:underline"
                    onClick={() => act(() => api(`/domains/${r.id}/external-code?code=${encodeURIComponent(code)}`, { method: 'DELETE' }))}
                  >
                    Xoá
                  </button>
                </div>
                <CopyRow label="File HTML (mở để xác nhận đã live):" value={`${API_URL}/zalo_verifier${code}.html`} />
                <CopyRow label="Hoặc DNS TXT (host @ / api):" value={`zalo-platform-site-verification=${code}`} />
                <a
                  href={`${API_URL}/zalo_verifier${code}.html`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-block text-[11px] font-bold text-brand-600 hover:underline"
                >
                  ↗ Mở file xác thực trong tab mới
                </a>
              </div>
            ))}
          </div>

          {(attempts[r.id] || r.status !== 'VERIFIED') && (
            <div className="mt-2 space-y-1">
              {(attempts[r.id] ?? []).map((a, i) => (
                <p key={i} className={`text-[11px] ${a.ok ? 'text-emerald-600' : 'text-ink-faint'}`}>
                  {a.ok ? '✅' : '·'} {a.method}: {a.detail}
                </p>
              ))}
            </div>
          )}

          {r.status !== 'VERIFIED' && (
            <div className="mt-3">
              <button className="text-xs font-bold text-brand-600" onClick={() => setExpanded(expanded === r.id ? null : r.id)}>
                {expanded === r.id ? '▲ Ẩn hướng dẫn tự xác thực' : '▼ 3 cách tự xác thực bằng mã nội bộ'}
              </button>
              {expanded === r.id && <DomainGuide row={r} />}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div>
      <label className="label">{label}</label>
      <div className="flex items-center gap-2">
        <code className="min-w-0 flex-1 truncate rounded-lg bg-white px-2 py-1.5 text-[11px]">{value}</code>
        <button
          className="btn-secondary shrink-0 px-3 py-1.5 text-xs"
          onClick={async () => {
            await navigator.clipboard.writeText(value);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          }}
        >
          {copied ? '✅' : '📋'}
        </button>
      </div>
    </div>
  );
}

function DomainGuide({ row }: { row: DomainRow }) {
  return (
    <div className="mt-2 space-y-3 rounded-xl bg-brand-50 p-3">
      <div>
        <p className="mb-1 text-xs font-bold text-ink-soft">Cách 1 — DNS TXT record (ổn định nhất):</p>
        <CopyRow label="Loại: TXT · Host: @ (hoặc để trống) · Giá trị:" value={row.verificationKey} />
      </div>
      <div>
        <p className="mb-1 text-xs font-bold text-ink-soft">Cách 2 — Meta tag (dán vào thẻ &lt;head&gt; trang chủ):</p>
        <CopyRow label="Thẻ meta:" value={`<meta name="chumchum-site-verification" content="${row.verificationKey}" />`} />
      </div>
      <div>
        <p className="mb-1 text-xs font-bold text-ink-soft">Cách 3 — File trên website:</p>
        <CopyRow label={`Tạo file "${row.verificationKey}.txt" tại thư mục gốc, nội dung:`} value={row.verificationKey} />
      </div>
      <div>
        <p className="mb-1 text-xs font-bold text-ink-soft">Link kiểm tra công khai (cho nhà cung cấp):</p>
        <CopyRow label="Endpoint JSON:" value={`${API_URL}/domains/verify/${row.verificationKey}`} />
      </div>
      <p className="text-[11px] leading-relaxed text-ink-faint">
        Làm xong 1 trong 3 cách (DNS có thể mất 5–30 phút để cập nhật) → bấm <b>🔄 Kiểm tra</b>.
      </p>
    </div>
  );
}

// ================= NGƯỜI DÙNG =================

function UsersTab({ canEdit, meId }: { canEdit: boolean; meId?: string }) {
  const [users, setUsers] = useState<User[]>([]);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [error, setError] = useState('');

  async function load() {
    setUsers(await api<User[]>('/users'));
  }
  useEffect(() => {
    load();
  }, []);

  async function act(fn: () => Promise<unknown>) {
    setError('');
    try {
      await fn();
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <div className="card divide-y divide-brand-50 overflow-hidden">
      {error && <p className="bg-red-50 px-4 py-2 text-xs font-medium text-red-600">{error}</p>}
      {users.map((u) => (
        <div key={u.id} className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-sm font-extrabold">{u.name}</span>
              <Badge className="bg-brand-100 text-brand-700">{ROLE_LABELS[u.role]}</Badge>
              {!u.isActive && <Badge className="bg-neutral-200 text-neutral-600">Đã khoá</Badge>}
              {u.id === meId && <Badge className="bg-brand-50 text-ink-soft">Bạn</Badge>}
            </div>
            <p className="text-xs text-ink-soft">{u.email}</p>
          </div>
          {canEdit && (
            <div className="flex gap-1.5">
              <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => { setEditing(u); setOpen(true); }}>
                ✏️ Sửa
              </button>
              {u.id !== meId && (
                <>
                  <button
                    className="btn-secondary px-3 py-1.5 text-xs"
                    onClick={() => act(() => api(`/users/${u.id}`, { method: 'PATCH', body: { isActive: !u.isActive } }))}
                  >
                    {u.isActive ? '⏸ Khoá' : '▶️ Mở khoá'}
                  </button>
                  <button
                    className="rounded-xl border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-100"
                    onClick={() => {
                      if (window.confirm(`Xoá vĩnh viễn tài khoản "${u.name}" (${u.email})? Lịch sử đơn liên quan sẽ được giữ.`)) {
                        act(() => api(`/users/${u.id}`, { method: 'DELETE' }));
                      }
                    }}
                  >
                    🗑
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      ))}
      {canEdit && (
        <div className="p-3">
          <button className="btn-primary w-full" onClick={() => { setEditing(null); setOpen(true); }}>
            ➕ Thêm người dùng
          </button>
        </div>
      )}
      <UserModal
        open={open}
        editing={editing}
        onClose={() => setOpen(false)}
        onSaved={() => {
          setOpen(false);
          load();
        }}
      />
    </div>
  );
}

function UserModal({ open, editing, onClose, onSaved }: { open: boolean; editing: User | null; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'STAFF', isActive: true });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setForm({
        name: editing?.name ?? '',
        email: editing?.email ?? '',
        password: '',
        role: editing?.role ?? 'STAFF',
        isActive: editing?.isActive ?? true,
      });
      setError('');
    }
  }, [open, editing]);

  return (
    <Modal open={open} onClose={onClose} title={editing ? `Sửa — ${editing.name}` : 'Thêm người dùng'}>
      <div className="space-y-3">
        <div>
          <label className="label">Tên</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        {!editing && (
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </div>
        )}
        <div>
          <label className="label">{editing ? 'Mật khẩu mới (bỏ trống nếu giữ nguyên)' : 'Mật khẩu'}</label>
          <input className="input" type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        </div>
        <div>
          <label className="label">Vai trò</label>
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </div>
        {editing && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={form.isActive} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
            Đang hoạt động
          </label>
        )}
        {error && <p className="text-xs font-medium text-red-600">{error}</p>}
        <button
          className="btn-primary w-full py-2.5"
          disabled={busy || !form.name || (!editing && (!form.email || form.password.length < 6))}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              if (editing) {
                const body: Record<string, unknown> = { name: form.name, role: form.role, isActive: form.isActive };
                if (form.password.length >= 6) body.password = form.password;
                await api(`/users/${editing.id}`, { method: 'PATCH', body });
              } else {
                await api('/users', { method: 'POST', body: form });
              }
              onSaved();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Spinner className="border-white/40 border-t-white" /> : 'Lưu'}
        </button>
      </div>
    </Modal>
  );
}

// ================= TRELLO =================

function TrelloTab() {
  const [settings, setSettings] = useState<{ apiKey?: string; token?: string; boardId?: string; listMap: Record<string, string>; connected: boolean } | null>(null);
  const [form, setForm] = useState({ apiKey: '', token: '', boardId: '' });
  const [boards, setBoards] = useState<{ boards: { id: string; name: string }[]; boardId?: string; lists: { id: string; name: string }[] } | null>(null);
  const [listMap, setListMap] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [callbackUrl, setCallbackUrl] = useState('');

  async function load() {
    const s = await api<{ apiKey?: string; token?: string; boardId?: string; listMap: Record<string, string>; connected: boolean }>('/trello/settings');
    setSettings(s);
    setListMap(s.listMap ?? {});
    setForm((f) => ({ ...f, boardId: s.boardId ?? '' }));
  }
  useEffect(() => {
    load();
  }, []);

  async function fetchBoards() {
    setBusy(true);
    setMsg('');
    try {
      const data = await api<{ boards: { id: string; name: string }[]; boardId?: string; lists: { id: string; name: string }[] }>('/trello/boards');
      setBoards(data);
      if (data.lists.length) {
        setForm((f) => ({ ...f, boardId: data.boardId ?? f.boardId }));
      }
    } catch (err) {
      setMsg(`❌ ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3 p-4">
        <h2 className="text-sm font-extrabold">Kết nối Trello</h2>
        {settings?.connected && (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-xs font-semibold text-emerald-700">✅ Đã kết nối board</p>
        )}
        <div>
          <label className="label">API Key <span className="font-normal text-ink-faint">(trello.com/power-ups/admin)</span></label>
          <input className="input" type="password" value={form.apiKey} onChange={(e) => setForm({ ...form, apiKey: e.target.value })} placeholder={settings?.apiKey ? '•••• (đã lưu)' : ''} />
        </div>
        <div>
          <label className="label">Token</label>
          <input className="input" type="password" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} placeholder={settings?.token ? '•••• (đã lưu)' : ''} />
        </div>
        <div className="flex gap-2">
          <button
            className="btn-primary flex-1"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setMsg('');
              try {
                await api('/trello/settings', { method: 'PUT', body: { apiKey: form.apiKey || undefined, token: form.token || undefined } });
                await fetchBoards();
                setMsg('✅ Đã lưu thông tin Trello');
                await load();
              } catch (err) {
                setMsg(`❌ ${(err as Error).message}`);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Spinner className="border-white/40 border-t-white" /> : 'Lưu & tải boards'}
          </button>
          {boards && <button className="btn-secondary" onClick={fetchBoards}>🔄 Tải lại</button>}
        </div>
        {msg && <p className="text-xs font-semibold">{msg}</p>}
      </div>

      {boards && (
        <div className="card space-y-3 p-4">
          <h2 className="text-sm font-extrabold">Chọn board & map cột trạng thái</h2>
          <div>
            <label className="label">Board</label>
            <select
              className="input"
              value={form.boardId}
              onChange={async (e) => {
                setForm({ ...form, boardId: e.target.value });
                await api('/trello/settings', { method: 'PUT', body: { boardId: e.target.value } });
                await fetchBoards();
              }}
            >
              <option value="">— Chọn board —</option>
              {boards.boards.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          {boards.lists.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-bold text-ink-soft">Map cột Trello cho từng trạng thái đơn:</p>
              {(['NEW', 'CONFIRMED', 'SHIPPING', 'COMPLETED', 'CANCELLED'] as const).map((status) => (
                <div key={status} className="flex items-center gap-2">
                  <span className="w-28 text-xs font-bold">{statusLabel(status)}</span>
                  <select
                    className="input flex-1"
                    value={listMap[status] ?? ''}
                    onChange={(e) => setListMap({ ...listMap, [status]: e.target.value })}
                  >
                    <option value="">— Chưa map —</option>
                    {boards.lists.map((l) => (
                      <option key={l.id} value={l.id}>{l.name}</option>
                    ))}
                  </select>
                </div>
              ))}
              <button
                className="btn-primary w-full"
                onClick={async () => {
                  setBusy(true);
                  try {
                    await api('/trello/settings', { method: 'PUT', body: { listMap } });
                    setMsg('✅ Đã lưu map cột — đơn mới/sửa sẽ tự tạo/di chuyển card');
                    await load();
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                Lưu map cột
              </button>
            </div>
          )}
        </div>
      )}

      <div className="card space-y-3 p-4">
        <h2 className="text-sm font-extrabold">Webhook Trello (đồng bộ ngược)</h2>
        <p className="text-xs leading-relaxed text-ink-soft">
          Kéo card sang cột khác trên Trello → trạng thái đơn ở đây tự cập nhật. Cần URL public (server đã triển khai, không phải
          localhost). Ví dụ: <code className="rounded bg-brand-50 px-1">https://api.ban-cua-ban.vn/webhooks/trello</code>
        </p>
        <input className="input" value={callbackUrl} onChange={(e) => setCallbackUrl(e.target.value)} placeholder="https://.../webhooks/trello" />
        <button
          className="btn-secondary"
          disabled={busy || !callbackUrl}
          onClick={async () => {
            setBusy(true);
            setMsg('');
            try {
              await api('/trello/webhook', { method: 'POST', body: { callbackUrl } });
              setMsg('✅ Đã đăng ký webhook');
            } catch (err) {
              setMsg(`❌ ${(err as Error).message}`);
            } finally {
              setBusy(false);
            }
          }}
        >
          Đăng ký webhook
        </button>
      </div>
    </div>
  );
}

function statusLabel(s: string): string {
  return { NEW: 'Chờ duyệt', CONFIRMED: 'Đã duyệt', SHIPPING: 'Đang giao', COMPLETED: 'Hoàn tất', CANCELLED: 'Đã huỷ' }[s] ?? s;
}

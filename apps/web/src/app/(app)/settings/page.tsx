'use client';

import { useEffect, useState } from 'react';
import { api, getStoredUser, logout } from '@/lib/api';
import { disablePush, enablePush, getPushState, type PushState } from '@/lib/push';
import { ROLE_LABELS, type ChannelAccount, type ChannelMeta, type ChannelType, type Role, type User } from '@/lib/types';
import { Badge, Modal, PageHeader, Spinner } from '@/components/ui';
import { ChannelPill } from '@/components/charts';

const TABS = [
  { key: 'channels', label: '🔗 Kênh' },
  { key: 'users', label: '👥 Người dùng' },
  { key: 'trello', label: '🗂 Trello' },
] as const;

export default function SettingsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]['key']>('channels');
  const [me, setMe] = useState(getStoredUser());
  const [pwOpen, setPwOpen] = useState(false);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4 md:p-6">
        <PageHeader title="Cài đặt" subtitle={`Xin chào ${me?.name ?? ''} · ${me ? ROLE_LABELS[me.role as Role] : ''}`} actions={
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => setPwOpen(true)}>🔑 Đổi mật khẩu</button>
            <button className="btn-secondary" onClick={logout}>Đăng xuất</button>
          </div>
        } />

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

const CRED_FIELDS: Partial<Record<ChannelType, { key: string; label: string; hint?: string }[]>> = {
  ZALO_OA: [
    { key: 'accessToken', label: 'OA Access Token', hint: 'developers.zalo.me → quản lý OA' },
  ],
  ZALO_PERSONAL: [
    { key: 'bridgeUrl', label: 'Bridge URL (không chính thức)', hint: '⚠️ Rủi ro khóa tài khoản Zalo!' },
    { key: 'apiKey', label: 'Bridge API Key' },
  ],
  FACEBOOK: [{ key: 'pageAccessToken', label: 'Page Access Token', hint: 'Meta for Developers → Messenger' }],
  INSTAGRAM: [{ key: 'pageAccessToken', label: 'Page Access Token (IG gắn Page)' }],
  TIKTOK: [{ key: 'accessToken', label: 'Business Messaging Access Token' }],
  SHOPEE: [
    { key: 'baseUrl', label: 'Base URL', hint: 'vd: https://partner.test-stable.shopeemobile.com' },
    { key: 'partnerId', label: 'Partner ID' },
    { key: 'partnerKey', label: 'Partner Key' },
    { key: 'shopId', label: 'Shop ID' },
  ],
};

function ChannelsTab() {
  const [accounts, setAccounts] = useState<ChannelAccount[]>([]);
  const [meta, setMeta] = useState<ChannelMeta[]>([]);
  const [open, setOpen] = useState(false);
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
      {meta.filter((m) => m.envBridge === undefined).length === 0 && null}
      {(Object.keys(CRED_FIELDS) as ChannelType[]).map((type) => {
        const m = meta.find((x) => x.type === type);
        const accs = accounts.filter((a) => a.type === type);
        return (
          <div key={type} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <ChannelPill type={type} />
                {m?.requiresApproval && <Badge className="bg-amber-100 text-amber-700">Cần xét duyệt</Badge>}
              </div>
              <div className="flex gap-2">
                {accs.length > 0 && (
                  <button
                    className="btn-secondary px-3 py-1.5 text-xs"
                    onClick={async () => {
                      await api(`/channel-accounts/${accs[0].id}`, { method: 'PATCH', body: { isActive: !accs[0].isActive } });
                      load();
                    }}
                  >
                    {accs[0].isActive ? '⏸ Tạm tắt' : '▶️ Bật'}
                  </button>
                )}
                <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => { setEditing(null); setOpen(true); }}>
                  ⚙️ {accs.length ? 'Sửa kết nối' : 'Kết nối'}
                </button>
              </div>
            </div>
            {accs.length > 0 ? (
              <div className="mt-2 space-y-1 text-xs text-ink-soft">
                {accs.map((a) => (
                  <div key={a.id} className="flex items-center gap-2">
                    <span className={a.hasCredentials ? 'text-emerald-600' : 'text-amber-600'}>
                      {a.hasCredentials ? '✅ Đã kết nối' : '🟡 Chế độ mock (chưa có token)'}
                    </span>
                    <span>· {a.name}</span>
                    <span>· {a._count?.conversations ?? 0} hội thoại</span>
                    {!a.isActive && <span className="font-bold text-neutral-500">· ĐÃ TẮT</span>}
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xs text-ink-faint">Chưa kết nối — inbox vẫn nhận được tin giả lập để test</p>
            )}
            {type === 'TIKTOK' && (
              <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-700">
                TikTok Business Messaging cần nộp đơn xét duyệt tại business-api.tiktok.com — điền token vào khi được cấp.
              </p>
            )}
            {type === 'SHOPEE' && (
              <p className="mt-2 rounded-lg bg-amber-50 px-2.5 py-1.5 text-[11px] leading-relaxed text-amber-700">
                Đồng bộ đơn hoạt động ngay với Open Platform; Chat API cần xin whitelist từ Shopee (open.shopee.com/faq/56).
              </p>
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
            <b>vi phạm điều khoản Zalo, tài khoản có thể bị khóa bất cứ lúc nào</b>. Cấu hình bridge qua biến môi trường
            ZALO_PERSONAL_BRIDGE_URL hoặc form kết nối. Mặc định tắt cho tới khi bạn chủ động bật.
          </p>
        </div>
      )}

      <ConnectModal
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

function ConnectModal({
  open,
  editing,
  onClose,
  onSaved,
}: {
  open: boolean;
  editing: ChannelAccount | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState<ChannelType>('ZALO_OA');
  const [name, setName] = useState('');
  const [externalId, setExternalId] = useState('');
  const [creds, setCreds] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setType(editing?.type ?? 'ZALO_OA');
      setName(editing?.name ?? '');
      setExternalId(editing?.externalId ?? '');
      setCreds({});
      setError('');
    }
  }, [open, editing]);

  const fields = CRED_FIELDS[type] ?? [];

  return (
    <Modal open={open} onClose={onClose} title={editing ? `Sửa kết nối — ${editing.name}` : 'Kết nối kênh'}>
      <div className="space-y-3">
        <div>
          <label className="label">Kênh</label>
          <select className="input" value={type} disabled={!!editing} onChange={(e) => setType(e.target.value as ChannelType)}>
            {(Object.keys(CRED_FIELDS) as ChannelType[]).map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Tên hiển thị</label>
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="vd: Zalo OA ChumChum" />
        </div>
        <div>
          <label className="label">ID kênh (external ID)</label>
          <input className="input" value={externalId} onChange={(e) => setExternalId(e.target.value)} placeholder="vd: OA id / Page id / Shop id" />
        </div>
        <div className="rounded-xl bg-brand-50 p-3">
          <p className="mb-2 text-xs font-bold text-ink-soft">Thông tin đăng nhập (để trống = giữ chế độ mock)</p>
          <div className="space-y-2">
            {fields.map((f) => (
              <div key={f.key}>
                <label className="label">{f.label}{f.hint && <span className="ml-1 font-normal text-ink-faint">— {f.hint}</span>}</label>
                <input
                  className="input"
                  type={f.key.toLowerCase().includes('key') || f.key.toLowerCase().includes('token') ? 'password' : 'text'}
                  value={creds[f.key] ?? ''}
                  onChange={(e) => setCreds({ ...creds, [f.key]: e.target.value })}
                />
              </div>
            ))}
          </div>
        </div>
        {error && <p className="text-xs font-medium text-red-600">{error}</p>}
        <button
          className="btn-primary w-full py-2.5"
          disabled={busy || !name}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const body = { type, name, externalId: externalId || `manual-${type}`, credentials: creds };
              if (editing) {
                await api(`/channel-accounts/${editing.id}`, { method: 'PATCH', body: { name, credentials: creds } });
              } else {
                await api('/channel-accounts', { method: 'POST', body });
              }
              onSaved();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Spinner className="border-white/40 border-t-white" /> : 'Lưu kết nối'}
        </button>
      </div>
    </Modal>
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

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { clockTime, money, moneyFull, parseTags, timeAgo } from '@/lib/format';
import {
  CHANNEL_LABELS,
  ORDER_STATUS_CLASSES,
  ORDER_STATUS_LABELS,
  type ChannelType,
  type Conversation,
  type ConversationDetail,
  type Message,
  type Order,
  type User,
} from '@/lib/types';
import { Avatar, EmptyState, Modal, Spinner } from '@/components/ui';
import { ChannelPill } from '@/components/charts';
import { QuickOrderModal } from '@/components/order-modal';

const CHANNEL_FILTERS: (ChannelType | 'ALL')[] = ['ALL', 'ZALO_OA', 'ZALO_PERSONAL', 'FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'SHOPEE'];

export default function InboxPage() {
  const searchParams = useSearchParams();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [filter, setFilter] = useState<ChannelType | 'ALL'>('ALL');
  const [q, setQ] = useState('');
  const [activeId, setActiveId] = useState<string | null>(searchParams.get('c'));
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [mobileView, setMobileView] = useState<'list' | 'chat'>('list');
  const [showCustomerPanel, setShowCustomerPanel] = useState(false);
  const [simOpen, setSimOpen] = useState(false);
  const [orderModalOpen, setOrderModalOpen] = useState(false);
  const [users, setUsers] = useState<User[]>([]);

  const loadConversations = useCallback(async () => {
    const params = new URLSearchParams();
    if (filter !== 'ALL') params.set('channelType', filter);
    if (q) params.set('q', q);
    const data = await api<Conversation[]>(`/conversations?${params}`);
    setConversations(data);
    return data;
  }, [filter, q]);

  useEffect(() => {
    loadConversations().finally(() => setLoading(false));
  }, [loadConversations]);

  useEffect(() => {
    api<User[]>('/users').then(setUsers).catch(() => {});
  }, []);

  const openConversation = useCallback(async (id: string) => {
    setActiveId(id);
    setMobileView('chat');
    const [d, msgs] = await Promise.all([
      api<ConversationDetail>(`/conversations/${id}`),
      api<Message[]>(`/conversations/${id}/messages`),
    ]);
    setDetail(d);
    setMessages(msgs);
    await api(`/conversations/${id}/read`, { method: 'PATCH' }).catch(() => {});
    setConversations((prev) => prev.map((c) => (c.id === id ? { ...c, unreadCount: 0 } : c)));
  }, []);

  // Mở hội thoại từ URL ?c=
  useEffect(() => {
    const c = searchParams.get('c');
    if (c && c !== activeId) openConversation(c);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Realtime
  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onMessageNew = (payload: { conversationId: string; message: Message }) => {
      if (payload.conversationId === activeId) {
        setMessages((prev) => (prev.some((m) => m.id === payload.message.id) ? prev : [...prev, payload.message]));
        api(`/conversations/${activeId}/read`, { method: 'PATCH' }).catch(() => {});
      }
      loadConversations();
    };
    const onMessageSent = (payload: { conversationId: string; message: Message }) => {
      if (payload.conversationId === activeId) {
        setMessages((prev) => (prev.some((m) => m.id === payload.message.id) ? prev : [...prev, payload.message]));
      }
    };
    const onConversationUpdated = (payload: { conversation: Conversation }) => {
      setConversations((prev) => {
        const exists = prev.some((c) => c.id === payload.conversation.id);
        if (exists) return prev.map((c) => (c.id === payload.conversation.id ? { ...c, ...payload.conversation } : c));
        loadConversations();
        return prev;
      });
    };
    socket.on('message:new', onMessageNew);
    socket.on('message:sent', onMessageSent);
    socket.on('conversation:updated', onConversationUpdated);
    return () => {
      socket.off('message:new', onMessageNew);
      socket.off('message:sent', onMessageSent);
      socket.off('conversation:updated', onConversationUpdated);
    };
  }, [activeId, loadConversations]);

  async function sendMessage(text: string) {
    if (!activeId || !text.trim()) return;
    await api(`/conversations/${activeId}/messages`, { method: 'POST', body: { text: text.trim() } });
  }

  async function assign(userId: string) {
    if (!activeId) return;
    await api(`/conversations/${activeId}/assign`, { method: 'PATCH', body: { userId: userId || null } });
    const updated = await api<Conversation>(`/conversations/${activeId}`);
    setDetail((d) => (d ? { ...d, assignedUser: updated.assignedUser } : d));
  }

  const customer = detail?.customer;

  return (
    <div className="flex h-full min-h-0">
      {/* ============ CỘT 1: DANH SÁCH HỘI THOẠI ============ */}
      <div className={`w-full shrink-0 flex-col border-r border-brand-100 bg-white md:flex md:w-80 lg:w-96 ${mobileView === 'list' ? 'flex' : 'hidden'}`}>
        <div className="space-y-2.5 p-3">
          <input className="input" placeholder="🔍 Tìm khách hàng..." value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="flex flex-wrap gap-1.5">
            {CHANNEL_FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-2.5 py-1 text-[11px] font-bold transition-colors ${
                  filter === f ? 'bg-brand-500 text-white' : 'bg-brand-50 text-ink-soft hover:bg-brand-100'
                }`}
              >
                {f === 'ALL' ? 'Tất cả' : CHANNEL_LABELS[f]}
              </button>
            ))}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex justify-center py-10"><Spinner className="h-6 w-6" /></div>
          ) : conversations.length === 0 ? (
            <EmptyState icon="💬" title="Chưa có hội thoại nào" hint="Bấm 🧪 để giả lập tin nhắn test" />
          ) : (
            conversations.map((c) => (
              <button
                key={c.id}
                onClick={() => openConversation(c.id)}
                className={`flex w-full items-center gap-3 border-b border-brand-50 px-3 py-3 text-left hover:bg-brand-50 ${
                  activeId === c.id ? 'bg-brand-50' : ''
                }`}
              >
                <div className="relative">
                  <Avatar name={c.customer.name} src={c.customer.avatarUrl} size={42} />
                  <span className="absolute -bottom-1 -right-1 rounded-full bg-white px-1 text-[10px] shadow">
                    {channelEmoji(c.channelAccount.type)}
                  </span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className={`truncate text-sm ${c.unreadCount ? 'font-extrabold' : 'font-bold'} text-ink`}>{c.customer.name}</span>
                    <span className="shrink-0 text-[10px] text-ink-faint">{timeAgo(c.lastMessageAt)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <p className={`truncate text-xs ${c.unreadCount ? 'font-semibold text-ink' : 'text-ink-soft'}`}>
                      {c.lastDirection === 'OUT' && <span className="text-ink-faint">Bạn: </span>}
                      {c.lastMessageText}
                    </p>
                    {c.unreadCount > 0 && (
                      <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-brand-500 px-1.5 text-[10px] font-bold text-white">
                        {c.unreadCount}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
        <button onClick={() => setSimOpen(true)} className="border-t border-brand-100 py-2.5 text-xs font-bold text-ink-faint hover:bg-brand-50 hover:text-brand-600">
          🧪 Giả lập tin nhắn đến (test)
        </button>
      </div>

      {/* ============ CỘT 2: KHUNG CHAT ============ */}
      <div className={`min-w-0 flex-1 flex-col bg-cream md:flex ${mobileView === 'chat' ? 'flex' : 'hidden'}`}>
        {!detail ? (
          <EmptyState icon="🍑" title="Chọn một hội thoại" hint="Danh sách hội thoại ở cạnh bên" />
        ) : (
          <>
            <div className="flex items-center gap-3 border-b border-brand-100 bg-white px-3 py-2.5">
              <button className="rounded-lg p-1.5 text-ink-soft hover:bg-brand-50 md:hidden" onClick={() => setMobileView('list')} aria-label="Quay lại">
                ←
              </button>
              <Avatar name={customer?.name} src={customer?.avatarUrl} size={38} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-bold">{customer?.name}</span>
                  <ChannelPill type={detail.channelAccount.type} />
                </div>
                <p className="truncate text-xs text-ink-soft">
                  {detail.assignedUser ? `Phụ trách: ${detail.assignedUser.name}` : 'Chưa phân công'}
                </p>
              </div>
              <select
                className="hidden rounded-lg border border-brand-200 bg-white px-2 py-1.5 text-xs font-semibold text-ink-soft sm:block"
                value={detail.assignedUser?.id ?? ''}
                onChange={(e) => assign(e.target.value)}
              >
                <option value="">— Phân công —</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
              <button
                onClick={() => setShowCustomerPanel(true)}
                className="rounded-lg border border-brand-200 px-2.5 py-1.5 text-xs font-bold text-ink-soft hover:bg-brand-50 lg:hidden"
              >
                👤 Khách
              </button>
            </div>

            <ChatArea messages={messages} onSend={sendMessage} />

            <div className="border-t border-brand-100 bg-white px-3 py-2.5">
              <div className="flex items-center gap-2">
                <span className="text-lg">😊</span>
                <span className="text-lg">📎</span>
                <ChatInput onSend={sendMessage} />
              </div>
            </div>
          </>
        )}
      </div>

      {/* ============ CỘT 3: KHÁCH HÀNG + ĐƠN HÀNG ============ */}
      {detail && customer && (
        <div
          className={`w-full shrink-0 overflow-y-auto border-l border-brand-100 bg-white lg:block lg:w-80 ${showCustomerPanel ? 'fixed inset-y-0 right-0 z-40 block w-80 shadow-float' : 'hidden'}`}
        >
          <div className="flex items-center justify-between p-4 lg:hidden">
            <span className="font-bold">Thông tin khách</span>
            <button onClick={() => setShowCustomerPanel(false)} className="rounded-lg p-1 text-ink-faint hover:bg-brand-50">✕</button>
          </div>
          <CustomerPanel
            key={customer.id}
            detail={detail}
            onOrderCreated={() => openConversation(detail.id)}
            onCloseMobile={() => setShowCustomerPanel(false)}
          />
        </div>
      )}

      <SimulateModal open={simOpen} onClose={() => setSimOpen(false)} onDone={() => loadConversations()} />

      <QuickOrderModal
        open={orderModalOpen}
        onClose={() => setOrderModalOpen(false)}
        customer={customer ?? null}
        onCreated={(order) => {
          setOrderModalOpen(false);
          if (detail) openConversation(detail.id);
        }}
      />
    </div>
  );
}

function channelEmoji(t: ChannelType): string {
  return { ZALO_OA: '💬', ZALO_PERSONAL: '📱', FACEBOOK: '📘', INSTAGRAM: '📸', TIKTOK: '🎵', SHOPEE: '🛍️' }[t] ?? '💬';
}

function ChatArea({ messages, onSend }: { messages: Message[]; onSend: (t: string) => Promise<void> }) {
  const bottomRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
      {messages.length === 0 && <p className="py-8 text-center text-xs text-ink-faint">Chưa có tin nhắn</p>}
      <div className="mx-auto flex max-w-xl flex-col gap-2">
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.direction === 'OUT' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                m.direction === 'OUT' ? 'rounded-br-md bg-brand-500 text-white' : 'rounded-bl-md bg-white text-ink'
              }`}
            >
              {m.attachmentUrl && m.type !== 'TEXT' ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={m.attachmentUrl} alt="đính kèm" className="mb-1 max-h-48 rounded-lg object-cover" />
              ) : null}
              {m.text && <p className="whitespace-pre-wrap break-words">{m.text}</p>}
              <div className={`mt-0.5 text-right text-[10px] ${m.direction === 'OUT' ? 'text-white/70' : 'text-ink-faint'}`}>
                {clockTime(m.createdAt)}
                {m.direction === 'OUT' && m.status === 'MOCKED' && ' · mock'}
                {m.direction === 'OUT' && m.status === 'FAILED' && ' · lỗi'}
              </div>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

function ChatInput({ onSend }: { onSend: (t: string) => Promise<void> }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  return (
    <div className="flex flex-1 items-center gap-2">
      <input
        className="input flex-1"
        placeholder="Nhập tin nhắn..."
        value={text}
        disabled={sending}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={async (e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!text.trim()) return;
            setSending(true);
            try {
              await onSend(text);
              setText('');
            } finally {
              setSending(false);
            }
          }
        }}
      />
      <button
        className="btn-primary px-4"
        disabled={sending || !text.trim()}
        onClick={async () => {
          setSending(true);
          try {
            await onSend(text);
            setText('');
          } finally {
            setSending(false);
          }
        }}
      >
        {sending ? <Spinner className="border-white/40 border-t-white" /> : 'Gửi'}
      </button>
    </div>
  );
}

function CustomerPanel({
  detail,
  onOrderCreated,
  onCloseMobile,
}: {
  detail: ConversationDetail;
  onOrderCreated: () => void;
  onCloseMobile: () => void;
}) {
  const c = detail.customer;
  const [orderOpen, setOrderOpen] = useState(false);
  return (
    <div className="p-4">
      <div className="flex flex-col items-center border-b border-brand-100 pb-4 text-center">
        <Avatar name={c.name} src={c.avatarUrl} size={56} />
        <Link href={`/customers/${c.id}`} className="mt-2 font-extrabold hover:text-brand-600">
          {c.name}
        </Link>
        <div className="mt-1 flex flex-wrap justify-center gap-1">
          {parseTags(c.tags).map((t) => (
            <span key={t} className="chip bg-brand-100 text-brand-700">#{t}</span>
          ))}
        </div>
      </div>

      <div className="space-y-2 border-b border-brand-100 py-3 text-sm">
        <InfoRow icon="📱" value={c.phone ?? '—'} />
        <InfoRow icon="📍" value={c.address ?? '—'} />
        <InfoRow icon="✉️" value={c.email ?? '—'} />
      </div>

      <div className="border-b border-brand-100 py-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-xs font-extrabold uppercase tracking-wide text-ink-faint">Đơn hàng</h3>
          <button onClick={() => setOrderOpen(true)} className="text-xs font-bold text-brand-600 hover:underline">
            ➕ Tạo đơn
          </button>
        </div>
        {(c.orders ?? []).length === 0 ? (
          <p className="py-2 text-xs text-ink-faint">Chưa có đơn hàng</p>
        ) : (
          <div className="space-y-2">
            {(c.orders ?? []).map((o) => (
              <Link key={o.id} href={`/orders/${o.id}`} className="flex items-center justify-between rounded-xl bg-brand-50 px-3 py-2 hover:bg-brand-100">
                <div>
                  <span className="text-xs font-bold">#{o.code}</span>
                  <div className="text-[10px] text-ink-faint">{timeAgo(o.createdAt)}</div>
                </div>
                <div className="text-right">
                  <div className="text-xs font-extrabold">{money(o.total)}</div>
                  <span className={`chip mt-0.5 ${ORDER_STATUS_CLASSES[o.status]}`}>{ORDER_STATUS_LABELS[o.status]}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <div className="py-3">
        <h3 className="mb-2 text-xs font-extrabold uppercase tracking-wide text-ink-faint">Ghi chú</h3>
        <p className="rounded-xl bg-brand-50 p-3 text-xs leading-relaxed text-ink-soft">{c.note || 'Chưa có ghi chú'}</p>
      </div>

      <QuickOrderModal
        open={orderOpen}
        onClose={() => setOrderOpen(false)}
        customer={c}
        onCreated={() => {
          setOrderOpen(false);
          onOrderCreated();
          onCloseMobile();
        }}
      />
    </div>
  );
}

function InfoRow({ icon, value }: { icon: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <span>{icon}</span>
      <span className="min-w-0 flex-1 break-words text-ink-soft">{value}</span>
    </div>
  );
}

/** Modal giả lập tin nhắn đến — test không cần credentials */
function SimulateModal({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const [channel, setChannel] = useState<ChannelType>('ZALO_OA');
  const [userName, setUserName] = useState('Khách Test');
  const [text, setText] = useState('Cho shop xin giá sản phẩm với ạ');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  return (
    <Modal open={open} onClose={onClose} title="🧪 Giả lập tin nhắn đến">
      <div className="space-y-3">
        <p className="rounded-xl bg-amber-50 p-3 text-xs leading-relaxed text-amber-800">
          Công cụ test: tạo tin nhắn như thể khách gửi từ kênh (kể cả kênh chưa kết nối). Gửi lại câu trả lời trong inbox để thấy
          toàn bộ luồng hoạt động.
        </p>
        <div>
          <label className="label">Kênh</label>
          <select className="input" value={channel} onChange={(e) => setChannel(e.target.value as ChannelType)}>
            {(['ZALO_OA', 'ZALO_PERSONAL', 'FACEBOOK', 'INSTAGRAM', 'TIKTOK', 'SHOPEE'] as ChannelType[]).map((t) => (
              <option key={t} value={t}>{CHANNEL_LABELS[t]}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Tên khách</label>
          <input className="input" value={userName} onChange={(e) => setUserName(e.target.value)} />
        </div>
        <div>
          <label className="label">Nội dung</label>
          <textarea className="input" rows={3} value={text} onChange={(e) => setText(e.target.value)} />
        </div>
        {error && <p className="text-xs font-medium text-red-600">{error}</p>}
        <button
          className="btn-primary w-full py-2.5"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await api('/dev/simulate-incoming', { method: 'POST', body: { channelType: channel, userName, text } });
              onDone();
              onClose();
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? <Spinner className="border-white/40 border-t-white" /> : 'Gửi tin giả lập'}
        </button>
      </div>
    </Modal>
  );
}

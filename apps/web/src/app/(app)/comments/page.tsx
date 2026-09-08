'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { getSocket } from '@/lib/socket';
import { moneyFull, timeAgo } from '@/lib/format';
import { ORDER_STATUS_CLASSES, ORDER_STATUS_LABELS, type Order, type SocialComment } from '@/lib/types';
import { Avatar, EmptyState, Modal, PageHeader, Spinner } from '@/components/ui';

export default function CommentsPage() {
  const [comments, setComments] = useState<SocialComment[]>([]);
  const [status, setStatus] = useState<'NEW' | 'HANDLED' | ''>('');
  const [loading, setLoading] = useState(true);
  const [convertTarget, setConvertTarget] = useState<SocialComment | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    setComments(await api<SocialComment[]>(`/comments?${params}`));
  }, [status]);

  useEffect(() => {
    load().finally(() => setLoading(false));
  }, [load]);

  useEffect(() => {
    const socket = getSocket();
    if (!socket) return;
    const onNew = () => load();
    socket.on('comment:new', onNew);
    return () => {
      socket.off('comment:new', onNew);
    };
  }, [load]);

  async function reply(c: SocialComment) {
    const message = window.prompt('Trả lời comment:', `Dạ shop inbox hỗ trợ mình nha 🥰`);
    if (!message) return;
    try {
      await api(`/comments/${c.id}/reply`, { method: 'POST', body: { message } });
      load();
    } catch (err) {
      alert((err as Error).message);
    }
  }

  async function handle(c: SocialComment) {
    await api(`/comments/${c.id}/handle`, { method: 'POST' });
    load();
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4 md:p-6">
        <PageHeader
          title="Bình luận Facebook"
          subtitle="Comment trên bài viết Page — trả lời & chuyển thành đơn hàng"
          actions={
            <div className="flex gap-1.5">
              {([['', 'Tất cả'], ['NEW', '🟡 Chưa xử lý'], ['HANDLED', '✅ Đã xử lý']] as const).map(([v, l]) => (
                <button
                  key={v}
                  onClick={() => setStatus(v)}
                  className={`rounded-full px-3 py-1.5 text-xs font-bold ${status === v ? 'bg-brand-500 text-white' : 'bg-white text-ink-soft border border-brand-200 hover:bg-brand-50'}`}
                >
                  {l}
                </button>
              ))}
            </div>
          }
        />

        {loading ? (
          <div className="flex justify-center py-10"><Spinner className="h-6 w-6" /></div>
        ) : comments.length === 0 ? (
          <div className="card">
            <EmptyState icon="🗣️" title="Chưa có bình luận" hint="Kết nối Facebook Page trong Cài đặt để nhận comment tự động, hoặc bấm nút giả lập bên dưới" />
            <div className="pb-5 text-center">
              <button
                className="btn-secondary text-xs"
                onClick={async () => {
                  await api('/dev/simulate-comment', { method: 'POST', body: { author: 'Khách Facebook', message: 'Mình đặt 1 cái màu hồng size L với ạ' } });
                  load();
                }}
              >
                🧪 Giả lập comment
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {comments.map((c) => (
              <div key={c.id} className="card p-4">
                <div className="flex items-start gap-3">
                  <Avatar name={c.authorName} size={38} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-sm font-extrabold">{c.authorName}</span>
                      <span className="text-[11px] text-ink-faint">{timeAgo(c.createdAt)}</span>
                      {c.status === 'NEW' ? (
                        <span className="chip bg-amber-100 text-amber-700">Chưa xử lý</span>
                      ) : (
                        <span className="chip bg-emerald-100 text-emerald-700">Đã xử lý</span>
                      )}
                    </div>
                    <p className="mt-1 rounded-xl bg-brand-50 px-3 py-2 text-sm text-ink">{c.message}</p>
                    {c.replyText && (
                      <p className="mt-1.5 text-xs text-ink-soft">
                        ↳ Đã trả lời: <span className="italic">{c.replyText}</span>
                      </p>
                    )}
                    {c.order && (
                      <Link href={`/orders/${c.order.id}`} className="mt-1.5 inline-flex items-center gap-2 rounded-lg bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700 hover:bg-emerald-100">
                        → Đơn {c.order.code} · {moneyFull(c.order.total)}{' '}
                        <span className={`chip ${ORDER_STATUS_CLASSES[c.order.status]}`}>{ORDER_STATUS_LABELS[c.order.status]}</span>
                      </Link>
                    )}
                    {c.customer && !c.order && (
                      <Link href={`/customers/${c.customer.id}`} className="ml-0 mt-1 block text-xs font-semibold text-brand-600 hover:underline">
                        👤 Khách: {c.customer.name}
                      </Link>
                    )}
                  </div>
                </div>
                {c.status === 'NEW' && (
                  <div className="mt-3 flex flex-wrap gap-2 border-t border-brand-50 pt-3">
                    <button className="btn-primary px-3 py-1.5 text-xs" onClick={() => setConvertTarget(c)}>
                      ➕ Tạo đơn
                    </button>
                    <button className="btn-secondary px-3 py-1.5 text-xs" onClick={() => reply(c)}>
                      💬 Trả lời
                    </button>
                    <button className="btn-ghost px-3 py-1.5 text-xs" onClick={() => handle(c)}>
                      ✅ Đánh dấu đã xử lý
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <ConvertModal
        comment={convertTarget}
        onClose={() => setConvertTarget(null)}
        onDone={() => {
          setConvertTarget(null);
          load();
        }}
      />
    </div>
  );
}

function ConvertModal({
  comment,
  onClose,
  onDone,
}: {
  comment: SocialComment | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [rows, setRows] = useState([{ productName: '', quantity: 1, price: 0 }]);
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [created, setCreated] = useState<Order | null>(null);

  useEffect(() => {
    if (comment) {
      setRows([{ productName: '', quantity: 1, price: 0 }]);
      setError('');
      setCreated(null);
    }
  }, [comment]);

  if (!comment) return null;

  return (
    <Modal open={!!comment} onClose={onClose} title={`Tạo đơn từ comment — ${comment.authorName}`} wide>
      {created ? (
        <div className="space-y-4 text-center">
          <div className="text-4xl">🎉</div>
          <p className="font-bold">Đã tạo đơn {created.code}</p>
          <Link href={`/orders/${created.id}`} className="btn-primary w-full py-2.5" onClick={onDone}>
            Xem đơn hàng
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="rounded-xl bg-brand-50 px-3 py-2 text-xs italic text-ink-soft">“{comment.message}”</p>
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-12 gap-2">
              <input
                className="input col-span-12 sm:col-span-6"
                placeholder="Sản phẩm"
                value={r.productName}
                onChange={(e) => setRows((prev) => prev.map((p, j) => (j === i ? { ...p, productName: e.target.value } : p)))}
              />
              <input
                className="input col-span-4 sm:col-span-2"
                type="number" min={1} placeholder="SL"
                value={r.quantity}
                onChange={(e) => setRows((prev) => prev.map((p, j) => (j === i ? { ...p, quantity: Number(e.target.value) } : p)))}
              />
              <input
                className="input col-span-7 sm:col-span-3"
                type="number" min={0} placeholder="Giá (đ)"
                value={r.price || ''}
                onChange={(e) => setRows((prev) => prev.map((p, j) => (j === i ? { ...p, price: Number(e.target.value) } : p)))}
              />
              <button className="col-span-1 rounded-lg text-ink-faint hover:bg-brand-50" onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev))}>
                ✕
              </button>
            </div>
          ))}
          <button className="btn-ghost text-xs" onClick={() => setRows((prev) => [...prev, { productName: '', quantity: 1, price: 0 }])}>
            ➕ Thêm sản phẩm
          </button>
          <div>
            <label className="label">Số điện thoại</label>
            <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <label className="label">Địa chỉ giao</label>
            <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
          </div>
          {error && <p className="text-xs font-medium text-red-600">{error}</p>}
          <button
            className="btn-primary w-full py-2.5"
            disabled={busy || !rows[0].productName}
            onClick={async () => {
              setBusy(true);
              setError('');
              try {
                const res = await api<{ order: Order }>(`/comments/${comment.id}/convert`, {
                  method: 'POST',
                  body: {
                    items: rows.filter((r) => r.productName),
                    shippingPhone: phone,
                    shippingAddress: address,
                  },
                });
                setCreated(res.order);
                onDone();
              } catch (err) {
                setError((err as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <Spinner className="border-white/40 border-t-white" /> : 'Tạo đơn hàng'}
          </button>
        </div>
      )}
    </Modal>
  );
}

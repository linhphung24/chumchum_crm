'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { dateTime, moneyFull } from '@/lib/format';
import {
  CHANNEL_LABELS,
  ORDER_STATUSES,
  ORDER_STATUS_CLASSES,
  ORDER_STATUS_LABELS,
  type ChannelType,
  type Order,
  type OrderStatus,
} from '@/lib/types';
import { PageHeader, Spinner } from '@/components/ui';

export default function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [order, setOrder] = useState<Order | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  async function load() {
    setOrder(await api<Order>(`/orders/${id}`));
  }
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!order) {
    return <div className="flex h-full items-center justify-center"><Spinner className="h-6 w-6" /></div>;
  }

  async function changeStatus(s: OrderStatus) {
    setBusy(true);
    try {
      await api(`/orders/${order!.id}/status`, { method: 'PATCH', body: { status: s } });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function syncTrello() {
    setBusy(true);
    setMsg('');
    try {
      await api(`/trello/sync-order/${order!.id}`, { method: 'POST' });
      await load();
      setMsg('✅ Đã đồng bộ Trello');
    } catch (err) {
      setMsg(`❌ ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-3xl p-4 md:p-6">
        <PageHeader
          title={`Đơn ${order.code}`}
          subtitle={`${dateTime(order.createdAt)} · ${order.sourceChannel ? `${CHANNEL_LABELS[order.sourceChannel as ChannelType] ?? order.sourceChannel}` : 'Tạo tay'}`}
          actions={
            <Link href="/orders" className="btn-ghost">← Danh sách</Link>
          }
        />

        {/* Trạng thái + thao tác */}
        <div className="card p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`chip px-3 py-1 text-sm ${ORDER_STATUS_CLASSES[order.status]}`}>{ORDER_STATUS_LABELS[order.status]}</span>
            <div className="flex-1" />
            {busy ? <Spinner /> : (
              <div className="flex flex-wrap gap-1.5">
                {ORDER_STATUSES.filter((s) => s !== order.status).map((s) => (
                  <button
                    key={s}
                    onClick={() => changeStatus(s)}
                    className="rounded-lg border border-brand-200 px-2.5 py-1 text-xs font-bold text-ink-soft hover:border-brand-400 hover:bg-brand-50"
                  >
                    → {ORDER_STATUS_LABELS[s]}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-brand-50 pt-3">
            {order.trelloCardUrl ? (
              <a href={order.trelloCardUrl} target="_blank" rel="noreferrer" className="btn-secondary text-xs">
                🔗 Mở Trello card
              </a>
            ) : null}
            <button className="btn-secondary text-xs" onClick={syncTrello} disabled={busy}>
              📋 {order.trelloCardId ? 'Đồng bộ lại Trello' : 'Tạo task Trello'}
            </button>
            {msg && <span className="text-xs font-semibold">{msg}</span>}
          </div>
        </div>

        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {/* Sản phẩm */}
          <div className="card p-4">
            <h3 className="mb-3 text-sm font-extrabold">Sản phẩm</h3>
            <div className="space-y-2">
              {(order.items ?? []).map((it, i) => (
                <div key={i} className="flex items-center justify-between rounded-xl bg-brand-50 px-3 py-2 text-sm">
                  <div>
                    <span className="font-semibold">{it.productName}</span>
                    {it.variant && <span className="ml-1 text-xs text-ink-soft">({it.variant})</span>}
                    <div className="text-[11px] text-ink-faint">{it.quantity} × {moneyFull(it.price)}</div>
                  </div>
                  <span className="font-extrabold">{moneyFull(it.quantity * it.price)}</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-brand-100 pt-3">
              <span className="font-bold">Tổng cộng</span>
              <span className="text-lg font-extrabold text-brand-600">{moneyFull(order.total)}</span>
            </div>
          </div>

          {/* Khách + giao hàng */}
          <div className="card space-y-2 p-4 text-sm">
            <h3 className="mb-1 text-sm font-extrabold">Khách hàng & giao hàng</h3>
            <div className="flex justify-between">
              <span className="text-ink-faint">Khách</span>
              <Link href={`/customers/${order.customer.id}`} className="font-bold hover:text-brand-600">{order.customer.name}</Link>
            </div>
            <div className="flex justify-between"><span className="text-ink-faint">SĐT</span><span>{order.shippingPhone ?? order.customer.phone ?? '—'}</span></div>
            <div className="flex justify-between gap-4">
              <span className="shrink-0 text-ink-faint">Địa chỉ</span>
              <span className="text-right">{order.shippingAddress ?? '—'}</span>
            </div>
            <div className="flex justify-between"><span className="text-ink-faint">Người tạo</span><span>{order.createdBy?.name ?? 'Hệ thống'}</span></div>
            {order.note && (
              <div className="rounded-xl bg-brand-50 p-3 text-xs text-ink-soft">📝 {order.note}</div>
            )}
          </div>
        </div>

        {/* Lịch sử trạng thái */}
        <div className="card mt-4 p-4">
          <h3 className="mb-3 text-sm font-extrabold">Lịch sử trạng thái</h3>
          <div className="space-y-3">
            {(order.events ?? []).slice().reverse().map((e) => (
              <div key={e.id} className="flex items-start gap-3">
                <span className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${e.toStatus === 'CANCELLED' ? 'bg-neutral-400' : 'bg-brand-400'}`} />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold">
                    {e.fromStatus ? `${ORDER_STATUS_LABELS[e.fromStatus as OrderStatus]} → ` : ''}
                    {ORDER_STATUS_LABELS[e.toStatus as OrderStatus] ?? e.toStatus}
                  </p>
                  <p className="text-[11px] text-ink-faint">
                    {dateTime(e.createdAt)}
                    {e.user?.name ? ` · ${e.user.name}` : ''}
                    {e.note ? ` · ${e.note}` : ''}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { dateTime, moneyFull } from '@/lib/format';
import {
  CHANNEL_LABELS,
  ORDER_STATUSES,
  ORDER_STATUS_CLASSES,
  ORDER_STATUS_LABELS,
  type ChannelType,
  type Customer,
  type Order,
  type OrderStatus,
} from '@/lib/types';
import { EmptyState, PageHeader, Spinner } from '@/components/ui';
import { QuickOrderModal } from '@/components/order-modal';

export default function OrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [status, setStatus] = useState('');
  const [channel, setChannel] = useState('');
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (channel) params.set('channel', channel);
    if (q) params.set('q', q);
    api<Order[]>(`/orders?${params}`).then(setOrders).finally(() => setLoading(false));
  }, [status, channel, q]);

  const [orderCustomer, setOrderCustomer] = useState<Customer | null>(null);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl p-4 md:p-6">
        <PageHeader
          title="Đơn hàng"
          subtitle={`${orders.length} đơn`}
          actions={
            <button className="btn-primary" onClick={() => { setCreateOpen(true); }}>
              ➕ Tạo đơn
            </button>
          }
        />

        <div className="mb-4 flex flex-wrap gap-2">
          <input className="input max-w-xs flex-1" placeholder="🔍 Tìm mã đơn, tên, SĐT..." value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input w-auto" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Mọi trạng thái</option>
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>{ORDER_STATUS_LABELS[s]}</option>
            ))}
          </select>
          <select className="input w-auto" value={channel} onChange={(e) => setChannel(e.target.value)}>
            <option value="">Mọi kênh</option>
            {(Object.keys(CHANNEL_LABELS) as ChannelType[]).map((t) => (
              <option key={t} value={t}>{CHANNEL_LABELS[t]}</option>
            ))}
          </select>
        </div>

        {loading ? (
          <div className="card"><div className="flex justify-center py-10"><Spinner className="h-6 w-6" /></div></div>
        ) : orders.length === 0 ? (
          <div className="card"><EmptyState icon="🛒" title="Không có đơn hàng" hint="Tạo đơn mới hoặc chờ đồng bộ từ kênh" /></div>
        ) : (
          <>
            {/* Bảng desktop */}
            <div className="card hidden overflow-hidden md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-brand-100 bg-brand-50/60 text-left text-xs font-extrabold uppercase tracking-wide text-ink-faint">
                    <th className="px-4 py-3">Mã</th>
                    <th className="px-4 py-3">Khách hàng</th>
                    <th className="px-4 py-3">Kênh</th>
                    <th className="px-4 py-3 text-right">Tổng</th>
                    <th className="px-4 py-3">Trạng thái</th>
                    <th className="px-4 py-3">Trello</th>
                    <th className="px-4 py-3">Ngày</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-50">
                  {orders.map((o) => (
                    <tr key={o.id} className="hover:bg-brand-50">
                      <td className="px-4 py-3 font-extrabold">
                        <Link href={`/orders/${o.id}`} className="hover:text-brand-600">#{o.code}</Link>
                      </td>
                      <td className="px-4 py-3">
                        <Link href={`/customers/${o.customer.id}`} className="font-semibold hover:text-brand-600">{o.customer.name}</Link>
                      </td>
                      <td className="px-4 py-3 text-xs text-ink-soft">{o.sourceChannel ? CHANNEL_LABELS[o.sourceChannel as ChannelType] ?? o.sourceChannel : '—'}</td>
                      <td className="px-4 py-3 text-right font-extrabold">{moneyFull(o.total)}</td>
                      <td className="px-4 py-3"><span className={`chip ${ORDER_STATUS_CLASSES[o.status]}`}>{ORDER_STATUS_LABELS[o.status]}</span></td>
                      <td className="px-4 py-3 text-xs">
                        {o.trelloCardUrl ? (
                          <a href={o.trelloCardUrl} target="_blank" rel="noreferrer" className="font-bold text-sky-600 hover:underline">🔗 Card</a>
                        ) : (
                          <span className="text-ink-faint">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-ink-faint">{dateTime(o.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Thẻ mobile */}
            <div className="space-y-3 md:hidden">
              {orders.map((o) => (
                <Link key={o.id} href={`/orders/${o.id}`} className="card block p-4">
                  <div className="flex items-center justify-between">
                    <span className="font-extrabold">#{o.code}</span>
                    <span className={`chip ${ORDER_STATUS_CLASSES[o.status]}`}>{ORDER_STATUS_LABELS[o.status]}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between text-sm">
                    <span className="font-semibold">{o.customer.name}</span>
                    <span className="font-extrabold">{moneyFull(o.total)}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-ink-faint">
                    {o.sourceChannel ? `${CHANNEL_LABELS[o.sourceChannel as ChannelType] ?? o.sourceChannel} · ` : ''}
                    {dateTime(o.createdAt)}
                  </div>
                </Link>
              ))}
            </div>
          </>
        )}
      </div>

      <QuickOrderModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        customer={orderCustomer}
        onCreated={() => setCreateOpen(false)}
      />
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import { moneyFull, parseTags, timeAgo } from '@/lib/format';
import {
  CHANNEL_LABELS,
  ORDER_STATUS_CLASSES,
  ORDER_STATUS_LABELS,
  type ChannelType,
  type Customer,
} from '@/lib/types';
import { Avatar, PageHeader, Spinner } from '@/components/ui';
import { ChannelPill } from '@/components/charts';

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [editForm, setEditForm] = useState({ name: '', phone: '', address: '', tags: '', note: '' });
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    const data = await api<Customer>(`/customers/${id}`);
    setCustomer(data);
    setEditForm({
      name: data.name,
      phone: data.phone ?? '',
      address: data.address ?? '',
      tags: data.tags ?? '',
      note: data.note ?? '',
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (!customer) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner className="h-6 w-6" />
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-4xl p-4 md:p-6">
        <PageHeader
          title="Hồ sơ khách hàng"
          actions={
            editing ? (
              <>
                <button className="btn-ghost" onClick={() => setEditing(false)}>Huỷ</button>
                <button
                  className="btn-primary"
                  disabled={saving}
                  onClick={async () => {
                    setSaving(true);
                    try {
                      await api(`/customers/${id}`, { method: 'PATCH', body: editForm });
                      setEditing(false);
                      load();
                    } finally {
                      setSaving(false);
                    }
                  }}
                >
                  {saving ? <Spinner className="border-white/40 border-t-white" /> : 'Lưu'}
                </button>
              </>
            ) : (
              <button className="btn-secondary" onClick={() => setEditing(true)}>✏️ Sửa</button>
            )
          }
        />

        <div className="grid gap-4 md:grid-cols-2">
          {/* Thông tin */}
          <div className="card p-5">
            <div className="flex items-center gap-4">
              <Avatar name={customer.name} src={customer.avatarUrl} size={64} />
              <div>
                <h2 className="text-lg font-extrabold">{customer.name}</h2>
                <div className="mt-1 flex flex-wrap gap-1">
                  {parseTags(customer.tags).map((t) => (
                    <span key={t} className="chip bg-brand-100 text-brand-700">#{t}</span>
                  ))}
                </div>
              </div>
            </div>
            {editing ? (
              <div className="mt-4 space-y-2.5">
                <div><label className="label">Tên</label><input className="input" value={editForm.name} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></div>
                <div><label className="label">SĐT</label><input className="input" value={editForm.phone} onChange={(e) => setEditForm({ ...editForm, phone: e.target.value })} /></div>
                <div><label className="label">Địa chỉ</label><input className="input" value={editForm.address} onChange={(e) => setEditForm({ ...editForm, address: e.target.value })} /></div>
                <div><label className="label">Tags (phân tách dấu phẩy)</label><input className="input" value={editForm.tags} onChange={(e) => setEditForm({ ...editForm, tags: e.target.value })} /></div>
                <div><label className="label">Ghi chú</label><textarea className="input" rows={3} value={editForm.note} onChange={(e) => setEditForm({ ...editForm, note: e.target.value })} /></div>
              </div>
            ) : (
              <div className="mt-4 space-y-2 text-sm">
                <Row icon="📱" value={customer.phone || '—'} />
                <Row icon="✉️" value={customer.email || '—'} />
                <Row icon="📍" value={customer.address || '—'} />
                <div className="flex items-start gap-2">
                  <span>📝</span>
                  <p className="min-w-0 flex-1 whitespace-pre-wrap rounded-xl bg-brand-50 p-3 text-xs text-ink-soft">{customer.note || 'Chưa có ghi chú'}</p>
                </div>
              </div>
            )}
          </div>

          {/* Danh tính kênh */}
          <div className="card p-5">
            <h3 className="mb-3 text-sm font-extrabold">Danh tính trên các kênh</h3>
            {(customer.identities ?? []).length === 0 ? (
              <p className="text-xs text-ink-faint">Chưa liên kết kênh nào</p>
            ) : (
              <div className="space-y-2">
                {(customer.identities ?? []).map((i2) => (
                  <div key={i2.id} className="flex items-center justify-between rounded-xl bg-brand-50 px-3 py-2">
                    <ChannelPill type={i2.channelAccount.type as ChannelType} />
                    <span className="text-xs font-semibold text-ink-soft">{i2.displayName || i2.channelAccount.name}</span>
                  </div>
                ))}
              </div>
            )}

            <h3 className="mb-2 mt-5 text-sm font-extrabold">Hội thoại</h3>
            {(customer.conversations ?? []).length === 0 ? (
              <p className="text-xs text-ink-faint">Chưa có hội thoại</p>
            ) : (
              <div className="space-y-2">
                {(customer.conversations ?? []).map((cv) => (
                  <Link key={cv.id} href={`/inbox?c=${cv.id}`} className="flex items-center justify-between rounded-xl border border-brand-100 px-3 py-2 text-xs font-semibold hover:bg-brand-50">
                    <ChannelPill type={cv.channelAccount.type as ChannelType} fallback={cv.channelAccount.name} />
                    <span className="text-ink-faint">{timeAgo(cv.lastMessageAt)}</span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Đơn hàng */}
        <div className="card mt-4 overflow-hidden">
          <h3 className="px-4 pt-4 text-sm font-extrabold">Lịch sử đơn hàng</h3>
          {(customer.orders ?? []).length === 0 ? (
            <p className="px-4 py-6 text-xs text-ink-faint">Chưa có đơn hàng</p>
          ) : (
            <div className="mt-2 divide-y divide-brand-50">
              {(customer.orders ?? []).map((o) => (
                <Link key={o.id} href={`/orders/${o.id}`} className="flex items-center justify-between px-4 py-3 hover:bg-brand-50">
                  <div>
                    <span className="text-sm font-extrabold">#{o.code}</span>
                    <div className="text-[11px] text-ink-faint">{timeAgo(o.createdAt)}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-extrabold">{moneyFull(o.total)}</span>
                    <span className={`chip ${ORDER_STATUS_CLASSES[o.status]}`}>{ORDER_STATUS_LABELS[o.status]}</span>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ icon, value }: { icon: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span>{icon}</span>
      <span className="break-words text-ink-soft">{value}</span>
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import type { Customer } from '@/lib/types';
import { Avatar, EmptyState, Modal, PageHeader, Spinner } from '@/components/ui';
import { parseTags } from '@/lib/format';

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => {
      api<Customer[]>(`/customers?q=${encodeURIComponent(q)}`).then(setCustomers).finally(() => setLoading(false));
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl p-4 md:p-6">
        <PageHeader
          title="Khách hàng"
          subtitle="Hồ sơ hợp nhất từ mọi kênh chat"
          actions={
            <button className="btn-primary" onClick={() => setCreateOpen(true)}>
              ➕ Thêm khách
            </button>
          }
        />

        <input className="input mb-4" placeholder="🔍 Tìm theo tên, SĐT, email..." value={q} onChange={(e) => setQ(e.target.value)} />

        {loading ? (
          <div className="card"><div className="flex justify-center py-10"><Spinner className="h-6 w-6" /></div></div>
        ) : customers.length === 0 ? (
          <div className="card"><EmptyState icon="👥" title="Không tìm thấy khách hàng" /></div>
        ) : (
          <div className="card divide-y divide-brand-50 overflow-hidden">
            {customers.map((c) => (
              <Link key={c.id} href={`/customers/${c.id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-brand-50">
                <Avatar name={c.name} src={c.avatarUrl} size={42} />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="truncate text-sm font-extrabold">{c.name}</span>
                    {parseTags(c.tags).slice(0, 2).map((t) => (
                      <span key={t} className="chip bg-brand-100 text-brand-700">#{t}</span>
                    ))}
                  </div>
                  <p className="truncate text-xs text-ink-soft">{c.phone ?? c.address ?? 'Chưa có thông tin liên hệ'}</p>
                </div>
                <div className="shrink-0 text-right text-[11px] text-ink-faint">
                  <div>{c._count?.orders ?? 0} đơn</div>
                  <div>{timeAgo(c.updatedAt)}</div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      <CreateCustomerModal open={createOpen} onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); setLoading(true); }} />
    </div>
  );
}

function CreateCustomerModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ name: '', phone: '', address: '', tags: '', note: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  return (
    <Modal open={open} onClose={onClose} title="Thêm khách hàng">
      <div className="space-y-3">
        {(
          [
            ['name', 'Tên khách *'],
            ['phone', 'Số điện thoại'],
            ['address', 'Địa chỉ'],
            ['tags', 'Tags (cách nhau dấu phẩy)'],
          ] as const
        ).map(([key, label]) => (
          <div key={key}>
            <label className="label">{label}</label>
            <input className="input" value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
          </div>
        ))}
        <div>
          <label className="label">Ghi chú</label>
          <textarea className="input" rows={2} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </div>
        {error && <p className="text-xs font-medium text-red-600">{error}</p>}
        <button
          className="btn-primary w-full py-2.5"
          disabled={busy || !form.name}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await api('/customers', { method: 'POST', body: form });
              onCreated();
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

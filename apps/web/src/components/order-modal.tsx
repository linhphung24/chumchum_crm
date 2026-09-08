'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { moneyFull } from '@/lib/format';
import type { Order } from '@/lib/types';
import { Modal, Spinner } from './ui';

interface CustomerLite {
  id: string;
  name: string;
  phone?: string | null;
  address?: string | null;
}

/** Modal tạo đơn nhanh — nếu không truyền customer sẽ hiện ô chọn khách */
export function QuickOrderModal({
  open,
  onClose,
  customer,
  onCreated,
  sourceType = 'CHAT',
}: {
  open: boolean;
  onClose: () => void;
  customer?: CustomerLite | null;
  onCreated: (order: Order) => void;
  sourceType?: string;
}) {
  const [rows, setRows] = useState([{ productName: '', quantity: 1, price: 0 }]);
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [customers, setCustomers] = useState<CustomerLite[]>([]);
  const [pickedId, setPickedId] = useState('');

  const effective = customer ?? customers.find((c) => c.id === pickedId) ?? null;

  useEffect(() => {
    if (open && !customer) {
      api<CustomerLite[]>('/customers').then(setCustomers).catch(() => {});
    }
  }, [open, customer]);

  useEffect(() => {
    if (open) {
      setAddress(effective?.address ?? '');
      setPhone(effective?.phone ?? '');
      setRows([{ productName: '', quantity: 1, price: 0 }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, effective?.id]);

  const total = useMemo(() => rows.reduce((s, r) => s + r.price * r.quantity, 0), [rows]);

  return (
    <Modal open={open} onClose={onClose} title={effective ? `Tạo đơn — ${effective.name}` : 'Tạo đơn hàng'} wide>
      <div className="space-y-3">
        {!customer && (
          <div>
            <label className="label">Khách hàng *</label>
            <select className="input" value={pickedId} onChange={(e) => setPickedId(e.target.value)}>
              <option value="">— Chọn khách hàng —</option>
              {customers.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                  {c.phone ? ` · ${c.phone}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-12 gap-2">
            <input
              className="input col-span-6"
              placeholder="Sản phẩm"
              value={r.productName}
              onChange={(e) => setRows((prev) => prev.map((p, j) => (j === i ? { ...p, productName: e.target.value } : p)))}
            />
            <input
              className="input col-span-2"
              type="number"
              min={1}
              placeholder="SL"
              value={r.quantity}
              onChange={(e) => setRows((prev) => prev.map((p, j) => (j === i ? { ...p, quantity: Number(e.target.value) } : p)))}
            />
            <input
              className="input col-span-3"
              type="number"
              min={0}
              placeholder="Giá (đ)"
              value={r.price || ''}
              onChange={(e) => setRows((prev) => prev.map((p, j) => (j === i ? { ...p, price: Number(e.target.value) } : p)))}
            />
            <button
              className="col-span-1 rounded-lg text-ink-faint hover:bg-brand-50"
              onClick={() => setRows((prev) => (prev.length > 1 ? prev.filter((_, j) => j !== i) : prev))}
            >
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
        <div className="flex items-center justify-between rounded-xl bg-brand-50 px-3 py-2 text-sm font-bold">
          <span>Tổng cộng</span>
          <span className="text-brand-600">{moneyFull(total)}</span>
        </div>
        {error && <p className="text-xs font-medium text-red-600">{error}</p>}
        <button
          className="btn-primary w-full py-2.5"
          disabled={saving || !rows[0].productName || !effective}
          onClick={async () => {
            setSaving(true);
            setError('');
            try {
              const order = await api<Order>('/orders', {
                method: 'POST',
                body: {
                  customerId: effective!.id,
                  items: rows.filter((r) => r.productName),
                  shippingAddress: address,
                  shippingPhone: phone,
                  sourceType,
                  sourceChannel: 'MANUAL',
                },
              });
              onCreated(order);
            } catch (err) {
              setError((err as Error).message);
            } finally {
              setSaving(false);
            }
          }}
        >
          {saving ? <Spinner className="border-white/40 border-t-white" /> : 'Lưu đơn hàng'}
        </button>
      </div>
    </Modal>
  );
}

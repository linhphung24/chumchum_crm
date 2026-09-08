'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { money, moneyFull } from '@/lib/format';
import {
  ORDER_STATUSES,
  ORDER_STATUS_CLASSES,
  ORDER_STATUS_LABELS,
  type ChannelType,
  type OrderStatus,
} from '@/lib/types';
import { PageHeader, Spinner } from '@/components/ui';
import { ChannelPie, ChannelPill, RevenueLine } from '@/components/charts';

export default function AnalyticsPage() {
  const [revenue, setRevenue] = useState<{ date: string; total: number }[]>([]);
  const [byChannel, setByChannel] = useState<{ channel: string; count: number; total: number; percent: number }[]>([]);
  const [msgsByChannel, setMsgsByChannel] = useState<{ channel: string; count: number }[]>([]);
  const [byStatus, setByStatus] = useState<Record<string, number>>({});
  const [staff, setStaff] = useState<{ userId: string; name: string; created: number; completed: number; revenue: number }[]>([]);
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api<{ date: string; total: number }[]>(`/analytics/revenue?days=${days}`),
      api<{ channel: string; count: number; total: number; percent: number }[]>('/analytics/orders-by-channel'),
      api<{ channel: string; count: number }[]>('/analytics/messages-by-channel'),
      api<Record<string, number>>('/analytics/orders-by-status'),
      api<{ userId: string; name: string; created: number; completed: number; revenue: number }[]>('/analytics/staff'),
    ])
      .then(([r, c, m, s, st]) => {
        setRevenue(r);
        setByChannel(c);
        setMsgsByChannel(m);
        setByStatus(s);
        setStaff(st);
      })
      .finally(() => setLoading(false));
  }, [days]);

  const totalRevenue = revenue.reduce((s, r) => s + r.total, 0);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl p-4 md:p-6">
        <PageHeader
          title="Số liệu"
          subtitle={`Tổng doanh thu ${days} ngày: ${moneyFull(totalRevenue)}`}
          actions={
            <select className="input w-auto" value={days} onChange={(e) => setDays(Number(e.target.value))}>
              <option value={7}>7 ngày</option>
              <option value={14}>14 ngày</option>
              <option value={30}>30 ngày</option>
              <option value={90}>90 ngày</option>
            </select>
          }
        />

        {loading ? (
          <div className="card"><div className="flex justify-center py-10"><Spinner className="h-6 w-6" /></div></div>
        ) : (
          <div className="space-y-4">
            <div className="card p-4">
              <h2 className="mb-2 text-sm font-bold">Doanh thu theo ngày</h2>
              <RevenueLine data={revenue} />
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div className="card p-4">
                <h2 className="mb-2 text-sm font-bold">Đơn theo kênh</h2>
                {byChannel.length === 0 ? (
                  <p className="py-6 text-center text-xs text-ink-faint">Chưa có dữ liệu</p>
                ) : (
                  <>
                    <ChannelPie data={byChannel} />
                    <div className="mt-3 space-y-1.5">
                      {byChannel.map((c) => (
                        <div key={c.channel} className="flex items-center justify-between text-xs">
                          <ChannelPill type={c.channel as ChannelType} fallback={c.channel} />
                          <span className="font-semibold text-ink-soft">{c.count} đơn · {money(c.total)}</span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>

              <div className="space-y-4">
                <div className="card p-4">
                  <h2 className="mb-2 text-sm font-bold">Đơn theo trạng thái</h2>
                  <div className="space-y-2">
                    {ORDER_STATUSES.map((s) => {
                      const value = byStatus[s] ?? 0;
                      const max = Math.max(...ORDER_STATUSES.map((x) => byStatus[x] ?? 0), 1);
                      return (
                        <div key={s} className="flex items-center gap-2">
                          <span className={`chip w-24 justify-center ${ORDER_STATUS_CLASSES[s as OrderStatus]}`}>{ORDER_STATUS_LABELS[s as OrderStatus]}</span>
                          <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-brand-50">
                            <div className="h-full rounded-full bg-brand-400" style={{ width: `${(value / max) * 100}%` }} />
                          </div>
                          <span className="w-6 text-right text-xs font-bold">{value}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="card p-4">
                  <h2 className="mb-2 text-sm font-bold">Tin nhắn theo kênh (30 ngày)</h2>
                  {msgsByChannel.length === 0 ? (
                    <p className="py-3 text-center text-xs text-ink-faint">Chưa có dữ liệu</p>
                  ) : (
                    <div className="space-y-1.5">
                      {msgsByChannel.map((m) => (
                        <div key={m.channel} className="flex items-center justify-between text-xs">
                          <ChannelPill type={m.channel as ChannelType} fallback={m.channel} />
                          <span className="font-semibold text-ink-soft">{m.count} tin</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            <div className="card overflow-hidden">
              <h2 className="px-4 pt-4 text-sm font-bold">Hiệu suất nhân viên</h2>
              <div className="overflow-x-auto">
                <table className="mt-2 w-full min-w-[480px] text-sm">
                <thead>
                  <tr className="border-b border-brand-100 text-left text-xs font-extrabold uppercase text-ink-faint">
                    <th className="px-4 py-2">Nhân viên</th>
                    <th className="px-4 py-2 text-right">Đơn đã tạo</th>
                    <th className="px-4 py-2 text-right">Hoàn tất</th>
                    <th className="px-4 py-2 text-right">Doanh thu</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-brand-50">
                  {staff.map((s) => (
                    <tr key={s.userId}>
                      <td className="px-4 py-2.5 font-semibold">{s.name}</td>
                      <td className="px-4 py-2.5 text-right">{s.created}</td>
                      <td className="px-4 py-2.5 text-right">{s.completed}</td>
                      <td className="px-4 py-2.5 text-right font-bold">{money(s.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

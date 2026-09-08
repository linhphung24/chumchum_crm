'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '@/lib/api';
import { money, moneyFull, timeAgo } from '@/lib/format';
import { CHANNEL_COLORS, CHANNEL_LABELS, type AnalyticsSummary, type ChannelType, type Conversation } from '@/lib/types';
import { PageHeader, SkeletonRows, Spinner } from '@/components/ui';
import { ChannelPill, RevenueChart, ChannelPie } from '@/components/charts';

export default function DashboardPage() {
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [revenue, setRevenue] = useState<{ date: string; total: number }[]>([]);
  const [byChannel, setByChannel] = useState<{ channel: string; count: number; total: number; percent: number }[]>([]);
  const [unanswered, setUnanswered] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const [s, r, c, convs] = await Promise.all([
          api<AnalyticsSummary>('/analytics/summary'),
          api<{ date: string; total: number }[]>('/analytics/revenue?days=14'),
          api<{ channel: string; count: number; total: number; percent: number }[]>('/analytics/orders-by-channel'),
          api<Conversation[]>('/conversations'),
        ]);
        setSummary(s);
        setRevenue(r);
        setByChannel(c);
        setUnanswered(convs.filter((c2) => c2.lastDirection === 'IN').slice(0, 8));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-6xl p-4 md:p-6">
        <PageHeader title="Tổng quan" subtitle="Số liệu 7 ngày gần nhất" actions={
          <Link href="/analytics" className="btn-secondary hidden md:inline-flex">📈 Xem số liệu chi tiết</Link>
        } />
        <Link href="/analytics" className="mb-3 flex items-center justify-between rounded-2xl border border-brand-100 bg-white px-4 py-3 text-sm font-bold text-ink md:hidden">
          📈 Xem số liệu chi tiết <span className="text-ink-faint">→</span>
        </Link>

        {loading ? (
          <div className="card"><SkeletonRows rows={4} /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
              <StatCard label="Chưa trả lời" value={String(summary?.unanswered ?? 0)} hint="hội thoại chờ" tone="warn" href="/inbox" />
              <StatCard label="Đơn hôm nay" value={String(summary?.ordersToday ?? 0)} hint="đơn mới" href="/orders" />
              <StatCard label="Doanh thu 7 ngày" value={money(summary?.revenue7d)} hint={moneyFull(summary?.revenue7d)} tone="accent" />
              <StatCard label="Khách mới" value={String(summary?.newCustomers7d ?? 0)} hint="7 ngày qua" href="/customers" />
              <StatCard label="Tỉ lệ hoàn tất" value={`${summary?.completedRate ?? 0}%`} hint={`${summary?.totalOrders ?? 0} đơn`} />
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <div className="card p-4 lg:col-span-2">
                <h2 className="mb-3 text-sm font-bold text-ink">Doanh thu 14 ngày</h2>
                <RevenueChart data={revenue} />
              </div>
              <div className="card p-4">
                <h2 className="mb-3 text-sm font-bold text-ink">Đơn theo kênh</h2>
                {byChannel.length === 0 ? (
                  <p className="py-8 text-center text-sm text-ink-faint">Chưa có dữ liệu</p>
                ) : (
                  <>
                    <ChannelPie data={byChannel} />
                    <div className="mt-3 space-y-1.5">
                      {byChannel.map((c) => (
                        <div key={c.channel} className="flex items-center justify-between text-xs">
                          <ChannelPill type={c.channel as ChannelType} fallback={c.channel} />
                          <span className="font-semibold text-ink-soft">
                            {c.count} đơn · {money(c.total)}
                          </span>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="card mt-4 overflow-hidden">
              <div className="flex items-center justify-between px-4 pt-4">
                <h2 className="text-sm font-bold text-ink">⚠️ Tin nhắn chưa trả lời</h2>
                <Link href="/inbox" className="text-xs font-semibold text-brand-600 hover:underline">
                  Xem tất cả →
                </Link>
              </div>
              {unanswered.length === 0 ? (
                <p className="py-8 text-center text-sm text-ink-faint">Tuyệt vời — đã trả lời hết! 🎉</p>
              ) : (
                <div className="mt-2 divide-y divide-brand-50">
                  {unanswered.map((c) => (
                    <Link key={c.id} href={`/inbox?c=${c.id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-brand-50">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-bold">{c.customer.name}</span>
                          <ChannelPill type={c.channelAccount.type} />
                        </div>
                        <p className="truncate text-xs text-ink-soft">{c.lastMessageText}</p>
                      </div>
                      <span className="shrink-0 text-[11px] text-ink-faint">{timeAgo(c.lastMessageAt)}</span>
                    </Link>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  hint,
  tone = 'default',
  href,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'default' | 'warn' | 'accent';
  href?: string;
}) {
  const toneClass =
    tone === 'warn' ? 'bg-amber-50 border-amber-200' : tone === 'accent' ? 'bg-accent-400/15 border-accent-400/40' : 'bg-white border-brand-100';
  const inner = (
    <div className={`rounded-2xl border p-4 shadow-card transition-transform ${toneClass} ${href ? 'hover:-translate-y-0.5' : ''}`}>
      <div className="text-[11px] font-bold uppercase tracking-wide text-ink-faint">{label}</div>
      <div className="mt-1 text-2xl font-extrabold text-ink">{value}</div>
      {hint && <div className="mt-0.5 truncate text-[11px] text-ink-soft">{hint}</div>}
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}

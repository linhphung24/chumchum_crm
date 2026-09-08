'use client';

import {
  Bar,
  BarChart,
  Cell,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Badge } from './ui';
import { CHANNEL_COLORS, CHANNEL_EMOJI, CHANNEL_LABELS, type ChannelType } from '@/lib/types';

export function ChannelPill({ type, fallback }: { type: ChannelType; fallback?: string }) {
  const known = CHANNEL_LABELS[type] !== undefined;
  return (
    <Badge className={known ? CHANNEL_COLORS[type] : 'bg-neutral-100 text-neutral-600'}>
      {known ? `${CHANNEL_EMOJI[type]} ${CHANNEL_LABELS[type]}` : (fallback ?? type)}
    </Badge>
  );
}

export function RevenueChart({ data }: { data: { date: string; total: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
        <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} axisLine={false} tickLine={false} />
        <Tooltip
          formatter={(v: number) => [`${v.toLocaleString('vi-VN')}đ`, 'Doanh thu']}
          labelFormatter={(l: string) => `Ngày ${l.slice(5)}`}
          contentStyle={{ borderRadius: 12, border: '1px solid #FFE8E1', fontSize: 12 }}
        />
        <Bar dataKey="total" fill="#FB6A52" radius={[6, 6, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function RevenueLine({ data }: { data: { date: string; total: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -12, bottom: 0 }}>
        <XAxis dataKey="date" tick={{ fontSize: 10 }} tickFormatter={(v: string) => v.slice(5)} axisLine={false} tickLine={false} />
        <YAxis tick={{ fontSize: 10 }} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} axisLine={false} tickLine={false} />
        <Tooltip
          formatter={(v: number) => [`${v.toLocaleString('vi-VN')}đ`, 'Doanh thu']}
          labelFormatter={(l: string) => `Ngày ${l}`}
          contentStyle={{ borderRadius: 12, border: '1px solid #FFE8E1', fontSize: 12 }}
        />
        <Line type="monotone" dataKey="total" stroke="#FB6A52" strokeWidth={2.5} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

const PIE_COLORS = ['#FB6A52', '#FFA94D', '#FFC48F', '#F08C2E', '#C03E27', '#FFAB99'];

export function ChannelPie({ data }: { data: { channel: string; count: number }[] }) {
  const rows = data.map((d) => ({ name: d.channel, value: d.count }));
  return (
    <ResponsiveContainer width="100%" height={160}>
      <PieChart>
        <Pie data={rows} dataKey="value" nameKey="name" innerRadius={40} outerRadius={64} paddingAngle={3}>
          {rows.map((_, i) => (
            <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip contentStyle={{ borderRadius: 12, border: '1px solid #FFE8E1', fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

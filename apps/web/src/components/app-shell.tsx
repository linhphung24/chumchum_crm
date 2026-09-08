'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { getSocket, disconnectSocket } from '@/lib/socket';
import { getStoredUser, logout } from '@/lib/api';
import { ROLE_LABELS, type Role } from '@/lib/types';
import { Avatar } from './ui';

const NAV = [
  { href: '/', label: 'Tổng quan', icon: '📊' },
  { href: '/inbox', label: 'Inbox', icon: '💬' },
  { href: '/comments', label: 'Bình luận', icon: '🗣️' },
  { href: '/orders', label: 'Đơn', icon: '🛒' },
  { href: '/customers', label: 'Khách', icon: '👥' },
  { href: '/analytics', label: 'Số liệu', icon: '📈', desktopOnly: true },
  { href: '/settings', label: 'Cài đặt', icon: '⚙️', desktopOnly: true },
];

interface StoredUser {
  id: string;
  name: string;
  email: string;
  role: Role;
}

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [user, setUser] = useState<StoredUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const u = getStoredUser();
    if (!u) {
      router.replace('/login');
      return;
    }
    setUser(u);
    setReady(true);
    getSocket(); // kết nối realtime
    return () => disconnectSocket();
  }, [router]);

  useEffect(() => {
    if (ready) getSocket();
  }, [pathname, ready]);

  if (!ready) {
    return (
      <div className="flex h-dvh items-center justify-center bg-cream">
        <div className="flex flex-col items-center gap-3">
          <span className="text-4xl">🐹</span>
          <span className="text-sm font-semibold text-ink-soft">Đang tải ChumChum…</span>
        </div>
      </div>
    );
  }

  const isActive = (href: string) => (href === '/' ? pathname === '/' : pathname.startsWith(href));

  return (
    <div className="flex h-dvh flex-col md:flex-row">
      {/* Sidebar desktop */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-brand-100 bg-white md:flex">
        <Link href="/" className="flex items-center gap-2.5 px-5 py-5">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand-500 text-lg">🐹</span>
          <div>
            <div className="text-base font-extrabold leading-tight text-ink">ChumChum CRM</div>
            <div className="text-[11px] font-medium text-ink-faint">Inbox đa kênh</div>
          </div>
        </Link>
        <nav className="flex-1 space-y-1 px-3">
          {NAV.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold transition-colors ${
                isActive(item.href) ? 'bg-brand-500 text-white shadow-float' : 'text-ink-soft hover:bg-brand-50 hover:text-ink'
              }`}
            >
              <span>{item.icon}</span>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="border-t border-brand-100 p-4">
          <div className="flex items-center gap-3">
            <Avatar name={user?.name} size={36} />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-bold">{user?.name}</div>
              <div className="text-[11px] text-ink-faint">{user?.role ? ROLE_LABELS[user.role] : ''}</div>
            </div>
            <button
              onClick={logout}
              title="Đăng xuất"
              className="rounded-lg p-2 text-ink-faint hover:bg-brand-50 hover:text-brand-600"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />
              </svg>
            </button>
          </div>
        </div>
      </aside>

      {/* Nội dung chính */}
      <main className="flex min-h-0 flex-1 flex-col overflow-hidden pb-[62px] md:pb-0">{children}</main>

      {/* Bottom nav mobile */}
      <nav className="fixed inset-x-0 bottom-0 z-40 flex h-[62px] items-stretch border-t border-brand-100 bg-white/95 backdrop-blur md:hidden">
        {NAV.filter((n) => !n.desktopOnly).map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] font-semibold ${
              isActive(item.href) ? 'text-brand-600' : 'text-ink-faint'
            }`}
          >
            <span className="text-lg leading-none">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

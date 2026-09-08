import type { Metadata, Viewport } from 'next';
import { PwaRegister } from '@/components/pwa';
import './globals.css';

export const metadata: Metadata = {
  title: 'ChumChum CRM',
  description: 'Inbox đa kênh — Zalo, Messenger, Instagram, TikTok, Shopee + quản lý khách hàng & đơn hàng',
  manifest: '/manifest.webmanifest',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'ChumChum CRM',
  },
};

export const viewport: Viewport = {
  themeColor: '#FB6A52',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="vi">
      <body>
        {children}
        <PwaRegister />
      </body>
    </html>
  );
}

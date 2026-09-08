'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, saveAuth } from '@/lib/api';
import type { AuthPayload } from '@/lib/types';
import { ErrorText, Spinner } from '@/components/ui';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('admin@chumchum.vn');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await api<AuthPayload>('/auth/login', { method: 'POST', body: { email, password } });
      saveAuth(data);
      router.replace('/');
    } catch (err) {
      setError((err as Error).message || 'Đăng nhập thất bại');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-gradient-to-b from-brand-100 via-cream to-cream p-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <span className="mb-3 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-500 text-3xl shadow-float">🐹</span>
          <h1 className="text-2xl font-extrabold text-ink">ChumChum CRM</h1>
          <p className="mt-1 text-sm text-ink-soft">Inbox đa kênh · Khách hàng · Đơn hàng</p>
        </div>

        <form onSubmit={onSubmit} className="card space-y-4 p-6">
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </div>
          <div>
            <label className="label">Mật khẩu</label>
            <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" />
          </div>
          <ErrorText>{error}</ErrorText>
          <button className="btn-primary w-full py-2.5" disabled={loading}>
            {loading ? <Spinner className="border-white/40 border-t-white" /> : 'Đăng nhập'}
          </button>
          <p className="text-center text-xs text-ink-faint">
            Tài khoản mẫu: <b>admin@chumchum.vn</b> / <b>Admin@123</b>
          </p>
        </form>
      </div>
    </div>
  );
}

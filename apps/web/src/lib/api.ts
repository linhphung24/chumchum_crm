'use client';

export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

const AT_KEY = 'cc_at';
const RT_KEY = 'cc_rt';
const USER_KEY = 'cc_user';

export function getAccessToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(AT_KEY);
}

export function getRefreshToken(): string | null {
  if (typeof window === 'undefined') return null;
  return localStorage.getItem(RT_KEY);
}

export function getStoredUser() {
  if (typeof window === 'undefined') return null;
  try {
    return JSON.parse(localStorage.getItem(USER_KEY) ?? 'null');
  } catch {
    return null;
  }
}

export function saveAuth(payload: { accessToken: string; refreshToken: string; user: unknown }) {
  localStorage.setItem(AT_KEY, payload.accessToken);
  localStorage.setItem(RT_KEY, payload.refreshToken);
  localStorage.setItem(USER_KEY, JSON.stringify(payload.user));
}

export function clearAuth() {
  localStorage.removeItem(AT_KEY);
  localStorage.removeItem(RT_KEY);
  localStorage.removeItem(USER_KEY);
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function tryRefresh(): Promise<boolean> {
  const rt = getRefreshToken();
  if (!rt) return false;
  try {
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: rt }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    saveAuth(data);
    return true;
  } catch {
    return false;
  }
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; retry?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const at = getAccessToken();
  if (at) headers.Authorization = `Bearer ${at}`;

  const res = await fetch(`${API_URL}${path}`, {
    method: opts.method ?? 'GET',
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 401 && opts.retry !== false) {
    const refreshed = await tryRefresh();
    if (refreshed) return api<T>(path, { ...opts, retry: false });
    clearAuth();
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login';
    }
    throw new ApiError('Phiên đăng nhập hết hạn', 401);
  }

  if (!res.ok) {
    let message = `Lỗi ${res.status}`;
    try {
      const data = await res.json();
      message = data.message ?? message;
      if (Array.isArray(message)) message = message.join('; ');
    } catch {
      /* ignore */
    }
    throw new ApiError(message, res.status);
  }
  return res.json() as Promise<T>;
}

export async function logout() {
  const rt = getRefreshToken();
  if (rt) {
    try {
      await api('/auth/logout', { method: 'POST', body: { refreshToken: rt } });
    } catch {
      /* ignore */
    }
  }
  clearAuth();
  window.location.href = '/login';
}

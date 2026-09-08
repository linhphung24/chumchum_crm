'use client';

import { io, type Socket } from 'socket.io-client';
import { API_URL, getAccessToken } from './api';

let socket: Socket | null = null;

/** Socket singleton — kết nối lại khi token thay đổi */
export function getSocket(): Socket | null {
  if (typeof window === 'undefined') return null;
  if (socket?.connected) return socket;
  const token = getAccessToken();
  if (!token) return null;
  if (socket) socket.disconnect();
  socket = io(API_URL, {
    auth: { token },
    transports: ['websocket', 'polling'],
    reconnectionAttempts: 10,
  });
  return socket;
}

export function disconnectSocket() {
  if (socket) {
    socket.disconnect();
    socket = null;
  }
}

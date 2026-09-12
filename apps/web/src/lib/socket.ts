import { io, Socket } from 'socket.io-client';
import { apiUrl } from './config';

let socket: Socket | null = null;

export function connectRealtime(token: string): Socket {
  if (socket) {
    socket.auth = { token };
    if (!socket.connected) {
      socket.connect();
    }
    return socket;
  }

  socket = io(apiUrl || window.location.origin, {
    auth: { token },
    transports: ['websocket', 'polling'],
  });
  return socket;
}

export function disconnectRealtime() {
  socket?.disconnect();
  socket = null;
}

export function getRealtime(): Socket | null {
  return socket;
}

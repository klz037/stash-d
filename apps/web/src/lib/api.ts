import type {
  CreateLockRequest,
  FriendDto,
  LockDto,
  UserDto,
} from '@stashd/shared';
import { apiUrl } from './config';

async function request<T>(
  path: string,
  token: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  if (!response.ok) {
    let message = 'Something went wrong.';
    try {
      const body = (await response.json()) as { message?: string | string[] };
      if (Array.isArray(body.message)) {
        message = body.message.join(' ');
      } else if (body.message) {
        message = body.message;
      }
    } catch {
      message = response.statusText;
    }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export const api = {
  me: (token: string) => request<UserDto>('/api/me', token),
  friends: (token: string) => request<FriendDto[]>('/api/friends', token),
  pair: (token: string, code: string) =>
    request<FriendDto>('/api/pair', token, {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  inbox: (token: string) => request<LockDto[]>('/api/locks', token),
  sent: (token: string) => request<LockDto[]>('/api/locks/sent', token),
  createLock: (token: string, body: CreateLockRequest) =>
    request<LockDto>('/api/locks', token, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  confirm: (token: string, id: string) =>
    request<LockDto>(`/api/locks/${id}/confirm`, token, { method: 'POST' }),
  setCondition: (token: string, id: string, conditionLabel: string) =>
    request<LockDto>(`/api/locks/${id}/condition`, token, {
      method: 'POST',
      body: JSON.stringify({ conditionLabel }),
    }),
};

import type {
  CreateFriendNoteRequest,
  CreateLockRequest,
  FriendDto,
  FriendNoteDto,
  HereResponse,
  LockContext,
  LockDto,
  SongDto,
  SpotifyNowPlayingDto,
  SpotifyStatusDto,
  UpdateProfileRequest,
  UserDto,
} from '@stashd/shared';
import { apiUrl } from './config';

/** An API failure. `code` is the machine-readable reason when the server gives one, e.g. MFA_REQUIRED. */
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

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
    let code: string | undefined;
    try {
      const body = (await response.json()) as {
        message?: string | string[];
        code?: string;
      };
      if (Array.isArray(body.message)) {
        message = body.message.join(' ');
      } else if (body.message) {
        message = body.message;
      }
      code = body.code;
    } catch {
      message = response.statusText;
    }
    throw new ApiError(message, response.status, code);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return response.json() as Promise<T>;
}

export const api = {
  me: (token: string) => request<UserDto>('/api/me', token),
  updateProfile: (token: string, body: UpdateProfileRequest) =>
    request<UserDto>('/api/me', token, {
      method: 'PATCH',
      body: JSON.stringify(body),
    }),
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
  /** "I'm here." Stamps matching sealed locks and tells their senders. */
  here: (token: string, context: LockContext) =>
    request<HereResponse>('/api/locks/here', token, {
      method: 'POST',
      body: JSON.stringify({ context }),
    }),
  spotifyStatus: (token: string) =>
    request<SpotifyStatusDto>('/api/spotify/status', token),
  spotifyAuthorizeUrl: (token: string) =>
    request<{ url: string }>('/api/spotify/authorize-url', token),
  spotifyNowPlaying: (token: string) =>
    request<SpotifyNowPlayingDto>('/api/spotify/now-playing', token),
  spotifyResolve: (token: string, url: string) =>
    request<SongDto>('/api/spotify/resolve', token, {
      method: 'POST',
      body: JSON.stringify({ url }),
    }),
  spotifyDisconnect: (token: string) =>
    request<SpotifyStatusDto>('/api/spotify', token, { method: 'DELETE' }),
  notes: (token: string) => request<FriendNoteDto[]>('/api/notes', token),
  createNote: (token: string, body: CreateFriendNoteRequest) =>
    request<FriendNoteDto>('/api/notes', token, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
};

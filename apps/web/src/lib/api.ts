import type {
  AlertPreviewDto,
  CalendarDto,
  CreateFriendNoteRequest,
  CreateGroupRequest,
  CreateLockRequest,
  FriendDto,
  FriendNoteDto,
  FriendRequestDto,
  GroupDto,
  HereResponse,
  LockContext,
  LockDto,
  NotificationsStatusDto,
  PreviewAlertsRequest,
  PushSubscriptionDto,
  SendAlertNowRequest,
  SendAlertNowResponse,
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
  /** Sends a request (`pending: true`), or accepts theirs if they asked first. */
  pair: (token: string, code: string) =>
    request<FriendDto>('/api/pair', token, {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  friendRequests: (token: string) => request<FriendRequestDto[]>('/api/friends/requests', token),
  acceptRequest: (token: string, userId: string) =>
    request<FriendDto>(`/api/friends/requests/${encodeURIComponent(userId)}/accept`, token, {
      method: 'POST',
    }),
  declineRequest: (token: string, userId: string) =>
    request<{ ok: true }>(`/api/friends/requests/${encodeURIComponent(userId)}/decline`, token, {
      method: 'POST',
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
  groups: (token: string) => request<GroupDto[]>('/api/groups', token),
  createGroup: (token: string, body: CreateGroupRequest) =>
    request<GroupDto>('/api/groups', token, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  joinGroup: (token: string, code: string) =>
    request<GroupDto>('/api/groups/join', token, {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  /** Your next two weeks, read from Google through Auth0 Token Vault. */
  calendar: (token: string) => request<CalendarDto>('/api/calendar', token),
  notes: (token: string) => request<FriendNoteDto[]>('/api/notes', token),
  createNote: (token: string, body: CreateFriendNoteRequest) =>
    request<FriendNoteDto>('/api/notes', token, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  notificationsStatus: (token: string) =>
    request<NotificationsStatusDto>('/api/notifications/status', token),
  subscribePush: (token: string, body: PushSubscriptionDto) =>
    request<void>('/api/notifications/subscribe', token, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  unsubscribePush: (token: string, endpoint: string) =>
    request<void>(
      `/api/notifications/subscribe?endpoint=${encodeURIComponent(endpoint)}`,
      token,
      { method: 'DELETE' },
    ),
  previewAlerts: (token: string, body: PreviewAlertsRequest = {}) =>
    request<AlertPreviewDto>('/api/notifications/preview', token, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  sendAlertNow: (token: string, body: SendAlertNowRequest = {}) =>
    request<SendAlertNowResponse>('/api/notifications/send-now', token, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  ackAlert: (token: string, id: string) =>
    request<void>(`/api/notifications/${id}/ack`, token, { method: 'POST' }),
};

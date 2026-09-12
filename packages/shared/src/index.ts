export const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PAIRING_CODE_LENGTH = 6;
export const HOLD_TO_UNLOCK_MS = 1500;
/** Most people one lock can be addressed to. A whole group fits. */
export const MAX_RECIPIENTS = 12;
export const MAX_GROUP_MEMBERS = 12;

export type ConditionType = 'MANUAL' | 'TOGETHER' | 'RECIPIENT_SET';
export type LockState = 'LOCKED' | 'READY' | 'UNLOCKED';

export const CONDITION_TYPES: ConditionType[] = [
  'MANUAL',
  'TOGETHER',
  'RECIPIENT_SET',
];

// ---------------------------------------------------------------------------
// Context
//
// Where a recipient can say they are. A lock tagged with a context is a plain
// MANUAL / TOGETHER lock whose condition the app can recognise: when a
// recipient taps "I'm here" with the matching context, the lock's
// `contextMetAt` is stamped and the sender is told. The hold is still the
// unlock. Context tells everyone the condition is true; it opens nothing.
// ---------------------------------------------------------------------------

export const CONTEXTS = ['coffee', 'walking-home', 'studying', 'home'] as const;
export type LockContext = (typeof CONTEXTS)[number];

export const CONTEXT_LABELS: Record<LockContext, string> = {
  coffee: 'getting coffee',
  'walking-home': 'walking home',
  studying: 'studying',
  home: 'home',
};

export function contextConditionLabel(context: LockContext): string {
  return context === 'home'
    ? 'Open when you get home'
    : `Open when you're ${CONTEXT_LABELS[context]}`;
}

/** Namespaced access-token claim the post-login Action sets once MFA ran. */
export const MFA_CLAIM = 'https://stashd/mfa';
/** Error code the API returns when a double-sealed lock is confirmed without it. */
export const MFA_REQUIRED = 'MFA_REQUIRED';
/** acr_values the client sends to ask Auth0 for a step-up login. */
export const MFA_ACR_VALUE = 'http://schemas.openid.net/pape/policies/2007/06/multi-factor';

export interface UserDto {
  id: string;
  displayName: string;
  /** True once the user typed their own name. */
  displayNameSet: boolean;
  pairingCode: string;
  pairingCodeDisplay: string;
  picture?: string;
  email?: string;
  schoolId?: string;
  schoolName?: string;
  city?: string;
  weeklyRitual?: string;
  /** Whether Spotify is linked. The tokens themselves never leave the server. */
  spotifyConnected?: boolean;
  /**
   * Whether the access token this request came in on carries the MFA claim.
   * Per session, not per user: read from the token, never stored.
   */
  mfa?: boolean;
}

export interface FriendDto {
  id: string;
  displayName: string;
  pairingCode: string;
  pairingCodeDisplay: string;
  picture?: string;
  isSelf: boolean;
  online?: boolean;
  /**
   * Their school stands in for their location. The client looks up weather,
   * local time, sunrise and sunset for it. Never a device position.
   */
  schoolId?: string;
  schoolName?: string;
  city?: string;
}

export interface LockRecipientDto {
  id: string;
  displayName: string;
}

export interface LockDto {
  id: string;
  senderId: string;
  /** One id for a 1:1 lock, N for a group lock. */
  recipientIds: string[];
  recipients: LockRecipientDto[];
  /** Sender plus recipients, de-duplicated. Everyone who must hold on a TOGETHER lock. */
  participantIds: string[];
  /** Users who have completed a hold. */
  confirmedIds: string[];
  senderName: string;
  /** "You", one name, or "Maya, Jules +1" depending on who is looking. */
  recipientName: string;
  conditionType: ConditionType;
  conditionLabel: string | null;
  context: LockContext | null;
  /** Set when a recipient tapped "I'm here" with the matching context. Not a state. */
  contextMetAt: string | null;
  contextMetBy: string | null;
  contextMetByName: string | null;
  /** Sender asked for a second key: confirm needs an MFA-backed token. */
  requiresMfa: boolean;
  state: LockState;
  createdAt: string;
  unlockedAt: string | null;
  /** Visible while sealed: lets the Stash show a record sleeve for songs. */
  mediaKind: MediaKind;
  text?: string;
  imageUrl?: string;
  /** Content. Absent from the JSON unless state === 'UNLOCKED'. */
  song?: SongDto;
  contentHidden: boolean;
}

export interface CreateLockRequest {
  /** 'me' is accepted as an alias for the caller's own id. */
  recipientIds: string[];
  text: string;
  imageUrl?: string;
  conditionType: ConditionType;
  conditionLabel?: string;
  context?: LockContext | null;
  requiresMfa?: boolean;
  /**
   * A Spotify track id. The server re-resolves it against Spotify and stores
   * canonical metadata — the client never supplies the album art URL, so a
   * caller cannot inject an arbitrary image into someone else's Stash.
   */
  songTrackId?: string;
}

export interface SetConditionRequest {
  conditionLabel: string;
}

export interface PairRequest {
  code: string;
}

// ---------------------------------------------------------------------------
// Groups
//
// A named set of people with an invite code, exactly like pairing but N-way.
// Being in a group with someone lets you stash to them, same as being paired.
// A lock still carries its own recipientIds; picking a group in capture just
// fills them in.
// ---------------------------------------------------------------------------

export interface GroupMemberDto {
  id: string;
  displayName: string;
  schoolId?: string;
  schoolName?: string;
  city?: string;
}

export interface GroupDto {
  id: string;
  name: string;
  inviteCode: string;
  inviteCodeDisplay: string;
  createdBy: string;
  memberIds: string[];
  members: GroupMemberDto[];
  createdAt: string;
}

export interface CreateGroupRequest {
  name: string;
  /** Extra members to start with. Must be people you are paired with. */
  memberIds?: string[];
}

export interface JoinGroupRequest {
  code: string;
}

// ---------------------------------------------------------------------------
// Calendar (Auth0 Token Vault → Google Calendar)
//
// Auth0 holds the user's Google token. The API exchanges the user's Auth0
// access token for it and reads their next two weeks. The browser never sees
// a Google credential and the API never stores one.
// ---------------------------------------------------------------------------

export interface CalendarEventDto {
  id: string;
  title: string;
  /** ISO. Date-only for all-day events. */
  start: string;
  end?: string;
  allDay: boolean;
}

export interface CalendarStatusDto {
  /** False when the API has no Token Vault client configured. */
  available: boolean;
  /** True when Auth0 handed us a Google token for this user. */
  connected: boolean;
  reason?: string;
}

export interface CalendarDto {
  status: CalendarStatusDto;
  events: CalendarEventDto[];
}

export interface HereRequest {
  context: LockContext;
}

export interface HereResponse {
  context: LockContext;
  /** Locks addressed to you whose condition just became true. */
  matched: LockDto[];
}

export const SOCKET_EVENTS = {
  lockCreated: 'lock:created',
  lockReady: 'lock:ready',
  lockUnlocked: 'lock:unlocked',
  lockUpdated: 'lock:updated',
  friendPaired: 'friend:paired',
  groupUpdated: 'group:updated',
} as const;

export function normalizePairingCode(input: string): string {
  return input.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

export function formatPairingCode(code: string): string {
  const normalized = normalizePairingCode(code);
  if (normalized.length !== PAIRING_CODE_LENGTH) {
    return normalized;
  }
  return `${normalized.slice(0, 3)}-${normalized.slice(3)}`;
}

export function generatePairingCode(random: () => number = Math.random): string {
  let code = '';
  for (let i = 0; i < PAIRING_CODE_LENGTH; i += 1) {
    code += PAIRING_ALPHABET[Math.floor(random() * PAIRING_ALPHABET.length)];
  }
  return code;
}

export interface FriendNoteDto {
  id: string;
  ownerId: string;
  friendId: string;
  friendName: string;
  text: string;
  dueAt?: string;
  createdAt: string;
}

export interface PromptDto {
  id: string;
  kind: 'tier0' | 'tier05' | 'tier1';
  emotion?: 'stress' | 'lull' | 'milestone' | 'weather' | 'reciprocity' | 'waiting' | 'memory';
  title: string;
  body: string;
  friendId?: string;
  friendName?: string;
  sourceUrl?: string;
  triggerKey: string;
}

export interface UpdateProfileRequest {
  /** 1–40 chars. Once set, the name stops syncing from the Auth0 token. */
  displayName?: string;
  schoolId?: string;
  schoolName?: string;
  city?: string;
  weeklyRitual?: string;
}

export interface CreateFriendNoteRequest {
  friendId: string;
  text: string;
  dueAt?: string;
}

// ---------------------------------------------------------------------------
// Songs
//
// A song is lock content, exactly like text and a photo. The whole SongDto is
// stripped from the API response until the lock is UNLOCKED — the album art is
// the reveal, so leaking it would give the lock away. `mediaKind` is the one
// thing that stays visible while sealed: the *kind* of thing is metadata, the
// *identity* of it is content.
// ---------------------------------------------------------------------------

export type MediaKind = 'TEXT' | 'PHOTO' | 'SONG';

export interface SongDto {
  trackId: string;
  title: string;
  artist: string;
  albumArtUrl: string;
  spotifyUrl: string;
  /** 30s clip. Spotify omits it for plenty of tracks, so treat it as optional. */
  previewUrl?: string;
  durationMs?: number;
}

export interface SpotifyStatusDto {
  connected: boolean;
  displayName?: string;
  /** False when the server has no Spotify credentials configured at all. */
  available: boolean;
}

export interface SpotifyNowPlayingDto {
  /** Null when nothing is playing right now — fall back to `recent`. */
  current: SongDto | null;
  recent: SongDto[];
  /**
   * Why the lists are empty when they shouldn't be. The common one: the
   * Spotify app is in development mode and this listener isn't on its
   * allow list, so Spotify answers 403 for everything about them.
   */
  reason?: string;
}

/** Shown when Spotify refuses a listener the app hasn't allow-listed. */
export const SPOTIFY_NOT_ALLOWED =
  "Spotify is refusing this account. While the app is in development mode, each listener's Spotify email has to be added under User Management in the Spotify developer dashboard.";

export interface ResolveSongRequest {
  /** A spotify.com track link, or a spotify:track:... URI. */
  url: string;
}

export const SPOTIFY_SCOPES = [
  'user-read-currently-playing',
  'user-read-recently-played',
] as const;

export const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PAIRING_CODE_LENGTH = 6;
export const HOLD_TO_UNLOCK_MS = 1500;
export const GROUP_CODE_LENGTH = 6;

export type ConditionType = 'MANUAL' | 'TOGETHER' | 'RECIPIENT_SET';
export type LockState = 'LOCKED' | 'READY' | 'UNLOCKED';

export const CONDITION_TYPES: ConditionType[] = [
  'MANUAL',
  'TOGETHER',
  'RECIPIENT_SET',
];

export interface UserDto {
  id: string;
  displayName: string;
  pairingCode: string;
  pairingCodeDisplay: string;
  picture?: string;
  email?: string;
  schoolId?: string;
  schoolName?: string;
  city?: string;
  weeklyRitual?: string;
  locationSharing?: boolean;
  placeLabel?: string;
  locationUpdatedAt?: string;
  /** Whether Spotify is linked. The tokens themselves never leave the server. */
  spotifyConnected?: boolean;
  /** Opt-in for device stash alerts (not shelf cards). */
  stashAlertsEnabled?: boolean;
}

export interface FriendDto {
  id: string;
  displayName: string;
  pairingCode: string;
  pairingCodeDisplay: string;
  picture?: string;
  isSelf: boolean;
  online?: boolean;
  schoolId?: string;
  schoolName?: string;
  city?: string;
  /** Coarse vibe only — never exact coordinates. */
  placeLabel?: string;
  locationUpdatedAt?: string;
}

export interface LockDto {
  id: string;
  senderId: string;
  recipientId: string;
  senderName: string;
  recipientName: string;
  conditionType: ConditionType;
  conditionLabel: string | null;
  state: LockState;
  senderConfirmed: boolean;
  recipientConfirmed: boolean;
  createdAt: string;
  unlockedAt: string | null;
  /** Visible while sealed: lets the Stash show a record sleeve for songs. */
  mediaKind: MediaKind;
  text?: string;
  imageUrl?: string;
  /** Content. Absent from the JSON unless state === 'UNLOCKED'. */
  song?: SongDto;
  contentHidden: boolean;
  groupId?: string;
  groupName?: string;
}

export interface CreateLockRequest {
  recipientId?: string;
  groupId?: string;
  text: string;
  imageUrl?: string;
  conditionType: ConditionType;
  conditionLabel?: string;
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

export interface UpdateProfileRequest {
  displayName?: string;
  schoolId?: string;
  schoolName?: string;
  city?: string;
  weeklyRitual?: string;
  locationSharing?: boolean;
  stashAlertsEnabled?: boolean;
}

export type StashAlertKind =
  | 'athletics'
  | 'tradition'
  | 'food'
  | 'event'
  | 'news';

export interface PushSubscriptionDto {
  endpoint: string;
  expirationTime?: number | null;
  keys: {
    p256dh: string;
    auth: string;
  };
}

export interface StashAlertDto {
  id: string;
  title: string;
  body: string;
  kind: StashAlertKind;
  friendId?: string;
  friendName?: string;
  schoolId?: string;
  schoolName?: string;
  sourceLabel?: string;
  sourceUrl?: string;
  suggestedCondition?: string;
  createdAt: string;
}

export interface NotificationsStatusDto {
  enabled: boolean;
  pushConfigured: boolean;
  vapidPublicKey?: string;
  sentToday: number;
  dailyBudget: number;
  pending: StashAlertDto[];
}

export interface UpdateLocationRequest {
  /** Already rounded client-side (~1km). */
  coarseLat: number;
  coarseLon: number;
  placeLabel?: string;
}

export interface GroupDto {
  id: string;
  name: string;
  inviteCode: string;
  inviteCodeDisplay: string;
  createdBy: string;
  memberIds: string[];
  members: Array<{ id: string; displayName: string }>;
  createdAt: string;
}

export interface CreateGroupRequest {
  name: string;
  memberIds?: string[];
}

export interface JoinGroupRequest {
  code: string;
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

export interface CreateFriendNoteRequest {
  friendId: string;
  text: string;
  dueAt?: string;
}

export interface PromptDto {
  id: string;
  kind: 'tier0' | 'tier05' | 'tier1' | 'location' | 'weather' | 'campus';
  emotion?:
    | 'stress'
    | 'lull'
    | 'milestone'
    | 'weather'
    | 'reciprocity'
    | 'waiting'
    | 'memory'
    | 'place'
    | 'athletics'
    | 'tradition'
    | 'food';
  title: string;
  body: string;
  friendId?: string;
  friendName?: string;
  sourceUrl?: string;
  triggerKey: string;
  suggestedCondition?: string;
  /** School the prompt is about (usually the recipient's). */
  schoolId?: string;
}

export interface ComposePromptRequest {
  schoolId: string;
  schoolName: string;
  cue: string;
  emotion:
    | 'athletics'
    | 'tradition'
    | 'food'
    | 'calendar'
    | 'weather'
    | 'place'
    | 'soft';
  recipientName?: string;
}

export interface ComposePromptResponse {
  title: string;
  body: string;
  cta: string;
  source: 'ifm' | 'fallback';
}

export const SOCKET_EVENTS = {
  lockCreated: 'lock:created',
  lockReady: 'lock:ready',
  lockUnlocked: 'lock:unlocked',
  lockUpdated: 'lock:updated',
  friendPaired: 'friend:paired',
  presence: 'presence:update',
  location: 'location:update',
  groupUpdated: 'group:updated',
} as const;

export function normalizePairingCode(input: string): string {
  return input.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
}

export function formatPairingCode(code: string): string {
  const normalized = normalizePairingCode(code);
  if (
    normalized.length !== PAIRING_CODE_LENGTH &&
    normalized.length !== GROUP_CODE_LENGTH
  ) {
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

/** Round to ~1.1km so friends never see exact pins. */
export function coarsenCoordinate(value: number): number {
  return Math.round(value * 100) / 100;
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
}

export interface ResolveSongRequest {
  /** A spotify.com track link, or a spotify:track:... URI. */
  url: string;
}

export const SPOTIFY_SCOPES = [
  'user-read-currently-playing',
  'user-read-recently-played',
] as const;

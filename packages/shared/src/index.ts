export const PAIRING_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const PAIRING_CODE_LENGTH = 6;
export const HOLD_TO_UNLOCK_MS = 1500;

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
}

export interface FriendDto {
  id: string;
  displayName: string;
  pairingCode: string;
  pairingCodeDisplay: string;
  picture?: string;
  isSelf: boolean;
  online?: boolean;
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
  text?: string;
  imageUrl?: string;
  contentHidden: boolean;
}

export interface CreateLockRequest {
  recipientId: string;
  text: string;
  imageUrl?: string;
  conditionType: ConditionType;
  conditionLabel?: string;
}

export interface SetConditionRequest {
  conditionLabel: string;
}

export interface PairRequest {
  code: string;
}

export const SOCKET_EVENTS = {
  lockCreated: 'lock:created',
  lockReady: 'lock:ready',
  lockUnlocked: 'lock:unlocked',
  lockUpdated: 'lock:updated',
  friendPaired: 'friend:paired',
  presence: 'presence:update',
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

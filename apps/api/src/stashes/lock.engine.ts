import { ConditionType, LockState } from '@stashd/shared';

export interface LockEngineInput {
  senderId: string;
  recipientIds: string[];
  conditionType: ConditionType;
  conditionLabel: string | null;
  state: LockState;
  confirmedIds: string[];
  /** Set on a stash-back: the original TOGETHER lock it answers. */
  replyToId?: string | null;
  /** Set on the original once the recipient has stashed back. */
  replyId?: string | null;
}

export interface ConfirmResult {
  state: LockState;
  confirmedIds: string[];
  unlockedAt: Date | null;
  /** True when this confirm started a pair opening (the one-minute wait begins). */
  startedOpening: boolean;
}

/** Sender plus every recipient, de-duplicated. Everyone who must hold on a TOGETHER lock. */
export function participants(lock: Pick<LockEngineInput, 'senderId' | 'recipientIds'>): string[] {
  return [...new Set([lock.senderId, ...lock.recipientIds])];
}

export function isRecipient(lock: Pick<LockEngineInput, 'recipientIds'>, userId: string): boolean {
  return lock.recipientIds.includes(userId);
}

export function isParticipant(
  lock: Pick<LockEngineInput, 'senderId' | 'recipientIds'>,
  userId: string,
): boolean {
  return participants(lock).includes(userId);
}

/** Only one person is involved, so there is nobody to wait for. */
export function isSelfStash(lock: Pick<LockEngineInput, 'senderId' | 'recipientIds'>): boolean {
  return participants(lock).length === 1;
}

/**
 * Two people, "open together", not itself a reply. This is the trade:
 * recipient stashes back → sender starts → recipient opens with them.
 */
export function isPairTogether(lock: LockEngineInput): boolean {
  return (
    lock.conditionType === 'TOGETHER' &&
    participants(lock).length === 2 &&
    !lock.replyToId
  );
}

/** A stash-back. It never opens on its own; it opens with the lock it answers. */
export function isReply(lock: Pick<LockEngineInput, 'replyToId'>): boolean {
  return Boolean(lock.replyToId);
}

export function canSeeContent(lock: Pick<LockEngineInput, 'state'>): boolean {
  return lock.state === 'UNLOCKED';
}

export function canSetCondition(lock: LockEngineInput, userId: string): boolean {
  return (
    lock.conditionType === 'RECIPIENT_SET' &&
    isRecipient(lock, userId) &&
    lock.state === 'LOCKED' &&
    !lock.conditionLabel
  );
}

/**
 * MANUAL: any recipient's hold opens it, for everyone.
 * RECIPIENT_SET: same, once a condition has been written.
 * TOGETHER, two people: the recipient must have stashed back; then only the
 *   sender can start (LOCKED → READY); then only the recipient can finish
 *   (READY → UNLOCKED). A stash-back itself is never held.
 * TOGETHER, a group: every participant holds once; the last hold opens it.
 */
export function canConfirm(lock: LockEngineInput, userId: string): boolean {
  if (lock.state === 'UNLOCKED') {
    return false;
  }
  if (lock.conditionType === 'MANUAL') {
    return isRecipient(lock, userId);
  }
  if (lock.conditionType === 'RECIPIENT_SET') {
    return isRecipient(lock, userId) && Boolean(lock.conditionLabel);
  }
  if (lock.conditionType === 'TOGETHER') {
    if (isReply(lock)) {
      return false;
    }
    if (isSelfStash(lock)) {
      return true;
    }
    if (isPairTogether(lock)) {
      if (userId === lock.senderId) {
        return lock.state === 'LOCKED' && Boolean(lock.replyId);
      }
      return isRecipient(lock, userId) && lock.state === 'READY';
    }
    return isParticipant(lock, userId) && !lock.confirmedIds.includes(userId);
  }
  return false;
}

/** Why a hold isn't allowed right now, for the card to show. Null when it is. */
export function holdBlockedReason(lock: LockEngineInput, userId: string): string | null {
  if (lock.state === 'UNLOCKED' || canConfirm(lock, userId)) return null;
  if (isReply(lock)) return 'opens with the one it answers';
  if (isPairTogether(lock)) {
    if (userId === lock.senderId) {
      return lock.replyId ? null : 'waiting for them to stash back';
    }
    if (isRecipient(lock, userId)) {
      if (!lock.replyId) return 'stash something back first';
      if (lock.state === 'LOCKED') return 'waiting for them to start';
    }
  }
  return null;
}

/** How many holds a group TOGETHER lock still needs. Zero for anything else. */
export function remainingHolds(lock: LockEngineInput): number {
  if (
    lock.conditionType !== 'TOGETHER' ||
    lock.state === 'UNLOCKED' ||
    isPairTogether(lock) ||
    isReply(lock)
  ) {
    return 0;
  }
  return participants(lock).filter((id) => !lock.confirmedIds.includes(id)).length;
}

export function applyConfirm(lock: LockEngineInput, userId: string): ConfirmResult {
  const confirmedIds = [...new Set([...lock.confirmedIds, userId])];
  const now = new Date();

  if (isPairTogether(lock) && !isSelfStash(lock)) {
    if (userId === lock.senderId) {
      return { state: 'READY', confirmedIds, unlockedAt: null, startedOpening: true };
    }
    return { state: 'UNLOCKED', confirmedIds, unlockedAt: now, startedOpening: false };
  }

  const everyone = participants(lock).every((id) => confirmedIds.includes(id));
  const unlocked =
    lock.conditionType !== 'TOGETHER' || isSelfStash(lock) || everyone;
  return {
    state: unlocked ? 'UNLOCKED' : 'READY',
    confirmedIds,
    unlockedAt: unlocked ? now : null,
    startedOpening: false,
  };
}

export function defaultConditionLabel(
  type: ConditionType,
  label?: string,
): string | null {
  if (type === 'TOGETHER') {
    return label?.trim() || 'Open together';
  }
  if (type === 'RECIPIENT_SET') {
    return null;
  }
  return label?.trim() || 'Open when it feels right';
}

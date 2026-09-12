import { ConditionType, LockState } from '@stashd/shared';

export interface LockEngineInput {
  senderId: string;
  recipientIds: string[];
  conditionType: ConditionType;
  conditionLabel: string | null;
  state: LockState;
  confirmedIds: string[];
}

export interface ConfirmResult {
  state: LockState;
  confirmedIds: string[];
  unlockedAt: Date | null;
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
 * TOGETHER: every participant holds once; the last hold opens it.
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
    return isParticipant(lock, userId) && !lock.confirmedIds.includes(userId);
  }
  return false;
}

/** How many holds a TOGETHER lock still needs. Zero for anything else. */
export function remainingHolds(lock: LockEngineInput): number {
  if (lock.conditionType !== 'TOGETHER' || lock.state === 'UNLOCKED') {
    return 0;
  }
  return participants(lock).filter((id) => !lock.confirmedIds.includes(id)).length;
}

export function applyConfirm(lock: LockEngineInput, userId: string): ConfirmResult {
  const confirmedIds = [...new Set([...lock.confirmedIds, userId])];
  const everyone = participants(lock).every((id) => confirmedIds.includes(id));
  const unlocked =
    lock.conditionType !== 'TOGETHER' || isSelfStash(lock) || everyone;
  return {
    state: unlocked ? 'UNLOCKED' : 'READY',
    confirmedIds,
    unlockedAt: unlocked ? new Date() : null,
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

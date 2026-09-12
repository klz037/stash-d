import { ConditionType, LockState } from '@stashd/shared';

export interface LockEngineInput {
  senderId: string;
  recipientId: string;
  conditionType: ConditionType;
  conditionLabel: string | null;
  state: LockState;
  senderConfirmed: boolean;
  recipientConfirmed: boolean;
}

export interface ConfirmResult {
  state: LockState;
  senderConfirmed: boolean;
  recipientConfirmed: boolean;
  unlockedAt: Date | null;
}

export function isParticipant(lock: LockEngineInput, userId: string): boolean {
  return lock.senderId === userId || lock.recipientId === userId;
}

export function isSelfStash(lock: LockEngineInput): boolean {
  return lock.senderId === lock.recipientId;
}

export function canSeeContent(lock: Pick<LockEngineInput, 'state'>): boolean {
  return lock.state === 'UNLOCKED';
}

export function canSetCondition(lock: LockEngineInput, userId: string): boolean {
  return (
    lock.conditionType === 'RECIPIENT_SET' &&
    lock.recipientId === userId &&
    lock.state === 'LOCKED' &&
    !lock.conditionLabel
  );
}

export function canConfirm(lock: LockEngineInput, userId: string): boolean {
  if (lock.state === 'UNLOCKED') {
    return false;
  }
  if (!isParticipant(lock, userId)) {
    return false;
  }

  if (lock.conditionType === 'MANUAL') {
    return lock.recipientId === userId;
  }

  if (lock.conditionType === 'RECIPIENT_SET') {
    return lock.recipientId === userId && Boolean(lock.conditionLabel);
  }

  if (lock.conditionType === 'TOGETHER') {
    if (isSelfStash(lock)) {
      return true;
    }
    if (userId === lock.senderId) {
      return !lock.senderConfirmed;
    }
    return !lock.recipientConfirmed;
  }

  return false;
}

export function applyConfirm(lock: LockEngineInput, userId: string): ConfirmResult {
  let { senderConfirmed, recipientConfirmed, state } = lock;
  const now = new Date();

  if (isSelfStash(lock)) {
    return {
      state: 'UNLOCKED',
      senderConfirmed: true,
      recipientConfirmed: true,
      unlockedAt: now,
    };
  }

  if (userId === lock.senderId) {
    senderConfirmed = true;
  }
  if (userId === lock.recipientId) {
    recipientConfirmed = true;
  }

  if (lock.conditionType === 'TOGETHER') {
    const both = senderConfirmed && recipientConfirmed;
    return {
      state: both ? 'UNLOCKED' : 'READY',
      senderConfirmed,
      recipientConfirmed,
      unlockedAt: both ? now : null,
    };
  }

  return {
    state: 'UNLOCKED',
    senderConfirmed,
    recipientConfirmed,
    unlockedAt: now,
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

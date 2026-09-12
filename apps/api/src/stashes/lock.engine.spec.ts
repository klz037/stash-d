import {
  applyConfirm,
  canConfirm,
  canSeeContent,
  canSetCondition,
  holdBlockedReason,
  remainingHolds,
} from './lock.engine';

const together = {
  senderId: 'maya',
  recipientIds: ['jules'],
  conditionType: 'TOGETHER' as const,
  conditionLabel: 'Open together',
  state: 'LOCKED' as const,
  confirmedIds: [] as string[],
  replyToId: null,
  replyId: null,
};

describe('lock engine', () => {
  it('strips content until unlocked', () => {
    expect(canSeeContent({ state: 'LOCKED' })).toBe(false);
    expect(canSeeContent({ state: 'READY' })).toBe(false);
    expect(canSeeContent({ state: 'UNLOCKED' })).toBe(true);
  });

  it('lets only the recipient unlock a MANUAL lock', () => {
    const lock = { ...together, conditionType: 'MANUAL' as const };
    expect(canConfirm(lock, 'jules')).toBe(true);
    expect(canConfirm(lock, 'maya')).toBe(false);
    expect(canConfirm(lock, 'stranger')).toBe(false);
    expect(applyConfirm(lock, 'jules').state).toBe('UNLOCKED');
  });

  describe('pair TOGETHER is a trade', () => {
    it('nobody can hold until the recipient has stashed back', () => {
      expect(canConfirm(together, 'maya')).toBe(false);
      expect(canConfirm(together, 'jules')).toBe(false);
      expect(holdBlockedReason(together, 'jules')).toBe('stash something back first');
      expect(holdBlockedReason(together, 'maya')).toBe('waiting for them to stash back');
    });

    it('then only the sender can start, moving it to READY', () => {
      const answered = { ...together, replyId: 'reply-1' };
      expect(canConfirm(answered, 'jules')).toBe(false);
      expect(holdBlockedReason(answered, 'jules')).toBe('waiting for them to start');
      expect(canConfirm(answered, 'maya')).toBe(true);

      const started = applyConfirm(answered, 'maya');
      expect(started.state).toBe('READY');
      expect(started.startedOpening).toBe(true);
      expect(started.unlockedAt).toBeNull();
    });

    it('then only the recipient can finish, and the sender cannot hold again', () => {
      const ready = { ...together, replyId: 'reply-1', state: 'READY' as const, confirmedIds: ['maya'] };
      expect(canConfirm(ready, 'maya')).toBe(false);
      expect(canConfirm(ready, 'jules')).toBe(true);
      const done = applyConfirm(ready, 'jules');
      expect(done.state).toBe('UNLOCKED');
      expect(done.startedOpening).toBe(false);
      expect(done.unlockedAt).not.toBeNull();
    });

    it('a stash-back is never held on its own', () => {
      const reply = { ...together, senderId: 'jules', recipientIds: ['maya'], replyToId: 'orig-1' };
      expect(canConfirm(reply, 'jules')).toBe(false);
      expect(canConfirm(reply, 'maya')).toBe(false);
      expect(holdBlockedReason(reply, 'maya')).toBe('opens with the one it answers');
      expect(remainingHolds(reply)).toBe(0);
    });
  });

  it('needs every participant on a group TOGETHER lock', () => {
    const group = { ...together, recipientIds: ['jules', 'sam', 'ali'] };
    expect(remainingHolds(group)).toBe(4);

    const one = { ...group, ...applyConfirm(group, 'sam') };
    expect(one.state).toBe('READY');
    const two = { ...one, ...applyConfirm(one, 'maya') };
    expect(two.state).toBe('READY');
    const three = { ...two, ...applyConfirm(two, 'ali') };
    expect(three.state).toBe('READY');
    expect(remainingHolds(three)).toBe(1);
    expect(canConfirm(three, 'sam')).toBe(false);
    expect(canConfirm(three, 'stranger')).toBe(false);

    const last = applyConfirm(three, 'jules');
    expect(last.state).toBe('UNLOCKED');
    expect(last.unlockedAt).not.toBeNull();
  });

  it('lets any one recipient open a group MANUAL lock for everyone', () => {
    const group = {
      ...together,
      conditionType: 'MANUAL' as const,
      recipientIds: ['jules', 'sam'],
    };
    expect(canConfirm(group, 'sam')).toBe(true);
    expect(canConfirm(group, 'maya')).toBe(false);
    expect(applyConfirm(group, 'sam').state).toBe('UNLOCKED');
  });

  it('unlocks a self-stash in one confirm, even when TOGETHER', () => {
    const solo = { ...together, recipientIds: ['maya'] };
    expect(canConfirm(solo, 'maya')).toBe(true);
    expect(applyConfirm(solo, 'maya').state).toBe('UNLOCKED');
    expect(applyConfirm({ ...solo, conditionType: 'MANUAL' }, 'maya').state).toBe(
      'UNLOCKED',
    );
  });

  it('counts the sender once when they are also a recipient in a group', () => {
    const us = { ...together, recipientIds: ['maya', 'jules', 'sam'] };
    expect(remainingHolds(us)).toBe(3);
    const ready = applyConfirm(us, 'maya');
    expect(ready.state).toBe('READY');
  });

  it('blocks RECIPIENT_SET unlock until a condition is written', () => {
    const lock = {
      ...together,
      conditionType: 'RECIPIENT_SET' as const,
      conditionLabel: null,
    };
    expect(canSetCondition(lock, 'jules')).toBe(true);
    expect(canSetCondition(lock, 'maya')).toBe(false);
    expect(canConfirm(lock, 'jules')).toBe(false);
    expect(canConfirm({ ...lock, conditionLabel: 'when you land' }, 'jules')).toBe(
      true,
    );
  });
});

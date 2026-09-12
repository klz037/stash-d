import {
  applyConfirm,
  canConfirm,
  canSeeContent,
  canSetCondition,
  remainingHolds,
} from './lock.engine';

const together = {
  senderId: 'maya',
  recipientIds: ['jules'],
  conditionType: 'TOGETHER' as const,
  conditionLabel: 'Open together',
  state: 'LOCKED' as const,
  confirmedIds: [] as string[],
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

  it('moves TOGETHER locks LOCKED → READY → UNLOCKED', () => {
    expect(canConfirm(together, 'maya')).toBe(true);
    const ready = applyConfirm(together, 'maya');
    expect(ready.state).toBe('READY');
    expect(ready.confirmedIds).toEqual(['maya']);
    expect(canConfirm({ ...together, ...ready }, 'maya')).toBe(false);

    const unlocked = applyConfirm({ ...together, ...ready }, 'jules');
    expect(unlocked.state).toBe('UNLOCKED');
    expect(unlocked.confirmedIds).toEqual(['maya', 'jules']);
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

  it('counts the sender once when they are also a recipient', () => {
    const us = { ...together, recipientIds: ['maya', 'jules'] };
    expect(remainingHolds(us)).toBe(2);
    const ready = applyConfirm(us, 'maya');
    expect(ready.state).toBe('READY');
    expect(applyConfirm({ ...us, ...ready }, 'jules').state).toBe('UNLOCKED');
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

import {
  applyConfirm,
  canConfirm,
  canSeeContent,
  canSetCondition,
} from './lock.engine';

const together = {
  senderId: 'maya',
  recipientId: 'jules',
  conditionType: 'TOGETHER' as const,
  conditionLabel: 'Open together',
  state: 'LOCKED' as const,
  senderConfirmed: false,
  recipientConfirmed: false,
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
    expect(applyConfirm(lock, 'jules').state).toBe('UNLOCKED');
  });

  it('moves TOGETHER locks LOCKED → READY → UNLOCKED', () => {
    expect(canConfirm(together, 'maya')).toBe(true);
    const ready = applyConfirm(together, 'maya');
    expect(ready.state).toBe('READY');
    expect(ready.senderConfirmed).toBe(true);

    const unlocked = applyConfirm({ ...together, ...ready }, 'jules');
    expect(unlocked.state).toBe('UNLOCKED');
    expect(unlocked.recipientConfirmed).toBe(true);
  });

  it('unlocks a self-stash in one confirm', () => {
    const solo = {
      ...together,
      recipientId: 'maya',
      conditionType: 'MANUAL' as const,
    };
    expect(canConfirm(solo, 'maya')).toBe(true);
    expect(applyConfirm(solo, 'maya').state).toBe('UNLOCKED');
  });

  it('blocks RECIPIENT_SET unlock until a condition is written', () => {
    const lock = {
      ...together,
      conditionType: 'RECIPIENT_SET' as const,
      conditionLabel: null,
    };
    expect(canSetCondition(lock, 'jules')).toBe(true);
    expect(canConfirm(lock, 'jules')).toBe(false);
    expect(canConfirm({ ...lock, conditionLabel: 'when you land' }, 'jules')).toBe(
      true,
    );
  });
});

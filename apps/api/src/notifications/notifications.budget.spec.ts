import { dailyAlertBudget } from './notifications.service';

describe('dailyAlertBudget', () => {
  it('sends nothing when there is nobody to stash for', () => {
    expect(dailyAlertBudget(0, 0, '2026-09-12')).toBe(0);
  });

  it('keeps small graphs to at most 2 a day', () => {
    expect(dailyAlertBudget(1, 0, '2026-09-12')).toBe(2);
    expect(dailyAlertBudget(4, 0, '2026-09-12')).toBe(2);
    expect(dailyAlertBudget(2, 2, '2026-09-12')).toBe(2);
  });

  it('caps at 3–4 a day once friends+groups exceed 4', () => {
    for (const day of ['2026-09-12', '2026-09-13', '2026-09-14', '2026-09-15']) {
      const budget = dailyAlertBudget(5, 0, day);
      expect(budget).toBeGreaterThanOrEqual(3);
      expect(budget).toBeLessThanOrEqual(4);
      expect(dailyAlertBudget(3, 3, day)).toBe(budget);
      expect(dailyAlertBudget(40, 10, day)).toBe(budget);
    }
  });
});

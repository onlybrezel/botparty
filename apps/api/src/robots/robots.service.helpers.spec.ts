import { isRobotInSchedule } from './robots.service.helpers';

describe('isRobotInSchedule', () => {
  it('allows robots without a configured schedule', () => {
    expect(isRobotInSchedule({ scheduleStart: null, scheduleEnd: null, timezone: 'UTC' })).toBe(true);
  });

  it('allows only the current valid schedule window', () => {
    expect(isRobotInSchedule({
      scheduleStart: new Date(Date.now() - 60_000),
      scheduleEnd: new Date(Date.now() + 60_000),
      timezone: 'UTC',
    })).toBe(true);
    expect(isRobotInSchedule({
      scheduleStart: new Date(Date.now() + 60_000),
      scheduleEnd: new Date(Date.now() + 120_000),
      timezone: 'UTC',
    })).toBe(false);
  });

  it('fails closed for invalid or reversed schedule data', () => {
    expect(isRobotInSchedule({
      scheduleStart: new Date('invalid'),
      scheduleEnd: new Date(),
      timezone: 'UTC',
    })).toBe(false);
    expect(isRobotInSchedule({
      scheduleStart: new Date('2026-01-02T00:00:00Z'),
      scheduleEnd: new Date('2026-01-01T00:00:00Z'),
      timezone: 'UTC',
    })).toBe(false);
  });
});

/// <reference types="jest" />
import { buildSchedule, type QueueItem } from '../build';

// Local times. 2026-11-16 is a Monday.
const at = (d: number, h = 0, m = 0) => new Date(2026, 10, d, h, m);
const focus = { days: ['Mon' as const, 'Wed' as const, 'Fri' as const], time: '07:00', minutes: 45 };
const listen = { days: ['Tue' as const, 'Thu' as const], time: '17:30', minutes: 20 };

const f = (id: number, minutes: number | null, done = false): QueueItem => ({ id, kind: 'focus', minutes, done });
const l = (id: number, minutes: number | null, done = false): QueueItem => ({ id, kind: 'listen', minutes, done });

function summary(sessions: ReturnType<typeof buildSchedule>) {
  return sessions.map((s) => `${s.kind} ${s.startAt.getDate()}/${s.startAt.getHours()}:${String(s.startAt.getMinutes()).padStart(2, '0')} [${s.itemIds.join(',')}]`);
}

describe('buildSchedule', () => {
  it('packs small items into slots and gives long items a slot to themselves', () => {
    const s = buildSchedule({
      start: '2026-11-16',
      slots: { focus },
      items: [f(1, 20), f(2, 20), f(3, 10), f(4, 60), f(5, 30), f(6, 15)],
      overrides: [],
      now: at(15, 12),
    });
    // 20+20 fit (40); 10 would make 50 > 45. 60 is longer than a slot: alone. 30+15 = 45 fits.
    expect(summary(s)).toEqual(['focus 16/7:00 [1,2]', 'focus 18/7:00 [3]', 'focus 20/7:00 [4]', 'focus 23/7:00 [5,6]']);
  });

  it('items with no minutes take a slot by themselves', () => {
    const s = buildSchedule({ start: '2026-11-16', slots: { focus }, items: [f(1, 10), f(2, null), f(3, 10)], overrides: [], now: at(15) });
    expect(summary(s)).toEqual(['focus 16/7:00 [1]', 'focus 18/7:00 [2]', 'focus 20/7:00 [3]']);
  });

  it('keeps focus and listen queues in their own slots, merged in time order', () => {
    const s = buildSchedule({
      start: '2026-11-16',
      slots: { focus, listen },
      items: [f(1, 45), l(2, 20), f(3, 45), l(4, 20)],
      overrides: [],
      now: at(15),
    });
    expect(summary(s)).toEqual(['focus 16/7:00 [1]', 'listen 17/17:30 [2]', 'focus 18/7:00 [3]', 'listen 19/17:30 [4]']);
  });

  it('does not schedule before the plan start date', () => {
    const s = buildSchedule({ start: '2026-11-20', slots: { focus }, items: [f(1, 45)], overrides: [], now: at(15) });
    expect(summary(s)).toEqual(['focus 20/7:00 [1]']);
  });

  it('a missed slot moves its unfinished items to the next slot (rebuilt from now)', () => {
    // It's Monday 09:00: the 07:00 slot has ended with item 1 unfinished.
    const s = buildSchedule({ start: '2026-11-16', slots: { focus }, items: [f(1, 45), f(2, 45)], overrides: [], now: at(16, 9) });
    expect(summary(s)).toEqual(['focus 18/7:00 [1]', 'focus 20/7:00 [2]']);
  });

  it('a slot in progress stays in the schedule', () => {
    const s = buildSchedule({ start: '2026-11-16', slots: { focus }, items: [f(1, 45)], overrides: [], now: at(16, 7, 30) });
    expect(summary(s)).toEqual(['focus 16/7:00 [1]']);
  });

  it('done items are not scheduled', () => {
    const s = buildSchedule({ start: '2026-11-16', slots: { focus }, items: [f(1, 45, true), f(2, 45)], overrides: [], now: at(15) });
    expect(summary(s)).toEqual(['focus 16/7:00 [2]']);
  });

  it('skip today removes the slot; its items go to the next one', () => {
    const s = buildSchedule({
      start: '2026-11-16',
      slots: { focus },
      items: [f(1, 45), f(2, 45)],
      overrides: [{ kind: 'focus', slotAt: at(16, 7).toISOString(), action: 'skip' }],
      now: at(16, 6, 50),
    });
    expect(summary(s)).toEqual(['focus 18/7:00 [1]', 'focus 20/7:00 [2]']);
  });

  it('snooze moves the start; the session keeps its slot identity', () => {
    const s = buildSchedule({
      start: '2026-11-16',
      slots: { focus },
      items: [f(1, 45)],
      overrides: [{ kind: 'focus', slotAt: at(16, 7).toISOString(), action: 'snooze', newAt: at(16, 7, 30).toISOString() }],
      now: at(16, 7, 5),
    });
    expect(summary(s)).toEqual(['focus 16/7:30 [1]']);
    expect(s[0].slotAt).toEqual(at(16, 7));
  });

  it('stops at the horizon and when the queue runs out', () => {
    const items = Array.from({ length: 20 }, (_, i) => f(i + 1, 45));
    const s = buildSchedule({ start: '2026-11-16', slots: { focus }, items, overrides: [], now: at(15), horizonDays: 7 });
    expect(s).toHaveLength(3); // Mon, Wed, Fri
    expect(buildSchedule({ start: '2026-11-16', slots: { focus }, items: [], overrides: [], now: at(15) })).toEqual([]);
  });
});

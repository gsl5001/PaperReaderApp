// Slot scheduling (design doc section 7), as a pure function so it can be tested.
//
// - Each plan has a focus queue and a listen queue; each fills only its own slots, in plan order.
// - Small items are packed into a slot until its minutes are used. An item longer than a
//   slot takes the slot by itself. An item with no minutes also takes a slot by itself.
// - The schedule is rebuilt from "now" every time, so unfinished items from a missed slot
//   land in the next slot of the same type and the rest shift back: no backlog builds up.
// - Skip today removes that slot occurrence; Snooze moves its start.
// - Optional items are scheduled like the rest (design doc section 2).
// All times are local.

import type { Day, Slot } from '../plan/types';

export type QueueKind = 'focus' | 'listen';

export interface QueueItem {
  id: number;
  kind: QueueKind;
  minutes: number | null;
  done: boolean;
}

export interface SlotOverride {
  kind: QueueKind;
  /** The slot occurrence's original start (ISO). */
  slotAt: string;
  action: 'skip' | 'snooze';
  /** New start for a snooze (ISO). */
  newAt?: string | null;
}

export interface ScheduledSession {
  kind: QueueKind;
  /** Original start of the slot occurrence; identifies it for skip/snooze. */
  slotAt: Date;
  /** Actual start (differs from slotAt when snoozed). */
  startAt: Date;
  minutes: number;
  itemIds: number[];
}

const DAY_INDEX: Record<Day, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

function parseDate(ymd: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Slot occurrences of one kind from `from` (a local midnight) for `days` days. */
function occurrences(slot: Slot, from: Date, days: number): Date[] {
  const [hh, mm] = slot.time.split(':').map(Number);
  const wanted = new Set(slot.days.map((d) => DAY_INDEX[d]));
  const out: Date[] = [];
  for (let i = 0; i < days; i++) {
    const day = new Date(from.getFullYear(), from.getMonth(), from.getDate() + i);
    if (wanted.has(day.getDay())) out.push(new Date(day.getFullYear(), day.getMonth(), day.getDate(), hh, mm));
  }
  return out;
}

export function buildSchedule(input: {
  start: string;
  slots: { focus?: Slot; listen?: Slot };
  items: QueueItem[];
  overrides: SlotOverride[];
  now: Date;
  horizonDays?: number;
}): ScheduledSession[] {
  const { start, slots, items, overrides, now } = input;
  const horizon = input.horizonDays ?? 14;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startDay = parseDate(start);
  const from = startDay > today ? startDay : today;

  const out: ScheduledSession[] = [];
  for (const kind of ['focus', 'listen'] as const) {
    const slot = slots[kind];
    if (!slot) continue;
    const queue = items.filter((i) => i.kind === kind && !i.done);
    if (!queue.length) continue;

    // Slot occurrences, with skips removed and snoozes applied, still open at `now`.
    const byKey = new Map(overrides.filter((o) => o.kind === kind).map((o) => [o.slotAt, o]));
    const sessions = occurrences(slot, from, horizon)
      .map((slotAt) => {
        const o = byKey.get(slotAt.toISOString());
        if (o?.action === 'skip') return null;
        const startAt = o?.action === 'snooze' && o.newAt ? new Date(o.newAt) : slotAt;
        return { kind, slotAt, startAt, minutes: slot.minutes, itemIds: [] as number[] };
      })
      .filter((s): s is ScheduledSession => !!s && s.startAt.getTime() + s.minutes * 60_000 > now.getTime())
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

    let q = 0;
    for (const s of sessions) {
      if (q >= queue.length) break;
      let used = 0;
      while (q < queue.length) {
        const m = queue[q].minutes;
        if (used === 0) {
          // The first item always goes in, even if it's longer than the slot.
          s.itemIds.push(queue[q++].id);
          used = m ?? s.minutes;
        } else if (m != null && used + m <= s.minutes) {
          s.itemIds.push(queue[q++].id);
          used += m;
        } else {
          break;
        }
      }
      out.push(s);
    }
  }
  return out.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

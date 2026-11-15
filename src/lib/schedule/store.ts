import type { Db } from '../db/types';
import type { Slot } from '../plan/types';
import { getPlanDetail, listPlanItems, type PlanItemRow } from '../plan/queries';
import { quizStates, reviewCount } from '../quiz/queries';
import { buildSchedule, type QueueKind, type SlotOverride } from './build';

// Stored schedule and the Today screen's data.
//
// refreshSchedule() runs on app start, on return to the foreground and after changes
// (item done, skip, snooze, import). For each plan with slots it:
//   1. closes sessions that have ended: 'done' if all their items are done, else 'missed';
//   2. replaces the remaining 'scheduled' sessions with a fresh buildSchedule() from now.
// Overdue items are not-done items from 'missed' sessions; they are also the first items
// of the next session, because the schedule is rebuilt from now.

export interface StoredSession {
  id: number;
  planId: string;
  kind: QueueKind;
  slotAt: string;
  startAt: string;
  minutes: number;
  itemIds: number[];
}

type PlanSlots = { focus?: Slot; listen?: Slot };

type SessionRow = {
  id: number;
  plan_id: string;
  kind: QueueKind;
  slot_at: string;
  start_at: string;
  minutes: number;
  item_ids: string;
};

const toSession = (r: SessionRow): StoredSession => ({
  id: r.id,
  planId: r.plan_id,
  kind: r.kind,
  slotAt: r.slot_at,
  startAt: r.start_at,
  minutes: r.minutes,
  itemIds: JSON.parse(r.item_ids),
});

async function plansWithSlots(db: Db): Promise<{ id: string; start: string; slots: PlanSlots }[]> {
  const rows = await db.all<{ id: string; start: string; slots_json: string | null }>(
    'SELECT id, start, slots_json FROM plans WHERE slots_json IS NOT NULL',
  );
  return rows.map((r) => ({ id: r.id, start: r.start, slots: JSON.parse(r.slots_json!) }));
}

export async function refreshSchedule(db: Db, now = new Date()): Promise<void> {
  const plans = await plansWithSlots(db);
  await db.transaction(async () => {
    // Plans whose slots were removed by a re-import keep no scheduled sessions.
    await db.run(
      "DELETE FROM sessions WHERE status = 'scheduled' AND plan_id NOT IN (SELECT id FROM plans WHERE slots_json IS NOT NULL)",
    );
    for (const plan of plans) {
      const items = await db.all<{ id: number; kind: QueueKind; minutes: number | null; done_at: string | null }>(
        `SELECT id, kind, minutes, done_at FROM items WHERE plan_id = ?
         ORDER BY section_num, CASE kind WHEN 'focus' THEN 0 ELSE 1 END, position`,
        [plan.id],
      );
      const done = new Set(items.filter((i) => i.done_at).map((i) => i.id));

      // 1. Close sessions that have ended.
      const open = await db.all<SessionRow>("SELECT * FROM sessions WHERE plan_id = ? AND status = 'scheduled'", [plan.id]);
      for (const s of open.map(toSession)) {
        const end = new Date(s.startAt).getTime() + s.minutes * 60_000;
        if (end > now.getTime()) continue;
        const status = s.itemIds.every((id) => done.has(id)) ? 'done' : 'missed';
        await db.run('UPDATE sessions SET status = ? WHERE id = ?', [status, s.id]);
      }

      // 2. Rebuild the future.
      await db.run("DELETE FROM sessions WHERE plan_id = ? AND status = 'scheduled'", [plan.id]);
      const overrides = await db.all<{ kind: QueueKind; slot_at: string; action: 'skip' | 'snooze'; new_at: string | null }>(
        'SELECT kind, slot_at, action, new_at FROM slot_overrides WHERE plan_id = ?',
        [plan.id],
      );
      const schedule = buildSchedule({
        start: plan.start,
        slots: plan.slots,
        items: items.map((i) => ({ id: i.id, kind: i.kind, minutes: i.minutes, done: !!i.done_at })),
        overrides: overrides.map<SlotOverride>((o) => ({ kind: o.kind, slotAt: o.slot_at, action: o.action, newAt: o.new_at })),
        now,
      });
      for (const s of schedule) {
        await db.run(
          `INSERT INTO sessions (plan_id, kind, slot_at, start_at, minutes, item_ids, status)
           VALUES (?, ?, ?, ?, ?, ?, 'scheduled')`,
          [plan.id, s.kind, s.slotAt.toISOString(), s.startAt.toISOString(), s.minutes, JSON.stringify(s.itemIds)],
        );
      }
    }
  });
}

export async function upcomingSessions(db: Db): Promise<StoredSession[]> {
  const rows = await db.all<SessionRow>("SELECT * FROM sessions WHERE status = 'scheduled' ORDER BY start_at");
  return rows.map(toSession);
}

export async function getSession(db: Db, id: number): Promise<StoredSession | null> {
  const r = await db.first<SessionRow>('SELECT * FROM sessions WHERE id = ?', [id]);
  return r ? toSession(r) : null;
}

/** Skip today: the slot occurrence is dropped and its items move to the next slot. */
export async function skipSlot(db: Db, planId: string, kind: QueueKind, slotAt: string): Promise<void> {
  await db.run(
    `INSERT INTO slot_overrides (plan_id, kind, slot_at, action, new_at) VALUES (?, ?, ?, 'skip', NULL)
     ON CONFLICT (plan_id, kind, slot_at) DO UPDATE SET action = 'skip', new_at = NULL`,
    [planId, kind, slotAt],
  );
}

/** Snooze: the slot occurrence starts at `newAt` instead. */
export async function snoozeSlot(db: Db, planId: string, kind: QueueKind, slotAt: string, newAt: Date): Promise<void> {
  await db.run(
    `INSERT INTO slot_overrides (plan_id, kind, slot_at, action, new_at) VALUES (?, ?, ?, 'snooze', ?)
     ON CONFLICT (plan_id, kind, slot_at) DO UPDATE SET action = 'snooze', new_at = excluded.new_at`,
    [planId, kind, slotAt, newAt.toISOString()],
  );
}

// ---------- Today ----------

export interface TodaySession {
  session: StoredSession;
  items: PlanItemRow[];
}

export interface TodayQuiz {
  /** The earliest section whose quiz is ready (Focus done) and not yet completed. */
  ready: { num: number; title: string; count: number } | null;
  /** Questions whose 7-day review is due. */
  reviewDue: number;
}

export type TodayPlan = TodayQuiz &
  (
  | {
      scheduled: true;
      planId: string;
      title: string;
      overdue: PlanItemRow[];
      nextFocus: TodaySession | null;
      nextListen: TodaySession | null;
    }
  | {
      scheduled: false;
      planId: string;
      title: string;
      /** Items in progress, then the next not-done Focus items in plan order. */
      reading: PlanItemRow[];
      upNext: PlanItemRow[];
      nextListen: PlanItemRow | null;
    }
  );

const UP_NEXT_COUNT = 3;

export async function getToday(db: Db): Promise<TodayPlan[]> {
  const plans = await db.all<{ id: string; slots_json: string | null }>(
    'SELECT id, slots_json FROM plans ORDER BY imported_at DESC',
  );
  const out: TodayPlan[] = [];
  for (const p of plans) {
    const detail = await getPlanDetail(db, p.id);
    if (!detail) continue;
    const all = await listPlanItems(db, p.id); // plan order
    const byId = new Map(all.map((i) => [i.id, i]));
    const states = await quizStates(db, p.id);
    const readyState = states.find((s) => s.ready && !s.doneAt && s.questionCount > 0);
    const quiz: TodayQuiz = {
      ready: readyState ? { num: readyState.num, title: readyState.title, count: readyState.questionCount } : null,
      reviewDue: await reviewCount(db, p.id),
    };
    const inOrder = (ids: number[]) => ids.map((id) => byId.get(id)).filter((i): i is PlanItemRow => !!i && !i.done);

    if (p.slots_json) {
      const missed = await db.all<{ item_ids: string }>("SELECT item_ids FROM sessions WHERE plan_id = ? AND status = 'missed'", [
        p.id,
      ]);
      const overdueIds = new Set(missed.flatMap((m) => JSON.parse(m.item_ids) as number[]));
      const overdue = all.filter((i) => overdueIds.has(i.id) && !i.done);
      const sessions = await db.all<SessionRow>(
        "SELECT * FROM sessions WHERE plan_id = ? AND status = 'scheduled' ORDER BY start_at",
        [p.id],
      );
      const next = (kind: QueueKind): TodaySession | null => {
        const row = sessions.find((s) => s.kind === kind);
        if (!row) return null;
        const session = toSession(row);
        // Overdue items are shown at the top, not again in their new session.
        return { session, items: inOrder(session.itemIds).filter((i) => !overdueIds.has(i.id)) };
      };
      out.push({
        ...quiz,
        scheduled: true,
        planId: p.id,
        title: detail.title,
        overdue,
        nextFocus: next('focus'),
        nextListen: next('listen'),
      });
    } else {
      const reading = detail.groups.reading;
      const readingIds = new Set(reading.map((i) => i.id));
      const ordered = all.filter((i) => !i.done);
      const upNext = ordered.filter((i) => i.kind === 'focus' && !readingIds.has(i.id)).slice(0, UP_NEXT_COUNT);
      const nextListen = ordered.find((i) => i.kind === 'listen' && !readingIds.has(i.id)) ?? null;
      out.push({ ...quiz, scheduled: false, planId: p.id, title: detail.title, reading, upNext, nextListen });
    }
  }
  return out;
}

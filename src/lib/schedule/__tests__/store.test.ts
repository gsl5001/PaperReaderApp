/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';

import { nodeDb } from '../../db/node-db';
import { migrate } from '../../db/schema';
import { importPlanText } from '../../library/import-plan';
import { setItemDone } from '../../plan/queries';
import { getToday, refreshSchedule, skipSlot, snoozeSlot, upcomingSessions } from '../store';

// Local times. 2026-11-16 is a Monday.
const at = (d: number, h = 0, m = 0) => new Date(2026, 10, d, h, m);

const SLOTTED = `---
format: plan/v1
id: slotted
title: Slotted plan
start: 2026-11-16
slots:
  focus:  { days: [Mon, Wed, Fri], time: "07:00", minutes: 45 }
  listen: { days: [Tue], time: "17:30", minutes: 20 }
library:
  - group: Papers
    docs:
      - id: doc-a
        title: Doc A
---

## 1. One

### Focus
- [ ] Read: a1 (45) [doc-a p.1-5]
- [ ] Read: a2 (20) [doc-a p.6-9]
- [ ] Do: a3 (20)

### Listen
- [ ] Listen: overview (20)
  - [doc-a p.1-9]

## 2. Two

### Focus
- [ ] Read: b1 (45) [doc-a p.10-12]
`;

const REAL_PLAN = readFileSync(join(__dirname, '../../../../plans/counterfactual-models.plan.md'), 'utf8');

async function setup(...plans: string[]) {
  const db = nodeDb();
  await migrate(db);
  for (const p of plans) {
    const r = await importPlanText(db, p, at(15));
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
  }
  return db;
}

const itemId = async (db: Awaited<ReturnType<typeof setup>>, text: string) =>
  (await db.first<{ id: number }>('SELECT id FROM items WHERE text = ?', [text]))!.id;

describe('refreshSchedule', () => {
  it('stores the schedule for plans with slots only', async () => {
    const db = await setup(SLOTTED, REAL_PLAN);
    await refreshSchedule(db, at(15, 12));
    const s = await upcomingSessions(db);
    expect(s.map((x) => [x.planId, x.kind, new Date(x.startAt).getDate(), x.itemIds.length])).toEqual([
      ['slotted', 'focus', 16, 1], // a1 (45)
      ['slotted', 'listen', 17, 1],
      ['slotted', 'focus', 18, 2], // a2 + a3 (40)
      ['slotted', 'focus', 20, 1], // b1
    ]);
  });

  it('a missed slot is recorded, its items become overdue and move to the next slot', async () => {
    const db = await setup(SLOTTED);
    await refreshSchedule(db, at(15, 12));
    await refreshSchedule(db, at(16, 9)); // Monday's 07:00 slot ended with a1 not done
    const [today] = await getToday(db);
    if (!today.scheduled) throw new Error('expected scheduled');
    expect(today.overdue.map((i) => i.text)).toEqual(['a1']);
    // a1 is now first in Wednesday's session but shown only under overdue
    expect(new Date(today.nextFocus!.session.startAt).getDate()).toBe(18);
    expect(today.nextFocus!.session.itemIds[0]).toBe(await itemId(db, 'a1'));
    expect(today.nextFocus!.items.map((i) => i.text)).toEqual([]);
    expect(today.nextListen!.items.map((i) => i.text)).toEqual(['overview']);

    // Doing it clears overdue
    await setItemDone(db, await itemId(db, 'a1'), true);
    await refreshSchedule(db, at(16, 10));
    const [after] = await getToday(db);
    if (!after.scheduled) throw new Error('expected scheduled');
    expect(after.overdue).toEqual([]);
    expect(after.nextFocus!.items.map((i) => i.text)).toEqual(['a2', 'a3']);
  });

  it('a slot whose items were all done is closed as done, not missed', async () => {
    const db = await setup(SLOTTED);
    await refreshSchedule(db, at(15, 12));
    await setItemDone(db, await itemId(db, 'a1'), true);
    await refreshSchedule(db, at(16, 9));
    expect(await db.all("SELECT status FROM sessions WHERE status != 'scheduled'")).toEqual([{ status: 'done' }]);
  });

  it('skip and snooze', async () => {
    const db = await setup(SLOTTED);
    await refreshSchedule(db, at(16, 6));
    await skipSlot(db, 'slotted', 'focus', at(16, 7).toISOString());
    await refreshSchedule(db, at(16, 6, 1));
    let focus = (await upcomingSessions(db)).filter((s) => s.kind === 'focus');
    expect(new Date(focus[0].startAt).getDate()).toBe(18);

    await snoozeSlot(db, 'slotted', 'focus', at(18, 7).toISOString(), at(18, 7, 30));
    await refreshSchedule(db, at(16, 6, 2));
    focus = (await upcomingSessions(db)).filter((s) => s.kind === 'focus');
    expect(new Date(focus[0].startAt)).toEqual(at(18, 7, 30));
    expect(focus[0].slotAt).toBe(at(18, 7).toISOString());
  });
});

describe('getToday for a plan without slots', () => {
  it('lists reading items, the next 3 Focus items and the next Listen item', async () => {
    const db = await setup(REAL_PLAN);
    await db.run("UPDATE documents SET last_page = 190 WHERE id = 'mml'"); // inside section 1's MML reading
    const [t] = await getToday(db);
    if (t.scheduled) throw new Error('expected unscheduled');
    expect(t.reading.map((i) => i.docId)).toEqual(['mml']);
    expect(t.upNext.map((i) => i.text)).toEqual([
      'Causality matters in medical imaging, full paper',
      'explain p(x, y), p(x | y) and p(x) in your own words',
      'Pearl Primer Ch. 1',
    ]);
    expect(t.nextListen?.text).toBe('NotebookLM overview of causality in medical imaging');
  });
});

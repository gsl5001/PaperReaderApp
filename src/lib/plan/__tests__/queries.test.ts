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
import { createMark } from '../../marks/queries';
import { gradeQuestion } from '../../quiz/queries';
import {
  deletePlan,
  getPlanDetail,
  listPlanOverviews,
  openRangedItemsForDoc,
  saveReadingPosition,
  setItemDone,
} from '../queries';

const REAL_PLAN = readFileSync(join(__dirname, '../../../../plans/counterfactual-models.plan.md'), 'utf8');

async function setup() {
  const db = nodeDb();
  await migrate(db);
  const r = await importPlanText(db, REAL_PLAN, new Date('2026-11-09T12:00:00Z'));
  if (!r.ok) throw new Error('import failed');
  return db;
}

describe('plan status queries', () => {
  it('a fresh plan: section 1 is due, the rest unread', async () => {
    const db = await setup();
    const [o] = await listPlanOverviews(db);
    expect(o.current).toEqual({ num: 1, title: 'Motivation and probability' });
    // Section 1 has 3 Focus + 1 Listen item
    expect(o.counts).toEqual({ reading: 0, due: 4, unread: 41, read: 0 });
    expect(o.total).toBe(45);
  });

  it('opening a document inside an item range makes it reading; done items are read', async () => {
    const db = await setup();
    await saveReadingPosition(db, 'mml', 190, 0.3); // inside section 1's MML §6.1–6.5 (p.178–210)
    const detail = (await getPlanDetail(db, 'counterfactual-models-2026'))!;
    expect(detail.groups.reading.map((i) => i.text)).toEqual(['Ch. 6, §6.1–6.5, probability spaces to the Gaussian']);
    expect(detail.groups.reading[0]).toMatchObject({
      docTitle: expect.stringContaining('Mathematics'),
      docHasFile: false,
    });

    const castro = detail.groups.due.find((i) => i.docId === 'castro-2020')!;
    await setItemDone(db, castro.id, true);
    const after = (await getPlanDetail(db, 'counterfactual-models-2026'))!;
    expect(after.groups.read.map((i) => i.id)).toEqual([castro.id]);

    await setItemDone(db, castro.id, false);
    expect((await getPlanDetail(db, 'counterfactual-models-2026'))!.groups.read).toEqual([]);
  });

  it('section 1 stays current until its Focus items are done and its quiz is completed', async () => {
    const db = await setup();
    const detail = (await getPlanDetail(db, 'counterfactual-models-2026'))!;
    for (const i of detail.groups.due.filter((i) => i.kind === 'focus')) await setItemDone(db, i.id, true);
    expect((await listPlanOverviews(db))[0].current?.num).toBe(1); // quiz still pending
    await db.run(
      "UPDATE sections SET quiz_done_at = '2026-11-12' WHERE plan_id = 'counterfactual-models-2026' AND num = 1",
    );
    expect((await listPlanOverviews(db))[0].current?.num).toBe(2);
  });

  it('lists not-done ranged items for a document', async () => {
    const db = await setup();
    const items = await openRangedItemsForDoc(db, 'pawlowski-2020');
    expect(items.map((i) => [i.pageFrom, i.pageTo])).toEqual(
      expect.arrayContaining([
        [1, 5],
        [6, 7],
        [8, 9],
      ]),
    );
  });
});

describe('deletePlan', () => {
  it('removes the plan and everything in it, keeping documents and marks', async () => {
    const db = nodeDb();
    await migrate(db);
    const plan = (id: string) => `---
format: plan/v1
id: ${id}
title: ${id}
start: 2026-11-09
library:
  - group: Books
    docs:
      - id: tb
        title: TB
---

## 1. One

### Focus
- [ ] Read: a [tb p.1-5]

### Questions
1. Q?
   Answer: A.
`;
    expect((await importPlanText(db, plan('keep'))).ok).toBe(true);
    expect((await importPlanText(db, plan('gone'))).ok).toBe(true);
    const m = await createMark(db, {
      docId: 'tb',
      kind: 'confused',
      text: 't',
      rects: [{ page: 2, x: 0, y: 0, w: 1, h: 0.1 }],
      preferPlanId: 'gone',
    });
    expect(m.planId).toBe('gone');
    const q = (await db.first<{ id: number }>("SELECT id FROM questions WHERE plan_id = 'gone'"))!.id;
    await gradeQuestion(db, 'gone', q, 'missed', { kind: 'section', sectionNum: 1 });

    await deletePlan(db, 'gone');
    const count = async (sql: string) => (await db.first<{ n: number }>(sql))!.n;
    expect(await count("SELECT COUNT(*) AS n FROM plans WHERE id = 'gone'")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM items WHERE plan_id = 'gone'")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM sections WHERE plan_id = 'gone'")).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM questions WHERE plan_id = 'gone'")).toBe(0);
    expect(await count('SELECT COUNT(*) AS n FROM attempts')).toBe(0);
    expect(await count("SELECT COUNT(*) AS n FROM items WHERE plan_id = 'keep'")).toBe(1);
    expect(await count("SELECT COUNT(*) AS n FROM documents WHERE id = 'tb'")).toBe(1);
    expect(await db.first('SELECT plan_id, section_num FROM marks WHERE id = ?', [m.id])).toEqual({
      plan_id: null,
      section_num: null,
    });
  });
});

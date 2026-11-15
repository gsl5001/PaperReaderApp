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
import { createMark, deleteMark, listMarks, sectionForPage, setMarkNote, setMarkStatus } from '../queries';

const REAL_PLAN = readFileSync(join(__dirname, '../../../../plans/counterfactual-models.plan.md'), 'utf8');
const NOW = new Date('2026-11-12T10:00:00Z');

async function setup() {
  const db = nodeDb();
  await migrate(db);
  const r = await importPlanText(db, REAL_PLAN, NOW);
  if (!r.ok) throw new Error('import failed');
  return db;
}

describe('sectionForPage', () => {
  it('uses the section of the reading that covers the page', async () => {
    const db = await setup();
    // MML p.178–210 is section 1; p.220–226 is section 3
    expect(await sectionForPage(db, 'mml', 190)).toEqual({ planId: 'counterfactual-models-2026', sectionNum: 1 });
    expect(await sectionForPage(db, 'mml', 221)).toEqual({ planId: 'counterfactual-models-2026', sectionNum: 3 });
    expect(await sectionForPage(db, 'mml', 300)).toBeNull();
  });

  it('when readings overlap, prefers one not done, then the earliest section', async () => {
    const db = await setup();
    // ribeiro-2023 p.2 is in section 2 (§2.1, p.2-2) and section 7 (full paper, p.1-9)
    expect((await sectionForPage(db, 'ribeiro-2023', 2))?.sectionNum).toBe(2);
    const s2 = await db.first<{ id: number }>("SELECT id FROM items WHERE doc_id = 'ribeiro-2023' AND section_num = 2 AND kind = 'focus'");
    await setItemDone(db, s2!.id, true);
    expect((await sectionForPage(db, 'ribeiro-2023', 2))?.sectionNum).toBe(7);
  });
});

describe('marks', () => {
  it('creates a cross-page mark with its section; confused marks start open', async () => {
    const db = await setup();
    const m = await createMark(
      db,
      {
        docId: 'mml',
        kind: 'confused',
        text: 'the posterior is proportional to',
        rects: [
          { page: 190, x: 0.1, y: 0.9, w: 0.8, h: 0.02 },
          { page: 191, x: 0.1, y: 0.05, w: 0.4, h: 0.02 },
        ],
      },
      NOW,
    );
    expect(m).toMatchObject({
      page: 190,
      pageEnd: 191,
      kind: 'confused',
      status: 'open',
      planId: 'counterfactual-models-2026',
      sectionNum: 1,
      note: null,
      createdAt: NOW.toISOString(),
    });
    expect(m.rects).toHaveLength(2);
  });

  it('highlights have no status; notes keep their text', async () => {
    const db = await setup();
    const h = await createMark(db, { docId: 'mml', kind: 'highlight', text: 'a', rects: [{ page: 180, x: 0, y: 0.5, w: 1, h: 0.02 }] });
    const n = await createMark(db, { docId: 'mml', kind: 'note', text: 'b', note: 'check this', rects: [{ page: 180, x: 0, y: 0.2, w: 1, h: 0.02 }] });
    expect(h.status).toBeNull();
    expect(n.note).toBe('check this');
    // Reading order: by page, then by position on the page
    expect((await listMarks(db, 'mml')).map((m) => m.id)).toEqual([n.id, h.id]);
  });

  it('edits notes, resolves and reopens confused marks, deletes', async () => {
    const db = await setup();
    const c = await createMark(db, { docId: 'mml', kind: 'confused', text: 'x', rects: [{ page: 180, x: 0, y: 0, w: 1, h: 0.02 }] });
    const h = await createMark(db, { docId: 'mml', kind: 'highlight', text: 'y', rects: [{ page: 181, x: 0, y: 0, w: 1, h: 0.02 }] });
    await setMarkNote(db, c.id, '  why?  ');
    await setMarkStatus(db, c.id, 'resolved');
    await setMarkStatus(db, h.id, 'resolved'); // ignored: highlights have no status
    let [mc, mh] = await listMarks(db, 'mml');
    expect(mc).toMatchObject({ note: 'why?', status: 'resolved' });
    expect(mh.status).toBeNull();
    await setMarkNote(db, c.id, '   ');
    await setMarkStatus(db, c.id, 'open');
    [mc] = await listMarks(db, 'mml');
    expect(mc).toMatchObject({ note: null, status: 'open' });
    await deleteMark(db, c.id);
    expect((await listMarks(db, 'mml')).map((m) => m.id)).toEqual([h.id]);
  });
});

/**
 * @jest-environment node
 */
/// <reference types="jest" />
/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';

import { nodeDb } from '../../db/node-db';
import { migrate } from '../../db/schema';
import type { Db } from '../../db/types';
import { importPlanText } from '../import-plan';
import { listLibrary, listPlans } from '../queries';

const REAL_PLAN = readFileSync(join(__dirname, '../../../../plans/counterfactual-models.plan.md'), 'utf8');

function plan(body: string, library = '      - id: doc-a\n        title: Doc A\n        url: https://example.org/a.pdf\n', group = 'Papers') {
  return `---
format: plan/v1
id: p1
title: Plan One
start: 2026-11-09
library:
  - group: ${group}
    docs:
${library}---
${body}`;
}

const BODY_V1 = `
## 1. One

### Focus
- [ ] Read: first (30) [doc-a p.1-5]
- [ ] Read: second (20) [doc-a p.6-9]
- [ ] Do: third (10)

### Listen
- [ ] Listen: overview (20) [optional]
  - [doc-a p.1-9]

### Questions
1. Q one?
   Answer: A one.
   Concepts: x, y
2. Q two?
   Answer: A two.

## 2. Two

### Focus
- [ ] Read: fourth [doc-a]
`;

async function freshDb(): Promise<Db> {
  const db = nodeDb();
  await migrate(db);
  return db;
}

async function importOk(db: Db, text: string) {
  const r = await importPlanText(db, text, new Date('2026-11-09T12:00:00Z'));
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.summary;
}

describe('migrate', () => {
  it('is idempotent', async () => {
    const db = await freshDb();
    await migrate(db);
    expect(await db.first('PRAGMA user_version')).toEqual({ user_version: 5 });
  });
});

describe('first import', () => {
  it('imports the counterfactual plan', async () => {
    const db = await freshDb();
    const s = await importOk(db, REAL_PLAN);
    expect(s).toMatchObject({ isNew: true, docsAdded: 19, sections: 10, itemsAdded: 45, questionsAdded: 39 });

    const lib = await listLibrary(db);
    expect(lib.map((g) => [g.name, g.docs.length])).toEqual([
      ['Textbooks', 4],
      ['Tutorials and reviews', 4],
      ['Papers', 11],
    ]);
    expect(await listPlans(db)).toEqual([
      { id: 'counterfactual-models-2026', title: expect.any(String), sections: 10, importedAt: '2026-11-09T12:00:00.000Z' },
    ]);
    const optional = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM items WHERE optional = 1');
    expect(optional?.n).toBe(16);
  });

  it('stores item fields', async () => {
    const db = await freshDb();
    await importOk(db, plan(BODY_V1));
    const items = await db.all('SELECT section_num, kind, type, text, minutes, doc_id, page_from, page_to, urls, optional, position FROM items ORDER BY section_num, kind, position');
    expect(items).toEqual([
      { section_num: 1, kind: 'focus', type: 'Read', text: 'first', minutes: 30, doc_id: 'doc-a', page_from: 1, page_to: 5, urls: null, optional: 0, position: 0 },
      { section_num: 1, kind: 'focus', type: 'Read', text: 'second', minutes: 20, doc_id: 'doc-a', page_from: 6, page_to: 9, urls: null, optional: 0, position: 1 },
      { section_num: 1, kind: 'focus', type: 'Do', text: 'third', minutes: 10, doc_id: null, page_from: null, page_to: null, urls: null, optional: 0, position: 2 },
      {
        section_num: 1, kind: 'listen', type: 'Listen', text: 'overview', minutes: 20, doc_id: null, page_from: null, page_to: null,
        urls: JSON.stringify({ url: null, sources: [{ kind: 'doc', ref: { docId: 'doc-a', pageFrom: 1, pageTo: 9 } }] }),
        optional: 1, position: 3,
      },
      { section_num: 2, kind: 'focus', type: 'Read', text: 'fourth', minutes: null, doc_id: 'doc-a', page_from: null, page_to: null, urls: null, optional: 0, position: 0 },
    ]);
    const qs = await db.all('SELECT section_num, text, answer, concepts, source, removed_at FROM questions ORDER BY position');
    expect(qs).toEqual([
      { section_num: 1, text: 'Q one?', answer: 'A one.', concepts: '["x","y"]', source: 'plan', removed_at: null },
      { section_num: 1, text: 'Q two?', answer: 'A two.', concepts: null, source: 'plan', removed_at: null },
    ]);
  });

  it('returns parse errors without writing anything', async () => {
    const db = await freshDb();
    const r = await importPlanText(db, plan('\n## 1. One\n\n### Focus\n- [ ] Skim: x\n'));
    expect(r.ok).toBe(false);
    expect(await db.all('SELECT * FROM plans')).toEqual([]);
  });

  it('resolves references to documents already in the library', async () => {
    const db = await freshDb();
    await importOk(db, plan(BODY_V1));
    const second = `---
format: plan/v1
id: p2
title: Plan Two
start: 2026-12-01
---

## 1. Reuse

### Focus
- [ ] Read: again [doc-a p.10-12]
`;
    const s = await importOk(db, second);
    expect(s).toMatchObject({ isNew: true, docsAdded: 0, itemsAdded: 1 });
  });
});

describe('re-import', () => {
  it('keeps done status, attached files and positions; applies the removal rules', async () => {
    const db = await freshDb();
    await importOk(db, plan(BODY_V1));
    await db.run("UPDATE documents SET file_path = 'file:///pdfs/doc-a.pdf', last_page = 7 WHERE id = 'doc-a'");
    await db.run("UPDATE items SET done_at = '2026-11-10' WHERE text IN ('first', 'second')");
    const q2 = await db.first<{ id: number }>("SELECT id FROM questions WHERE text = 'Q two?'");
    await db.run("INSERT INTO attempts (question_id, answered_at, grade) VALUES (?, '2026-11-10', 'missed')", [q2!.id]);

    // v2: "second" (done) and "third" (not done) removed; "fourth" section removed entirely;
    // new item added; Q two removed; Q one's answer edited; doc title, URL and group changed.
    const BODY_V2 = `
## 1. One (edited)

### Focus
- [ ] Read: first (45) [doc-a p.1-6]
- [ ] Read: new item [doc-a p.10-11]

### Listen
- [ ] Listen: overview (20) [optional]
  - [doc-a p.1-9]

### Questions
1. Q one?
   Answer: A one, edited.
   Concepts: x
`;
    const s = await importOk(
      db,
      plan(BODY_V2, '      - id: doc-a\n        title: Doc A (2nd ed.)\n        url: https://example.org/a2.pdf\n', 'Textbooks'),
    );
    expect(s).toMatchObject({
      isNew: false,
      docsAdded: 0,
      docsUpdated: 1,
      itemsAdded: 1,
      itemsMatched: 2,
      itemsKeptDone: 1,
      itemsDeleted: 2,
      questionsAdded: 0,
      questionsMatched: 1,
      questionsRemoved: 1,
    });

    const items = await db.all<{ text: string; done_at: string | null; minutes: number | null }>(
      'SELECT text, done_at, minutes FROM items ORDER BY section_num, kind, position',
    );
    expect(items.map((i) => i.text).sort()).toEqual(['first', 'new item', 'overview', 'second']);
    expect(items.find((i) => i.text === 'first')).toMatchObject({ done_at: '2026-11-10', minutes: 45 });
    expect(items.find((i) => i.text === 'second')).toMatchObject({ done_at: '2026-11-10' });

    // Section 2 had no done items, so it's gone; section 1 has the new title.
    expect(await db.all('SELECT num, title FROM sections ORDER BY num')).toEqual([{ num: 1, title: 'One (edited)' }]);

    // Document: new details, same file and position; moved to the new group.
    const lib = await listLibrary(db);
    expect(lib).toEqual([
      {
        id: expect.any(Number),
        name: 'Textbooks',
        docs: [{ id: 'doc-a', title: 'Doc A (2nd ed.)', url: 'https://example.org/a2.pdf', filePath: 'file:///pdfs/doc-a.pdf', lastPage: 7 }],
      },
    ]);

    // Q two: removed from the quiz, attempts kept. Q one: same row, edited answer.
    const qs = await db.all<{ text: string; answer: string; removed_at: string | null }>(
      'SELECT text, answer, removed_at FROM questions ORDER BY text',
    );
    expect(qs).toEqual([
      { text: 'Q one?', answer: 'A one, edited.', removed_at: null },
      { text: 'Q two?', answer: 'A two.', removed_at: '2026-11-09T12:00:00.000Z' },
    ]);
    expect(await db.all('SELECT grade FROM attempts')).toEqual([{ grade: 'missed' }]);

    // Re-importing v1 brings Q two back into the quiz.
    await importOk(db, plan(BODY_V1));
    expect(await db.first("SELECT removed_at FROM questions WHERE text = 'Q two?'")).toEqual({ removed_at: null });
  });

  it('re-importing the same file changes nothing', async () => {
    const db = await freshDb();
    await importOk(db, REAL_PLAN);
    const before = await db.all('SELECT * FROM items ORDER BY id');
    const s = await importOk(db, REAL_PLAN);
    expect(s).toMatchObject({ isNew: false, itemsAdded: 0, itemsMatched: 45, itemsDeleted: 0, questionsAdded: 0, questionsRemoved: 0 });
    expect(await db.all('SELECT * FROM items ORDER BY id')).toEqual(before);
  });
});

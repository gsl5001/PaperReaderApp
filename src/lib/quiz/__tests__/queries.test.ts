/**
 * @jest-environment node
 */
/// <reference types="jest" />
import { nodeDb } from '../../db/node-db';
import { migrate } from '../../db/schema';
import { importPlanText } from '../../library/import-plan';
import { listPlanOverviews, setItemDone } from '../../plan/queries';
import {
  completeSectionQuiz,
  conceptScores,
  gradeQuestion,
  quizBecameReady,
  quizScore,
  quizStates,
  reviewCount,
  reviewQuiz,
  sectionQuiz,
} from '../queries';

const PLAN = `---
format: plan/v1
id: p
title: P
start: 2026-11-09
---

## 1. One

### Focus
- [ ] Read: one-a
- [ ] Read: one-b
- [ ] Read: one-opt [optional]

### Questions
1. Q1a?
   Answer: A.
   Concepts: x
2. Q1b?
   Answer: B.
   Concepts: x, y

## 2. Two

### Focus
- [ ] Read: two-a

### Questions
1. Q2a?
   Answer: C.
   Concepts: y

## 3. Three

### Focus
- [ ] Read: three-a
`;

const T0 = new Date('2026-11-12T10:00:00Z');
const days = (n: number) => new Date(T0.getTime() + n * 86_400_000);

async function setup() {
  const db = nodeDb();
  await migrate(db);
  const r = await importPlanText(db, PLAN, T0);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return db;
}
const qid = async (db: Awaited<ReturnType<typeof setup>>, text: string) =>
  (await db.first<{ id: number }>('SELECT id FROM questions WHERE text = ?', [text]))!.id;
const iid = async (db: Awaited<ReturnType<typeof setup>>, text: string) =>
  (await db.first<{ id: number }>('SELECT id FROM items WHERE text = ?', [text]))!.id;
const S1 = { kind: 'section' as const, sectionNum: 1 };
const S2 = { kind: 'section' as const, sectionNum: 2 };

describe('grading and repeats', () => {
  it('Missed in its own quiz carries to the next section, then a 7-day review', async () => {
    const db = await setup();
    const q = await qid(db, 'Q1a?');
    await gradeQuestion(db, 'p', q, 'missed', S1, T0);
    expect((await sectionQuiz(db, 'p', 2)).map((x) => [x.text, x.repeat])).toEqual([
      ['Q1a?', true],
      ['Q2a?', false],
    ]);
    expect(await reviewCount(db, 'p', days(30))).toBe(0);

    await gradeQuestion(db, 'p', q, 'partly', S2, days(1));
    expect((await sectionQuiz(db, 'p', 2)).map((x) => x.text)).toEqual(['Q2a?']);
    expect(await reviewCount(db, 'p', days(7))).toBe(0);
    expect((await reviewQuiz(db, 'p', days(8))).map((x) => x.text)).toEqual(['Q1a?']);
  });

  it('Got it the first time: no repeat; two Got its retire', async () => {
    const db = await setup();
    const q = await qid(db, 'Q1a?');
    await gradeQuestion(db, 'p', q, 'got_it', S1, T0);
    expect((await sectionQuiz(db, 'p', 2)).map((x) => x.text)).toEqual(['Q2a?']);
    expect(await reviewCount(db, 'p', days(30))).toBe(0);
    expect((await sectionQuiz(db, 'p', 1)).map((x) => x.text)).toEqual(['Q1a?', 'Q1b?']); // retake still asks it
    await gradeQuestion(db, 'p', q, 'got_it', S1, days(1));
    expect((await sectionQuiz(db, 'p', 1)).map((x) => x.text)).toEqual(['Q1b?']); // retired
  });

  it('carries to the next section even if it has no questions of its own, then a 7-day review', async () => {
    const db = await setup();
    const q = await qid(db, 'Q2a?');
    await gradeQuestion(db, 'p', q, 'missed', S2, T0);
    expect((await sectionQuiz(db, 'p', 3)).map((x) => x.text)).toEqual(['Q2a?']);
    await gradeQuestion(db, 'p', q, 'missed', { kind: 'section', sectionNum: 3 }, T0);
    expect(await reviewCount(db, 'p', days(7))).toBe(1);
  });

  it('a review grade schedules another review in 7 days', async () => {
    const db = await setup();
    const q = await qid(db, 'Q1b?');
    await db.run('UPDATE questions SET next_due = ? WHERE id = ?', [T0.toISOString(), q]);
    await gradeQuestion(db, 'p', q, 'missed', { kind: 'review' }, T0);
    expect(await reviewCount(db, 'p', days(6))).toBe(0);
    expect(await reviewCount(db, 'p', days(7))).toBe(1);
  });

  it('records attempts and concept scores over the last 5 attempts', async () => {
    const db = await setup();
    const a = await qid(db, 'Q1a?'); // x
    const b = await qid(db, 'Q1b?'); // x, y
    await gradeQuestion(db, 'p', a, 'got_it', S1, T0);
    await gradeQuestion(db, 'p', b, 'partly', S1, days(1));
    const scores = await conceptScores(db, 'p');
    expect(scores).toEqual({ x: { score: 0.75, attempts: 2 }, y: { score: 0.5, attempts: 1 } });
    expect(await db.all('SELECT grade FROM attempts ORDER BY id')).toEqual([{ grade: 'got_it' }, { grade: 'partly' }]);
  });
});

describe('quiz state and section completion', () => {
  it('quiz is ready when required Focus items are done; early quizzes are available', async () => {
    const db = await setup();
    let states = await quizStates(db, 'p');
    expect(states.map((s) => [s.num, s.questionCount, s.ready, s.available])).toEqual([
      [1, 2, false, true], // current section: available early
      [2, 1, false, false], // later section
      [3, 0, false, false], // no questions
    ]);

    expect(await quizBecameReady(db, await iid(db, 'one-a'))).toBeNull(); // not done yet
    await setItemDone(db, await iid(db, 'one-a'), true);
    expect(await quizBecameReady(db, await iid(db, 'one-a'))).toBeNull(); // one-b still to do
    await setItemDone(db, await iid(db, 'one-b'), true);
    expect(await quizBecameReady(db, await iid(db, 'one-b'))).toEqual({ planId: 'p', sectionNum: 1, title: 'One', count: 2 });
    expect(await quizBecameReady(db, await iid(db, 'one-opt'))).toBeNull(); // optional items never trigger it

    states = await quizStates(db, 'p');
    expect(states[0]).toMatchObject({ ready: true, available: true, doneAt: null });
    expect((await listPlanOverviews(db))[0].current?.num).toBe(1);

    await completeSectionQuiz(db, 'p', 1, ['got_it', 'partly'], T0);
    states = await quizStates(db, 'p');
    expect(states[0]).toMatchObject({ doneAt: T0.toISOString(), score: 1.5, total: 2 });
    expect(states[1].available).toBe(true); // section 2 is now current
    expect((await listPlanOverviews(db))[0].current?.num).toBe(2);
  });

  it('quizScore', () => {
    expect(quizScore(['got_it', 'partly', 'missed', 'got_it'])).toBe(2.5);
  });
});

describe('multiple choice', () => {
  it('options are stored on import and returned in quizzes; re-import updates them', async () => {
    const db = nodeDb();
    await migrate(db);
    const mc = (right: string) => `---
format: plan/v1
id: mc
title: MC
start: 2026-11-09
---

## 1. One

### Questions
1. Pick one?
   - [ ] a
   - [x] ${right}
   Answer: Because.
`;
    const r = await importPlanText(db, mc('b'), T0);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const [q] = await sectionQuiz(db, 'mc', 1);
    expect(q.options).toEqual([
      { text: 'a', correct: false },
      { text: 'b', correct: true },
    ]);
    await importPlanText(db, mc('c'), T0);
    const [q2] = await sectionQuiz(db, 'mc', 1);
    expect(q2.id).toBe(q.id); // same question, history kept
    expect(q2.options[1]).toEqual({ text: 'c', correct: true });
  });
});

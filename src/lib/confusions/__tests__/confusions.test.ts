/**
 * @jest-environment node
 */
/// <reference types="jest" />
import { nodeDb } from '../../db/node-db';
import { migrate } from '../../db/schema';
import { importPlanText } from '../../library/import-plan';
import { createMark, getMark, setMarkStatus } from '../../marks/queries';
import { setItemDone } from '../../plan/queries';
import { addReadingTime, confusionsMarkdown, openConfusionCount, planProgress, progressMarkdown } from '../../progress';
import { gradeQuestion, quizStates, reviewCount, reviewQuiz, sectionQuiz } from '../../quiz/queries';
import { importQuestionsText } from '../import';
import { parseQuestionsFile } from '../parse';

const PLAN = `---
format: plan/v1
id: p
title: P
start: 2026-11-09
library:
  - group: Books
    docs:
      - id: tb
        title: Think Bayes
  - group: Papers
    docs:
      - id: pa
        title: Paper A
---

## 1. One

### Focus
- [ ] Read: one-a [tb p.1-20]
- [ ] Read: one-b [pa p.1-5]

### Questions
1. Q1a?
   Answer: A.
2. Q1b?
   Answer: B.

## 2. Two

### Focus
- [ ] Read: two-a [tb p.21-40]

### Questions
1. Q2a?
   Answer: C.
`;

const T0 = new Date('2026-11-12T10:00:00Z');
const days = (n: number) => new Date(T0.getTime() + n * 86_400_000);
const rect = (page: number) => ({ page, x: 0.1, y: 0.2, w: 0.5, h: 0.02 });

async function setup() {
  const db = nodeDb();
  await migrate(db);
  const r = await importPlanText(db, PLAN, T0);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  const c = await createMark(
    db,
    {
      docId: 'tb',
      kind: 'confused',
      text: 'The posterior is proportional\nto the prior times the likelihood.',
      rects: [rect(14)],
      note: 'Why drop P(D)?',
    },
    T0,
  );
  return { db, markId: c.id };
}

const questionsFile = (markId: number, extra = '') => `---
format: questions/v1
plan: p
---

## C${markId} · tb p.14 · Section 1
Explanation: P(D) is the same for every hypothesis.

1. Why can P(D) be dropped?
   - [ ] It is always 1
   - [x] It is the same for every hypothesis
   Answer: It only rescales.
   Ref: tb p.14
   Concepts: normalisation
2. [hard] When do you need P(D)?
   Answer: Comparing models.
${extra}`;

describe('questions/v1 parser', () => {
  it('parses confusions with explanations and questions', () => {
    const r = parseQuestionsFile(questionsFile(7), ['tb']);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.file.planId).toBe('p');
    expect(r.file.confusions).toHaveLength(1);
    const c = r.file.confusions[0];
    expect(c.markId).toBe(7);
    expect(c.explanation).toBe('P(D) is the same for every hypothesis.');
    expect(c.questions.map((q) => [q.text, q.hard, q.options.length])).toEqual([
      ['Why can P(D) be dropped?', false, 2],
      ['When do you need P(D)?', true, 0],
    ]);
    expect(c.questions[0].ref).toEqual({ docId: 'tb', page: 14 });
  });

  it('reports a missing explanation, missing questions and unknown documents with line numbers', () => {
    const r = parseQuestionsFile(
      `---
format: questions/v1
plan: p
---

## C1
1. Q?
   Answer: A.
   Ref: nope p.3

## C2
Explanation: E.
`,
      ['tb'],
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.errors.map((e) => e.line)).toEqual([6, 9, 11]);
    expect(r.errors.map((e) => e.message)).toEqual(
      expect.arrayContaining(['C1 has no Explanation line', 'C2 has no questions', 'Unknown document "nope"']),
    );
  });

  it('rejects the wrong format', () => {
    const r = parseQuestionsFile('---\nformat: plan/v1\nplan: p\n---\n');
    expect(r.ok).toBe(false);
  });
});

describe('confusions export', () => {
  it('lists open confusions in the design doc format', async () => {
    const { db, markId } = await setup();
    expect(await openConfusionCount(db, 'p', 1)).toBe(1);
    expect(await openConfusionCount(db, 'p', 2)).toBe(0);
    expect(await confusionsMarkdown(db, 'p', T0)).toBe(
      `# Confusions: p (exported 2026-11-12)

## C${markId} · tb p.14 · Section 1
> The posterior is proportional
> to the prior times the likelihood.
Note: Why drop P(D)?
`,
    );
  });

  it('returns null when nothing is open', async () => {
    const { db, markId } = await setup();
    await setMarkStatus(db, markId, 'resolved');
    expect(await confusionsMarkdown(db, 'p', T0)).toBeNull();
  });
});

describe('questions/v1 import', () => {
  it('attaches the explanation, adds the questions and marks the confusion Explained', async () => {
    const { db, markId } = await setup();
    const r = await importQuestionsText(db, questionsFile(markId), T0);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.summary).toMatchObject({ confusions: 1, questionsAdded: 2, questionsMatched: 0, questionsRemoved: 0 });
    const m = await getMark(db, markId);
    expect(m?.status).toBe('explained');
    expect(m?.explanation).toBe('P(D) is the same for every hypothesis.');
    expect(await confusionsMarkdown(db, 'p', T0)).toBeNull();
  });

  it('rejects unknown, non-Confused and other-plan marks without changing anything', async () => {
    const { db, markId } = await setup();
    const h = await createMark(db, { docId: 'tb', kind: 'highlight', text: 'h', rects: [rect(15)] }, T0);
    const r = await importQuestionsText(db, questionsFile(markId).replace(`C${markId}`, `C${h.id}`), T0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].message).toBe(`C${h.id} is not a Confused mark`);
    const r2 = await importQuestionsText(db, questionsFile(999), T0);
    expect(r2.ok).toBe(false);
    const r3 = await importQuestionsText(db, questionsFile(markId).replace('plan: p', 'plan: other'), T0);
    expect(r3.ok).toBe(false);
    expect((await getMark(db, markId))?.status).toBe('open');
  });

  it('re-import matches questions by text, adds new ones and removes dropped ones', async () => {
    const { db, markId } = await setup();
    await importQuestionsText(db, questionsFile(markId), T0);
    const edited = questionsFile(markId)
      .replace('2. [hard] When do you need P(D)?\n   Answer: Comparing models.\n', '')
      .concat('2. New one?\n   Answer: N.\n');
    const r = await importQuestionsText(db, edited, T0);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.summary).toMatchObject({ questionsAdded: 1, questionsMatched: 1, questionsRemoved: 1 });
  });
});

describe('confusion questions in the quiz', () => {
  it('come first in the next quiz or review, then repeat every 7 days until retired, then resolve the mark', async () => {
    const { db, markId } = await setup();
    await importQuestionsText(db, questionsFile(markId), T0);

    // First in the section quiz (any section) and in the review.
    expect((await sectionQuiz(db, 'p', 2)).map((q) => [q.text, q.markId != null])).toEqual([
      ['Why can P(D) be dropped?', true],
      ['When do you need P(D)?', true],
      ['Q2a?', false],
    ]);
    expect(await reviewCount(db, 'p', T0)).toBe(2);
    expect((await reviewQuiz(db, 'p', T0)).map((q) => q.text)).toEqual([
      'Why can P(D) be dropped?',
      'When do you need P(D)?',
    ]);
    // They don't count towards a section's own quiz.
    expect((await quizStates(db, 'p')).map((s) => s.questionCount)).toEqual([2, 1]);

    const [a, b] = await reviewQuiz(db, 'p', T0);
    const R = { kind: 'review' as const };
    await gradeQuestion(db, 'p', a.id, 'got_it', R, T0);
    await gradeQuestion(db, 'p', b.id, 'got_it', R, T0);
    // Graded once: no longer new, back in 7 days even after Got it.
    expect(await reviewCount(db, 'p', days(1))).toBe(0);
    expect((await sectionQuiz(db, 'p', 1)).map((q) => q.text)).toEqual(['Q1a?', 'Q1b?']);
    expect(await reviewCount(db, 'p', days(7))).toBe(2);
    expect((await getMark(db, markId))?.status).toBe('explained');

    await gradeQuestion(db, 'p', a.id, 'got_it', R, days(7));
    expect((await getMark(db, markId))?.status).toBe('explained');
    await gradeQuestion(db, 'p', b.id, 'got_it', R, days(7));
    expect((await getMark(db, markId))?.status).toBe('resolved');
  });
});

describe('progress export', () => {
  it('writes sections, quiz scores, confusions, reading time and missed questions', async () => {
    const { db, markId } = await setup();
    const id = async (text: string) =>
      (await db.first<{ id: number }>('SELECT id FROM items WHERE text = ?', [text]))!.id;
    const qid = async (text: string) =>
      (await db.first<{ id: number }>('SELECT id FROM questions WHERE text = ?', [text]))!.id;
    await setItemDone(db, await id('one-a'), true, new Date('2026-11-13T09:00:00Z'));
    await setItemDone(db, await id('one-b'), true, new Date('2026-11-14T09:00:00Z'));
    const S1 = { kind: 'section' as const, sectionNum: 1 };
    await gradeQuestion(db, 'p', await qid('Q1a?'), 'got_it', S1, T0);
    await gradeQuestion(db, 'p', await qid('Q1b?'), 'partly', S1, T0);
    await db.run(
      "UPDATE sections SET quiz_done_at = '2026-11-15T09:00:00Z', quiz_score = 1.5, quiz_total = 2 WHERE num = 1",
    );
    await addReadingTime(db, 'tb', 3 * 3600 + 600);
    await addReadingTime(db, 'pa', 45 * 60);
    expect(markId).toBeGreaterThan(0);

    const p = await planProgress(db, 'p');
    expect(progressMarkdown(p!, T0)).toBe(
      `# Progress: p (exported 2026-11-12)
- 1. One: done 2026-11-15, quiz 1.5/2, confusions 1 open
- 2. Two: not started (0/1 focus items)

Reading time: Books 3h 10m, Papers 45m

Still missing:
- S1 Q2: Q1b?
`,
    );
  });
});

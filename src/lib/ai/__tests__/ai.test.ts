/**
 * @jest-environment node
 */
/// <reference types="jest" />
import { nodeDb } from '../../db/node-db';
import { migrate } from '../../db/schema';
import { importPlanText } from '../../library/import-plan';
import { createMark, getMark } from '../../marks/queries';
import { setItemDone } from '../../plan/queries';
import { flagQuestion, gradeQuestion, reviewQuiz, sectionQuiz } from '../../quiz/queries';
import { makeRunner, spendSummary, type AiConfig } from '../client';
import { explainConfusion } from '../confusion';
import { missingItemPages, savePageTexts } from '../page-text';
import { generateSectionQuestions, sectionNeedsQuestions } from '../section';
import { ensureVariant } from '../variants';

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
---

## 1. One

### Focus
- [ ] Read: one-a [tb p.1-3]

### Questions
1. Q1?
   - [ ] wrong
   - [x] right
   Answer: A.
   Concepts: bayes

## 2. Two

### Focus
- [ ] Read: two-a [tb p.4-5]

### Questions
1. Q2?
   Answer: B.
`;

const T0 = new Date('2026-11-12T10:00:00Z');
const days = (n: number) => new Date(T0.getTime() + n * 86_400_000);
const CFG: AiConfig = { baseUrl: 'https://x/api/v1/', model: 'm', apiKey: 'k', priceInGbp: 1, priceOutGbp: 10 };

/** A fake chat completions endpoint answering with the given JSON values in turn. */
function fakeFetch(replies: unknown[], usage = { prompt_tokens: 1000, completion_tokens: 100 }) {
  const calls: { url: string; body: { model: string; messages: { content: string }[]; response_format: unknown } }[] =
    [];
  const f = (async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const reply = replies.shift();
    return {
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: JSON.stringify(reply) } }], usage }),
    };
  }) as unknown as typeof fetch;
  return { f, calls };
}

async function setup() {
  const db = nodeDb();
  await migrate(db);
  const r = await importPlanText(db, PLAN, T0);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return db;
}
type TestDb = Awaited<ReturnType<typeof setup>>;
const qid = async (db: TestDb, text: string) =>
  (await db.first<{ id: number }>('SELECT id FROM questions WHERE text = ?', [text]))!.id;

const mcq = (text: string, extra: object = {}) => ({
  text,
  options: [
    { text: 'a', correct: false },
    { text: 'b', correct: true },
    { text: 'c', correct: false },
    { text: 'd', correct: false },
  ],
  answer: 'because b',
  hard: false,
  concepts: ['bayes'],
  ...extra,
});

describe('client', () => {
  it('sends a JSON-schema request, logs tokens and cost, and retries once on a bad response', async () => {
    const db = await setup();
    const { f, calls } = fakeFetch([{ nope: 1 }, { ok: true }]);
    const run = makeRunner(db, CFG, { fetch: f });
    const out = await run('test', {
      system: 's',
      user: 'u',
      schemaName: 't',
      schema: {},
      validate: (raw) => ((raw as { ok?: boolean }).ok ? { ok: true } : { error: 'bad' }),
    });
    expect(out).toEqual({ ok: true });
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toBe('https://x/api/v1/chat/completions');
    expect(calls[0].body.model).toBe('m');
    expect(calls[0].body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 't', strict: true },
    });
    // 1000 in at £1/M + 100 out at £10/M = £0.002 per call
    const s = await spendSummary(db);
    expect(s.calls).toBe(2);
    expect(s.failed).toBe(1);
    expect(s.totalGbp).toBeCloseTo(0.004);
  });

  it('gives up after two bad responses', async () => {
    const db = await setup();
    const run = makeRunner(db, CFG, { fetch: fakeFetch([{}, {}]).f });
    await expect(
      run('test', { system: '', user: '', schemaName: 't', schema: {}, validate: () => ({ error: 'bad' }) }),
    ).rejects.toThrow('failed the check twice: bad');
  });

  it('calls onSpendStep each time the estimate passes another £5', async () => {
    const db = await setup();
    const steps: number[] = [];
    // £3 per call: 3M input tokens at £1/M
    const { f } = fakeFetch([{}, {}, {}, {}], { prompt_tokens: 3_000_000, completion_tokens: 0 });
    const run = makeRunner(db, CFG, { fetch: f, onSpendStep: (g) => steps.push(g) });
    const req = { system: '', user: '', schemaName: 't', schema: {}, validate: () => ({}) };
    for (let i = 0; i < 4; i++) await run('test', req);
    expect(steps).toEqual([5, 10]); // after £6 and £12
  });
});

describe('retry variants', () => {
  it('writes a variant after a miss, asks it when the question comes back, and records the attempt on it', async () => {
    const db = await setup();
    const q1 = await qid(db, 'Q1?');
    const { needsVariant } = await gradeQuestion(db, 'p', q1, 'missed', { kind: 'section', sectionNum: 1 }, T0, {
      chosen: 'wrong',
    });
    expect(needsVariant).toBe(true);

    const { f, calls } = fakeFetch([mcq('Q1 reworded?')]);
    expect(await ensureVariant(db, makeRunner(db, CFG, { fetch: f }), q1)).toBe('made');
    expect(calls[0].body.messages[1].content).toContain('They chose: "wrong"');
    expect(await ensureVariant(db, makeRunner(db, CFG, { fetch: f }), q1)).toBe('exists');

    // Carried to section 2, shown as the variant; the variant isn't listed on its own.
    const quiz = await sectionQuiz(db, 'p', 2);
    expect(quiz.map((q) => [q.id, q.text, q.variantId != null, q.generated])).toEqual([
      [q1, 'Q1 reworded?', true, true],
      [await qid(db, 'Q2?'), 'Q2?', false, false],
    ]);
    expect((await sectionQuiz(db, 'p', 1)).map((q) => q.text)).toEqual(['Q1?']);

    await gradeQuestion(db, 'p', q1, 'got_it', { kind: 'section', sectionNum: 2 }, days(1), {
      variantId: quiz[0].variantId,
    });
    const attempt = await db.first<{ question_id: number }>(
      'SELECT question_id FROM attempts ORDER BY id DESC LIMIT 1',
    );
    expect(attempt?.question_id).toBe(quiz[0].variantId);
    // The variant is used up: the review a week later shows the original again.
    expect((await reviewQuiz(db, 'p', days(8))).map((q) => [q.text, q.variantId])).toEqual([['Q1?', null]]);
  });

  it('rejects a variant of the wrong type', async () => {
    const db = await setup();
    const q2 = await qid(db, 'Q2?'); // open question
    const run = makeRunner(db, CFG, { fetch: fakeFetch([mcq('x'), mcq('y')]).f });
    await expect(ensureVariant(db, run, q2)).rejects.toThrow('must be an open question');
  });

  it('flagging a variant removes it and the original is asked instead', async () => {
    const db = await setup();
    const q1 = await qid(db, 'Q1?');
    await gradeQuestion(db, 'p', q1, 'missed', { kind: 'section', sectionNum: 1 }, T0);
    await ensureVariant(db, makeRunner(db, CFG, { fetch: fakeFetch([mcq('V?')]).f }), q1);
    const [v] = await sectionQuiz(db, 'p', 2);
    await flagQuestion(db, v.variantId!);
    expect((await sectionQuiz(db, 'p', 2))[0].text).toBe('Q1?');
  });
});

describe('section questions', () => {
  it('needs the reading done and the page text, then writes questions once with checked page refs', async () => {
    const db = await setup();
    expect(await sectionNeedsQuestions(db, 'p', 1)).toBe(false);
    const item = (await db.first<{ id: number }>("SELECT id FROM items WHERE text = 'one-a'"))!.id;
    await setItemDone(db, item, true, T0);
    expect(await sectionNeedsQuestions(db, 'p', 1)).toBe(true);

    const run0 = makeRunner(db, CFG, { fetch: fakeFetch([]).f });
    expect(await generateSectionQuestions(db, run0, 'p', 1)).toBe('no-text');

    expect(await missingItemPages(db, 'tb', 100)).toEqual([[1, 5]]);
    await savePageTexts(db, 'tb', [
      { page: 1, text: 'Bayes theorem text' },
      { page: 2, text: 'More text' },
    ]);
    expect(await missingItemPages(db, 'tb', 100)).toEqual([[3, 5]]);

    const { f, calls } = fakeFetch([
      {
        questions: [
          mcq('S1 extra a?', { ref_doc: 'tb', ref_page: 2 }),
          mcq('S1 extra b?', { ref_doc: 'tb', ref_page: 9 }), // not a page sent: dropped
        ],
      },
    ]);
    expect(await generateSectionQuestions(db, makeRunner(db, CFG, { fetch: f }), 'p', 1, T0)).toBe(2);
    const prompt = calls[0].body.messages[1].content;
    expect(prompt).toContain('[tb p.1]\nBayes theorem text');
    expect(prompt).toContain('Question: Q1?');
    expect(prompt).toContain('- bayes: no attempts');

    const quiz = await sectionQuiz(db, 'p', 1);
    expect(quiz.map((q) => [q.text, q.refPage, q.generated])).toEqual([
      ['Q1?', null, false],
      ['S1 extra a?', 2, true],
      ['S1 extra b?', null, true],
    ]);
    expect(await sectionNeedsQuestions(db, 'p', 1)).toBe(false);
    expect(await generateSectionQuestions(db, makeRunner(db, CFG, { fetch: f }), 'p', 1)).toBe('done-before');
  });
});

describe('confusion explanations', () => {
  it('stores the explanation and questions, and the mark becomes Explained', async () => {
    const db = await setup();
    const m = await createMark(
      db,
      {
        docId: 'tb',
        kind: 'confused',
        text: 'P(D) drops out',
        rects: [{ page: 2, x: 0, y: 0, w: 1, h: 0.1 }],
        note: 'why?',
      },
      T0,
    );
    await savePageTexts(db, 'tb', [{ page: 2, text: 'Page two text' }]);
    const { f, calls } = fakeFetch([
      {
        explanation: 'It is a constant.',
        questions: [mcq('C a?', { ref_doc: 'tb', ref_page: 2 }), mcq('C b?', { ref_doc: null, ref_page: null })],
      },
    ]);
    await explainConfusion(db, makeRunner(db, CFG, { fetch: f }), m.id);
    expect(calls[0].body.messages[1].content).toContain("The learner's note: why?");
    expect(calls[0].body.messages[1].content).toContain('Page two text');
    const after = await getMark(db, m.id);
    expect(after?.status).toBe('explained');
    expect(after?.explanation).toBe('It is a constant.');
    expect((await reviewQuiz(db, 'p', T0)).map((q) => [q.text, q.markId])).toEqual([
      ['C a?', m.id],
      ['C b?', m.id],
    ]);
  });
});

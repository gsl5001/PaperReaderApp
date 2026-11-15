/// <reference types="jest" />
/// <reference types="node" />
import { readFileSync } from 'fs';
import { join } from 'path';

import { parsePlan } from '../parse';

// The original example from section 2 of learning-planner-design.md (open questions).
const SPEC_EXAMPLE = `---
format: plan/v1
id: bayes-stats-2026
title: Bayesian Statistics for Reading Papers
start: 2026-11-09
slots:
  focus:  { days: [Mon, Wed, Fri], time: "07:00", minutes: 45 }
  listen: { days: [Tue, Thu, Sat], time: "17:30", minutes: 30 }
library:
  - group: Textbooks
    docs:
      - id: think-bayes
        title: Think Bayes (2nd ed.)
        url: https://example.org/think-bayes.pdf
  - group: Papers
    docs:
      - id: gelman-shalizi-2013
        title: Gelman & Shalizi, Philosophy and the practice of Bayesian statistics
---

## 1. Probability refresher

### Focus
- [ ] Read: Ch. 1, conditional probability (40) [think-bayes p.1-24]
- [ ] Do: Ch. 1 exercises (30) [think-bayes p.25-27]

### Listen
- [ ] Listen: NotebookLM audio overview of conditional probability (20)
  - [think-bayes p.1-24]
  - <https://en.wikipedia.org/wiki/Bayes%27_theorem>

### Questions
1. A test is 99% sensitive and 95% specific for a condition with 1% prevalence. What is P(condition | positive)? Show the calculation.
   Answer: (0.99 × 0.01) / (0.99 × 0.01 + 0.05 × 0.99) ≈ 0.167
   Ref: think-bayes p.14
   Concepts: conditional probability, base rates
2. [hard] Why can two people with the same data reach different posteriors, and when does the difference shrink?
   Answer: They used different priors. The difference shrinks as data accumulates, because the likelihood comes to dominate the prior.
   Concepts: priors, likelihood
`;

/** Minimal valid frontmatter + one section, with `body` as the section contents. */
function withBody(body: string, frontmatterExtra = '') {
  return `---
format: plan/v1
id: test-plan
title: Test
start: 2026-11-09
${frontmatterExtra}library:
  - group: Papers
    docs:
      - id: doc-a
        title: Doc A
---

## 1. Section
${body}`;
}

function errorsOf(text: string, known: string[] = []) {
  const r = parsePlan(text, known);
  if (r.ok) throw new Error('expected parse errors');
  return r.errors;
}

describe('spec example', () => {
  const r = parsePlan(SPEC_EXAMPLE);

  it('parses without errors', () => {
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it('reads frontmatter', () => {
    if (!r.ok) return;
    expect(r.plan.id).toBe('bayes-stats-2026');
    expect(r.plan.start).toBe('2026-11-09');
    expect(r.plan.slots.focus).toEqual({ days: ['Mon', 'Wed', 'Fri'], time: '07:00', minutes: 45 });
    expect(r.plan.library.map((g) => g.name)).toEqual(['Textbooks', 'Papers']);
    expect(r.plan.library[0].docs[0].url).toBe('https://example.org/think-bayes.pdf');
    expect(r.plan.library[1].docs[0].url).toBeUndefined();
  });

  it('reads focus items', () => {
    if (!r.ok) return;
    expect(r.plan.sections[0].focus[0]).toMatchObject({
      kind: 'focus',
      type: 'Read',
      text: 'Ch. 1, conditional probability',
      minutes: 40,
      ref: { docId: 'think-bayes', pageFrom: 1, pageTo: 24 },
      optional: false,
      line: 24,
    });
  });

  it('reads listen items and their sources', () => {
    if (!r.ok) return;
    const listen = r.plan.sections[0].listen[0];
    expect(listen.minutes).toBe(20);
    expect(listen.ref).toBeUndefined();
    expect(listen.sources).toEqual([
      { kind: 'doc', ref: { docId: 'think-bayes', pageFrom: 1, pageTo: 24 } },
      { kind: 'url', url: 'https://en.wikipedia.org/wiki/Bayes%27_theorem' },
    ]);
  });

  it('reads questions', () => {
    if (!r.ok) return;
    const [q1, q2] = r.plan.sections[0].questions;
    expect(q1).toMatchObject({
      num: 1,
      hard: false,
      answer: '(0.99 × 0.01) / (0.99 × 0.01 + 0.05 × 0.99) ≈ 0.167',
      ref: { docId: 'think-bayes', page: 14 },
      concepts: ['conditional probability', 'base rates'],
    });
    expect(q2.hard).toBe(true);
    expect(q2.text.startsWith('Why can two people')).toBe(true);
    expect(q2.ref).toBeUndefined();
  });
});

describe('counterfactual-models plan', () => {
  const text = readFileSync(join(__dirname, '../../../../plans/counterfactual-models.plan.md'), 'utf8');
  const r = parsePlan(text);

  it('parses without errors', () => {
    expect(r.ok ? [] : r.errors).toEqual([]);
  });

  it('has the expected counts', () => {
    if (!r.ok) return;
    const items = r.plan.sections.flatMap((s) => [...s.focus, ...s.listen]);
    expect(r.plan.sections).toHaveLength(10);
    expect(items).toHaveLength(45);
    expect(items.filter((i) => i.optional)).toHaveLength(16);
    expect(r.plan.sections.flatMap((s) => s.questions)).toHaveLength(39);
    expect(r.plan.slots).toEqual({});
  });

  it('reads page-less refs, url items and [optional] together', () => {
    if (!r.ok) return;
    const s2 = r.plan.sections[1];
    expect(s2.focus[0].ref).toEqual({ docId: 'pearl-primer' });
    expect(s2.focus[3]).toMatchObject({ ref: { docId: 'peters-elements' }, optional: true, minutes: 120 });
    const demo = r.plan.sections[6].focus[3];
    expect(demo).toMatchObject({ type: 'Do', url: 'https://github.com/biomedia-mira/causal-gen', optional: true });
    // [optional] with no doc ref must not be read as a reference to a doc called "optional"
    const listen = r.plan.sections[0].listen[0];
    expect(listen).toMatchObject({ optional: true, minutes: 20 });
    expect(listen.ref).toBeUndefined();
  });
});

describe('optional slots', () => {
  it('accepts a plan with only listen slots', () => {
    const r = parsePlan(
      withBody('### Focus\n- [ ] Read: x [doc-a]\n', 'slots:\n  listen: { days: [Mon], time: "17:30", minutes: 20 }\n'),
    );
    expect(r.ok && r.plan.slots).toEqual({ listen: { days: ['Mon'], time: '17:30', minutes: 20 } });
  });
});

describe('multiple-choice questions', () => {
  const MC = `### Questions
1. [hard] Which is right?
   - [ ] wrong one
   - [x] right one
   - [X] `;
  it('reads options, the correct one and the explanation', () => {
    const r = parsePlan(
      withBody(`### Questions
1. [hard] Which is right?
   - [ ] wrong one
   - [x] right one
   - [ ] another wrong one
   Answer: Because.
   Concepts: c
2. Open question?
   Answer: Open answer.
`),
    );
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    const [mc, open] = r.plan.sections[0].questions;
    expect(mc).toMatchObject({
      hard: true,
      options: [
        { text: 'wrong one', correct: false },
        { text: 'right one', correct: true },
        { text: 'another wrong one', correct: false },
      ],
      answer: 'Because.',
      concepts: ['c'],
    });
    expect(open.options).toEqual([]);
  });

  it('needs exactly one correct option', () => {
    expect(errorsOf(withBody(MC + 'also right\n   Answer: x\n'))).toEqual([
      { line: 15, message: 'Question 1 must mark exactly one option [x]' },
    ]);
    expect(errorsOf(withBody('### Questions\n1. Q?\n   - [ ] a\n   - [ ] b\n   Answer: x\n'))[0].message).toMatch(/exactly one/);
  });

  it('needs at least two options', () => {
    expect(errorsOf(withBody('### Questions\n1. Q?\n   - [x] a\n   Answer: x\n'))[0].message).toMatch(/at least two/);
  });

  it('options must come before the Answer line', () => {
    expect(errorsOf(withBody('### Questions\n1. Q?\n   Answer: x\n   - [x] a\n'))[0]).toMatchObject({ line: 17 });
  });
});

describe('errors report the right line', () => {
  it('bad item', () => {
    expect(errorsOf(withBody('### Focus\n- [ ] Skim: chapter 1\n'))).toEqual([
      { line: 15, message: expect.stringContaining('Not a valid Focus item') },
    ]);
  });

  it('unknown document', () => {
    expect(errorsOf(withBody('### Focus\n- [ ] Read: x [doc-b p.1-2]\n'))).toEqual([
      { line: 15, message: 'Unknown document "doc-b"' },
    ]);
  });

  it('accepts a document already in the shared library', () => {
    expect(parsePlan(withBody('### Focus\n- [ ] Read: x [doc-b p.1-2]\n'), ['doc-b']).ok).toBe(true);
  });

  it('reversed page range', () => {
    expect(errorsOf(withBody('### Focus\n- [ ] Read: x [doc-a p.9-3]\n'))[0]).toEqual({
      line: 15,
      message: 'Page range 9-3 ends before it starts',
    });
  });

  it('missing Answer line', () => {
    // Reported once, on the line where Answer: was expected
    expect(errorsOf(withBody('### Questions\n1. Why?\n   Concepts: x\n'))).toEqual([
      { line: 16, message: 'Expected an indented "Answer:" line after the question (and after its options)' },
    ]);
  });

  it('question at end of file with no Answer line', () => {
    expect(errorsOf(withBody('### Questions\n1. Why?\n'))).toEqual([
      { line: 15, message: 'Question 1 has no Answer line' },
    ]);
  });

  it('question numbering', () => {
    expect(errorsOf(withBody('### Questions\n2. Why?\n   Answer: because\n'))[0]).toMatchObject({ line: 15 });
  });

  it('Listen item under Focus', () => {
    expect(errorsOf(withBody('### Focus\n- [ ] Listen: x\n'))[0]).toMatchObject({ line: 15 });
  });

  it('sources under a Focus item', () => {
    expect(errorsOf(withBody('### Focus\n- [ ] Read: x\n  - [doc-a]\n'))[0]).toMatchObject({ line: 16 });
  });

  it('text before first section', () => {
    const text = withBody('').replace('## 1. Section', 'Some intro\n\n## 1. Section');
    expect(errorsOf(text)[0]).toMatchObject({ line: 13, message: expect.stringContaining('before the first') });
  });

  it('frontmatter: bad slot time points at the slot line', () => {
    const errs = errorsOf(
      withBody('### Focus\n- [ ] Read: x\n', 'slots:\n  focus: { days: [Mon], time: "7am", minutes: 45 }\n'),
    );
    expect(errs).toEqual([{ line: 7, message: 'slots.focus.time: must be "HH:MM"' }]);
  });

  it('frontmatter: reserved document id', () => {
    const text = withBody('').replace('id: doc-a', 'id: optional');
    expect(errorsOf(text)[0]).toMatchObject({ line: 9, message: expect.stringContaining('reserved') });
  });

  it('frontmatter: YAML syntax error', () => {
    const text = withBody('').replace('title: Test', 'title: [unclosed');
    expect(errorsOf(text)[0].message).toMatch(/^YAML:/);
  });
});

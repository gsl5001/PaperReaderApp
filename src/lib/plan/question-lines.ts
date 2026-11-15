import type { DocRef, PlanQuestion } from './types';

// Numbered questions, shared by plan/v1 (### Questions) and questions/v1 (under ## C<id>):
//
// 1. [hard] Question on one line?
//    - [ ] wrong option            (optional: multiple choice, at least two, exactly one [x])
//    - [x] right option
//    Answer: answer or explanation on one line.
//    Ref: doc-id p.N               (optional)
//    Concepts: one, two            (optional)

const QUESTION = /^(\d+)\. (\[hard\] )?(.+)$/;
const Q_OPTION = /^\s+- \[([ xX])\] (.+)$/;
const Q_ANSWER = /^\s+Answer: (.+)$/;
const Q_REF = /^\s+Ref: ([a-z0-9][a-z0-9-]*) p\.(\d+)$/;
const Q_CONCEPTS = /^\s+Concepts: (.+)$/;

export class QuestionLines {
  private list: PlanQuestion[] = [];
  private last: PlanQuestion | null = null;
  private part: 'answer' | 'extra' = 'extra';
  private all: PlanQuestion[] = [];
  private missingAnswerReported = new Set<PlanQuestion>();

  constructor(
    private err: (line: number, message: string) => void,
    private checkRef: (line: number, ref: DocRef) => void,
  ) {}

  /** Start a new numbered list (a new section or confusion); questions go into `list`. */
  start(list: PlanQuestion[]) {
    this.list = list;
    this.last = null;
  }

  /** Handle one non-blank line inside a question list. */
  line(l: string, lineNo: number) {
    let m: RegExpMatchArray | null;
    if ((m = l.match(QUESTION))) {
      const num = +m[1];
      if (num !== this.list.length + 1) this.err(lineNo, `Expected question ${this.list.length + 1}, found ${num}`);
      this.last = { num, text: m[3].trim(), hard: !!m[2], options: [], answer: '', concepts: [], line: lineNo };
      this.list.push(this.last);
      this.all.push(this.last);
      this.part = 'answer';
      return;
    }
    const q = this.last;
    if (!q) {
      this.err(lineNo, 'Expected a numbered question ("1. ...")');
      return;
    }
    if (this.part === 'answer') {
      if ((m = l.match(Q_OPTION))) {
        q.options.push({ text: m[2].trim(), correct: m[1] !== ' ' });
        return;
      }
      if ((m = l.match(Q_ANSWER))) {
        q.answer = m[1].trim();
        this.part = 'extra';
        if (q.options.length === 1)
          this.err(q.line, `Question ${q.num} has only one option; multiple choice needs at least two`);
        if (q.options.length > 1 && q.options.filter((o) => o.correct).length !== 1)
          this.err(q.line, `Question ${q.num} must mark exactly one option [x]`);
      } else {
        this.err(lineNo, 'Expected an indented "Answer:" line after the question (and after its options)');
        this.missingAnswerReported.add(q);
        this.part = 'extra';
      }
      return;
    }
    if ((m = l.match(Q_REF))) {
      q.ref = { docId: m[1], page: +m[2] };
      this.checkRef(lineNo, { docId: m[1], pageFrom: +m[2], pageTo: +m[2] });
      return;
    }
    if ((m = l.match(Q_CONCEPTS))) {
      q.concepts = m[1]
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      return;
    }
    this.err(lineNo, 'Expected "Ref: doc-id p.N", "Concepts: ..." or the next numbered question');
  }

  /** Report questions that never got an Answer line. */
  finish() {
    for (const q of this.all) {
      if (!q.answer && !this.missingAnswerReported.has(q)) this.err(q.line, `Question ${q.num} has no Answer line`);
    }
  }
}

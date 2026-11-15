import type { Db } from '../db/types';
import type { QuestionOption } from '../plan/types';
import { listPlanItems, quizPendingSections } from '../plan/queries';
import { currentSection } from '../plan/status';
import { unusedVariant } from '../ai/variants';
import { updateMarkResolution } from '../confusions/status';

// Quizzes (design doc sections 6 and 8).
//
// A section quiz holds new confusion questions (first), then questions carried over from an
// earlier quiz, then the section's own questions, leaving out retired and removed ones.
// A review holds new confusion questions (first) and the plan's questions whose 7-day
// repeat is due.
//
// Confusion questions (imported from a questions/v1 file, design doc section 4) are "new"
// until first graded, and come first in whichever quiz or review is taken next. After that,
// whatever the grade, they come back in a review 7 days later until retired. When all of a
// mark's questions are retired, the mark becomes Resolved.
//
// Grading (self-graded Got it / Partly / Missed):
// - Two Got it grades in total retire a question.
// - First time in its own section's quiz: Missed or Partly carries it to the next
//   section's quiz (or, in the last section, to a review 7 days later).
// - When it comes back (carried over, or in a review): whatever the grade, it is
//   scheduled for a review 7 days later.
// A section quiz counts as completed once every question in it has been graded.
//
// Retry variants (src/lib/ai/variants.ts): a question that comes back (carried over or in a
// review) is shown as its unused variant if it has one. The attempt is recorded against the
// variant (with the learner's choice), and the original question is scheduled as usual.
// Questions written by the model (section extras, confusion questions, variants) can be
// flagged as wrong or unclear: a flagged question leaves the quiz.

export type Grade = 'got_it' | 'partly' | 'missed';

export interface QuizQuestion {
  id: number;
  sectionNum: number;
  text: string;
  answer: string;
  hard: boolean;
  refDoc: string | null;
  refPage: number | null;
  concepts: string[];
  /** Multiple-choice options in file order; empty for an open question. */
  options: QuestionOption[];
  /** Asked again: carried over from an earlier quiz, or a due review. */
  repeat: boolean;
  /** The Confused mark this question was written for. */
  markId: number | null;
  /** Shown as this variant (a reworded retry) of the question. Text, options and answer are the variant's. */
  variantId: number | null;
  /** Written by a model rather than the plan file: can be flagged. */
  generated: boolean;
}

export type QuizContext = { kind: 'section'; sectionNum: number } | { kind: 'review' };

const REVIEW_DAYS = 7;
const DAY_MS = 86_400_000;

type QuestionRow = {
  id: number;
  section_num: number;
  text: string;
  answer: string;
  hard: number;
  ref_doc: string | null;
  ref_page: number | null;
  concepts: string | null;
  carry_to: number | null;
  next_due: string | null;
  correct_count: number;
  options: string | null;
  mark_id: number | null;
  source: string;
};

const toQuestion = (r: QuestionRow, repeat: boolean): QuizQuestion => ({
  id: r.id,
  sectionNum: r.section_num,
  text: r.text,
  answer: r.answer,
  hard: !!r.hard,
  refDoc: r.ref_doc,
  refPage: r.ref_page,
  concepts: r.concepts ? JSON.parse(r.concepts) : [],
  options: r.options ? JSON.parse(r.options) : [],
  repeat,
  markId: r.mark_id,
  variantId: null,
  generated: r.source !== 'plan',
});

/** Show a repeat as its unused variant, if there is one. */
async function withVariant(db: Db, q: QuizQuestion): Promise<QuizQuestion> {
  const v = await unusedVariant(db, q.id);
  if (!v) return q;
  return {
    ...q,
    text: v.text,
    answer: v.answer,
    options: v.options ? JSON.parse(v.options) : [],
    variantId: v.id,
    generated: true,
  };
}
const withVariants = (db: Db, list: QuizQuestion[]) => Promise.all(list.map((q) => withVariant(db, q)));

const ACTIVE = 'removed_at IS NULL AND retired_at IS NULL AND variant_of IS NULL';

const NOT_CONFUSION = "source != 'confusion'";

/** Confusion questions that haven't been graded yet. */
async function newConfusionQuestions(db: Db, planId: string): Promise<QuizQuestion[]> {
  const rows = await db.all<QuestionRow>(
    `SELECT * FROM questions WHERE plan_id = ? AND source = 'confusion' AND last_grade IS NULL AND ${ACTIVE}
     ORDER BY mark_id, position`,
    [planId],
  );
  return rows.map((r) => toQuestion(r, false));
}

/**
 * @param withConfusions include new confusion questions (the quiz as taken). Without them,
 *   the list is the section's own quiz, used for its question count and readiness.
 */
export async function sectionQuiz(
  db: Db,
  planId: string,
  sectionNum: number,
  withConfusions = true,
): Promise<QuizQuestion[]> {
  const carried = await db.all<QuestionRow>(
    `SELECT * FROM questions WHERE plan_id = ? AND carry_to = ? AND section_num != ? AND ${NOT_CONFUSION} AND ${ACTIVE}
     ORDER BY section_num, position`,
    [planId, sectionNum, sectionNum],
  );
  const own = await db.all<QuestionRow>(
    `SELECT * FROM questions WHERE plan_id = ? AND section_num = ? AND ${NOT_CONFUSION} AND ${ACTIVE} ORDER BY position`,
    [planId, sectionNum],
  );
  return [
    ...(withConfusions ? await newConfusionQuestions(db, planId) : []),
    ...(await withVariants(
      db,
      carried.map((r) => toQuestion(r, true)),
    )),
    ...own.map((r) => toQuestion(r, false)),
  ];
}

export async function reviewQuiz(db: Db, planId: string, now = new Date()): Promise<QuizQuestion[]> {
  const rows = await db.all<QuestionRow>(
    `SELECT * FROM questions WHERE plan_id = ? AND next_due IS NOT NULL AND next_due <= ? AND ${ACTIVE}
     ORDER BY next_due, section_num, position`,
    [planId, now.toISOString()],
  );
  return [
    ...(await newConfusionQuestions(db, planId)),
    ...(await withVariants(
      db,
      rows.map((r) => toQuestion(r, true)),
    )),
  ];
}

/** Questions in the review: due repeats plus new confusion questions. */
export async function reviewCount(db: Db, planId: string, now = new Date()): Promise<number> {
  const r = await db.first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM questions WHERE plan_id = ? AND ${ACTIVE} AND
     ((next_due IS NOT NULL AND next_due <= ?) OR (source = 'confusion' AND last_grade IS NULL))`,
    [planId, now.toISOString()],
  );
  return r?.n ?? 0;
}

async function nextSectionNum(db: Db, planId: string, sectionNum: number): Promise<number | null> {
  const r = await db.first<{ num: number }>(
    'SELECT num FROM sections WHERE plan_id = ? AND num > ? ORDER BY num LIMIT 1',
    [planId, sectionNum],
  );
  return r?.num ?? null;
}

export async function gradeQuestion(
  db: Db,
  planId: string,
  questionId: number,
  grade: Grade,
  context: QuizContext,
  now = new Date(),
  attempt: { variantId?: number | null; chosen?: string | null } = {},
): Promise<{ needsVariant: boolean }> {
  const q = await db.first<QuestionRow>('SELECT * FROM questions WHERE id = ?', [questionId]);
  if (!q) return { needsVariant: false };
  const ts = now.toISOString();
  await db.run('INSERT INTO attempts (question_id, answered_at, grade, typed_answer) VALUES (?, ?, ?, ?)', [
    attempt.variantId ?? questionId,
    ts,
    grade,
    attempt.chosen ?? null,
  ]);

  const correct = q.correct_count + (grade === 'got_it' ? 1 : 0);
  let carryTo: number | null = null;
  let nextDue: string | null = null;
  let retiredAt: string | null = null;
  const inReview = new Date(now.getTime() + REVIEW_DAYS * DAY_MS).toISOString();

  if (correct >= 2) {
    retiredAt = ts;
  } else {
    const firstTimeInOwnQuiz =
      q.source !== 'confusion' &&
      context.kind === 'section' &&
      context.sectionNum === q.section_num &&
      q.carry_to == null;
    if (firstTimeInOwnQuiz) {
      if (grade !== 'got_it') {
        carryTo = await nextSectionNum(db, planId, q.section_num);
        if (carryTo == null) nextDue = inReview;
      }
    } else {
      nextDue = inReview;
    }
  }
  await db.run(
    'UPDATE questions SET last_grade = ?, correct_count = ?, carry_to = ?, next_due = ?, retired_at = ? WHERE id = ?',
    [grade, correct, carryTo, nextDue, retiredAt, questionId],
  );
  if (q.mark_id != null) await updateMarkResolution(db, q.mark_id);
  // A retry variant is written for questions graded Missed or Partly that will come back.
  return { needsVariant: grade !== 'got_it' && retiredAt == null };
}

/** Flag a model-written question (or variant) as wrong or unclear: it leaves the quiz (design doc section 5). */
export async function flagQuestion(db: Db, questionId: number, now = new Date()): Promise<void> {
  const q = await db.first<{ mark_id: number | null }>('SELECT mark_id FROM questions WHERE id = ?', [questionId]);
  if (!q) return;
  await db.run('UPDATE questions SET flagged = 1, removed_at = ? WHERE id = ?', [now.toISOString(), questionId]);
  if (q.mark_id != null) await updateMarkResolution(db, q.mark_id);
}

const GRADE_VALUE: Record<Grade, number> = { got_it: 1, partly: 0.5, missed: 0 };

/** Score for a set of grades: Got it = 1, Partly = 0.5, Missed = 0. */
export function quizScore(grades: Grade[]): number {
  return grades.reduce((a, g) => a + GRADE_VALUE[g], 0);
}

export async function completeSectionQuiz(
  db: Db,
  planId: string,
  sectionNum: number,
  grades: Grade[],
  now = new Date(),
): Promise<void> {
  await db.run('UPDATE sections SET quiz_done_at = ?, quiz_score = ?, quiz_total = ? WHERE plan_id = ? AND num = ?', [
    now.toISOString(),
    quizScore(grades),
    grades.length,
    planId,
    sectionNum,
  ]);
}

export interface SectionQuizState {
  num: number;
  title: string;
  questionCount: number;
  /** Required Focus items done: the quiz is "ready". */
  ready: boolean;
  /** Can be taken now: ready, or the current or an earlier section (early quizzes are allowed). */
  available: boolean;
  doneAt: string | null;
  score: number | null;
  total: number | null;
}

export async function quizStates(db: Db, planId: string): Promise<SectionQuizState[]> {
  const sections = await db.all<{
    num: number;
    title: string;
    quiz_done_at: string | null;
    quiz_score: number | null;
    quiz_total: number | null;
  }>('SELECT num, title, quiz_done_at, quiz_score, quiz_total FROM sections WHERE plan_id = ? ORDER BY num', [planId]);
  const items = await listPlanItems(db, planId);
  const current = currentSection(items, await quizPendingSections(db, planId));
  const out: SectionQuizState[] = [];
  for (const s of sections) {
    const questionCount = (await sectionQuiz(db, planId, s.num, false)).length;
    const ready = !items.some((i) => i.sectionNum === s.num && i.kind === 'focus' && !i.optional && !i.done);
    out.push({
      num: s.num,
      title: s.title,
      questionCount,
      ready,
      available: questionCount > 0 && (ready || current == null || s.num <= current),
      doneAt: s.quiz_done_at,
      score: s.quiz_score,
      total: s.quiz_total,
    });
  }
  return out;
}

/**
 * After an item is marked done: if that completed its section's required Focus items and
 * the section has an unfinished quiz, return the section so "quiz ready" can be announced.
 */
export async function quizBecameReady(
  db: Db,
  itemId: number,
): Promise<{ planId: string; sectionNum: number; title: string; count: number } | null> {
  const item = await db.first<{ plan_id: string; section_num: number; kind: string; optional: number }>(
    'SELECT plan_id, section_num, kind, optional FROM items WHERE id = ?',
    [itemId],
  );
  if (!item || item.kind !== 'focus' || item.optional) return null;
  const left = await db.first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM items WHERE plan_id = ? AND section_num = ? AND kind = 'focus'
     AND optional = 0 AND done_at IS NULL`,
    [item.plan_id, item.section_num],
  );
  if (left?.n) return null;
  const section = await db.first<{ title: string; quiz_done_at: string | null }>(
    'SELECT title, quiz_done_at FROM sections WHERE plan_id = ? AND num = ?',
    [item.plan_id, item.section_num],
  );
  if (!section || section.quiz_done_at) return null;
  const count = (await sectionQuiz(db, item.plan_id, item.section_num, false)).length;
  return count ? { planId: item.plan_id, sectionNum: item.section_num, title: section.title, count } : null;
}

/** Share correct over each concept's last 5 attempts, Partly counting half (design doc section 5). */
export async function conceptScores(
  db: Db,
  planId: string,
): Promise<Record<string, { score: number; attempts: number }>> {
  const rows = await db.all<{ concepts: string | null; grade: Grade }>(
    `SELECT q.concepts, a.grade FROM attempts a JOIN questions q ON q.id = a.question_id
     WHERE q.plan_id = ? ORDER BY a.answered_at DESC, a.id DESC`,
    [planId],
  );
  const recent: Record<string, Grade[]> = {};
  for (const r of rows) {
    for (const c of r.concepts ? (JSON.parse(r.concepts) as string[]) : []) {
      const list = (recent[c] ??= []);
      if (list.length < 5) list.push(r.grade);
    }
  }
  return Object.fromEntries(
    Object.entries(recent).map(([c, grades]) => [
      c,
      { score: quizScore(grades) / grades.length, attempts: grades.length },
    ]),
  );
}

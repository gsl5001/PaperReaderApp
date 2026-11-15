import type { Db } from '../db/types';
import type { QuestionOption } from '../plan/types';
import type { Runner } from './client';
import { QUESTION_RULES, checkQuestion, describeQuestion, questionSchema, type AiQuestion } from './questions';

// Retry variants (design doc section 5): after a question is graded Missed or Partly, the
// model writes a reworded version. When the question comes back (carried to the next
// section's quiz, or in a review), the unused variant is asked in its place, so the retry
// tests understanding rather than memory of the answer. A variant is used once: grading it
// records the attempt against the variant and schedules the original as usual.

type Row = {
  id: number;
  plan_id: string;
  section_num: number;
  text: string;
  answer: string;
  hard: number;
  ref_doc: string | null;
  ref_page: number | null;
  concepts: string | null;
  options: string | null;
  position: number;
  retired_at: string | null;
  removed_at: string | null;
};

/** The newest variant of a question that hasn't been asked or flagged yet. */
export async function unusedVariant(db: Db, questionId: number): Promise<Row | null> {
  return db.first<Row>(
    `SELECT * FROM questions v WHERE v.variant_of = ? AND v.removed_at IS NULL
     AND NOT EXISTS (SELECT 1 FROM attempts a WHERE a.question_id = v.id) ORDER BY v.id DESC LIMIT 1`,
    [questionId],
  );
}

const SYSTEM = `You write retry questions for a learner using a spaced-repetition quiz app. The learner got a question wrong or only partly right. Write one new question that tests the same idea from a different angle (a new case, new numbers, the reverse direction, or a different consequence) so that remembering the original answer is not enough. Keep the same type: multiple choice with four options if the original has options, otherwise an open question.

${QUESTION_RULES}`;

export async function ensureVariant(db: Db, run: Runner, questionId: number): Promise<'made' | 'exists' | 'skipped'> {
  const q = await db.first<Row>('SELECT * FROM questions WHERE id = ? AND variant_of IS NULL', [questionId]);
  if (!q || q.retired_at || q.removed_at) return 'skipped';
  if (await unusedVariant(db, questionId)) return 'exists';

  const options: QuestionOption[] = q.options ? JSON.parse(q.options) : [];
  const concepts: string[] = q.concepts ? JSON.parse(q.concepts) : [];
  const last = await db.first<{ grade: string; typed_answer: string | null }>(
    `SELECT a.grade, a.typed_answer FROM attempts a JOIN questions x ON x.id = a.question_id
     WHERE x.id = ? OR x.variant_of = ? ORDER BY a.answered_at DESC, a.id DESC LIMIT 1`,
    [questionId, questionId],
  );
  const earlier = await db.all<{ text: string }>('SELECT text FROM questions WHERE variant_of = ?', [questionId]);

  const user = [
    describeQuestion({ text: q.text, options, answer: q.answer }),
    concepts.length ? `Concepts: ${concepts.join(', ')}` : '',
    last ? `The learner's last grade: ${last.grade === 'missed' ? 'Missed' : 'Partly'}.` : '',
    last?.typed_answer ? `They chose: "${last.typed_answer}"` : '',
    earlier.length
      ? `Earlier rewordings (write something different):\n${earlier.map((e) => `- ${e.text}`).join('\n')}`
      : '',
    options.length
      ? 'Write a multiple-choice question with exactly four options.'
      : 'Write an open question with a short answer (options: []).',
  ]
    .filter(Boolean)
    .join('\n\n');

  const v = await run<AiQuestion>('variant', {
    system: SYSTEM,
    user,
    schemaName: 'retry_question',
    schema: questionSchema(false),
    validate: (raw) => {
      const c = checkQuestion(raw);
      if (typeof c === 'string') return { error: c };
      if (!!options.length !== !!c.options.length)
        return {
          error: options.length ? 'the variant must be multiple choice' : 'the variant must be an open question',
        };
      return c;
    },
  });

  await db.run(
    `INSERT INTO questions (plan_id, section_num, text, answer, hard, ref_doc, ref_page, concepts, options,
     source, variant_of, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'claude', ?, ?)`,
    [
      q.plan_id,
      q.section_num,
      v.text,
      v.answer,
      q.hard,
      q.ref_doc,
      q.ref_page,
      q.concepts,
      v.options.length ? JSON.stringify(v.options) : null,
      q.id,
      q.position,
    ],
  );
  return 'made';
}

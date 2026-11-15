import type { Db } from '../db/types';
import { conceptScores } from '../quiz/queries';
import type { Runner } from './client';
import { getPageTexts, joinPages } from './page-text';
import { QUESTION_RULES, checkQuestion, describeQuestion, questionSchema, type AiQuestion } from './questions';

// Section quiz questions (design doc section 5): when a section's required Focus items are
// done, the model writes extra questions from the text of the section's pages, on top of the
// plan's own. Done once per section (sections.ai_questions_at).
//
// The request carries: the pages' text; concept scores (last 5 attempts); questions missed or
// partly right, with the learner's choice; the section's existing questions (to avoid repeats);
// the section's open confusions; and questions the learner flagged as wrong or unclear.

export const EXTRA_QUESTIONS = 3;
const MAX_SOURCE_CHARS = 200_000;

const SYSTEM = `You write quiz questions for one section of a learner's reading plan, from the text of the pages they have just read. They are added to the section's existing questions.

Difficulty by concept score (share right over the last 5 attempts): below 60%, more and simpler questions first; 60–85%, medium; above 85%, fewer and harder questions that ask the learner to apply the idea. Concepts with no score are new: medium.
Mix question types: recall, applying an idea to a new case, and explaining why.
Tag every question with 1–3 concepts. Reuse the concept names given below where they fit, spelled exactly the same.
Give every question a page reference (ref_doc, ref_page) to a page included below where the answer is explained.
Don't repeat or closely paraphrase the existing questions, and avoid the problems in flagged questions.
Mark the hardest question or two with hard: true.

${QUESTION_RULES}`;

export type SectionResult = 'done-before' | 'no-text' | number;

export async function sectionNeedsQuestions(db: Db, planId: string, sectionNum: number): Promise<boolean> {
  const s = await db.first<{ ai_questions_at: string | null; quiz_done_at: string | null }>(
    'SELECT ai_questions_at, quiz_done_at FROM sections WHERE plan_id = ? AND num = ?',
    [planId, sectionNum],
  );
  if (!s || s.ai_questions_at || s.quiz_done_at) return false;
  const left = await db.first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM items WHERE plan_id = ? AND section_num = ? AND kind = 'focus' AND optional = 0
     AND done_at IS NULL`,
    [planId, sectionNum],
  );
  return !left?.n;
}

export async function generateSectionQuestions(
  db: Db,
  run: Runner,
  planId: string,
  sectionNum: number,
  now = new Date(),
): Promise<SectionResult> {
  const section = await db.first<{ title: string; ai_questions_at: string | null; plan_title: string }>(
    `SELECT s.title, s.ai_questions_at, p.title AS plan_title FROM sections s JOIN plans p ON p.id = s.plan_id
     WHERE s.plan_id = ? AND s.num = ?`,
    [planId, sectionNum],
  );
  if (!section) return 'no-text';
  if (section.ai_questions_at) return 'done-before';

  // ----- Source text: the pages of the section's Focus items -----
  const items = await db.all<{ text: string; doc_id: string; page_from: number; page_to: number; title: string }>(
    `SELECT i.text, i.doc_id, i.page_from, i.page_to, d.title FROM items i JOIN documents d ON d.id = i.doc_id
     WHERE i.plan_id = ? AND i.section_num = ? AND i.kind = 'focus' AND i.page_from IS NOT NULL ORDER BY i.position`,
    [planId, sectionNum],
  );
  const allowed = new Map<string, Set<number>>();
  const parts: { header: string; docId: string; pages: { page: number; text: string }[] }[] = [];
  for (const i of items) {
    const pages = (await getPageTexts(db, i.doc_id, i.page_from, i.page_to)).filter((p) => p.text.trim());
    if (!pages.length) continue;
    const set = allowed.get(i.doc_id) ?? new Set<number>();
    pages.forEach((p) => set.add(p.page));
    allowed.set(i.doc_id, set);
    parts.push({ header: `${i.title} (id ${i.doc_id}), for "${i.text}"`, docId: i.doc_id, pages });
  }
  if (!parts.length) return 'no-text';
  const perPart = Math.floor(MAX_SOURCE_CHARS / parts.length);
  const source = parts.map((p) => `### ${p.header}\n${joinPages(p.docId, p.pages, perPart)}`).join('\n\n');

  // ----- History -----
  const existing = await db.all<{ text: string; options: string | null; answer: string; concepts: string | null }>(
    `SELECT text, options, answer, concepts FROM questions WHERE plan_id = ? AND section_num = ? AND removed_at IS NULL
     AND variant_of IS NULL ORDER BY position`,
    [planId, sectionNum],
  );
  const allConcepts = await db.all<{ concepts: string | null }>(
    'SELECT DISTINCT concepts FROM questions WHERE plan_id = ? AND concepts IS NOT NULL',
    [planId],
  );
  const conceptNames = [...new Set(allConcepts.flatMap((r) => JSON.parse(r.concepts!) as string[]))];
  const scores = await conceptScores(db, planId);
  const missed = await db.all<{
    text: string;
    options: string | null;
    answer: string;
    grade: string;
    typed: string | null;
  }>(
    `SELECT q.text, q.options, q.answer, q.last_grade AS grade,
       (SELECT a.typed_answer FROM attempts a JOIN questions x ON x.id = a.question_id
        WHERE x.id = q.id OR x.variant_of = q.id ORDER BY a.answered_at DESC LIMIT 1) AS typed
     FROM questions q WHERE q.plan_id = ? AND q.last_grade IN ('missed', 'partly') AND q.removed_at IS NULL
     AND q.retired_at IS NULL AND q.variant_of IS NULL ORDER BY q.id DESC LIMIT 10`,
    [planId],
  );
  const confusions = await db.all<{ text: string; note: string | null }>(
    `SELECT text, note FROM marks WHERE plan_id = ? AND section_num = ? AND kind = 'confused' AND status = 'open'`,
    [planId, sectionNum],
  );
  const flagged = await db.all<{ text: string }>(
    'SELECT text FROM questions WHERE plan_id = ? AND flagged = 1 ORDER BY id DESC LIMIT 10',
    [planId],
  );

  const user = [
    `Plan: ${section.plan_title}. Section ${sectionNum}: ${section.title}.`,
    `Write ${EXTRA_QUESTIONS} questions.`,
    conceptNames.length
      ? `Concepts and scores:\n${conceptNames
          .map(
            (c) =>
              `- ${c}: ${scores[c] ? `${Math.round(scores[c].score * 100)}% over ${scores[c].attempts}` : 'no attempts'}`,
          )
          .join('\n')}`
      : '',
    existing.length
      ? `Existing questions in this section:\n${existing
          .map((q) =>
            describeQuestion({ text: q.text, options: q.options ? JSON.parse(q.options) : [], answer: q.answer }),
          )
          .join('\n\n')}`
      : '',
    missed.length
      ? `Questions the learner recently missed or got partly right:\n${missed
          .map((q) => `- ${q.text} (${q.grade}${q.typed ? `; they chose "${q.typed}"` : ''})`)
          .join('\n')}`
      : '',
    confusions.length
      ? `Passages the learner marked as confusing in this section:\n${confusions
          .map((c) => `- "${c.text}"${c.note ? ` (note: ${c.note})` : ''}`)
          .join('\n')}`
      : '',
    flagged.length
      ? `Questions the learner flagged as wrong or unclear:\n${flagged.map((f) => `- ${f.text}`).join('\n')}`
      : '',
    `Source text:\n${source}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const questions = await run<AiQuestion[]>('section', {
    system: SYSTEM,
    user,
    schemaName: 'section_questions',
    schema: {
      type: 'object',
      properties: { questions: { type: 'array', items: questionSchema(true) } },
      required: ['questions'],
      additionalProperties: false,
    },
    validate: (raw) => {
      const list = (raw as { questions?: unknown })?.questions;
      if (!Array.isArray(list) || !list.length) return { error: 'no questions' };
      const out: AiQuestion[] = [];
      for (const q of list.slice(0, EXTRA_QUESTIONS)) {
        const c = checkQuestion(q, allowed);
        if (typeof c === 'string') return { error: c };
        out.push(c);
      }
      return out;
    },
  });

  await db.transaction(async () => {
    for (const [i, q] of questions.entries()) {
      await db.run(
        `INSERT INTO questions (plan_id, section_num, text, answer, hard, ref_doc, ref_page, concepts, options, source, position)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'claude', ?)`,
        [
          planId,
          sectionNum,
          q.text,
          q.answer,
          q.hard ? 1 : 0,
          q.refDoc,
          q.refPage,
          q.concepts.length ? JSON.stringify(q.concepts) : null,
          q.options.length ? JSON.stringify(q.options) : null,
          1000 + i,
        ],
      );
    }
    await db.run('UPDATE sections SET ai_questions_at = ? WHERE plan_id = ? AND num = ?', [
      now.toISOString(),
      planId,
      sectionNum,
    ]);
  });
  return questions.length;
}

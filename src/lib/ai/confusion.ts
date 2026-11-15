import { applyConfusionAnswer } from '../confusions/import';
import type { Db } from '../db/types';
import type { Runner } from './client';
import { getPageTexts, joinPages } from './page-text';
import { QUESTION_RULES, checkQuestion, questionSchema, type AiQuestion } from './questions';

// Confusion explanations (design doc sections 4 and 5): marking a passage as Confused asks
// the model for an explanation and 2–3 questions straight away. The result is stored the
// same way as an imported questions/v1 file, and the mark becomes Explained.

const SYSTEM = `You help a learner who marked a passage in their reading as confusing. Explain the point they are stuck on, then write 2 or 3 questions that check whether they now understand it.

The explanation: 2 to 4 plain sentences on one line, aimed at the learner's note if there is one. Use the surrounding page text for context. Don't restate the passage.

${QUESTION_RULES}
- Give a page reference (ref_doc, ref_page) only for a page included below; otherwise null.`;

const MAX_PAGE_CHARS = 30_000;

export async function explainConfusion(db: Db, run: Runner, markId: number): Promise<void> {
  const mark = await db.first<{
    id: number;
    doc_id: string;
    page: number;
    page_end: number;
    kind: string;
    text: string;
    note: string | null;
    plan_id: string | null;
    section_num: number | null;
  }>('SELECT * FROM marks WHERE id = ?', [markId]);
  if (!mark || mark.kind !== 'confused' || mark.plan_id == null || mark.section_num == null) return;

  const ctx = await db.first<{ doc_title: string; plan_title: string; section_title: string }>(
    `SELECT d.title AS doc_title, p.title AS plan_title, s.title AS section_title
     FROM documents d, plans p, sections s WHERE d.id = ? AND p.id = ? AND s.plan_id = p.id AND s.num = ?`,
    [mark.doc_id, mark.plan_id, mark.section_num],
  );
  const pages = await getPageTexts(db, mark.doc_id, mark.page, mark.page_end);
  const allowed = new Map([[mark.doc_id, new Set(pages.map((p) => p.page))]]);

  const user = [
    `Learning plan: ${ctx?.plan_title ?? mark.plan_id}, section ${mark.section_num}: ${ctx?.section_title ?? ''}`,
    `Document: ${ctx?.doc_title ?? mark.doc_id} (id ${mark.doc_id})`,
    `Passage the learner marked as confusing (p.${mark.page}${mark.page_end > mark.page ? `-${mark.page_end}` : ''}):\n"""${mark.text}"""`,
    mark.note ? `The learner's note: ${mark.note}` : 'The learner left no note.',
    pages.length
      ? `Text of the page${pages.length > 1 ? 's' : ''}:\n${joinPages(mark.doc_id, pages, MAX_PAGE_CHARS)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n\n');

  const result = await run<{ explanation: string; questions: AiQuestion[] }>('confusion', {
    system: SYSTEM,
    user,
    schemaName: 'confusion_explanation',
    schema: {
      type: 'object',
      properties: {
        explanation: { type: 'string' },
        questions: { type: 'array', items: questionSchema(true) },
      },
      required: ['explanation', 'questions'],
      additionalProperties: false,
    },
    validate: (raw) => {
      const r = raw as { explanation?: unknown; questions?: unknown };
      const explanation = typeof r?.explanation === 'string' ? r.explanation.replace(/\s*\n\s*/g, ' ').trim() : '';
      if (!explanation) return { error: 'no explanation' };
      if (!Array.isArray(r.questions) || !r.questions.length) return { error: 'no questions' };
      const questions: AiQuestion[] = [];
      for (const q of r.questions.slice(0, 3)) {
        const c = checkQuestion(q, allowed);
        if (typeof c === 'string') return { error: c };
        questions.push(c);
      }
      return { explanation, questions };
    },
  });

  // The mark may have been deleted or resolved while waiting.
  const still = await db.first<{ status: string }>('SELECT status FROM marks WHERE id = ?', [markId]);
  if (!still) return;
  await db.transaction(async () => {
    await applyConfusionAnswer(db, {
      planId: mark.plan_id!,
      sectionNum: mark.section_num!,
      markId,
      explanation: result.explanation,
      questions: result.questions.map((q) => ({
        ...q,
        ref: q.refDoc && q.refPage != null ? { docId: q.refDoc, page: q.refPage } : undefined,
      })),
    });
  });
}

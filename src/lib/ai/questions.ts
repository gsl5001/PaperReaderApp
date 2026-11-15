import type { QuestionOption } from '../plan/types';

// The question shape the model returns, its JSON schema, the check applied to it, and
// the writing rules shared by every prompt (the same rules as the learning-plan-writer skill).

export const QUESTION_RULES = `Question rules:
- The learner answers on a phone, in their head. No question may need pen and paper: no derivations, no multi-step algebra, no arithmetic beyond what is easy mentally.
- Questions should still be hard: test whether the learner can tell apart ideas that are easy to confuse, apply an idea to a new small case, or predict what happens when an assumption changes.
- Prefer multiple choice with exactly four options and exactly one correct. Each wrong option should be a mistake someone who half-understood the reading would actually make. No joke options, no "all of the above", no options that refer to other options by letter or position (options are shuffled). Keep options short.
- An open question (no options) is fine when the answer is a short thing to recall or state.
- "answer" is one or two sentences: for multiple choice, why the right option is right and why the most tempting wrong one is wrong; for an open question, the answer itself.
- Every field is plain text on one line. Write symbols directly (¬, ∪, ≤, μ), never as escape codes or LaTeX.
- Questions must be correct according to the source text. Do not invent claims about a paper.`;

export interface AiQuestion {
  text: string;
  options: QuestionOption[];
  answer: string;
  hard: boolean;
  concepts: string[];
  refDoc: string | null;
  refPage: number | null;
}

const optionSchema = {
  type: 'object',
  properties: { text: { type: 'string' }, correct: { type: 'boolean' } },
  required: ['text', 'correct'],
  additionalProperties: false,
};

/** JSON schema for one question; `withRef` adds a page reference (ref_doc, ref_page, or nulls). */
export function questionSchema(withRef: boolean) {
  const properties: Record<string, object> = {
    text: { type: 'string' },
    options: { type: 'array', items: optionSchema, description: 'Empty for an open question' },
    answer: { type: 'string' },
    hard: { type: 'boolean' },
    concepts: { type: 'array', items: { type: 'string' } },
  };
  if (withRef) {
    properties.ref_doc = { type: ['string', 'null'] };
    properties.ref_page = { type: ['integer', 'null'] };
  }
  return { type: 'object', properties, required: Object.keys(properties), additionalProperties: false };
}

const oneLine = (s: unknown) => (typeof s === 'string' ? s.replace(/\s*\n\s*/g, ' ').trim() : '');

/**
 * Check one question from the model.
 * @param allowedRefs pages a reference may point to, by document; other references are dropped.
 */
export function checkQuestion(raw: unknown, allowedRefs: Map<string, Set<number>> = new Map()): AiQuestion | string {
  if (!raw || typeof raw !== 'object') return 'question is not an object';
  const q = raw as Record<string, unknown>;
  const text = oneLine(q.text);
  const answer = oneLine(q.answer);
  if (!text) return 'question has no text';
  if (!answer) return `"${text}" has no answer`;
  const options = Array.isArray(q.options)
    ? q.options.map((o) => ({ text: oneLine((o as QuestionOption)?.text), correct: !!(o as QuestionOption)?.correct }))
    : [];
  if (options.some((o) => !o.text)) return `"${text}" has an empty option`;
  if (options.length === 1) return `"${text}" has only one option`;
  if (options.length > 6) return `"${text}" has more than six options`;
  if (options.length && options.filter((o) => o.correct).length !== 1)
    return `"${text}" must have exactly one correct option`;
  const concepts = Array.isArray(q.concepts) ? q.concepts.map(oneLine).filter(Boolean) : [];
  let refDoc = typeof q.ref_doc === 'string' ? q.ref_doc : null;
  let refPage = typeof q.ref_page === 'number' && Number.isInteger(q.ref_page) ? q.ref_page : null;
  if (!refDoc || refPage == null || !allowedRefs.get(refDoc)?.has(refPage)) refDoc = refPage = null;
  return { text, options, answer, hard: !!q.hard, concepts, refDoc, refPage };
}

/** A question as text for a prompt, with the right option marked. */
export function describeQuestion(q: { text: string; options: QuestionOption[]; answer: string }): string {
  const lines = [`Question: ${q.text}`];
  for (const o of q.options) lines.push(`  ${o.correct ? '[right]' : '[wrong]'} ${o.text}`);
  lines.push(`Answer: ${q.answer}`);
  return lines.join('\n');
}

import { LineCounter, parseDocument } from 'yaml';
import { z } from 'zod';

import { QuestionLines } from '../plan/question-lines';
import type { DocRef, ParseError, PlanQuestion } from '../plan/types';

// questions/v1 (design doc section 4): Claude's answer to a confusions export.
//
// ---
// format: questions/v1
// plan: bayes-stats-2026
// ---
//
// ## C7
// Explanation: one line.
//
// 1. Question?
//    Answer: ...
//
// The heading may keep the rest of the export's heading ("## C7 · think-bayes p.14 · Section 1").
// Each confusion needs an Explanation line before its questions and at least one question.
// Questions follow the plan/v1 rules (options, Answer, Ref, Concepts).

export interface ConfusionAnswer {
  markId: number;
  explanation: string;
  questions: PlanQuestion[];
  line: number;
}

export interface QuestionsFile {
  planId: string;
  confusions: ConfusionAnswer[];
}

export type QuestionsParseResult = { ok: true; file: QuestionsFile } | { ok: false; errors: ParseError[] };

const frontmatter = z
  .object({
    format: z.literal('questions/v1'),
    plan: z.string().regex(/^[a-z0-9][a-z0-9-]*$/, 'must be lowercase letters, digits and hyphens'),
  })
  .strict();

const HEADING = /^## C(\d+)(?: · .*)?$/;
const EXPLANATION = /^Explanation: (.+)$/;

export function parseQuestionsFile(text: string, knownDocIds: Iterable<string> = []): QuestionsParseResult {
  const errors: ParseError[] = [];
  const err = (line: number, message: string) => errors.push({ line, message });
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  if (lines[0] !== '---')
    return { ok: false, errors: [{ line: 1, message: 'File must start with "---" (YAML frontmatter)' }] };
  const fmEnd = lines.indexOf('---', 1);
  if (fmEnd === -1) return { ok: false, errors: [{ line: 1, message: 'Frontmatter has no closing "---"' }] };

  const lineCounter = new LineCounter();
  const yamlDoc = parseDocument(lines.slice(1, fmEnd).join('\n'), { lineCounter });
  for (const e of yamlDoc.errors) err(lineCounter.linePos(e.pos[0]).line + 1, `YAML: ${e.message.split('\n')[0]}`);
  if (errors.length) return { ok: false, errors };
  const fm = frontmatter.safeParse(yamlDoc.toJS());
  if (!fm.success) {
    for (const issue of fm.error.issues) err(1, `${issue.path.join('.') || 'frontmatter'}: ${issue.message}`);
    return { ok: false, errors };
  }

  const docIds = new Set(knownDocIds);
  const checkRef = (line: number, ref: DocRef) => {
    if (!docIds.has(ref.docId)) err(line, `Unknown document "${ref.docId}"`);
    if (ref.pageFrom !== undefined && ref.pageFrom < 1) err(line, 'Page numbers start at 1');
  };
  const questions = new QuestionLines(err, checkRef);

  const confusions: ConfusionAnswer[] = [];
  let current: ConfusionAnswer | null = null;

  for (let i = fmEnd + 1; i < lines.length; i++) {
    const lineNo = i + 1;
    const l = lines[i].trimEnd();
    if (!l.trim()) continue;
    let m: RegExpMatchArray | null;

    if ((m = l.match(HEADING))) {
      const markId = +m[1];
      if (confusions.some((c) => c.markId === markId)) err(lineNo, `C${markId} appears twice`);
      current = { markId, explanation: '', questions: [], line: lineNo };
      confusions.push(current);
      questions.start(current.questions);
      continue;
    }
    if (!current) {
      err(lineNo, 'Text before the first "## C<number>" heading');
      continue;
    }
    if ((m = l.match(EXPLANATION))) {
      if (current.explanation) err(lineNo, `C${current.markId} has two Explanation lines`);
      else if (current.questions.length) err(lineNo, 'The Explanation line goes before the questions');
      current.explanation = m[1].trim();
      continue;
    }
    questions.line(l, lineNo);
  }
  questions.finish();

  for (const c of confusions) {
    if (!c.explanation) err(c.line, `C${c.markId} has no Explanation line`);
    if (!c.questions.length) err(c.line, `C${c.markId} has no questions`);
  }
  if (!confusions.length) err(fmEnd + 2, 'File has no "## C<number>" sections');

  if (errors.length) return { ok: false, errors: errors.sort((a, b) => a.line - b.line) };
  return { ok: true, file: { planId: fm.data.plan, confusions } };
}

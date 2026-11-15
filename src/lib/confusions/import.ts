import type { Db } from '../db/types';
import type { ParseError, PlanQuestion } from '../plan/types';
import { updateMarkResolution } from './status';
import { parseQuestionsFile } from './parse';

// Import a questions/v1 file (design doc section 4, step 3):
// - Each confusion's explanation is stored on its mark.
// - Its questions join the quiz as source 'confusion', in the mark's plan section.
// - The mark becomes Explained (or stays Resolved if every question it has is retired).
// Re-importing matches a mark's questions by text: matched ones are updated and keep their
// history, new ones are added, and ones no longer in the file leave the quiz (history kept).

export interface QuestionsImportSummary {
  planId: string;
  confusions: number;
  questionsAdded: number;
  questionsMatched: number;
  questionsRemoved: number;
}

export type QuestionsImportResult = { ok: true; summary: QuestionsImportSummary } | { ok: false; errors: ParseError[] };

type MarkRow = { id: number; kind: string; plan_id: string | null; section_num: number | null };

export async function importQuestionsText(db: Db, text: string, now = new Date()): Promise<QuestionsImportResult> {
  const known = await db.all<{ id: string }>('SELECT id FROM documents');
  const parsed = parseQuestionsFile(
    text,
    known.map((d) => d.id),
  );
  if (!parsed.ok) return parsed;
  const { planId, confusions } = parsed.file;

  // Check the marks before changing anything.
  const errors: ParseError[] = [];
  const plan = await db.first<{ id: string }>('SELECT id FROM plans WHERE id = ?', [planId]);
  if (!plan) errors.push({ line: 1, message: `No plan "${planId}" in the app` });
  const marks = new Map<number, MarkRow>();
  for (const c of confusions) {
    const m = await db.first<MarkRow>('SELECT id, kind, plan_id, section_num FROM marks WHERE id = ?', [c.markId]);
    if (!m) errors.push({ line: c.line, message: `C${c.markId}: no such mark (it may have been deleted)` });
    else if (m.kind !== 'confused') errors.push({ line: c.line, message: `C${c.markId} is not a Confused mark` });
    else if (m.plan_id == null || m.section_num == null)
      errors.push({ line: c.line, message: `C${c.markId} is not in a plan section` });
    else if (plan && m.plan_id !== planId)
      errors.push({ line: c.line, message: `C${c.markId} belongs to plan "${m.plan_id}", not "${planId}"` });
    else marks.set(c.markId, m);
  }
  if (errors.length) return { ok: false, errors };

  const summary: QuestionsImportSummary = {
    planId,
    confusions: confusions.length,
    questionsAdded: 0,
    questionsMatched: 0,
    questionsRemoved: 0,
  };

  await db.transaction(async () => {
    for (const c of confusions) {
      const mark = marks.get(c.markId)!;
      const counts = await applyConfusionAnswer(db, {
        planId,
        sectionNum: mark.section_num!,
        markId: c.markId,
        explanation: c.explanation,
        questions: c.questions,
        now,
      });
      summary.questionsAdded += counts.added;
      summary.questionsMatched += counts.matched;
      summary.questionsRemoved += counts.removed;
    }
  });

  return { ok: true, summary };
}

/**
 * Store an explanation and its questions on a Confused mark (from a questions/v1 file or a
 * model response). Questions are matched to the mark's existing ones by text. Not wrapped
 * in a transaction: the caller decides.
 */
export async function applyConfusionAnswer(
  db: Db,
  a: {
    planId: string;
    sectionNum: number;
    markId: number;
    explanation: string;
    questions: Pick<PlanQuestion, 'text' | 'answer' | 'hard' | 'ref' | 'concepts' | 'options'>[];
    now?: Date;
  },
): Promise<{ added: number; matched: number; removed: number }> {
  const ts = (a.now ?? new Date()).toISOString();
  const counts = { added: 0, matched: 0, removed: 0 };
  await db.run('UPDATE marks SET explanation = ? WHERE id = ?', [a.explanation, a.markId]);

  const old = await db.all<{ id: number; text: string; removed_at: string | null }>(
    "SELECT id, text, removed_at FROM questions WHERE mark_id = ? AND source = 'confusion'",
    [a.markId],
  );
  const unmatched = new Set(old);
  for (const [position, q] of a.questions.entries()) {
    const match = [...unmatched].find((o) => o.text === q.text);
    const values = [
      q.answer,
      q.hard ? 1 : 0,
      q.ref?.docId ?? null,
      q.ref?.page ?? null,
      q.concepts.length ? JSON.stringify(q.concepts) : null,
      q.options.length ? JSON.stringify(q.options) : null,
      position,
    ];
    if (match) {
      unmatched.delete(match);
      await db.run(
        `UPDATE questions SET answer = ?, hard = ?, ref_doc = ?, ref_page = ?, concepts = ?, options = ?,
         position = ?, removed_at = NULL WHERE id = ?`,
        [...values, match.id],
      );
      counts.matched++;
    } else {
      await db.run(
        `INSERT INTO questions (answer, hard, ref_doc, ref_page, concepts, options, position,
         plan_id, section_num, mark_id, text, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confusion')`,
        [...values, a.planId, a.sectionNum, a.markId, q.text],
      );
      counts.added++;
    }
  }
  for (const o of unmatched) {
    if (o.removed_at) continue;
    await db.run('UPDATE questions SET removed_at = ? WHERE id = ?', [ts, o.id]);
    counts.removed++;
  }
  await updateMarkResolution(db, a.markId);
  return counts;
}

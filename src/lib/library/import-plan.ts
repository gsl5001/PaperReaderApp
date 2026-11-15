import type { Db } from '../db/types';
import { parsePlan } from '../plan/parse';
import type { ParseError, Plan, PlanItem } from '../plan/types';

export interface ImportSummary {
  planId: string;
  title: string;
  isNew: boolean;
  docsAdded: number;
  docsUpdated: number;
  sections: number;
  itemsAdded: number;
  itemsMatched: number;
  /** Removed from the file but kept because they were done */
  itemsKeptDone: number;
  itemsDeleted: number;
  questionsAdded: number;
  questionsMatched: number;
  /** Removed from the file: out of the quiz, history kept */
  questionsRemoved: number;
}

export type ImportResult = { ok: true; summary: ImportSummary } | { ok: false; errors: ParseError[] };

/** Parse a plan file and import it, using documents already in the library to resolve references. */
export async function importPlanText(db: Db, text: string, now = new Date()): Promise<ImportResult> {
  const known = await db.all<{ id: string }>('SELECT id FROM documents');
  const parsed = parsePlan(
    text,
    known.map((d) => d.id),
  );
  if (!parsed.ok) return parsed;
  return { ok: true, summary: await importPlan(db, parsed.plan, now) };
}

/**
 * Import or re-import a parsed plan (design doc section 9).
 *
 * Re-import rules:
 * - Documents are matched by id. Title, URL and group take the new plan's values;
 *   the attached PDF, reading position and marks are kept.
 * - Sections are matched by number, items by section, kind and text. Matched items keep their done status.
 * - Items no longer in the file are deleted, unless done, in which case they are kept.
 *   A section with no remaining items is deleted.
 * - Plan questions are matched by section and text. Questions no longer in the file
 *   get removed_at set: they leave the quiz, and their attempts are kept.
 */
export async function importPlan(db: Db, plan: Plan, now = new Date()): Promise<ImportSummary> {
  const ts = now.toISOString();
  const summary: ImportSummary = {
    planId: plan.id,
    title: plan.title,
    isNew: false,
    docsAdded: 0,
    docsUpdated: 0,
    sections: plan.sections.length,
    itemsAdded: 0,
    itemsMatched: 0,
    itemsKeptDone: 0,
    itemsDeleted: 0,
    questionsAdded: 0,
    questionsMatched: 0,
    questionsRemoved: 0,
  };

  await db.transaction(async () => {
    // ----- Library -----
    for (const group of plan.library) {
      await db.run('INSERT OR IGNORE INTO groups (name) VALUES (?)', [group.name]);
      const g = await db.first<{ id: number }>('SELECT id FROM groups WHERE name = ?', [group.name]);
      for (const d of group.docs) {
        const existing = await db.first<{ id: string }>('SELECT id FROM documents WHERE id = ?', [d.id]);
        if (existing) {
          await db.run('UPDATE documents SET title = ?, url = ?, group_id = ? WHERE id = ?', [
            d.title,
            d.url ?? null,
            g!.id,
            d.id,
          ]);
          summary.docsUpdated++;
        } else {
          await db.run('INSERT INTO documents (id, group_id, title, url) VALUES (?, ?, ?, ?)', [
            d.id,
            g!.id,
            d.title,
            d.url ?? null,
          ]);
          summary.docsAdded++;
        }
      }
    }

    // ----- Plan -----
    const existingPlan = await db.first<{ id: string }>('SELECT id FROM plans WHERE id = ?', [plan.id]);
    summary.isNew = !existingPlan;
    const slotsJson = plan.slots.focus || plan.slots.listen ? JSON.stringify(plan.slots) : null;
    if (existingPlan) {
      await db.run('UPDATE plans SET title = ?, start = ?, slots_json = ?, imported_at = ? WHERE id = ?', [
        plan.title,
        plan.start,
        slotsJson,
        ts,
        plan.id,
      ]);
    } else {
      await db.run('INSERT INTO plans (id, title, start, slots_json, imported_at) VALUES (?, ?, ?, ?, ?)', [
        plan.id,
        plan.title,
        plan.start,
        slotsJson,
        ts,
      ]);
    }

    // ----- Sections -----
    for (const s of plan.sections) {
      await db.run(
        `INSERT INTO sections (plan_id, num, title) VALUES (?, ?, ?)
         ON CONFLICT (plan_id, num) DO UPDATE SET title = excluded.title`,
        [plan.id, s.num, s.title],
      );
    }

    // ----- Items -----
    type ItemRow = { id: number; section_num: number; kind: string; text: string; done_at: string | null };
    const oldItems = await db.all<ItemRow>(
      'SELECT id, section_num, kind, text, done_at FROM items WHERE plan_id = ? ORDER BY position',
      [plan.id],
    );
    const unmatchedItems = new Set(oldItems);
    const itemKey = (sectionNum: number, kind: string, text: string) => `${sectionNum}\u0000${kind}\u0000${text}`;

    for (const s of plan.sections) {
      const all: PlanItem[] = [...s.focus, ...s.listen];
      for (const [position, item] of all.entries()) {
        const key = itemKey(s.num, item.kind, item.text);
        const match = [...unmatchedItems].find((o) => itemKey(o.section_num, o.kind, o.text) === key);
        const urls = item.url || item.sources.length ? JSON.stringify({ url: item.url ?? null, sources: item.sources }) : null;
        const values = [
          item.type,
          item.minutes ?? null,
          item.ref?.docId ?? null,
          item.ref?.pageFrom ?? null,
          item.ref?.pageTo ?? null,
          urls,
          item.optional ? 1 : 0,
          position,
        ];
        if (match) {
          unmatchedItems.delete(match);
          await db.run(
            `UPDATE items SET type = ?, minutes = ?, doc_id = ?, page_from = ?, page_to = ?, urls = ?,
             optional = ?, position = ? WHERE id = ?`,
            [...values, match.id],
          );
          summary.itemsMatched++;
        } else {
          await db.run(
            `INSERT INTO items (type, minutes, doc_id, page_from, page_to, urls, optional, position,
             plan_id, section_num, kind, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [...values, plan.id, s.num, item.kind, item.text],
          );
          summary.itemsAdded++;
        }
      }
    }
    for (const o of unmatchedItems) {
      if (o.done_at) {
        summary.itemsKeptDone++;
      } else {
        await db.run('DELETE FROM items WHERE id = ?', [o.id]);
        summary.itemsDeleted++;
      }
    }

    // Sections no longer in the file go once they have no items left.
    const fileSections = new Set(plan.sections.map((s) => s.num));
    const oldSections = await db.all<{ num: number }>('SELECT num FROM sections WHERE plan_id = ?', [plan.id]);
    for (const { num } of oldSections) {
      if (fileSections.has(num)) continue;
      const left = await db.first<{ n: number }>('SELECT COUNT(*) AS n FROM items WHERE plan_id = ? AND section_num = ?', [
        plan.id,
        num,
      ]);
      if (!left?.n) await db.run('DELETE FROM sections WHERE plan_id = ? AND num = ?', [plan.id, num]);
    }

    // ----- Plan questions -----
    type QuestionRow = { id: number; section_num: number; text: string; removed_at: string | null };
    const oldQuestions = await db.all<QuestionRow>(
      "SELECT id, section_num, text, removed_at FROM questions WHERE plan_id = ? AND source = 'plan'",
      [plan.id],
    );
    const unmatchedQuestions = new Set(oldQuestions);
    for (const s of plan.sections) {
      for (const [position, q] of s.questions.entries()) {
        const match = [...unmatchedQuestions].find((o) => o.section_num === s.num && o.text === q.text);
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
          unmatchedQuestions.delete(match);
          await db.run(
            `UPDATE questions SET answer = ?, hard = ?, ref_doc = ?, ref_page = ?, concepts = ?, options = ?,
             position = ?, removed_at = NULL WHERE id = ?`,
            [...values, match.id],
          );
          summary.questionsMatched++;
        } else {
          await db.run(
            `INSERT INTO questions (answer, hard, ref_doc, ref_page, concepts, options, position, plan_id, section_num, text, source)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'plan')`,
            [...values, plan.id, s.num, q.text],
          );
          summary.questionsAdded++;
        }
      }
    }
    for (const o of unmatchedQuestions) {
      if (o.removed_at) continue;
      await db.run('UPDATE questions SET removed_at = ? WHERE id = ?', [ts, o.id]);
      summary.questionsRemoved++;
    }
  });

  return summary;
}

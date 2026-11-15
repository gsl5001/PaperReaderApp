import type { Db } from '../db/types';
import type { Source } from './types';
import { groupByStatus, type DocPosition, type ItemStatus, type StatusItem } from './status';

export interface PlanItemRow extends StatusItem {
  planId: string;
  type: string;
  text: string;
  minutes: number | null;
  url: string | null;
  /** A Listen item's NotebookLM sources. */
  sources: Source[];
  docTitle: string | null;
  docHasFile: boolean;
  docUrl: string | null;
}

export interface PlanOverview {
  id: string;
  title: string;
  current: { num: number; title: string } | null;
  counts: Record<ItemStatus, number>;
  total: number;
}

export interface PlanDetail {
  id: string;
  title: string;
  sections: { num: number; title: string }[];
  current: number | null;
  groups: Record<ItemStatus, PlanItemRow[]>;
}

type ItemDbRow = {
  id: number;
  plan_id: string;
  section_num: number;
  kind: 'focus' | 'listen';
  type: string;
  text: string;
  minutes: number | null;
  doc_id: string | null;
  page_from: number | null;
  page_to: number | null;
  urls: string | null;
  optional: number;
  done_at: string | null;
  doc_title: string | null;
  file_path: string | null;
  doc_url: string | null;
};

const ITEM_SELECT = `
  SELECT i.id, i.plan_id, i.section_num, i.kind, i.type, i.text, i.minutes, i.doc_id, i.page_from, i.page_to,
         i.urls, i.optional, i.done_at, d.title AS doc_title, d.file_path, d.url AS doc_url
  FROM items i LEFT JOIN documents d ON d.id = i.doc_id`;

function toItem(r: ItemDbRow): PlanItemRow {
  const urls = r.urls ? (JSON.parse(r.urls) as { url: string | null; sources?: Source[] }) : null;
  return {
    id: r.id,
    planId: r.plan_id,
    sectionNum: r.section_num,
    kind: r.kind,
    type: r.type,
    text: r.text,
    minutes: r.minutes,
    optional: !!r.optional,
    done: !!r.done_at,
    docId: r.doc_id,
    pageFrom: r.page_from,
    pageTo: r.page_to,
    url: urls?.url ?? null,
    sources: urls?.sources ?? [],
    docTitle: r.doc_title,
    docHasFile: !!r.file_path,
    docUrl: r.doc_url,
  };
}

/** Sections with quiz questions whose quiz hasn't been completed. */
export async function quizPendingSections(db: Db, planId: string): Promise<number[]> {
  const rows = await db.all<{ num: number }>(
    `SELECT s.num FROM sections s
     WHERE s.plan_id = ? AND s.quiz_done_at IS NULL
       AND EXISTS (SELECT 1 FROM questions q WHERE q.plan_id = s.plan_id AND q.section_num = s.num
                   AND q.source != 'confusion' AND q.variant_of IS NULL AND q.removed_at IS NULL AND q.retired_at IS NULL)`,
    [planId],
  );
  return rows.map((r) => r.num);
}

async function docPositions(db: Db): Promise<Record<string, DocPosition>> {
  const rows = await db.all<{ id: string; last_page: number | null }>('SELECT id, last_page FROM documents');
  return Object.fromEntries(rows.map((r) => [r.id, { lastPage: r.last_page }]));
}

/** A plan's items in plan order: section, Focus before Listen, then position. */
export async function listPlanItems(db: Db, planId: string): Promise<PlanItemRow[]> {
  const rows = await db.all<ItemDbRow>(
    `${ITEM_SELECT} WHERE i.plan_id = ? ORDER BY i.section_num, CASE i.kind WHEN 'focus' THEN 0 ELSE 1 END, i.position`,
    [planId],
  );
  return rows.map(toItem);
}

export async function listPlanOverviews(db: Db): Promise<PlanOverview[]> {
  const plans = await db.all<{ id: string; title: string }>('SELECT id, title FROM plans ORDER BY imported_at DESC');
  const docs = await docPositions(db);
  const out: PlanOverview[] = [];
  for (const p of plans) {
    const items = await listPlanItems(db, p.id);
    const { current, groups } = groupByStatus(items, docs, await quizPendingSections(db, p.id));
    const section =
      current == null
        ? null
        : await db.first<{ num: number; title: string }>(
            'SELECT num, title FROM sections WHERE plan_id = ? AND num = ?',
            [p.id, current],
          );
    out.push({
      id: p.id,
      title: p.title,
      current: section,
      counts: {
        reading: groups.reading.length,
        due: groups.due.length,
        unread: groups.unread.length,
        read: groups.read.length,
      },
      total: items.length,
    });
  }
  return out;
}

export async function getPlanDetail(db: Db, planId: string): Promise<PlanDetail | null> {
  const plan = await db.first<{ id: string; title: string }>('SELECT id, title FROM plans WHERE id = ?', [planId]);
  if (!plan) return null;
  const sections = await db.all<{ num: number; title: string }>(
    'SELECT num, title FROM sections WHERE plan_id = ? ORDER BY num',
    [planId],
  );
  const { current, groups } = groupByStatus(
    await listPlanItems(db, planId),
    await docPositions(db),
    await quizPendingSections(db, planId),
  );
  return { id: plan.id, title: plan.title, sections, current, groups };
}

export async function getItem(db: Db, itemId: number): Promise<PlanItemRow | null> {
  const r = await db.first<ItemDbRow>(`${ITEM_SELECT} WHERE i.id = ?`, [itemId]);
  return r ? toItem(r) : null;
}

/** Items using this document that aren't done and have a page range: candidates for the "Mark done?" prompt. */
export async function openRangedItemsForDoc(db: Db, docId: string): Promise<PlanItemRow[]> {
  const rows = await db.all<ItemDbRow>(
    `${ITEM_SELECT} WHERE i.doc_id = ? AND i.done_at IS NULL AND i.page_to IS NOT NULL`,
    [docId],
  );
  return rows.map(toItem);
}

export async function setItemDone(db: Db, itemId: number, done: boolean, now = new Date()): Promise<void> {
  await db.run('UPDATE items SET done_at = ? WHERE id = ?', [done ? now.toISOString() : null, itemId]);
}

export async function saveReadingPosition(db: Db, docId: string, page: number, offset: number): Promise<void> {
  await db.run('UPDATE documents SET last_page = ?, last_offset = ? WHERE id = ?', [page, offset, docId]);
}

export async function getReadingPosition(db: Db, docId: string): Promise<{ page: number; offset: number } | null> {
  const r = await db.first<{ last_page: number | null; last_offset: number | null }>(
    'SELECT last_page, last_offset FROM documents WHERE id = ?',
    [docId],
  );
  return r?.last_page != null ? { page: r.last_page, offset: r.last_offset ?? 0 } : null;
}

/**
 * Delete a plan: its sections, items, questions (with their attempts and variants), sessions
 * and slot overrides. Documents, PDFs and marks stay in the library; marks lose their link
 * to the plan.
 */
export async function deletePlan(db: Db, planId: string): Promise<void> {
  await db.transaction(async () => {
    await db.run('DELETE FROM attempts WHERE question_id IN (SELECT id FROM questions WHERE plan_id = ?)', [planId]);
    await db.run('UPDATE questions SET variant_of = NULL WHERE plan_id = ?', [planId]);
    await db.run('DELETE FROM questions WHERE plan_id = ?', [planId]);
    await db.run('UPDATE marks SET plan_id = NULL, section_num = NULL WHERE plan_id = ?', [planId]);
    await db.run('DELETE FROM sessions WHERE plan_id = ?', [planId]);
    await db.run('DELETE FROM slot_overrides WHERE plan_id = ?', [planId]);
    await db.run('DELETE FROM items WHERE plan_id = ?', [planId]);
    await db.run('DELETE FROM sections WHERE plan_id = ?', [planId]);
    await db.run('DELETE FROM plans WHERE id = ?', [planId]);
  });
}

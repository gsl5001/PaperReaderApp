import type { Db } from '../db/types';

export type MarkKind = 'highlight' | 'confused' | 'note';
export type MarkStatus = 'open' | 'explained' | 'resolved';

/** A rectangle as fractions of its page's width and height. */
export interface MarkRect {
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Mark {
  id: number;
  docId: string;
  page: number;
  pageEnd: number;
  kind: MarkKind;
  text: string;
  rects: MarkRect[];
  note: string | null;
  planId: string | null;
  sectionNum: number | null;
  /** Only Confused marks have a status. */
  status: MarkStatus | null;
  explanation: string | null;
  createdAt: string;
}

type MarkRow = {
  id: number;
  doc_id: string;
  page: number;
  page_end: number;
  kind: MarkKind;
  text: string;
  rects_json: string;
  note: string | null;
  plan_id: string | null;
  section_num: number | null;
  status: MarkStatus | null;
  explanation: string | null;
  created_at: string;
};

const toMark = (r: MarkRow): Mark => ({
  id: r.id,
  docId: r.doc_id,
  page: r.page,
  pageEnd: r.page_end,
  kind: r.kind,
  text: r.text,
  rects: JSON.parse(r.rects_json),
  note: r.note,
  planId: r.plan_id,
  sectionNum: r.section_num,
  status: r.status,
  explanation: r.explanation,
  createdAt: r.created_at,
});

/**
 * The plan section a mark belongs to: the section of the reading (item) whose page range
 * covers the mark's start page (design doc section 3). If several readings cover it,
 * prefer the plan the reader was opened from, then a reading that isn't done, then the
 * earliest section.
 */
export async function sectionForPage(
  db: Db,
  docId: string,
  page: number,
  preferPlanId?: string | null,
): Promise<{ planId: string; sectionNum: number } | null> {
  const rows = await db.all<{ plan_id: string; section_num: number; done_at: string | null }>(
    `SELECT plan_id, section_num, done_at FROM items
     WHERE doc_id = ? AND page_from IS NOT NULL AND page_from <= ? AND page_to >= ?`,
    [docId, page, page],
  );
  if (!rows.length) return null;
  rows.sort(
    (a, b) =>
      Number(b.plan_id === preferPlanId) - Number(a.plan_id === preferPlanId) ||
      Number(!b.done_at) - Number(!a.done_at) ||
      a.section_num - b.section_num,
  );
  return { planId: rows[0].plan_id, sectionNum: rows[0].section_num };
}

export async function createMark(
  db: Db,
  m: {
    docId: string;
    kind: MarkKind;
    text: string;
    rects: MarkRect[];
    note?: string | null;
    preferPlanId?: string | null;
  },
  now = new Date(),
): Promise<Mark> {
  const pages = m.rects.map((r) => r.page);
  const page = Math.min(...pages);
  const pageEnd = Math.max(...pages);
  const section = await sectionForPage(db, m.docId, page, m.preferPlanId);
  const r = await db.run(
    `INSERT INTO marks (doc_id, page, page_end, kind, text, rects_json, note, plan_id, section_num, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      m.docId,
      page,
      pageEnd,
      m.kind,
      m.text,
      JSON.stringify(m.rects),
      m.note ?? null,
      section?.planId ?? null,
      section?.sectionNum ?? null,
      m.kind === 'confused' ? 'open' : null,
      now.toISOString(),
    ],
  );
  return (await getMark(db, r.lastInsertRowId))!;
}

export async function getMark(db: Db, id: number): Promise<Mark | null> {
  const r = await db.first<MarkRow>('SELECT * FROM marks WHERE id = ?', [id]);
  return r ? toMark(r) : null;
}

/** A document's marks in reading order. */
export async function listMarks(db: Db, docId: string): Promise<Mark[]> {
  const rows = await db.all<MarkRow>('SELECT * FROM marks WHERE doc_id = ? ORDER BY page, id', [docId]);
  const marks = rows.map(toMark);
  // Within a page, order by the top of the first rectangle.
  return marks.sort((a, b) => a.page - b.page || (a.rects[0]?.y ?? 0) - (b.rects[0]?.y ?? 0));
}

export async function setMarkNote(db: Db, id: number, note: string | null): Promise<void> {
  await db.run('UPDATE marks SET note = ? WHERE id = ?', [note?.trim() ? note.trim() : null, id]);
}

/** Manual resolve / reopen of a Confused mark (design doc section 4). */
export async function setMarkStatus(db: Db, id: number, status: MarkStatus): Promise<void> {
  await db.run("UPDATE marks SET status = ? WHERE id = ? AND kind = 'confused'", [status, id]);
}

export async function deleteMark(db: Db, id: number): Promise<void> {
  await db.run('DELETE FROM marks WHERE id = ?', [id]);
}

export interface MarkWithDoc extends Mark {
  docTitle: string;
  groupId: number;
  groupName: string;
}

/** Every mark in the library, by group, document and reading order (Marks screen). */
export async function listAllMarks(db: Db): Promise<MarkWithDoc[]> {
  const rows = await db.all<MarkRow & { doc_title: string; group_id: number; group_name: string }>(
    `SELECT m.*, d.title AS doc_title, g.id AS group_id, g.name AS group_name
     FROM marks m JOIN documents d ON d.id = m.doc_id JOIN groups g ON g.id = d.group_id
     ORDER BY g.id, d.title, m.page, m.id`,
  );
  return rows.map((r) => ({ ...toMark(r), docTitle: r.doc_title, groupId: r.group_id, groupName: r.group_name }));
}

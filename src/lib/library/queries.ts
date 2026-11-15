import type { Db } from '../db/types';

export interface LibraryDocument {
  id: string;
  title: string;
  url: string | null;
  filePath: string | null;
  lastPage: number | null;
}

export interface LibraryGroup {
  id: number;
  name: string;
  docs: LibraryDocument[];
}

export interface PlanSummary {
  id: string;
  title: string;
  sections: number;
  importedAt: string;
}

/** Groups that have documents, in the order they were first created, each with its documents by title. */
export async function listLibrary(db: Db): Promise<LibraryGroup[]> {
  const rows = await db.all<{
    group_id: number;
    group_name: string;
    id: string;
    title: string;
    url: string | null;
    file_path: string | null;
    last_page: number | null;
  }>(
    `SELECT g.id AS group_id, g.name AS group_name, d.id, d.title, d.url, d.file_path, d.last_page
     FROM documents d JOIN groups g ON g.id = d.group_id
     ORDER BY g.id, d.title COLLATE NOCASE`,
  );
  const groups: LibraryGroup[] = [];
  for (const r of rows) {
    let g = groups[groups.length - 1];
    if (!g || g.id !== r.group_id) {
      g = { id: r.group_id, name: r.group_name, docs: [] };
      groups.push(g);
    }
    g.docs.push({ id: r.id, title: r.title, url: r.url, filePath: r.file_path, lastPage: r.last_page });
  }
  return groups;
}

export async function listPlans(db: Db): Promise<PlanSummary[]> {
  const rows = await db.all<{ id: string; title: string; imported_at: string; sections: number }>(
    `SELECT p.id, p.title, p.imported_at, (SELECT COUNT(*) FROM sections s WHERE s.plan_id = p.id) AS sections
     FROM plans p ORDER BY p.imported_at DESC`,
  );
  return rows.map((r) => ({ id: r.id, title: r.title, sections: r.sections, importedAt: r.imported_at }));
}

export async function getDocument(db: Db, id: string): Promise<LibraryDocument | null> {
  const r = await db.first<{ id: string; title: string; url: string | null; file_path: string | null; last_page: number | null }>(
    'SELECT id, title, url, file_path, last_page FROM documents WHERE id = ?',
    [id],
  );
  return r && { id: r.id, title: r.title, url: r.url, filePath: r.file_path, lastPage: r.last_page };
}

export async function setDocumentFile(db: Db, id: string, filePath: string): Promise<void> {
  await db.run('UPDATE documents SET file_path = ? WHERE id = ?', [filePath, id]);
}

import type { Db } from '../db/types';

// Plain text of PDF pages, extracted by the reader's pdf.js and stored for model requests
// (design doc section 5: "text extracted from the section's pages with PDF.js").

export async function savePageTexts(db: Db, docId: string, pages: { page: number; text: string }[]): Promise<void> {
  for (const p of pages) {
    await db.run(
      'INSERT INTO page_text (doc_id, page, text) VALUES (?, ?, ?) ON CONFLICT (doc_id, page) DO UPDATE SET text = excluded.text',
      [docId, p.page, p.text],
    );
  }
}

export async function getPageTexts(
  db: Db,
  docId: string,
  from: number,
  to: number,
): Promise<{ page: number; text: string }[]> {
  return db.all('SELECT page, text FROM page_text WHERE doc_id = ? AND page BETWEEN ? AND ? ORDER BY page', [
    docId,
    from,
    to,
  ]);
}

/**
 * Pages of a document that plan items cover but whose text isn't stored yet, as ranges.
 * The reader extracts these in the background when the document opens.
 */
export async function missingItemPages(db: Db, docId: string, numPages: number): Promise<[number, number][]> {
  const items = await db.all<{ page_from: number; page_to: number }>(
    'SELECT DISTINCT page_from, page_to FROM items WHERE doc_id = ? AND page_from IS NOT NULL AND page_to IS NOT NULL',
    [docId],
  );
  const stored = new Set(
    (await db.all<{ page: number }>('SELECT page FROM page_text WHERE doc_id = ?', [docId])).map((r) => r.page),
  );
  const want = new Set<number>();
  for (const i of items)
    for (let p = i.page_from; p <= Math.min(i.page_to, numPages); p++) if (!stored.has(p)) want.add(p);
  const pages = [...want].sort((a, b) => a - b);
  const ranges: [number, number][] = [];
  for (const p of pages) {
    const last = ranges.at(-1);
    if (last && p === last[1] + 1) last[1] = p;
    else ranges.push([p, p]);
  }
  return ranges;
}

/** Join page texts for a prompt, keeping the total under `maxChars` by trimming each page evenly. */
export function joinPages(label: string, pages: { page: number; text: string }[], maxChars: number): string {
  const total = pages.reduce((n, p) => n + p.text.length, 0);
  const perPage = total > maxChars ? Math.floor(maxChars / Math.max(1, pages.length)) : Infinity;
  return pages
    .map((p) => `[${label} p.${p.page}]\n${p.text.length > perPage ? p.text.slice(0, perPage) + ' …' : p.text}`)
    .join('\n\n');
}

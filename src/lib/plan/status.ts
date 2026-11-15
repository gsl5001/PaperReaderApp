// Item status within a plan (design doc section 6, Plan screen).
//
//   read     the item is done
//   reading  not done; the reader's saved position in its document is inside the
//            item's page range (for an item with no page range: the document has been opened)
//   due      not done and not reading, in the current section
//   unread   everything else
//
// The current section is the first section, by number, that isn't complete. A section is
// complete when its required (non-optional) Focus items are done and, if it has quiz
// questions, its quiz has been completed (design doc section 8).

export type ItemStatus = 'read' | 'reading' | 'due' | 'unread';

export interface StatusItem {
  id: number;
  sectionNum: number;
  kind: 'focus' | 'listen';
  optional: boolean;
  done: boolean;
  docId: string | null;
  pageFrom: number | null;
  pageTo: number | null;
}

export interface DocPosition {
  lastPage: number | null;
}

/** @param quizPending sections that have quiz questions and whose quiz hasn't been completed */
export function currentSection(items: StatusItem[], quizPending: Iterable<number> = []): number | null {
  const pending = [
    ...items.filter((i) => i.kind === 'focus' && !i.optional && !i.done).map((i) => i.sectionNum),
    ...quizPending,
  ];
  return pending.length ? Math.min(...pending) : null;
}

export function itemStatus(item: StatusItem, current: number | null, docs: Record<string, DocPosition>): ItemStatus {
  if (item.done) return 'read';
  const pos = item.docId ? docs[item.docId] : undefined;
  if (pos?.lastPage != null) {
    const hasRange = item.pageFrom != null && item.pageTo != null;
    if (!hasRange || (pos.lastPage >= item.pageFrom! && pos.lastPage <= item.pageTo!)) return 'reading';
  }
  if (current != null && item.sectionNum === current) return 'due';
  return 'unread';
}

export function groupByStatus<T extends StatusItem>(
  items: T[],
  docs: Record<string, DocPosition>,
  quizPending: Iterable<number> = [],
): { current: number | null; groups: Record<ItemStatus, T[]> } {
  const current = currentSection(items, quizPending);
  const groups: Record<ItemStatus, T[]> = { reading: [], due: [], unread: [], read: [] };
  for (const item of items) groups[itemStatus(item, current, docs)].push(item);
  return { current, groups };
}

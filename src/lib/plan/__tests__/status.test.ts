/// <reference types="jest" />
import { currentSection, groupByStatus, itemStatus, type StatusItem } from '../status';

let nextId = 1;
const item = (p: Partial<StatusItem>): StatusItem => ({
  id: nextId++,
  sectionNum: 1,
  kind: 'focus',
  optional: false,
  done: false,
  docId: null,
  pageFrom: null,
  pageTo: null,
  ...p,
});

describe('currentSection', () => {
  it('is the first section with a required Focus item not done', () => {
    const items = [
      item({ sectionNum: 1, done: true }),
      item({ sectionNum: 1, optional: true }), // optional doesn't hold the section open
      item({ sectionNum: 1, kind: 'listen' }), // nor does Listen
      item({ sectionNum: 2 }),
      item({ sectionNum: 3 }),
    ];
    expect(currentSection(items)).toBe(2);
  });

  it('a section with a pending quiz stays current after its Focus items are done', () => {
    const items = [item({ sectionNum: 1, done: true }), item({ sectionNum: 2 })];
    expect(currentSection(items, [1])).toBe(1);
    expect(currentSection(items, [])).toBe(2);
    expect(currentSection([item({ sectionNum: 1, done: true })], [3])).toBe(3);
  });

  it('is null when every required Focus item is done', () => {
    expect(currentSection([item({ done: true }), item({ optional: true })])).toBeNull();
  });
});

describe('itemStatus', () => {
  const docs = { book: { lastPage: 30 }, unopened: { lastPage: null } };

  it('done items are read, even if the position is inside them', () => {
    expect(itemStatus(item({ done: true, docId: 'book', pageFrom: 25, pageTo: 40 }), 1, docs)).toBe('read');
  });

  it('reading when the saved position is inside the page range', () => {
    expect(itemStatus(item({ sectionNum: 5, docId: 'book', pageFrom: 25, pageTo: 40 }), 1, docs)).toBe('reading');
    expect(itemStatus(item({ docId: 'book', pageFrom: 30, pageTo: 30 }), 1, docs)).toBe('reading');
  });

  it('not reading when the position is outside the range', () => {
    expect(itemStatus(item({ sectionNum: 1, docId: 'book', pageFrom: 1, pageTo: 24 }), 1, docs)).toBe('due');
    expect(itemStatus(item({ sectionNum: 2, docId: 'book', pageFrom: 41, pageTo: 60 }), 1, docs)).toBe('unread');
  });

  it('page-less items are reading once the document has been opened', () => {
    expect(itemStatus(item({ sectionNum: 3, docId: 'book' }), 1, docs)).toBe('reading');
    expect(itemStatus(item({ sectionNum: 3, docId: 'unopened' }), 1, docs)).toBe('unread');
  });

  it('items with no document are due in the current section, else unread', () => {
    expect(itemStatus(item({ sectionNum: 1 }), 1, docs)).toBe('due');
    expect(itemStatus(item({ sectionNum: 2 }), 1, docs)).toBe('unread');
  });

  it('optional and Listen items in the current section are due too', () => {
    expect(itemStatus(item({ optional: true }), 1, docs)).toBe('due');
    expect(itemStatus(item({ kind: 'listen' }), 1, docs)).toBe('due');
  });
});

describe('groupByStatus', () => {
  it('groups a plan', () => {
    const a = item({ sectionNum: 1, done: true });
    const b = item({ sectionNum: 2, docId: 'book', pageFrom: 25, pageTo: 40 });
    const c = item({ sectionNum: 2 });
    const d = item({ sectionNum: 3 });
    const r = groupByStatus([a, b, c, d], { book: { lastPage: 26 } });
    expect(r.current).toBe(2);
    expect(r.groups).toEqual({ read: [a], reading: [b], due: [c], unread: [d] });
  });
});

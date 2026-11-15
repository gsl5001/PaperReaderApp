export type Day = 'Mon' | 'Tue' | 'Wed' | 'Thu' | 'Fri' | 'Sat' | 'Sun';

export interface Slot {
  days: Day[];
  /** "HH:MM", 24-hour */
  time: string;
  minutes: number;
}

export interface LibraryDoc {
  id: string;
  title: string;
  /** Direct PDF link, if any */
  url?: string;
}

export interface LibraryGroup {
  name: string;
  docs: LibraryDoc[];
}

export interface DocRef {
  docId: string;
  /** Absent when the reference has no page range (`[doc-id]`) */
  pageFrom?: number;
  pageTo?: number;
}

export type Source = { kind: 'doc'; ref: DocRef } | { kind: 'url'; url: string };

export type ItemType = 'Read' | 'Watch' | 'Do' | 'Listen';
export type ItemKind = 'focus' | 'listen';

export interface PlanItem {
  kind: ItemKind;
  type: ItemType;
  text: string;
  minutes?: number;
  ref?: DocRef;
  url?: string;
  /** Indented sources under a Listen item, for NotebookLM */
  sources: Source[];
  optional: boolean;
  /** 1-based line number in the plan file */
  line: number;
}

export interface QuestionOption {
  text: string;
  correct: boolean;
}

export interface PlanQuestion {
  num: number;
  text: string;
  hard: boolean;
  /** Multiple-choice options; empty for an open (reveal and self-grade) question. */
  options: QuestionOption[];
  /** For an open question, the answer; for multiple choice, the explanation shown after answering. */
  answer: string;
  ref?: { docId: string; page: number };
  concepts: string[];
  line: number;
}

export interface PlanSection {
  num: number;
  title: string;
  focus: PlanItem[];
  listen: PlanItem[];
  questions: PlanQuestion[];
  line: number;
}

export interface Plan {
  format: 'plan/v1';
  id: string;
  title: string;
  /** "YYYY-MM-DD" */
  start: string;
  slots: { focus?: Slot; listen?: Slot };
  library: LibraryGroup[];
  sections: PlanSection[];
}

export interface ParseError {
  line: number;
  message: string;
}

export type ParseResult = { ok: true; plan: Plan } | { ok: false; errors: ParseError[] };

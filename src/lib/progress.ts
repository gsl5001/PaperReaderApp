import { format } from 'date-fns';

import type { Db } from './db/types';

// Per-plan progress and the two exports for Claude (design doc sections 4 and 8).

const day = (iso: string) => format(new Date(iso), 'yyyy-MM-dd');

// ---------- Reading time ----------

/** Add time spent in the reader to a document (design doc section 3). */
export async function addReadingTime(db: Db, docId: string, secs: number): Promise<void> {
  if (secs <= 0) return;
  await db.run('UPDATE documents SET reading_secs = reading_secs + ? WHERE id = ?', [Math.round(secs), docId]);
}

export function formatDuration(secs: number): string {
  const m = Math.round(secs / 60);
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

// ---------- Stats ----------

export interface ConfusionCounts {
  open: number;
  explained: number;
  resolved: number;
}

export interface SectionProgress {
  num: number;
  title: string;
  requiredDone: number;
  required: number;
  hasQuiz: boolean;
  quizDoneAt: string | null;
  quizScore: number | null;
  quizTotal: number | null;
  /** Required Focus items done and, if the section has a quiz, the quiz taken. */
  complete: boolean;
  /** When it became complete: the last of those dates. */
  doneAt: string | null;
  confusions: ConfusionCounts;
}

export interface PlanProgress {
  planId: string;
  title: string;
  sections: SectionProgress[];
  confusions: ConfusionCounts;
  /** Reading time per group, for the documents this plan's items use. */
  readingTime: { group: string; secs: number }[];
  /** Questions whose last grade was Missed or Partly and that are still in the quiz. */
  missing: { label: string; text: string }[];
}

const noConfusions = (): ConfusionCounts => ({ open: 0, explained: 0, resolved: 0 });

export async function planProgress(db: Db, planId: string): Promise<PlanProgress | null> {
  const plan = await db.first<{ id: string; title: string }>('SELECT id, title FROM plans WHERE id = ?', [planId]);
  if (!plan) return null;

  const sections = await db.all<{
    num: number;
    title: string;
    quiz_done_at: string | null;
    quiz_score: number | null;
    quiz_total: number | null;
  }>('SELECT num, title, quiz_done_at, quiz_score, quiz_total FROM sections WHERE plan_id = ? ORDER BY num', [planId]);
  const items = await db.all<{ section_num: number; done_at: string | null }>(
    "SELECT section_num, done_at FROM items WHERE plan_id = ? AND kind = 'focus' AND optional = 0",
    [planId],
  );
  const quizSections = new Set(
    (
      await db.all<{ section_num: number }>(
        "SELECT DISTINCT section_num FROM questions WHERE plan_id = ? AND source != 'confusion' AND variant_of IS NULL AND removed_at IS NULL",
        [planId],
      )
    ).map((r) => r.section_num),
  );
  const marks = await db.all<{ section_num: number | null; status: keyof ConfusionCounts }>(
    "SELECT section_num, status FROM marks WHERE plan_id = ? AND kind = 'confused' AND status IS NOT NULL",
    [planId],
  );

  const confusions = noConfusions();
  for (const m of marks) confusions[m.status]++;

  const out: SectionProgress[] = sections.map((s) => {
    const own = items.filter((i) => i.section_num === s.num);
    const done = own.filter((i) => i.done_at);
    const hasQuiz = quizSections.has(s.num);
    const complete = done.length === own.length && (!hasQuiz || s.quiz_done_at != null);
    const dates = [...done.map((i) => i.done_at!), ...(hasQuiz && s.quiz_done_at ? [s.quiz_done_at] : [])].sort();
    const sectionConfusions = noConfusions();
    for (const m of marks) if (m.section_num === s.num) sectionConfusions[m.status]++;
    return {
      num: s.num,
      title: s.title,
      requiredDone: done.length,
      required: own.length,
      hasQuiz,
      quizDoneAt: s.quiz_done_at,
      quizScore: s.quiz_score,
      quizTotal: s.quiz_total,
      complete,
      doneAt: complete ? (dates.at(-1) ?? null) : null,
      confusions: sectionConfusions,
    };
  });

  const readingTime = await db.all<{ group: string; secs: number }>(
    `SELECT g.name AS "group", SUM(d.reading_secs) AS secs FROM documents d JOIN groups g ON g.id = d.group_id
     WHERE d.id IN (SELECT doc_id FROM items WHERE plan_id = ? AND doc_id IS NOT NULL)
     GROUP BY g.id ORDER BY g.id`,
    [planId],
  );

  const missingRows = await db.all<{
    section_num: number;
    mark_id: number | null;
    position: number;
    text: string;
    source: string;
  }>(
    `SELECT section_num, mark_id, position, text, source FROM questions
     WHERE plan_id = ? AND last_grade IN ('missed', 'partly') AND removed_at IS NULL AND retired_at IS NULL AND variant_of IS NULL
     ORDER BY section_num, mark_id IS NOT NULL, mark_id, position`,
    [planId],
  );
  const missing = missingRows.map((q) => ({
    label:
      q.mark_id != null
        ? `C${q.mark_id} Q${q.position + 1}`
        : q.source === 'claude'
          ? `S${q.section_num} extra ${q.position - 999}`
          : `S${q.section_num} Q${q.position + 1}`,
    text: q.text,
  }));

  return { planId, title: plan.title, sections: out, confusions, readingTime, missing };
}

export function confusionSummary(c: ConfusionCounts): string {
  const parts = (['open', 'explained', 'resolved'] as const).filter((k) => c[k]).map((k) => `${c[k]} ${k}`);
  return parts.join(' / ');
}

// ---------- Progress export (design doc section 8) ----------

export function progressMarkdown(p: PlanProgress, now = new Date()): string {
  const lines = [`# Progress: ${p.planId} (exported ${format(now, 'yyyy-MM-dd')})`];
  for (const s of p.sections) {
    const parts: string[] = [];
    if (s.complete) parts.push(s.doneAt ? `done ${day(s.doneAt)}` : 'done');
    else if (s.requiredDone === s.required && s.hasQuiz) parts.push('reading done, quiz not taken');
    else if (s.requiredDone || s.quizDoneAt) parts.push(`in progress (${s.requiredDone}/${s.required} focus items)`);
    else parts.push(`not started (0/${s.required} focus items)`);
    if (s.quizDoneAt) parts.push(`quiz ${s.quizScore}/${s.quizTotal}`);
    const c = confusionSummary(s.confusions);
    if (c) parts.push(`confusions ${c}`);
    lines.push(`- ${s.num}. ${s.title}: ${parts.join(', ')}`);
  }
  const time = p.readingTime.filter((r) => r.secs > 0);
  lines.push(
    '',
    `Reading time: ${time.length ? time.map((r) => `${r.group} ${formatDuration(r.secs)}`).join(', ') : 'none logged'}`,
  );
  if (p.missing.length) {
    lines.push('', 'Still missing:', ...p.missing.map((q) => `- ${q.label}: ${q.text}`));
  }
  return lines.join('\n') + '\n';
}

// ---------- Confusions export (design doc section 4) ----------

export async function openConfusionCount(db: Db, planId: string, sectionNum?: number): Promise<number> {
  const r = await db.first<{ n: number }>(
    `SELECT COUNT(*) AS n FROM marks WHERE plan_id = ? AND kind = 'confused' AND status = 'open'
     ${sectionNum != null ? 'AND section_num = ?' : ''}`,
    sectionNum != null ? [planId, sectionNum] : [planId],
  );
  return r?.n ?? 0;
}

/** The plan's open confusions as markdown, or null if there are none. */
export async function confusionsMarkdown(db: Db, planId: string, now = new Date()): Promise<string | null> {
  const rows = await db.all<{
    id: number;
    doc_id: string;
    page: number;
    page_end: number;
    text: string;
    note: string | null;
    section_num: number;
  }>(
    `SELECT id, doc_id, page, page_end, text, note, section_num FROM marks
     WHERE plan_id = ? AND kind = 'confused' AND status = 'open' ORDER BY section_num, doc_id, page, id`,
    [planId],
  );
  if (!rows.length) return null;
  const lines = [`# Confusions: ${planId} (exported ${format(now, 'yyyy-MM-dd')})`];
  for (const m of rows) {
    const pages = m.page_end > m.page ? `p.${m.page}-${m.page_end}` : `p.${m.page}`;
    lines.push('', `## C${m.id} · ${m.doc_id} ${pages} · Section ${m.section_num}`);
    for (const t of m.text.split('\n')) if (t.trim()) lines.push(`> ${t.trim()}`);
    if (m.note) lines.push(`Note: ${m.note.replace(/\s*\n\s*/g, ' ')}`);
  }
  return lines.join('\n') + '\n';
}

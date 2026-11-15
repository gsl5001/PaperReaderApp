import { LineCounter, parseDocument } from 'yaml';
import { z } from 'zod';

import type { DocRef, ParseError, ParseResult, Plan, PlanItem, PlanSection, Source } from './types';
import { QuestionLines } from './question-lines';

// ---------- Frontmatter schema ----------

const docId = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, 'must be lowercase letters, digits and hyphens')
  .refine((id) => id !== 'optional', '"optional" is reserved and can\'t be a document id');

const slot = z.object({
  days: z.array(z.enum(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'])).min(1),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'must be "HH:MM"'),
  minutes: z.number().int().positive(),
});

const frontmatter = z.object({
  format: z.literal('plan/v1'),
  id: docId,
  title: z.string().min(1),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be "YYYY-MM-DD"'),
  slots: z.object({ focus: slot.optional(), listen: slot.optional() }).strict().optional(),
  library: z
    .array(
      z.object({
        group: z.string().min(1),
        docs: z.array(z.object({ id: docId, title: z.string().min(1), url: z.url().optional() }).strict()),
      }),
    )
    .default([]),
});

// ---------- Line patterns ----------

const SECTION = /^## (\d+)\. (.+)$/;
const SUBSECTION = /^### (Focus|Listen|Questions)$/;
const REF_BODY = '[a-z0-9][a-z0-9-]*(?: p\\.\\d+-\\d+)?';
// - [ ] Type: description (minutes) [doc-id p.A-B] [optional]
const ITEM = new RegExp(
  '^- \\[ \\] (Read|Watch|Do|Listen): (.+?)' +
    '(?: \\((\\d+)\\))?' +
    `(?: \\[(?!optional\\])(${REF_BODY})\\]| <(https?://[^>\\s]+)>)?` +
    '( \\[optional\\])?$',
);
const SOURCE = new RegExp(`^\\s+- (?:\\[(${REF_BODY})\\]|<(https?://[^>\\s]+)>)$`);

function parseRef(body: string): DocRef {
  const m = body.match(/^([a-z0-9-]+)(?: p\.(\d+)-(\d+))?$/)!;
  return m[2] ? { docId: m[1], pageFrom: +m[2], pageTo: +m[3] } : { docId: m[1] };
}

/**
 * Parse a plan/v1 file.
 *
 * @param knownDocIds document ids already in the app's shared library. A plan
 *   may refer to these without listing them in its own `library`.
 */
export function parsePlan(text: string, knownDocIds: Iterable<string> = []): ParseResult {
  const errors: ParseError[] = [];
  const err = (line: number, message: string) => errors.push({ line, message });
  const lines = text.replace(/\r\n?/g, '\n').split('\n');

  // ----- Frontmatter -----
  if (lines[0] !== '---') {
    return { ok: false, errors: [{ line: 1, message: 'File must start with "---" (YAML frontmatter)' }] };
  }
  const fmEnd = lines.indexOf('---', 1);
  if (fmEnd === -1) {
    return { ok: false, errors: [{ line: 1, message: 'Frontmatter has no closing "---"' }] };
  }

  const lineCounter = new LineCounter();
  const yamlDoc = parseDocument(lines.slice(1, fmEnd).join('\n'), { lineCounter });
  // Frontmatter starts on file line 2.
  const yamlLine = (offset: number | undefined) => (offset === undefined ? 1 : lineCounter.linePos(offset).line + 1);

  for (const e of yamlDoc.errors) err(yamlLine(e.pos[0]), `YAML: ${e.message.split('\n')[0]}`);
  if (yamlDoc.errors.length) return { ok: false, errors };

  const fm = frontmatter.safeParse(yamlDoc.toJS());
  if (!fm.success) {
    for (const issue of fm.error.issues) {
      // Walk up the path until we find a node with a position.
      let line = 1;
      for (let n = issue.path.length; n >= 0; n--) {
        const node = yamlDoc.getIn(issue.path.slice(0, n) as (string | number)[], true) as
          { range?: [number, number, number] } | undefined;
        if (node?.range) {
          line = yamlLine(node.range[0]);
          break;
        }
      }
      err(line, `${issue.path.join('.') || 'frontmatter'}: ${issue.message}`);
    }
    return { ok: false, errors };
  }

  const docIds = new Set<string>(knownDocIds);
  const seenInPlan = new Set<string>();
  for (const group of fm.data.library) {
    for (const d of group.docs) {
      if (seenInPlan.has(d.id)) err(1, `library: document id "${d.id}" is listed twice`);
      seenInPlan.add(d.id);
      docIds.add(d.id);
    }
  }

  const checkRef = (line: number, ref: DocRef) => {
    if (!docIds.has(ref.docId)) err(line, `Unknown document "${ref.docId}"`);
    if (ref.pageFrom !== undefined && ref.pageTo !== undefined) {
      if (ref.pageFrom < 1) err(line, 'Page numbers start at 1');
      if (ref.pageTo < ref.pageFrom) err(line, `Page range ${ref.pageFrom}-${ref.pageTo} ends before it starts`);
    }
  };

  // ----- Body -----
  const sections: PlanSection[] = [];
  let section: PlanSection | null = null;
  type Subsection = 'Focus' | 'Listen' | 'Questions';
  let sub: Subsection | null = null;
  let lastItem: PlanItem | null = null;
  const questions = new QuestionLines(err, checkRef);

  for (let i = fmEnd + 1; i < lines.length; i++) {
    const raw = lines[i];
    const lineNo = i + 1;
    const l = raw.trimEnd();
    if (!l.trim()) continue;

    let m: RegExpMatchArray | null;

    if ((m = l.match(SECTION))) {
      const num = +m[1];
      if (sections.some((s) => s.num === num)) err(lineNo, `Section number ${num} is used twice`);
      section = { num, title: m[2].trim(), focus: [], listen: [], questions: [], line: lineNo };
      sections.push(section);
      sub = null;
      lastItem = null;
      questions.start(section.questions);
      continue;
    }

    if (!section) {
      err(lineNo, 'Text before the first "## N. Title" section heading');
      continue;
    }

    if ((m = l.match(SUBSECTION))) {
      sub = m[1] as Subsection;
      lastItem = null;
      questions.start(section.questions);
      continue;
    }

    if (sub === 'Focus' || sub === 'Listen') {
      if ((m = l.match(ITEM))) {
        const [, type, desc, minutes, refBody, url, optional] = m;
        if (sub === 'Listen' && type !== 'Listen')
          err(lineNo, `Only Listen items go under ### Listen (found "${type}")`);
        if (sub === 'Focus' && type === 'Listen') err(lineNo, 'Listen items go under ### Listen, not ### Focus');
        const item: PlanItem = {
          kind: sub === 'Focus' ? 'focus' : 'listen',
          type: type as PlanItem['type'],
          text: desc.trim(),
          minutes: minutes ? +minutes : undefined,
          ref: refBody ? parseRef(refBody) : undefined,
          url,
          sources: [],
          optional: !!optional,
          line: lineNo,
        };
        if (item.ref) checkRef(lineNo, item.ref);
        (sub === 'Focus' ? section.focus : section.listen).push(item);
        lastItem = item;
        continue;
      }
      if ((m = l.match(SOURCE))) {
        if (!lastItem || lastItem.kind !== 'listen') {
          err(lineNo, 'Indented sources are only allowed under a Listen item');
          continue;
        }
        const source: Source = m[1] ? { kind: 'doc', ref: parseRef(m[1]) } : { kind: 'url', url: m[2] };
        if (source.kind === 'doc') checkRef(lineNo, source.ref);
        lastItem.sources.push(source);
        continue;
      }
      err(lineNo, `Not a valid ${sub} item. Expected "- [ ] Type: description (minutes) [doc-id p.A-B] [optional]"`);
      continue;
    }

    if (sub === 'Questions') {
      questions.line(l, lineNo);
      continue;
    }

    err(lineNo, 'Text outside ### Focus, ### Listen or ### Questions');
  }

  questions.finish();
  if (!sections.length) err(fmEnd + 2, 'Plan has no sections');

  if (errors.length) return { ok: false, errors: errors.sort((a, b) => a.line - b.line) };

  const plan: Plan = {
    format: 'plan/v1',
    id: fm.data.id,
    title: fm.data.title,
    start: fm.data.start,
    slots: fm.data.slots ?? {},
    library: fm.data.library.map((g) => ({ name: g.group, docs: g.docs })),
    sections,
  };
  return { ok: true, plan };
}

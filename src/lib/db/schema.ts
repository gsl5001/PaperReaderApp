import type { Db } from './types';

// Tables from design doc section 9. Each migration runs once, tracked by PRAGMA user_version.
// Columns not in the design doc's table list:
//   items.position, questions.position  order within a section (the queue runs in plan order)
//   items.urls                          JSON {url, sources}: the item's own link and a Listen item's sources
//   questions.removed_at                set when re-importing a plan that no longer has the question;
//                                       removed questions leave the quiz but keep their attempts
//   plans.imported_at
//   sessions.slot_at, sessions.minutes  the slot occurrence a session fills (start_at differs when snoozed)
//   slot_overrides                      Skip today / Snooze on a slot occurrence
//   settings                            app settings as key/value
//   questions.carry_to                  section whose quiz a Missed/Partly question comes back in
//   questions.retired_at                set after two Got it grades
//   sections.quiz_done_at, quiz_score, quiz_total   the section quiz's last completion and score
//   questions.options                   JSON [{text, correct}] for a multiple-choice question, else null
//   ai_calls                            every model request, with tokens and estimated cost in GBP
//   page_text                           plain text of PDF pages, extracted in the reader, for model requests
//   sections.ai_questions_at            when the model wrote extra questions for the section quiz
// questions.variant_of: a reworded retry of another question; it replaces that question when it
// comes back, and is never listed in a quiz on its own.
// sessions.status: scheduled | missed | done. item_ids is a JSON array.
const MIGRATIONS: string[] = [
  `
  CREATE TABLE groups (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL UNIQUE
  );
  CREATE TABLE documents (
    id TEXT PRIMARY KEY,
    group_id INTEGER NOT NULL REFERENCES groups(id),
    title TEXT NOT NULL,
    file_path TEXT,
    url TEXT,
    last_page INTEGER,
    last_offset REAL,
    reading_secs INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE plans (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    start TEXT NOT NULL,
    slots_json TEXT,
    imported_at TEXT NOT NULL
  );
  CREATE TABLE sections (
    plan_id TEXT NOT NULL REFERENCES plans(id),
    num INTEGER NOT NULL,
    title TEXT NOT NULL,
    completed_at TEXT,
    PRIMARY KEY (plan_id, num)
  );
  CREATE TABLE items (
    id INTEGER PRIMARY KEY,
    plan_id TEXT NOT NULL REFERENCES plans(id),
    section_num INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('focus', 'listen')),
    type TEXT NOT NULL,
    text TEXT NOT NULL,
    minutes INTEGER,
    doc_id TEXT,
    page_from INTEGER,
    page_to INTEGER,
    urls TEXT,
    optional INTEGER NOT NULL DEFAULT 0,
    done_at TEXT,
    position INTEGER NOT NULL
  );
  CREATE INDEX items_plan ON items(plan_id, section_num, kind, position);
  CREATE TABLE marks (
    id INTEGER PRIMARY KEY,
    doc_id TEXT NOT NULL REFERENCES documents(id),
    page INTEGER NOT NULL,
    page_end INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('highlight', 'confused', 'note')),
    text TEXT NOT NULL,
    rects_json TEXT NOT NULL,
    note TEXT,
    plan_id TEXT,
    section_num INTEGER,
    status TEXT CHECK (status IN ('open', 'explained', 'resolved')),
    explanation TEXT,
    created_at TEXT NOT NULL
  );
  CREATE INDEX marks_doc ON marks(doc_id, page);
  CREATE TABLE questions (
    id INTEGER PRIMARY KEY,
    plan_id TEXT NOT NULL,
    section_num INTEGER NOT NULL,
    mark_id INTEGER REFERENCES marks(id),
    text TEXT NOT NULL,
    answer TEXT NOT NULL,
    hard INTEGER NOT NULL DEFAULT 0,
    ref_doc TEXT,
    ref_page INTEGER,
    concepts TEXT,
    source TEXT NOT NULL CHECK (source IN ('plan', 'claude', 'confusion')),
    variant_of INTEGER REFERENCES questions(id),
    flagged INTEGER NOT NULL DEFAULT 0,
    last_grade TEXT,
    correct_count INTEGER NOT NULL DEFAULT 0,
    next_due TEXT,
    removed_at TEXT,
    position INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX questions_plan ON questions(plan_id, section_num);
  CREATE TABLE attempts (
    id INTEGER PRIMARY KEY,
    question_id INTEGER NOT NULL REFERENCES questions(id),
    answered_at TEXT NOT NULL,
    grade TEXT NOT NULL CHECK (grade IN ('got_it', 'partly', 'missed')),
    typed_answer TEXT,
    grade_reason TEXT
  );
  CREATE TABLE sessions (
    id INTEGER PRIMARY KEY,
    plan_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    start_at TEXT NOT NULL,
    item_ids TEXT NOT NULL,
    status TEXT NOT NULL
  );
  `,
  // 2: slot scheduling (design doc section 7)
  `
  ALTER TABLE sessions ADD COLUMN slot_at TEXT;
  ALTER TABLE sessions ADD COLUMN minutes INTEGER;
  CREATE INDEX sessions_plan ON sessions(plan_id, status, start_at);
  CREATE TABLE slot_overrides (
    plan_id TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('focus', 'listen')),
    slot_at TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('skip', 'snooze')),
    new_at TEXT,
    PRIMARY KEY (plan_id, kind, slot_at)
  );
  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );
  `,
  // 3: quizzes (design doc section 8)
  `
  ALTER TABLE questions ADD COLUMN carry_to INTEGER;
  ALTER TABLE questions ADD COLUMN retired_at TEXT;
  ALTER TABLE sections ADD COLUMN quiz_done_at TEXT;
  ALTER TABLE sections ADD COLUMN quiz_score REAL;
  ALTER TABLE sections ADD COLUMN quiz_total INTEGER;
  `,
  // 4: multiple-choice questions
  `
  ALTER TABLE questions ADD COLUMN options TEXT;
  `,
  // 5: model requests (design doc section 5)
  `
  CREATE TABLE ai_calls (
    id INTEGER PRIMARY KEY,
    at TEXT NOT NULL,
    feature TEXT NOT NULL,
    model TEXT NOT NULL,
    input_tokens INTEGER NOT NULL,
    output_tokens INTEGER NOT NULL,
    cost_gbp REAL NOT NULL,
    ok INTEGER NOT NULL,
    error TEXT
  );
  CREATE TABLE page_text (
    doc_id TEXT NOT NULL,
    page INTEGER NOT NULL,
    text TEXT NOT NULL,
    PRIMARY KEY (doc_id, page)
  );
  ALTER TABLE sections ADD COLUMN ai_questions_at TEXT;
  CREATE INDEX questions_variant ON questions(variant_of);
  `,
];

export async function migrate(db: Db): Promise<void> {
  await db.exec('PRAGMA foreign_keys = ON');
  const row = await db.first<{ user_version: number }>('PRAGMA user_version');
  const version = row?.user_version ?? 0;
  for (let v = version; v < MIGRATIONS.length; v++) {
    await db.transaction(async () => {
      await db.exec(MIGRATIONS[v]);
      await db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

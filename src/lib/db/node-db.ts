// Test-only Db over Node's built-in sqlite. Not imported by the app.
/// <reference types="node" />
import { DatabaseSync } from 'node:sqlite';

import type { Db, Param } from './types';

export function nodeDb(): Db {
  const db = new DatabaseSync(':memory:');
  return {
    exec: async (sql) => {
      db.exec(sql);
    },
    run: async (sql, params: Param[] = []) => {
      const r = db.prepare(sql).run(...params);
      return { lastInsertRowId: Number(r.lastInsertRowid), changes: Number(r.changes) };
    },
    all: async <T>(sql: string, params: Param[] = []) => db.prepare(sql).all(...params) as T[],
    first: async <T>(sql: string, params: Param[] = []) => (db.prepare(sql).get(...params) as T) ?? null,
    transaction: async (fn) => {
      db.exec('BEGIN');
      try {
        await fn();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  };
}

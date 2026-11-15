export type Param = string | number | null;

/**
 * The database operations the app uses. Implemented over expo-sqlite in the app
 * (./expo.ts) and over Node's built-in sqlite in tests, so data logic can be
 * tested on the laptop.
 */
export interface Db {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: Param[]): Promise<{ lastInsertRowId: number; changes: number }>;
  all<T>(sql: string, params?: Param[]): Promise<T[]>;
  first<T>(sql: string, params?: Param[]): Promise<T | null>;
  /** Runs fn in a transaction; rolls back if it throws. */
  transaction(fn: () => Promise<void>): Promise<void>;
}

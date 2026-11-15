import { useSQLiteContext } from 'expo-sqlite';
import { useMemo } from 'react';

import { expoDb } from './expo';
import type { Db } from './types';

/** The app database. Must be used under <SQLiteProvider> (see src/app/_layout.tsx). */
export function useDb(): Db {
  const sqlite = useSQLiteContext();
  return useMemo(() => expoDb(sqlite), [sqlite]);
}

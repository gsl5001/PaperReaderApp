import type { Db } from './db/types';

export interface Settings {
  /** Notify an hour before a listen session, to give time to generate a NotebookLM audio overview. */
  listenPrepReminder: boolean;
  /** OpenAI-compatible endpoint for model requests (design doc section 5). The key is in secure storage. */
  aiBaseUrl: string;
  aiModel: string;
  /** Estimated price in GBP per million input / output tokens, for the spend estimate. */
  aiPriceInGbp: number;
  aiPriceOutGbp: number;
  /** How many £5 steps of estimated spend have been notified. */
  aiSpendAlertedSteps: number;
}

// gpt-5.4-mini list price $0.75 / $4.50 per million tokens, at £0.75 to the dollar.
const DEFAULTS: Settings = {
  listenPrepReminder: false,
  aiBaseUrl: 'https://elm.edina.ac.uk/api/v1',
  aiModel: 'gpt-5.4-mini',
  aiPriceInGbp: 0.5625,
  aiPriceOutGbp: 3.375,
  aiSpendAlertedSteps: 0,
};

export async function getSettings(db: Db): Promise<Settings> {
  const rows = await db.all<{ key: string; value: string }>('SELECT key, value FROM settings');
  const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)]));
  return { ...DEFAULTS, ...stored };
}

export async function setSetting<K extends keyof Settings>(db: Db, key: K, value: Settings[K]): Promise<void> {
  await db.run(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
    [key, JSON.stringify(value)],
  );
}

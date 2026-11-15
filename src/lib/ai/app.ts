import * as Notifications from 'expo-notifications';
import * as SecureStore from 'expo-secure-store';

import type { Db } from '../db/types';
import { quizBecameReady } from '../quiz/queries';
import { setUpNotifications } from '../schedule/notifications';
import { getSettings } from '../settings';
import { makeRunner, type Runner } from './client';
import { explainConfusion } from './confusion';
import { generateSectionQuestions } from './section';
import { ensureVariant } from './variants';

// App-side wiring for model requests: the API key (secure storage), the £5 spend
// notification, and background calls that never block or break the UI. A failed background
// call leaves things as they were (no variant, mark stays Open, plan questions only); the
// error is in the ai_calls log and shown in Settings.

const KEY = 'aiApiKey';

export async function getApiKey(): Promise<string | null> {
  return SecureStore.getItemAsync(KEY);
}

export async function setApiKey(key: string | null): Promise<void> {
  if (key?.trim()) await SecureStore.setItemAsync(KEY, key.trim());
  else await SecureStore.deleteItemAsync(KEY);
}

async function notifySpend(gbp: number) {
  await setUpNotifications();
  const perm = await Notifications.getPermissionsAsync();
  if (!perm.granted) return;
  await Notifications.scheduleNotificationAsync({
    content: { title: `AI spend passed £${gbp}`, body: 'Estimated from token counts. See Settings for details.' },
    trigger: null,
  });
}

/** A runner for model requests, or null if no API key is set. */
export async function getRunner(db: Db): Promise<Runner | null> {
  const key = await getApiKey().catch(() => null);
  if (!key) return null;
  const s = await getSettings(db);
  return makeRunner(
    db,
    { baseUrl: s.aiBaseUrl, model: s.aiModel, apiKey: key, priceInGbp: s.aiPriceInGbp, priceOutGbp: s.aiPriceOutGbp },
    { onSpendStep: (gbp) => notifySpend(gbp).catch(() => {}) },
  );
}

const quietly = (p: Promise<unknown>) => p.catch((e) => console.warn('AI request failed:', e));

/** After a Missed or Partly grade: write a retry variant in the background. */
export function requestVariant(db: Db, questionId: number): void {
  quietly(getRunner(db).then((run) => run && ensureVariant(db, run, questionId)));
}

/** After an item is ticked: if that made a section's quiz ready, write its extra questions. */
export function afterItemDone(db: Db, itemId: number): void {
  quietly(
    (async () => {
      const ready = await quizBecameReady(db, itemId);
      if (!ready) return;
      const run = await getRunner(db);
      if (run) await generateSectionQuestions(db, run, ready.planId, ready.sectionNum);
    })(),
  );
}

/** Write a section's extra questions now (when the quiz opens and they don't exist yet). */
export async function sectionQuestionsNow(db: Db, planId: string, sectionNum: number): Promise<void> {
  const run = await getRunner(db);
  if (run) await generateSectionQuestions(db, run, planId, sectionNum);
}

/** Ask for an explanation of a Confused mark. Throws on failure (the caller decides whether to show it). */
export async function explainMark(db: Db, markId: number): Promise<boolean> {
  const run = await getRunner(db);
  if (!run) return false;
  await explainConfusion(db, run, markId);
  return true;
}

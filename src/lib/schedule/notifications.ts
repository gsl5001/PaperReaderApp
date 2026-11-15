import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';

import type { Db } from '../db/types';
import { getItem, type PlanItemRow } from '../plan/queries';
import { quizBecameReady } from '../quiz/queries';
import { getSettings } from '../settings';
import { refreshSchedule, upcomingSessions, type StoredSession } from './store';

// Slot notifications (design doc section 7). Only plans with slots get any.
// - At slot start: "Focus · 45 min: <first item>", with Start, Snooze 30 min and Skip today.
//   Listen sessions have Prepare NotebookLM in place of Start.
// - Optional (Settings): a reminder an hour before a listen session, to generate the audio overview.
// - Only the next 14 days are scheduled (the schedule's horizon), and everything is
//   rescheduled whenever the schedule changes or the app opens.
// All actions open the app, which then applies Snooze / Skip; this is the reliable path
// for notification actions in expo-notifications.

export const CHANNEL_ID = 'sessions';
export const ACTION = { start: 'start', snooze: 'snooze', skip: 'skip', prepare: 'prepare' } as const;
const CATEGORY = { focus: 'focus-session', listen: 'listen-session', prep: 'listen-prep' } as const;
const MAX_SCHEDULED = 60; // stay clear of platform limits

export interface SessionNotificationData {
  sessionId: number;
  planId: string;
  kind: 'focus' | 'listen';
  slotAt: string;
  [key: string]: unknown;
}

/** Data on a "quiz ready" notification. */
export interface QuizNotificationData {
  quizPlanId: string;
  quizSection: number;
  [key: string]: unknown;
}

let setUp = false;

export async function setUpNotifications(): Promise<void> {
  if (setUp) return;
  setUp = true;
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
  await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
    name: 'Study sessions',
    importance: AndroidImportance.HIGH,
  });
  const open = { opensAppToForeground: true };
  await Notifications.setNotificationCategoryAsync(CATEGORY.focus, [
    { identifier: ACTION.start, buttonTitle: 'Start', options: open },
    { identifier: ACTION.snooze, buttonTitle: 'Snooze 30 min', options: open },
    { identifier: ACTION.skip, buttonTitle: 'Skip today', options: open },
  ]);
  await Notifications.setNotificationCategoryAsync(CATEGORY.listen, [
    { identifier: ACTION.prepare, buttonTitle: 'Prepare NotebookLM', options: open },
    { identifier: ACTION.snooze, buttonTitle: 'Snooze 30 min', options: open },
    { identifier: ACTION.skip, buttonTitle: 'Skip today', options: open },
  ]);
  await Notifications.setNotificationCategoryAsync(CATEGORY.prep, [
    { identifier: ACTION.prepare, buttonTitle: 'Prepare NotebookLM', options: open },
  ]);
}

function itemLabel(item: PlanItemRow): string {
  const doc = item.docTitle ? item.docTitle.split(/[,(]/)[0].trim() : null;
  return doc ? `${doc}: ${item.text}` : item.text;
}

async function content(db: Db, s: StoredSession) {
  const items = (await Promise.all(s.itemIds.map((id) => getItem(db, id)))).filter((i): i is PlanItemRow => !!i);
  const first = items[0];
  const kindLabel = s.kind === 'focus' ? 'Focus' : 'Listen';
  return {
    title: `${kindLabel} · ${s.minutes} min${first ? `: ${itemLabel(first)}` : ''}`,
    body: items.length > 1 ? `Then: ${items.slice(1).map((i) => i.text).join('; ')}` : undefined,
  };
}

// Calls run one at a time: overlapping runs would each open a transaction.
let queue: Promise<void> = Promise.resolve();

/** Rebuild the schedule and reschedule all notifications. Safe to call often. */
export function syncSchedule(db: Db, now?: Date): Promise<void> {
  const run = queue.then(() => doSync(db, now ?? new Date()));
  queue = run.catch(() => {});
  return run;
}

async function doSync(db: Db, now: Date): Promise<void> {
  await refreshSchedule(db, now);
  await setUpNotifications();
  await Notifications.cancelAllScheduledNotificationsAsync();

  const sessions = (await upcomingSessions(db)).filter((s) => new Date(s.startAt) > now);
  if (!sessions.length) return;

  let perm = await Notifications.getPermissionsAsync();
  if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) return;

  const { listenPrepReminder } = await getSettings(db);
  let count = 0;
  for (const s of sessions) {
    if (count >= MAX_SCHEDULED) break;
    const data: SessionNotificationData = { sessionId: s.id, planId: s.planId, kind: s.kind, slotAt: s.slotAt };
    const { title, body } = await content(db, s);
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data, categoryIdentifier: s.kind === 'focus' ? CATEGORY.focus : CATEGORY.listen },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: new Date(s.startAt), channelId: CHANNEL_ID },
    });
    count++;

    const prepAt = new Date(new Date(s.startAt).getTime() - 60 * 60_000);
    if (s.kind === 'listen' && listenPrepReminder && prepAt > now && count < MAX_SCHEDULED) {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: 'Listen session in 1 hour',
          body: 'Prepare the NotebookLM audio overview now so it is ready.',
          data,
          categoryIdentifier: CATEGORY.prep,
        },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: prepAt, channelId: CHANNEL_ID },
      });
      count++;
    }
  }
}

/**
 * Call after an item is marked done. If that finished its section's required Focus items
 * and the section quiz isn't done, notify now: "Section 1 quiz ready (5 questions)"
 * (design doc section 8). Tapping it opens the quiz.
 */
export async function announceQuizReady(db: Db, itemId: number): Promise<void> {
  const ready = await quizBecameReady(db, itemId);
  if (!ready) return;
  await setUpNotifications();
  let perm = await Notifications.getPermissionsAsync();
  if (!perm.granted && perm.canAskAgain) perm = await Notifications.requestPermissionsAsync();
  if (!perm.granted) return;
  const data: QuizNotificationData = { quizPlanId: ready.planId, quizSection: ready.sectionNum };
  await Notifications.scheduleNotificationAsync({
    content: {
      title: `Section ${ready.sectionNum} quiz ready (${ready.count} question${ready.count === 1 ? '' : 's'})`,
      body: ready.title,
      data,
    },
    trigger: null,
  });
}

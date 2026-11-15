import * as Clipboard from 'expo-clipboard';
import * as Notifications from 'expo-notifications';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider, useRouter, type ErrorBoundaryProps } from 'expo-router';
import { SQLiteProvider, type SQLiteDatabase } from 'expo-sqlite';
import { useEffect } from 'react';
import { AppState, Pressable, ScrollView, StyleSheet, useColorScheme } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { expoDb } from '@/lib/db/expo';
import { migrate } from '@/lib/db/schema';
import { useDb } from '@/lib/db/use-db';
import { getItem } from '@/lib/plan/queries';
import {
  ACTION,
  syncSchedule,
  type QuizNotificationData,
  type SessionNotificationData,
} from '@/lib/schedule/notifications';
import { getSession, skipSlot, snoozeSlot } from '@/lib/schedule/store';

async function initDb(db: SQLiteDatabase) {
  await migrate(expoDb(db));
}

export default function RootLayout() {
  const colorScheme = useColorScheme();
  return (
    <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
      <SQLiteProvider databaseName="planner.db" onInit={initDb}>
        <ScheduleSync />
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        </Stack>
      </SQLiteProvider>
    </ThemeProvider>
  );
}

const SNOOZE_MS = 30 * 60_000;

/**
 * Keeps the schedule and notifications current (on start and on return to the
 * foreground) and handles taps on session notifications and their actions.
 */
function ScheduleSync() {
  const db = useDb();
  const router = useRouter();

  useEffect(() => {
    syncSchedule(db).catch(() => {});
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncSchedule(db).catch(() => {});
    });
    return () => sub.remove();
  }, [db]);

  useEffect(() => {
    async function handle(response: Notifications.NotificationResponse) {
      const quiz = response.notification.request.content.data as Partial<QuizNotificationData>;
      if (quiz.quizPlanId && quiz.quizSection != null) {
        await Notifications.dismissNotificationAsync(response.notification.request.identifier).catch(() => {});
        router.push({ pathname: '/quiz', params: { planId: quiz.quizPlanId, section: String(quiz.quizSection) } });
        return;
      }
      const data = response.notification.request.content.data as Partial<SessionNotificationData>;
      if (data.sessionId == null || !data.planId || !data.kind || !data.slotAt) return;
      const action = response.actionIdentifier;
      await Notifications.dismissNotificationAsync(response.notification.request.identifier).catch(() => {});

      if (action === ACTION.snooze) {
        await snoozeSlot(db, data.planId, data.kind, data.slotAt, new Date(Date.now() + SNOOZE_MS));
        await syncSchedule(db);
        router.navigate('/');
        return;
      }
      if (action === ACTION.skip) {
        await skipSlot(db, data.planId, data.kind, data.slotAt);
        await syncSchedule(db);
        router.navigate('/');
        return;
      }
      // Start, Prepare NotebookLM, or a tap on the notification itself.
      const session = await getSession(db, data.sessionId);
      if (!session) {
        router.navigate('/');
        return;
      }
      if (session.kind === 'listen' || action === ACTION.prepare) {
        router.push({ pathname: '/prepare', params: { itemIds: session.itemIds.join(',') } });
        return;
      }
      for (const id of session.itemIds) {
        const item = await getItem(db, id);
        if (item && !item.done && item.docId && item.docHasFile) {
          router.push({ pathname: '/reader/[docId]', params: { docId: item.docId, itemId: String(item.id) } });
          return;
        }
      }
      router.navigate('/');
    }

    // A response that launched the app, then any while it runs.
    const last = Notifications.getLastNotificationResponse();
    if (last) {
      handle(last).finally(() => Notifications.clearLastNotificationResponse());
    }
    const sub = Notifications.addNotificationResponseReceivedListener((r) => {
      handle(r).finally(() => Notifications.clearLastNotificationResponse());
    });
    return () => sub.remove();
  }, [db, router]);

  return null;
}

// Without a dev server, crashes don't reach the laptop. Show the error and
// stack trace on the phone, with a button to copy them (design doc, section 9).
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  const details = `${error.name}: ${error.message}\n\n${error.stack ?? '(no stack trace)'}`;
  return (
    <ThemedView style={styles.container}>
      <SafeAreaView style={styles.safeArea}>
        <ThemedText type="subtitle">Something went wrong</ThemedText>
        <ScrollView style={styles.details}>
          <ThemedText type="code">{details}</ThemedText>
        </ScrollView>
        <Pressable style={styles.button} onPress={() => Clipboard.setStringAsync(details)}>
          <ThemedText type="smallBold">Copy error</ThemedText>
        </Pressable>
        <Pressable style={styles.button} onPress={retry}>
          <ThemedText type="smallBold">Try again</ThemedText>
        </Pressable>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  safeArea: { flex: 1, padding: Spacing.three, gap: Spacing.three },
  details: { flex: 1 },
  button: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: '#888',
    alignItems: 'center',
  },
});

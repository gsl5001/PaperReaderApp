import { Link, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ItemRow, useItemActions } from '@/components/item-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useDb } from '@/lib/db/use-db';
import type { PlanItemRow } from '@/lib/plan/queries';
import { syncSchedule } from '@/lib/schedule/notifications';
import { getToday, skipSlot, snoozeSlot, type TodayPlan, type TodaySession } from '@/lib/schedule/store';

// Today (design doc section 6), one block per plan.
// - Plans with slots: overdue items at the top, then the next focus session and the next
//   listen session, each with its time, items and Start (Prepare NotebookLM for listen),
//   Snooze 30 min and Skip today.
// - Plans without slots: items in progress, the next Focus items and the next Listen item.
// - Both: "Section N quiz ready" and "Review (N)" when there is a quiz to take.

const SNOOZE_MINUTES = 30;

function when(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === now.toDateString()) return `Today ${time}`;
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow ${time}`;
  return `${d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' })} ${time}`;
}

export default function TodayScreen() {
  const db = useDb();
  const router = useRouter();
  const [plans, setPlans] = useState<TodayPlan[] | null>(null);

  const reload = useCallback(async () => {
    setPlans(await getToday(db));
  }, [db]);
  const { open, toggleDone, busyDoc } = useItemActions(db, reload);

  useFocusEffect(
    useCallback(() => {
      // Refresh the schedule first so missed slots and overdue items are up to date.
      syncSchedule(db)
        .catch(() => {})
        .finally(reload);
    }, [db, reload]),
  );

  const row = (item: PlanItemRow, tag?: string) => (
    <ItemRow
      key={item.id}
      item={item}
      tag={tag}
      busy={busyDoc != null && busyDoc === item.docId}
      onToggle={() => toggleDone(item)}
      onOpen={() => open(item)}
    />
  );

  function start(s: TodaySession) {
    const first = s.items[0];
    if (s.session.kind === 'listen') {
      router.push({ pathname: '/prepare', params: { itemIds: s.session.itemIds.join(',') } });
    } else if (first) {
      open(first);
    }
  }

  async function snooze(s: TodaySession) {
    const base = Math.max(Date.now(), new Date(s.session.startAt).getTime());
    await snoozeSlot(db, s.session.planId, s.session.kind, s.session.slotAt, new Date(base + SNOOZE_MINUTES * 60_000));
    await syncSchedule(db);
    await reload();
  }

  function skip(s: TodaySession) {
    Alert.alert('Skip this session?', 'Its items move to the next session.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Skip',
        onPress: async () => {
          await skipSlot(db, s.session.planId, s.session.kind, s.session.slotAt);
          await syncSchedule(db);
          await reload();
        },
      },
    ]);
  }

  function sessionBlock(label: string, s: TodaySession | null, overdueCount: number) {
    if (!s) return null;
    const startLabel = s.session.kind === 'listen' ? 'Prepare NotebookLM' : 'Start';
    const total = s.items.reduce((a, i) => a + (i.minutes ?? 0), 0);
    return (
      <View style={styles.session}>
        <ThemedText type="smallBold">
          {label} · {when(s.session.startAt)} · {s.session.minutes} min
        </ThemedText>
        {s.items.length ? (
          s.items.map((i) => row(i))
        ) : overdueCount ? (
          <ThemedText type="small" themeColor="textSecondary">
            Catching up on the overdue items above.
          </ThemedText>
        ) : null}
        {total > s.session.minutes ? (
          <ThemedText type="small" themeColor="textSecondary">
            This item is longer than the session ({total} min).
          </ThemedText>
        ) : null}
        <View style={styles.actions}>
          <Pressable style={styles.button} onPress={() => start(s)}>
            <ThemedText type="smallBold">{startLabel}</ThemedText>
          </Pressable>
          <Pressable style={styles.button} onPress={() => snooze(s)}>
            <ThemedText type="smallBold">Snooze {SNOOZE_MINUTES} min</ThemedText>
          </Pressable>
          <Pressable style={styles.button} onPress={() => skip(s)}>
            <ThemedText type="smallBold">Skip</ThemedText>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {plans && plans.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            No plans yet. Import one from the Plans tab.
          </ThemedText>
        ) : null}
        {plans?.map((p) => (
          <ThemedView key={p.planId} type="backgroundElement" style={styles.card}>
            <Link href={{ pathname: '/plan/[planId]', params: { planId: p.planId } }} asChild>
              <Pressable>
                <ThemedText type="subtitle" style={styles.cardTitle}>
                  {p.title} ›
                </ThemedText>
              </Pressable>
            </Link>

            {p.ready || p.reviewDue ? (
              <View style={styles.actions}>
                {p.ready ? (
                  <Link
                    href={{ pathname: '/quiz', params: { planId: p.planId, section: String(p.ready.num) } }}
                    asChild>
                    <Pressable style={[styles.button, styles.quizButton]}>
                      <ThemedText type="smallBold">
                        Section {p.ready.num} quiz ready ({p.ready.count})
                      </ThemedText>
                    </Pressable>
                  </Link>
                ) : null}
                {p.reviewDue ? (
                  <Link href={{ pathname: '/quiz', params: { planId: p.planId, review: '1' } }} asChild>
                    <Pressable style={[styles.button, styles.quizButton]}>
                      <ThemedText type="smallBold">Review ({p.reviewDue})</ThemedText>
                    </Pressable>
                  </Link>
                ) : null}
              </View>
            ) : null}

            {p.scheduled ? (
              <>
                {p.overdue.length ? (
                  <View style={styles.session}>
                    <ThemedText type="smallBold">Overdue ({p.overdue.length})</ThemedText>
                    {p.overdue.map((i) => row(i, 'overdue'))}
                  </View>
                ) : null}
                {sessionBlock('Focus', p.nextFocus, p.overdue.length)}
                {sessionBlock('Listen', p.nextListen, 0)}
                {!p.nextFocus && !p.nextListen && !p.overdue.length ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Nothing scheduled in the next two weeks.
                  </ThemedText>
                ) : null}
              </>
            ) : (
              <>
                {p.reading.length ? (
                  <View style={styles.session}>
                    <ThemedText type="smallBold">Reading</ThemedText>
                    {p.reading.map((i) => row(i))}
                  </View>
                ) : null}
                {p.upNext.length ? (
                  <View style={styles.session}>
                    <ThemedText type="smallBold">Up next</ThemedText>
                    {p.upNext.map((i) => row(i))}
                  </View>
                ) : null}
                {p.nextListen ? (
                  <View style={styles.session}>
                    <ThemedText type="smallBold">Listen</ThemedText>
                    {row(p.nextListen)}
                  </View>
                ) : null}
                {!p.reading.length && !p.upNext.length && !p.nextListen ? (
                  <ThemedText type="small" themeColor="textSecondary">
                    Everything in this plan is done.
                  </ThemedText>
                ) : null}
              </>
            )}
          </ThemedView>
        ))}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three },
  card: { padding: Spacing.three, borderRadius: Spacing.two, gap: Spacing.three },
  cardTitle: { fontSize: 20, lineHeight: 26 },
  session: { gap: Spacing.two },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  quizButton: { borderColor: '#208AEF', paddingVertical: Spacing.two },
  button: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: '#888',
  },
});

import { Link, Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View, type ScrollViewInstance } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ItemRow, useItemActions } from '@/components/item-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { Db } from '@/lib/db/types';
import { useDb } from '@/lib/db/use-db';
import { exportConfusions, exportProgress } from '@/lib/exports';
import { deletePlan, getPlanDetail, type PlanDetail, type PlanItemRow } from '@/lib/plan/queries';
import { syncSchedule } from '@/lib/schedule/notifications';
import { confusionSummary, formatDuration, planProgress, type PlanProgress } from '@/lib/progress';
import { quizStates, reviewCount, type SectionQuizState } from '@/lib/quiz/queries';

// A plan's items grouped by status: Reading, Due (the current section), Unread
// (by section) and Read (collapsed). See src/lib/plan/status.ts for the rules.
// Quizzes: the sections whose quiz can be taken now (ready, current or earlier) or has been
// taken, and the due review.
// Progress (design doc section 8): sections done, confusions, reading time per group, and
// the exports for Claude (progress, open confusions).

export default function PlanScreen() {
  const { planId } = useLocalSearchParams<{ planId: string }>();
  const db = useDb();
  const router = useRouter();
  const [plan, setPlan] = useState<PlanDetail | null>(null);
  const [quizzes, setQuizzes] = useState<SectionQuizState[]>([]);
  const [reviewDue, setReviewDue] = useState(0);
  const [progress, setProgress] = useState<PlanProgress | null>(null);
  const [showRead, setShowRead] = useState(false);
  const scroll = useRef<ScrollViewInstance>(null);
  const scrollToRead = useRef(false);
  // The app draws edge-to-edge: keep the last rows clear of the system navigation bar.
  const { bottom } = useSafeAreaInsets();

  const reload = useCallback(async () => {
    setPlan(await getPlanDetail(db, planId));
    setQuizzes(await quizStates(db, planId));
    setReviewDue(await reviewCount(db, planId));
    setProgress(await planProgress(db, planId));
  }, [db, planId]);
  const { open, toggleDone, busyDoc } = useItemActions(db, reload);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  if (!plan) return <ThemedView style={styles.container} />;

  function confirmDelete() {
    Alert.alert(
      `Delete "${plan!.title}"?`,
      'This removes the plan, its items, quiz questions and quiz history, and its scheduled sessions. Documents, PDFs and marks stay in the Library. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deletePlan(db, planId);
            syncSchedule(db).catch(() => {});
            router.back();
          },
        },
      ],
    );
  }

  const sectionTitle = (num: number) => plan.sections.find((s) => s.num === num)?.title ?? '';
  const row = (item: PlanItemRow) => (
    <ItemRow
      key={item.id}
      item={item}
      busy={busyDoc != null && busyDoc === item.docId}
      onToggle={() => toggleDone(item)}
      onOpen={() => open(item)}
    />
  );

  // Unread items, grouped by section
  const unreadBySection = new Map<number, PlanItemRow[]>();
  for (const i of plan.groups.unread)
    unreadBySection.set(i.sectionNum, [...(unreadBySection.get(i.sectionNum) ?? []), i]);

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: plan.title }} />
      <ScrollView
        ref={scroll}
        contentContainerStyle={[styles.content, { paddingBottom: Spacing.four + bottom }]}
        onContentSizeChange={() => {
          // After opening Read, bring its items into view.
          if (scrollToRead.current) {
            scrollToRead.current = false;
            scroll.current?.scrollToEnd({ animated: true });
          }
        }}>
        <Group title="Reading" count={plan.groups.reading.length} empty="Nothing open right now.">
          {plan.groups.reading.map(row)}
        </Group>

        <Group
          title={plan.current != null ? `Due · ${plan.current}. ${sectionTitle(plan.current)}` : 'Due'}
          count={plan.groups.due.length}
          empty={plan.current == null ? 'All sections done.' : 'Everything in this section is read or in progress.'}>
          {plan.groups.due.map(row)}
        </Group>

        {quizzes.some((q) => q.available || q.doneAt) || reviewDue ? (
          <View style={styles.group}>
            <ThemedText type="smallBold">Quizzes</ThemedText>
            {reviewDue ? (
              <QuizRow
                href={{ pathname: '/quiz', params: { planId, review: '1' } }}
                title={`Review (${reviewDue})`}
                detail="Repeats, and new questions on your confusions"
                action="Start"
              />
            ) : null}
            {quizzes
              .filter((q) => q.available || q.doneAt)
              .map((q) => (
                <QuizRow
                  key={q.num}
                  href={{ pathname: '/quiz', params: { planId, section: String(q.num) } }}
                  title={`${q.num}. ${q.title}`}
                  detail={
                    q.doneAt
                      ? `Done · ${q.score} / ${q.total}`
                      : `${q.questionCount} question${q.questionCount === 1 ? '' : 's'} · ${q.ready ? 'ready' : 'early (reading not finished)'}`
                  }
                  action={q.doneAt ? 'Retake' : 'Take quiz'}
                  disabled={q.questionCount === 0}
                />
              ))}
          </View>
        ) : null}

        {plan.groups.unread.length ? (
          <Group title="Unread" count={plan.groups.unread.length}>
            {[...unreadBySection.entries()].map(([num, items]) => (
              <View key={num} style={styles.subgroup}>
                <ThemedText type="small" themeColor="textSecondary">
                  {num}. {sectionTitle(num)}
                </ThemedText>
                {items.map(row)}
              </View>
            ))}
          </Group>
        ) : null}

        {progress ? <ProgressBlock progress={progress} db={db} planId={planId} /> : null}

        {plan.groups.read.length ? (
          <View style={styles.group}>
            <Pressable
              style={styles.readToggle}
              hitSlop={8}
              onPress={() => {
                scrollToRead.current = !showRead;
                setShowRead((v) => !v);
              }}>
              <ThemedText type="smallBold">
                {showRead ? '▾' : '▸'} Read ({plan.groups.read.length})
              </ThemedText>
            </Pressable>
            {showRead ? plan.groups.read.map(row) : null}
          </View>
        ) : null}

        <Pressable style={styles.deleteButton} onPress={confirmDelete}>
          <ThemedText type="smallBold" style={styles.deleteText}>
            Delete plan
          </ThemedText>
        </Pressable>
      </ScrollView>
    </ThemedView>
  );
}

function ProgressBlock({ progress, db, planId }: { progress: PlanProgress; db: Db; planId: string }) {
  const done = progress.sections.filter((s) => s.complete).length;
  const time = progress.readingTime.filter((r) => r.secs > 0);
  const confusions = confusionSummary(progress.confusions);
  return (
    <View style={styles.group}>
      <ThemedText type="smallBold">Progress</ThemedText>
      <ThemedText type="small">
        Sections done: {done} of {progress.sections.length}
      </ThemedText>
      <ThemedText type="small">Confusions: {confusions || 'none'}</ThemedText>
      <ThemedText type="small">
        Reading time:{' '}
        {time.length ? time.map((r) => `${r.group} ${formatDuration(r.secs)}`).join(', ') : 'none logged yet'}
      </ThemedText>
      <View style={styles.buttonRow}>
        <Pressable style={styles.smallButton} onPress={() => exportProgress(db, planId)}>
          <ThemedText type="smallBold">Export progress</ThemedText>
        </Pressable>
        <Pressable
          style={[styles.smallButton, !progress.confusions.open && styles.disabled]}
          disabled={!progress.confusions.open}
          onPress={() => exportConfusions(db, planId)}>
          <ThemedText type="smallBold">Export confusions ({progress.confusions.open})</ThemedText>
        </Pressable>
      </View>
    </View>
  );
}

function QuizRow({
  href,
  title,
  detail,
  action,
  disabled,
}: {
  href: { pathname: '/quiz'; params: Record<string, string> };
  title: string;
  detail: string;
  action: string;
  disabled?: boolean;
}) {
  return (
    <View style={styles.quizRow}>
      <View style={styles.quizText}>
        <ThemedText type="small">{title}</ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {detail}
        </ThemedText>
      </View>
      {disabled ? null : (
        <Link href={href} asChild>
          <Pressable style={styles.smallButton}>
            <ThemedText type="smallBold">{action}</ThemedText>
          </Pressable>
        </Link>
      )}
    </View>
  );
}

function Group({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.group}>
      <ThemedText type="smallBold">
        {title} ({count})
      </ThemedText>
      {count === 0 && empty ? (
        <ThemedText type="small" themeColor="textSecondary">
          {empty}
        </ThemedText>
      ) : (
        children
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.four },
  group: { gap: Spacing.two },
  subgroup: { gap: Spacing.two, marginTop: Spacing.one },
  readToggle: { paddingVertical: Spacing.two },
  quizRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  quizText: { flex: 1 },
  buttonRow: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  disabled: { opacity: 0.4 },
  deleteButton: {
    marginTop: Spacing.four,
    padding: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: '#D64545',
    alignItems: 'center',
  },
  deleteText: { color: '#D64545' },
  smallButton: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: '#888',
  },
});

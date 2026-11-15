import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { requestVariant, sectionQuestionsNow } from '@/lib/ai/app';
import { sectionNeedsQuestions } from '@/lib/ai/section';
import { useDb } from '@/lib/db/use-db';
import { exportConfusions } from '@/lib/exports';
import { openConfusionCount } from '@/lib/progress';
import { getDocument } from '@/lib/library/queries';
import {
  completeSectionQuiz,
  conceptScores,
  flagQuestion,
  gradeQuestion,
  quizScore,
  reviewQuiz,
  sectionQuiz,
  type Grade,
  type QuizContext,
  type QuizQuestion,
} from '@/lib/quiz/queries';

// Quiz screen (design doc section 6): one question at a time.
// - Multiple choice: options are shuffled when the quiz opens. A wrong choice is Missed;
//   a right one asks "Knew it" (Got it) or "Guessed" (Partly). The Answer line is shown
//   as the explanation.
// - Open questions: reveal the answer, then self-grade Got it / Partly / Missed.
// Answers with a Ref link open the reader at that page.
// Params: planId and either section (a section quiz) or review=1 (due repeats).
// With an API key (design doc section 5): a ready section quiz without extra questions gets
// them written when it opens; a Missed or Partly grade asks for a retry variant in the
// background; questions written by the model have a Flag button, which removes the question
// and skips it (it isn't graded).
// After a section quiz, if that section has open confusions, the summary offers to export
// them for Claude (design doc section 4).

const GRADES: { grade: Grade; label: string; colour: string }[] = [
  { grade: 'got_it', label: 'Got it', colour: '#2E9E5B' },
  { grade: 'partly', label: 'Partly', colour: '#D99A00' },
  { grade: 'missed', label: 'Missed', colour: '#D64545' },
];
type Result = Grade | 'flagged';
const RESULT_LABEL: Record<Result, string> = {
  got_it: 'Got it',
  partly: 'Partly',
  missed: 'Missed',
  flagged: 'Flagged',
};
const RESULT_COLOUR: Record<Result, string> = {
  got_it: '#2E9E5B',
  partly: '#D99A00',
  missed: '#D64545',
  flagged: '#888888',
};
const RIGHT = '#2E9E5B';
const WRONG = '#D64545';

function shuffle<T>(list: T[]): T[] {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export default function QuizScreen() {
  const { planId, section, review } = useLocalSearchParams<{ planId: string; section?: string; review?: string }>();
  const db = useDb();
  const router = useRouter();
  const { bottom } = useSafeAreaInsets();
  const context: QuizContext = review ? { kind: 'review' } : { kind: 'section', sectionNum: Number(section) };

  const [questions, setQuestions] = useState<QuizQuestion[] | null>(null);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  /** Index of the chosen option (multiple choice). */
  const [chosen, setChosen] = useState<number | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [writing, setWriting] = useState(false);
  const [refTitle, setRefTitle] = useState<string | null>(null);
  const [concepts, setConcepts] = useState<Record<string, { score: number; attempts: number }> | null>(null);
  const [openConfusions, setOpenConfusions] = useState(0);

  // The question list is fixed when the quiz opens.
  useEffect(() => {
    (async () => {
      if (!review && (await sectionNeedsQuestions(db, planId, Number(section)))) {
        setWriting(true);
        await sectionQuestionsNow(db, planId, Number(section)).catch((e) =>
          console.warn('Section questions failed', e),
        );
        setWriting(false);
      }
      const list = review ? await reviewQuiz(db, planId) : await sectionQuiz(db, planId, Number(section));
      setQuestions(list.map((x) => ({ ...x, options: shuffle(x.options) })));
    })();
  }, [db, planId, section, review]);

  const q = questions?.[index];
  const finished = questions != null && index >= questions.length;

  useEffect(() => {
    let cancelled = false;
    if (q?.refDoc) getDocument(db, q.refDoc).then((d) => !cancelled && setRefTitle(d?.title ?? q.refDoc));
    return () => {
      cancelled = true;
    };
  }, [db, q?.refDoc]);

  async function grade(g: Grade) {
    if (!q) return;
    const { needsVariant } = await gradeQuestion(db, planId, q.id, g, context, undefined, {
      variantId: q.variantId,
      chosen: chosen != null ? q.options[chosen].text : null,
    });
    if (needsVariant) requestVariant(db, q.id);
    await next(g);
  }

  function flag() {
    if (!q) return;
    Alert.alert('Flag this question?', 'It leaves the quiz and is not graded. Later requests avoid the same problem.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Flag',
        style: 'destructive',
        onPress: async () => {
          await flagQuestion(db, q.variantId ?? q.id);
          await next('flagged');
        },
      },
    ]);
  }

  async function next(r: Result) {
    if (!questions) return;
    const all = [...results, r];
    setResults(all);
    setRevealed(false);
    setChosen(null);
    setRefTitle(null);
    if (index + 1 >= questions.length) {
      if (context.kind === 'section') {
        await completeSectionQuiz(
          db,
          planId,
          context.sectionNum,
          all.filter((x): x is Grade => x !== 'flagged'),
        );
        setOpenConfusions(await openConfusionCount(db, planId, context.sectionNum));
      }
      setConcepts(await conceptScores(db, planId));
    }
    setIndex(index + 1);
  }

  const title = review ? 'Review' : `Section ${section} quiz`;

  if (!questions) {
    return (
      <ThemedView style={styles.center}>
        <Stack.Screen options={{ title }} />
        <ActivityIndicator />
        {writing ? (
          <ThemedText type="small" themeColor="textSecondary">
            Writing extra questions from the section&apos;s pages…
          </ThemedText>
        ) : null}
      </ThemedView>
    );
  }

  if (questions.length === 0) {
    return (
      <ThemedView style={styles.center}>
        <Stack.Screen options={{ title }} />
        <ThemedText type="small" themeColor="textSecondary">
          {review ? 'No questions are due for review.' : 'This section has no questions.'}
        </ThemedText>
      </ThemedView>
    );
  }

  if (finished) {
    const graded = results.filter((x): x is Grade => x !== 'flagged');
    const score = quizScore(graded);
    const touched = [...new Set(questions.flatMap((x) => x.concepts))];
    return (
      <ThemedView style={styles.container}>
        <Stack.Screen options={{ title }} />
        <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Spacing.four + bottom }]}>
          <ThemedText type="subtitle">
            {score} / {graded.length}
          </ThemedText>
          <ThemedText type="small" themeColor="textSecondary">
            Got it = 1, Partly = ½, Missed = 0. Missed and Partly questions come back
            {context.kind === 'section' ? " in the next section's quiz" : ' in a review in 7 days'}.
          </ThemedText>

          <View style={styles.block}>
            {questions.map((x, n) => (
              <View key={x.id} style={styles.summaryRow}>
                <View style={[styles.dot, { backgroundColor: RESULT_COLOUR[results[n]] }]} />
                <ThemedText type="small" style={styles.flex}>
                  {x.text}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {RESULT_LABEL[results[n]]}
                </ThemedText>
              </View>
            ))}
          </View>

          {touched.length && concepts ? (
            <View style={styles.block}>
              <ThemedText type="smallBold">Concepts (last 5 attempts)</ThemedText>
              {touched.map((c) => (
                <View key={c} style={styles.summaryRow}>
                  <ThemedText type="small" style={styles.flex}>
                    {c}
                  </ThemedText>
                  <ThemedText type="small" themeColor="textSecondary">
                    {concepts[c] ? `${Math.round(concepts[c].score * 100)}% (${concepts[c].attempts})` : '—'}
                  </ThemedText>
                </View>
              ))}
            </View>
          ) : null}

          {openConfusions ? (
            <ThemedView type="backgroundElement" style={styles.answer}>
              <ThemedText type="small">
                Section {section} has {openConfusions} open confusion{openConfusions === 1 ? '' : 's'}. Export your open
                confusions to give Claude, then import the questions file it returns from the Library tab.
              </ThemedText>
              <Pressable style={styles.button} onPress={() => exportConfusions(db, planId)}>
                <ThemedText type="smallBold">Export confusions</ThemedText>
              </Pressable>
            </ThemedView>
          ) : null}

          <Pressable style={styles.button} onPress={() => router.back()}>
            <ThemedText type="smallBold">Done</ThemedText>
          </Pressable>
        </ScrollView>
      </ThemedView>
    );
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Spacing.four + bottom }]}>
        <ThemedText type="small" themeColor="textSecondary">
          {index + 1} of {questions.length}
          {q!.hard ? ' · hard' : ''}
          {q!.markId != null ? ' · from your confusion' : q!.repeat ? ` · repeat from section ${q!.sectionNum}` : ''}
          {q!.variantId != null ? ' · reworded' : ''}
        </ThemedText>
        <ThemedText style={styles.question}>{q!.text}</ThemedText>

        {q!.options.length ? (
          <View style={styles.options}>
            {q!.options.map((o, n) => {
              const answered = chosen != null;
              const colour = answered && o.correct ? RIGHT : answered && n === chosen ? WRONG : undefined;
              return (
                <Pressable
                  key={n}
                  disabled={answered}
                  style={[styles.option, colour ? { borderColor: colour, borderWidth: 2 } : null]}
                  onPress={() => setChosen(n)}>
                  <ThemedText style={colour ? { color: colour } : undefined}>{o.text}</ThemedText>
                </Pressable>
              );
            })}
          </View>
        ) : !revealed ? (
          <Pressable style={styles.button} onPress={() => setRevealed(true)}>
            <ThemedText type="smallBold">Reveal answer</ThemedText>
          </Pressable>
        ) : null}

        {revealed || chosen != null ? (
          <ThemedView type="backgroundElement" style={styles.answer}>
            {chosen != null ? (
              <ThemedText type="smallBold" style={{ color: q!.options[chosen].correct ? RIGHT : WRONG }}>
                {q!.options[chosen].correct ? 'Right' : 'Not quite'}
              </ThemedText>
            ) : null}
            <ThemedText>{q!.answer}</ThemedText>
            {q!.refDoc && q!.refPage != null ? (
              <Pressable
                onPress={() =>
                  router.push({ pathname: '/reader/[docId]', params: { docId: q!.refDoc!, page: String(q!.refPage) } })
                }>
                <ThemedText type="linkPrimary">
                  See p.{q!.refPage}
                  {refTitle ? ` in ${refTitle}` : ''}
                </ThemedText>
              </Pressable>
            ) : null}
            {q!.concepts.length ? (
              <ThemedText type="small" themeColor="textSecondary">
                {q!.concepts.join(' · ')}
              </ThemedText>
            ) : null}
          </ThemedView>
        ) : null}

        {chosen != null ? (
          q!.options[chosen].correct ? (
            <View style={styles.grades}>
              <Pressable style={[styles.gradeButton, { borderColor: RIGHT }]} onPress={() => grade('got_it')}>
                <ThemedText type="smallBold" style={{ color: RIGHT }}>
                  Knew it
                </ThemedText>
              </Pressable>
              <Pressable style={[styles.gradeButton, { borderColor: '#D99A00' }]} onPress={() => grade('partly')}>
                <ThemedText type="smallBold" style={{ color: '#D99A00' }}>
                  Guessed
                </ThemedText>
              </Pressable>
            </View>
          ) : (
            <Pressable style={styles.button} onPress={() => grade('missed')}>
              <ThemedText type="smallBold">Next</ThemedText>
            </Pressable>
          )
        ) : revealed ? (
          <View style={styles.grades}>
            {GRADES.map(({ grade: g, label, colour }) => (
              <Pressable key={g} style={[styles.gradeButton, { borderColor: colour }]} onPress={() => grade(g)}>
                <ThemedText type="smallBold" style={{ color: colour }}>
                  {label}
                </ThemedText>
              </Pressable>
            ))}
          </View>
        ) : null}

        {q!.generated ? (
          <Pressable onPress={flag} hitSlop={8} style={styles.flag}>
            <ThemedText type="small" themeColor="textSecondary">
              ⚑ Flag as wrong or unclear
            </ThemedText>
          </Pressable>
        ) : null}
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: Spacing.four },
  content: { padding: Spacing.three, gap: Spacing.three },
  question: { fontSize: 18, lineHeight: 26 },
  answer: { padding: Spacing.three, borderRadius: Spacing.two, gap: Spacing.two },
  grades: { flexDirection: 'row', gap: Spacing.two },
  options: { gap: Spacing.two },
  option: { padding: Spacing.three, borderRadius: Spacing.two, borderWidth: 1, borderColor: '#888' },
  gradeButton: {
    flex: 1,
    paddingVertical: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: 2,
    alignItems: 'center',
  },
  button: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: '#888',
    alignItems: 'center',
  },
  block: { gap: Spacing.two },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dot: { width: 10, height: 10, borderRadius: 5 },
  flex: { flex: 1 },
  flag: { alignSelf: 'flex-start', marginTop: Spacing.two },
});

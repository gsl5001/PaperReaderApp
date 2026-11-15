import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { MARK_COLOURS, markPages } from '@/components/marks';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useDb } from '@/lib/db/use-db';
import { listAllMarks, type MarkStatus, type MarkWithDoc } from '@/lib/marks/queries';

// Marks screen (design doc section 6): every highlight, note and confusion in the library,
// filterable by group, document and status. Status applies to Confused marks only, so
// choosing a status shows only confusions. Tap a mark to open the reader at its page.

const STATUSES: MarkStatus[] = ['open', 'explained', 'resolved'];
const KIND_LABEL = { highlight: 'Highlight', confused: 'Confused', note: 'Note' } as const;

export default function MarksScreen() {
  const db = useDb();
  const router = useRouter();
  const [marks, setMarks] = useState<MarkWithDoc[]>([]);
  const [group, setGroup] = useState<number | null>(null);
  const [doc, setDoc] = useState<string | null>(null);
  const [status, setStatus] = useState<MarkStatus | null>(null);

  useFocusEffect(
    useCallback(() => {
      listAllMarks(db).then(setMarks);
    }, [db]),
  );

  const groups = [...new Map(marks.map((m) => [m.groupId, m.groupName])).entries()];
  const docs = [
    ...new Map(marks.filter((m) => group == null || m.groupId === group).map((m) => [m.docId, m.docTitle])).entries(),
  ];
  const shown = marks.filter(
    (m) =>
      (group == null || m.groupId === group) &&
      (doc == null || m.docId === doc) &&
      (status == null || m.status === status),
  );

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {marks.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            No marks yet. Select text in the reader to highlight it, mark it as confusing or add a note.
          </ThemedText>
        ) : (
          <>
            <ChipRow
              options={groups.map(([id, name]) => ({ key: String(id), label: name }))}
              selected={group == null ? null : String(group)}
              allLabel="All groups"
              onSelect={(k) => {
                setGroup(k == null ? null : Number(k));
                setDoc(null);
              }}
            />
            <ChipRow
              options={docs.map(([id, title]) => ({ key: id, label: title }))}
              selected={doc}
              allLabel="All documents"
              onSelect={setDoc}
            />
            <ChipRow
              options={STATUSES.map((s) => ({ key: s, label: s[0].toUpperCase() + s.slice(1) }))}
              selected={status}
              allLabel="Any status"
              onSelect={(k) => setStatus(k as MarkStatus | null)}
            />

            <ThemedText type="small" themeColor="textSecondary">
              {shown.length} mark{shown.length === 1 ? '' : 's'}
            </ThemedText>

            {shown.map((m) => (
              <Pressable
                key={m.id}
                style={styles.mark}
                onPress={() =>
                  router.push({ pathname: '/reader/[docId]', params: { docId: m.docId, page: String(m.page) } })
                }>
                <View style={styles.labelRow}>
                  <View style={[styles.dot, { backgroundColor: MARK_COLOURS[m.kind] }]} />
                  <ThemedText type="small" themeColor="textSecondary" style={styles.flex} numberOfLines={1}>
                    {KIND_LABEL[m.kind]} · {m.docTitle} · {markPages(m)}
                    {m.status ? ` · ${m.status}` : ''}
                  </ThemedText>
                </View>
                <ThemedText type="small" numberOfLines={3}>
                  {m.text}
                </ThemedText>
                {m.note ? (
                  <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
                    Note: {m.note}
                  </ThemedText>
                ) : null}
              </Pressable>
            ))}
          </>
        )}
      </ScrollView>
    </ThemedView>
  );
}

function ChipRow({
  options,
  selected,
  allLabel,
  onSelect,
}: {
  options: { key: string; label: string }[];
  selected: string | null;
  allLabel: string;
  onSelect: (key: string | null) => void;
}) {
  const chip = (key: string | null, label: string) => (
    <Pressable
      key={key ?? '*'}
      style={[styles.chip, selected === key ? styles.chipOn : null]}
      onPress={() => onSelect(key)}>
      <ThemedText type="small" numberOfLines={1}>
        {label}
      </ThemedText>
    </Pressable>
  );
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
      {chip(null, allLabel)}
      {options.map((o) => chip(o.key, o.label))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.two },
  chips: { gap: Spacing.two },
  chip: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.three,
    borderWidth: 1,
    borderColor: '#888',
    maxWidth: 220,
  },
  chipOn: { borderColor: '#3c87f7', borderWidth: 2, backgroundColor: 'rgba(60,135,247,0.15)' },
  mark: {
    paddingVertical: Spacing.two,
    gap: Spacing.one,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#888',
  },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dot: { width: 10, height: 10, borderRadius: 5 },
  flex: { flex: 1 },
});

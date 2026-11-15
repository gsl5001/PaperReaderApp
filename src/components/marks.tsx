import { Modal, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { Mark, MarkKind } from '@/lib/marks/queries';

export const MARK_COLOURS: Record<MarkKind, string> = {
  highlight: '#FFD600',
  confused: '#FF5A5A',
  note: '#50A0FF',
};

const KIND_LABEL: Record<MarkKind, string> = { highlight: 'Highlight', confused: 'Confused', note: 'Note' };

// Order of the groups in the side panel: the marks you'll act on first.
const PANEL_GROUPS: { kind: MarkKind; title: string }[] = [
  { kind: 'confused', title: 'Confused' },
  { kind: 'note', title: 'Notes' },
  { kind: 'highlight', title: 'Highlights' },
];

export const markPages = (m: Mark) => (m.pageEnd !== m.page ? `p.${m.page}–${m.pageEnd}` : `p.${m.page}`);

function MarkLabel({ mark }: { mark: Mark }) {
  const status = mark.status ? ` · ${mark.status}` : '';
  return (
    <View style={styles.labelRow}>
      <View style={[styles.dot, { backgroundColor: MARK_COLOURS[mark.kind] }]} />
      <ThemedText type="small" themeColor="textSecondary">
        {KIND_LABEL[mark.kind]} · {markPages(mark)}
        {status}
      </ThemedText>
    </View>
  );
}

/** Side panel listing a document's marks, grouped by type, in reading order within each group. Tap one to jump to it. */
export function MarksPanel({
  visible,
  marks,
  onSelect,
  onClose,
}: {
  visible: boolean;
  marks: Mark[];
  onSelect: (m: Mark) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.panelBackdrop}>
        <Pressable style={styles.panelDismiss} onPress={onClose} />
        <ThemedView style={styles.panel}>
          <View style={styles.panelHeader}>
            <ThemedText type="smallBold">Marks ({marks.length})</ThemedText>
            <Pressable hitSlop={12} onPress={onClose}>
              <ThemedText type="smallBold">✕</ThemedText>
            </Pressable>
          </View>
          <ScrollView contentContainerStyle={styles.panelList}>
            {marks.length === 0 ? (
              <ThemedText type="small" themeColor="textSecondary">
                No marks yet. Select text and choose Highlight, Confused or Note.
              </ThemedText>
            ) : null}
            {PANEL_GROUPS.map(({ kind, title }) => {
              const group = marks.filter((m) => m.kind === kind);
              if (!group.length) return null;
              return (
                <View key={kind} style={styles.panelGroup}>
                  <View style={styles.labelRow}>
                    <View style={[styles.dot, { backgroundColor: MARK_COLOURS[kind] }]} />
                    <ThemedText type="smallBold">
                      {title} ({group.length})
                    </ThemedText>
                  </View>
                  {group.map((m) => (
                    <Pressable key={m.id} style={styles.panelItem} onPress={() => onSelect(m)}>
                      <ThemedText type="small" themeColor="textSecondary">
                        {markPages(m)}
                        {m.status ? ` · ${m.status}` : ''}
                      </ThemedText>
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
                </View>
              );
            })}
          </ScrollView>
        </ThemedView>
      </View>
    </Modal>
  );
}

/** Details of one mark, with its actions. */
export function MarkSheet({
  mark,
  onEditNote,
  onToggleResolved,
  onExplain,
  explaining,
  onDelete,
  onClose,
}: {
  mark: Mark | null;
  onEditNote: () => void;
  onToggleResolved: () => void;
  /** Ask the model for an explanation (Confused marks in a plan section). */
  onExplain?: () => void;
  explaining?: boolean;
  onDelete: () => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={!!mark} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        {mark ? (
          <Pressable>
            <ThemedView style={styles.sheet}>
              <MarkLabel mark={mark} />
              <ScrollView style={styles.sheetScroll}>
                <ThemedText type="small">“{mark.text}”</ThemedText>
                {mark.note ? (
                  <ThemedText type="small" style={styles.sheetPara}>
                    Note: {mark.note}
                  </ThemedText>
                ) : null}
                {mark.explanation ? (
                  <ThemedText type="small" style={styles.sheetPara}>
                    Explanation: {mark.explanation}
                  </ThemedText>
                ) : explaining ? (
                  <ThemedText type="small" themeColor="textSecondary" style={styles.sheetPara}>
                    Asking for an explanation…
                  </ThemedText>
                ) : null}
              </ScrollView>
              <View style={styles.sheetActions}>
                <Pressable style={styles.button} onPress={onEditNote}>
                  <ThemedText type="smallBold">{mark.note ? 'Edit note' : 'Add note'}</ThemedText>
                </Pressable>
                {mark.kind === 'confused' && mark.status === 'open' && onExplain && !explaining ? (
                  <Pressable style={styles.button} onPress={onExplain}>
                    <ThemedText type="smallBold">
                      {mark.explanation ? 'Explain again' : 'Ask for explanation'}
                    </ThemedText>
                  </Pressable>
                ) : null}
                {mark.kind === 'confused' ? (
                  <Pressable style={styles.button} onPress={onToggleResolved}>
                    <ThemedText type="smallBold">{mark.status === 'resolved' ? 'Reopen' : 'Resolve'}</ThemedText>
                  </Pressable>
                ) : null}
                <Pressable style={styles.button} onPress={onDelete}>
                  <ThemedText type="smallBold">Delete</ThemedText>
                </Pressable>
              </View>
            </ThemedView>
          </Pressable>
        ) : null}
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  dot: { width: 10, height: 10, borderRadius: 5 },
  panelBackdrop: { flex: 1, flexDirection: 'row', backgroundColor: '#0006' },
  panelDismiss: { flex: 1 },
  panel: { width: '82%', paddingTop: Spacing.four },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.three,
    paddingBottom: Spacing.two,
  },
  panelList: { padding: Spacing.three, gap: Spacing.three },
  panelGroup: { gap: Spacing.three },
  panelItem: { gap: Spacing.one, paddingLeft: Spacing.three },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: '#0006' },
  sheet: {
    padding: Spacing.three,
    gap: Spacing.two,
    borderTopLeftRadius: Spacing.three,
    borderTopRightRadius: Spacing.three,
  },
  sheetScroll: { maxHeight: 260 },
  sheetPara: { marginTop: Spacing.two },
  sheetActions: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap', marginTop: Spacing.two },
  button: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: '#888',
  },
});

import * as DocumentPicker from 'expo-document-picker';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import type { Db } from '@/lib/db/types';
import { attachPdf, downloadPdf } from '@/lib/library/files';
import { setDocumentFile } from '@/lib/library/queries';
import { setItemDone, type PlanItemRow } from '@/lib/plan/queries';
import { afterItemDone } from '@/lib/ai/app';
import { announceQuizReady, syncSchedule } from '@/lib/schedule/notifications';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * What tapping and ticking a plan item does, shared by Today and the Plan screen.
 * - open: a document item opens the reader at the item (or offers Download / Attach if
 *   there's no PDF); a link item opens the link; a Listen item with sources opens Prepare NotebookLM.
 * - toggleDone: ticks or unticks the item, updates the schedule, and announces a quiz that
 *   became ready.
 */
export function useItemActions(db: Db, reload: () => Promise<void>) {
  const router = useRouter();
  const [busyDoc, setBusyDoc] = useState<string | null>(null);

  const openReader = (item: PlanItemRow) =>
    router.push({ pathname: '/reader/[docId]', params: { docId: item.docId!, itemId: String(item.id) } });

  async function getPdf(item: PlanItemRow, how: 'download' | 'attach') {
    if (!item.docId) return;
    try {
      let uri: string;
      if (how === 'download') {
        setBusyDoc(item.docId);
        uri = await downloadPdf(item.docId, item.docUrl!);
      } else {
        const picked = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
        if (picked.canceled) return;
        setBusyDoc(item.docId);
        uri = await attachPdf(item.docId, picked.assets[0].uri);
      }
      await setDocumentFile(db, item.docId, uri);
      await reload();
      openReader(item);
    } catch (e) {
      Alert.alert(how === 'download' ? 'Download failed' : 'Attach failed', message(e));
    } finally {
      setBusyDoc(null);
    }
  }

  function open(item: PlanItemRow) {
    if (item.kind === 'listen' && item.sources.length) {
      router.push({ pathname: '/prepare', params: { itemIds: String(item.id) } });
      return;
    }
    if (item.docId) {
      if (item.docHasFile) return openReader(item);
      const buttons: { text: string; onPress?: () => void; style?: 'cancel' }[] = [];
      if (item.docUrl) buttons.push({ text: 'Download', onPress: () => getPdf(item, 'download') });
      buttons.push({ text: 'Attach a PDF', onPress: () => getPdf(item, 'attach') });
      buttons.push({ text: 'Cancel', style: 'cancel' });
      Alert.alert(item.docTitle ?? 'No PDF', 'This document has no PDF yet.', buttons);
      return;
    }
    if (item.url) Linking.openURL(item.url);
  }

  async function toggleDone(item: PlanItemRow) {
    await setItemDone(db, item.id, !item.done);
    await reload();
    syncSchedule(db).catch(() => {});
    if (!item.done) announceQuizReady(db, item.id).catch(() => {});
    if (!item.done) afterItemDone(db, item.id);
  }

  return { open, toggleDone, busyDoc };
}

export function ItemRow({
  item,
  busy,
  onToggle,
  onOpen,
  tag,
}: {
  item: PlanItemRow;
  busy: boolean;
  onToggle: () => void;
  onOpen: () => void;
  /** Extra label shown with the item's type, e.g. "overdue". */
  tag?: string;
}) {
  const meta = [item.type, item.minutes ? `${item.minutes} min` : null, item.optional ? 'optional' : null, tag ?? null]
    .filter(Boolean)
    .join(' · ');
  const pages =
    item.pageFrom != null
      ? item.pageFrom === item.pageTo
        ? ` · p.${item.pageFrom}`
        : ` · p.${item.pageFrom}–${item.pageTo}`
      : '';
  const source = item.docTitle
    ? `${item.docTitle}${pages}${item.docHasFile ? '' : ' · no PDF'}`
    : item.url
      ? 'Opens a link'
      : item.sources.length
        ? `${item.sources.length} NotebookLM source${item.sources.length === 1 ? '' : 's'}`
        : null;

  return (
    <View style={styles.itemRow}>
      <Pressable hitSlop={10} onPress={onToggle} style={styles.checkbox}>
        <ThemedText type="subtitle" style={styles.checkboxText}>
          {item.done ? '☑' : '☐'}
        </ThemedText>
      </Pressable>
      <Pressable style={styles.itemBody} onPress={onOpen} disabled={busy}>
        <ThemedText type="small" themeColor="textSecondary">
          {meta}
        </ThemedText>
        <ThemedText type="small" style={item.done ? styles.doneText : undefined}>
          {item.text}
        </ThemedText>
        {source ? (
          <ThemedText type="small" themeColor="textSecondary" numberOfLines={1}>
            {source}
          </ThemedText>
        ) : null}
      </Pressable>
      {busy ? <ActivityIndicator /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.two, paddingVertical: Spacing.one },
  checkbox: { paddingTop: 2 },
  checkboxText: { fontSize: 22, lineHeight: 26 },
  itemBody: { flex: 1 },
  doneText: { textDecorationLine: 'line-through' },
});

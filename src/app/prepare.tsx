import * as Clipboard from 'expo-clipboard';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import * as Sharing from 'expo-sharing';
import { useCallback, useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ItemRow, useItemActions } from '@/components/item-row';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useDb } from '@/lib/db/use-db';
import { getDocument, type LibraryDocument } from '@/lib/library/queries';
import { getItem, type PlanItemRow } from '@/lib/plan/queries';

// Prepare NotebookLM (design doc section 7): for the given Listen items, copy the
// source links and share the referenced PDFs, so they can be added to a notebook
// before generating an audio overview.

type DocSource = { doc: LibraryDocument | null; docId: string; pageFrom?: number; pageTo?: number };

export default function PrepareScreen() {
  const { itemIds } = useLocalSearchParams<{ itemIds: string }>();
  const db = useDb();
  const [items, setItems] = useState<PlanItemRow[]>([]);
  const [docs, setDocs] = useState<Record<string, LibraryDocument | null>>({});

  const reload = useCallback(async () => {
    const ids = (itemIds ?? '').split(',').map(Number).filter(Boolean);
    const loaded = (await Promise.all(ids.map((id) => getItem(db, id)))).filter((i): i is PlanItemRow => !!i);
    const docIds = new Set(loaded.flatMap((i) => i.sources.flatMap((s) => (s.kind === 'doc' ? [s.ref.docId] : []))));
    const entries = await Promise.all([...docIds].map(async (id) => [id, await getDocument(db, id)] as const));
    setItems(loaded);
    setDocs(Object.fromEntries(entries));
  }, [db, itemIds]);
  const { open, toggleDone, busyDoc } = useItemActions(db, reload);
  const { bottom } = useSafeAreaInsets();

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  const links = [...new Set(items.flatMap((i) => i.sources.flatMap((s) => (s.kind === 'url' ? [s.url] : []))))];
  const docSources: DocSource[] = items.flatMap((i) =>
    i.sources.flatMap((s) =>
      s.kind === 'doc' ? [{ doc: docs[s.ref.docId] ?? null, docId: s.ref.docId, pageFrom: s.ref.pageFrom, pageTo: s.ref.pageTo }] : [],
    ),
  );

  async function copyLinks() {
    await Clipboard.setStringAsync(links.join('\n'));
    Alert.alert('Links copied', `${links.length} link${links.length === 1 ? '' : 's'} copied. Paste them into NotebookLM as website sources.`);
  }

  async function share(d: DocSource) {
    if (!d.doc?.filePath) return;
    try {
      await Sharing.shareAsync(d.doc.filePath, { mimeType: 'application/pdf', dialogTitle: d.doc.title });
    } catch (e) {
      Alert.alert('Share failed', e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'Prepare NotebookLM' }} />
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: Spacing.four + bottom }]}>
        {items.map((i) => (
          <ItemRow
            key={i.id}
            item={i}
            busy={busyDoc != null && busyDoc === i.docId}
            onToggle={() => toggleDone(i)}
            onOpen={() => (i.sources.length ? undefined : open(i))}
          />
        ))}

        <View style={styles.block}>
          <ThemedText type="smallBold">PDFs</ThemedText>
          {docSources.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              No PDF sources.
            </ThemedText>
          ) : null}
          {docSources.map((d, n) => (
            <View key={`${d.docId}-${n}`} style={styles.sourceRow}>
              <View style={styles.sourceText}>
                <ThemedText type="small" numberOfLines={2}>
                  {d.doc?.title ?? d.docId}
                </ThemedText>
                <ThemedText type="small" themeColor="textSecondary">
                  {d.pageFrom != null ? `Pages ${d.pageFrom}–${d.pageTo}` : 'Whole document'}
                  {d.doc?.filePath ? '' : ' · no PDF attached'}
                </ThemedText>
              </View>
              {d.doc?.filePath ? (
                <Pressable style={styles.button} onPress={() => share(d)}>
                  <ThemedText type="smallBold">Share PDF</ThemedText>
                </Pressable>
              ) : null}
            </View>
          ))}
          {docSources.some((d) => d.pageFrom != null) ? (
            <ThemedText type="small" themeColor="textSecondary">
              NotebookLM takes the whole PDF. Mention the page ranges in your prompt to keep the overview on them.
            </ThemedText>
          ) : null}
        </View>

        <View style={styles.block}>
          <ThemedText type="smallBold">Links</ThemedText>
          {links.length === 0 ? (
            <ThemedText type="small" themeColor="textSecondary">
              No link sources.
            </ThemedText>
          ) : (
            <>
              {links.map((url) => (
                <Pressable key={url} onPress={() => Linking.openURL(url)}>
                  <ThemedText type="small" numberOfLines={1}>
                    {url}
                  </ThemedText>
                </Pressable>
              ))}
              <Pressable style={[styles.button, styles.alignStart]} onPress={copyLinks}>
                <ThemedText type="smallBold">Copy links</ThemedText>
              </Pressable>
            </>
          )}
        </View>

        <Pressable style={[styles.button, styles.alignStart]} onPress={() => Linking.openURL('https://notebooklm.google.com/')}>
          <ThemedText type="smallBold">Open NotebookLM</ThemedText>
        </Pressable>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.four },
  block: { gap: Spacing.two },
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  sourceText: { flex: 1 },
  alignStart: { alignSelf: 'flex-start' },
  button: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: '#888',
  },
});

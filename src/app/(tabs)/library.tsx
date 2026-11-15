import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ImportResultCard, type AnyImportResult } from '@/components/import-result-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { importQuestionsText } from '@/lib/confusions/import';
import { useDb } from '@/lib/db/use-db';
import { attachPdf, downloadPdf } from '@/lib/library/files';
import { listLibrary, setDocumentFile, type LibraryDocument, type LibraryGroup } from '@/lib/library/queries';

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export default function LibraryScreen() {
  const db = useDb();
  const router = useRouter();
  const [groups, setGroups] = useState<LibraryGroup[]>([]);
  const [busyDoc, setBusyDoc] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<AnyImportResult | null>(null);

  const reload = useCallback(async () => {
    setGroups(await listLibrary(db));
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  async function attach(doc: LibraryDocument) {
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
      if (picked.canceled) return;
      setBusyDoc(doc.id);
      const uri = await attachPdf(doc.id, picked.assets[0].uri);
      await setDocumentFile(db, doc.id, uri);
      await reload();
    } catch (e) {
      Alert.alert('Attach failed', message(e));
    } finally {
      setBusyDoc(null);
    }
  }

  async function download(doc: LibraryDocument) {
    if (!doc.url) return;
    try {
      setBusyDoc(doc.id);
      const uri = await downloadPdf(doc.id, doc.url);
      await setDocumentFile(db, doc.id, uri);
      await reload();
    } catch (e) {
      Alert.alert('Download failed', message(e));
    } finally {
      setBusyDoc(null);
    }
  }

  // A questions/v1 file: Claude's explanations and questions for exported confusions.
  async function importQuestions() {
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      const result = await importQuestionsText(db, await new File(asset.uri).text());
      setImportResult({ ...result, fileName: asset.name });
    } catch (e) {
      Alert.alert('Import failed', message(e));
    }
  }

  function docOptions(doc: LibraryDocument) {
    const buttons: { text: string; onPress?: () => void; style?: 'cancel' }[] = [
      { text: 'Attach a different PDF', onPress: () => attach(doc) },
    ];
    if (doc.url) buttons.push({ text: 'Download again', onPress: () => download(doc) });
    buttons.push({ text: 'Cancel', style: 'cancel' });
    Alert.alert(doc.title, undefined, buttons);
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        <Pressable style={styles.importButton} onPress={importQuestions}>
          <ThemedText type="smallBold">Import questions file</ThemedText>
        </Pressable>
        {importResult ? <ImportResultCard result={importResult} onDismiss={() => setImportResult(null)} /> : null}

        {groups.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            No documents yet. Import a plan from the Plans screen to add its reading list.
          </ThemedText>
        ) : null}

        {groups.map((g) => (
          <View key={g.id} style={styles.block}>
            <ThemedText type="smallBold">{g.name}</ThemedText>
            {g.docs.map((d) => (
              <DocRow
                key={d.id}
                doc={d}
                busy={busyDoc === d.id}
                onOpen={() => router.push({ pathname: '/reader/[docId]', params: { docId: d.id } })}
                onAttach={() => attach(d)}
                onDownload={() => download(d)}
                onOptions={() => docOptions(d)}
              />
            ))}
          </View>
        ))}
      </ScrollView>
    </ThemedView>
  );
}

function DocRow({
  doc,
  busy,
  onOpen,
  onAttach,
  onDownload,
  onOptions,
}: {
  doc: LibraryDocument;
  busy: boolean;
  onOpen: () => void;
  onAttach: () => void;
  onDownload: () => void;
  onOptions: () => void;
}) {
  const status = !doc.filePath ? 'No PDF' : doc.lastPage ? `Last read p.${doc.lastPage}` : 'Not opened';
  return (
    <Pressable
      style={styles.docRow}
      disabled={busy || !doc.filePath}
      onPress={onOpen}
      onLongPress={doc.filePath ? onOptions : undefined}>
      <View style={styles.docText}>
        <ThemedText type="small" numberOfLines={2}>
          {doc.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          {status}
        </ThemedText>
      </View>
      {busy ? <ActivityIndicator /> : null}
      {!busy && !doc.filePath ? (
        <View style={styles.docActions}>
          {doc.url ? (
            <Pressable style={styles.smallButton} onPress={onDownload}>
              <ThemedText type="smallBold">Download</ThemedText>
            </Pressable>
          ) : null}
          <Pressable style={styles.smallButton} onPress={onAttach}>
            <ThemedText type="smallBold">Attach</ThemedText>
          </Pressable>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three },
  block: { gap: Spacing.two },
  smallButton: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: '#888',
  },
  docRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingVertical: Spacing.one },
  docText: { flex: 1 },
  importButton: {
    padding: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: '#888',
    alignItems: 'center',
  },
  docActions: { flexDirection: 'row', gap: Spacing.two },
});

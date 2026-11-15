import * as Clipboard from 'expo-clipboard';
import { Pressable, StyleSheet, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import type { QuestionsImportResult } from '@/lib/confusions/import';
import type { ImportResult, ImportSummary } from '@/lib/library/import-plan';

/** The outcome of importing a plan file or a questions/v1 file. */
export type AnyImportResult = (ImportResult | QuestionsImportResult) & { fileName: string };

export function ImportResultCard({ result, onDismiss }: { result: AnyImportResult; onDismiss: () => void }) {
  let text: string;
  if (result.ok && 'confusions' in result.summary) {
    const s = result.summary;
    text = [
      `Imported explanations for ${s.confusions} confusion${s.confusions === 1 ? '' : 's'} in "${s.planId}"`,
      `Questions: ${s.questionsAdded} added, ${s.questionsMatched} kept` +
        (s.questionsRemoved ? `, ${s.questionsRemoved} removed from the quiz (history kept)` : ''),
      'The new questions come first in your next quiz or review.',
    ].join('\n');
  } else if (result.ok) {
    const s = result.summary as ImportSummary;
    const lines = [
      `${s.isNew ? 'Imported' : 'Updated'} "${s.title}" (${s.sections} sections)`,
      `Documents: ${s.docsAdded} added, ${s.docsUpdated} already in library`,
      `Items: ${s.itemsAdded} added, ${s.itemsMatched} kept` +
        (s.itemsDeleted ? `, ${s.itemsDeleted} removed` : '') +
        (s.itemsKeptDone ? `, ${s.itemsKeptDone} removed from the file but kept because done` : ''),
      `Questions: ${s.questionsAdded} added, ${s.questionsMatched} kept` +
        (s.questionsRemoved ? `, ${s.questionsRemoved} removed from the quiz (history kept)` : ''),
    ];
    text = lines.join('\n');
  } else {
    text = [
      `${result.fileName} has ${result.errors.length} error${result.errors.length === 1 ? '' : 's'}:`,
      ...result.errors.map((e) => `Line ${e.line}: ${e.message}`),
    ].join('\n');
  }
  return (
    <ThemedView type="backgroundElement" style={styles.card}>
      <ThemedText type="small">{text}</ThemedText>
      <View style={styles.docActions}>
        {!result.ok ? (
          <Pressable style={styles.smallButton} onPress={() => Clipboard.setStringAsync(text)}>
            <ThemedText type="smallBold">Copy errors</ThemedText>
          </Pressable>
        ) : null}
        <Pressable style={styles.smallButton} onPress={onDismiss}>
          <ThemedText type="smallBold">Dismiss</ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  card: { padding: Spacing.three, borderRadius: Spacing.two, gap: Spacing.two },
  docActions: { flexDirection: 'row', gap: Spacing.two },
  smallButton: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: '#888',
  },
});

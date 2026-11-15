import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';

/** A modal text box for writing or editing a mark's note. */
export function NoteModal({
  visible,
  title,
  quote,
  initial,
  onSave,
  onCancel,
}: {
  visible: boolean;
  title: string;
  quote?: string;
  initial?: string | null;
  onSave: (note: string) => void;
  onCancel: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <KeyboardAvoidingView behavior="height" style={styles.backdrop}>
        {/* Mounted only while open, so each opening starts from `initial`. */}
        {visible ? (
          <NoteEditor title={title} quote={quote} initial={initial} onSave={onSave} onCancel={onCancel} />
        ) : null}
      </KeyboardAvoidingView>
    </Modal>
  );
}

function NoteEditor({
  title,
  quote,
  initial,
  onSave,
  onCancel,
}: {
  title: string;
  quote?: string;
  initial?: string | null;
  onSave: (note: string) => void;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const [text, setText] = useState(initial ?? '');
  return (
    <ThemedView style={styles.box}>
      <ThemedText type="smallBold">{title}</ThemedText>
      {quote ? (
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={3}>
          “{quote}”
        </ThemedText>
      ) : null}
      <TextInput
        style={[styles.input, { color: theme.text, borderColor: theme.textSecondary }]}
        value={text}
        onChangeText={setText}
        placeholder="Your note"
        placeholderTextColor={theme.textSecondary}
        multiline
        autoFocus
      />
      <View style={styles.row}>
        <Pressable style={styles.button} onPress={onCancel}>
          <ThemedText type="smallBold">Cancel</ThemedText>
        </Pressable>
        <Pressable style={styles.button} onPress={() => onSave(text)}>
          <ThemedText type="smallBold">Save</ThemedText>
        </Pressable>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#0008',
    justifyContent: 'center',
    padding: Spacing.three,
  },
  box: { borderRadius: Spacing.two, padding: Spacing.three, gap: Spacing.two },
  input: {
    minHeight: 96,
    borderWidth: 1,
    borderRadius: Spacing.two,
    padding: Spacing.two,
    textAlignVertical: 'top',
  },
  row: { flexDirection: 'row', justifyContent: 'flex-end', gap: Spacing.two },
  button: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: '#888',
  },
});

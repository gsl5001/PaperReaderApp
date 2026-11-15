import { Link, Stack, useFocusEffect } from 'expo-router';
import * as Updates from 'expo-updates';
import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AiSettings } from '@/components/ai-settings';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useDb } from '@/lib/db/use-db';
import { syncSchedule } from '@/lib/schedule/notifications';
import { getSettings, setSetting, type Settings } from '@/lib/settings';

export default function SettingsScreen() {
  const [status, setStatus] = useState('');
  const db = useDb();
  const [settings, setSettings] = useState<Settings | null>(null);
  const { bottom } = useSafeAreaInsets();

  useFocusEffect(
    useCallback(() => {
      getSettings(db).then(setSettings);
    }, [db]),
  );

  async function setPrepReminder(value: boolean) {
    await setSetting(db, 'listenPrepReminder', value);
    setSettings(await getSettings(db));
    syncSchedule(db).catch(() => {});
  }

  async function checkForUpdate() {
    try {
      setStatus('Checking…');
      const result = await Updates.checkForUpdateAsync();
      if (!result.isAvailable) {
        setStatus('No update available.');
        return;
      }
      setStatus('Downloading…');
      await Updates.fetchUpdateAsync();
      await Updates.reloadAsync();
    } catch (e) {
      setStatus(`Update check failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return (
    <ThemedView style={styles.flex}>
      <Stack.Screen options={{ title: 'Settings' }} />
      <ScrollView contentContainerStyle={[styles.container, { paddingBottom: Spacing.four + bottom }]}>
        <ThemedText type="smallBold">App updates</ThemedText>
        <ThemedText type="small">Channel: {Updates.channel ?? '(none)'}</ThemedText>
        <ThemedText type="small">Runtime version: {Updates.runtimeVersion ?? '(none)'}</ThemedText>
        <ThemedText type="small">
          Update: {Updates.isEmbeddedLaunch ? 'embedded in the APK' : Updates.updateId}
        </ThemedText>
        <ThemedText type="small">Published: {Updates.createdAt?.toLocaleString() ?? '—'}</ThemedText>
        <Pressable style={styles.button} onPress={checkForUpdate}>
          <ThemedText type="smallBold">Check for update</ThemedText>
        </Pressable>
        {status ? <ThemedText type="small">{status}</ThemedText> : null}

        <ThemedText type="smallBold" style={styles.heading}>
          Notifications
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary">
          Only plans with time slots send notifications, at the start of each session.
        </ThemedText>
        <View style={styles.switchRow}>
          <ThemedText type="small" style={styles.switchLabel}>
            Remind me an hour before listen sessions, to prepare the NotebookLM audio
          </ThemedText>
          <Switch value={settings?.listenPrepReminder ?? false} onValueChange={setPrepReminder} disabled={!settings} />
        </View>

        <ThemedText type="smallBold" style={styles.heading}>
          AI questions
        </ThemedText>
        <AiSettings db={db} />

        <ThemedText type="smallBold" style={styles.heading}>
          Developer
        </ThemedText>
        <Link href="/pdf-test" asChild>
          <Pressable style={styles.button}>
            <ThemedText type="smallBold">PDF loading test</ThemedText>
          </Pressable>
        </Link>
      </ScrollView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: Spacing.three, gap: Spacing.two },
  heading: { marginTop: Spacing.four },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  switchLabel: { flex: 1 },
  button: {
    marginTop: Spacing.two,
    padding: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: '#888',
    alignItems: 'center',
  },
});

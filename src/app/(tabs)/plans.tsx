import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Link, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { ImportResultCard } from '@/components/import-result-card';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { useDb } from '@/lib/db/use-db';
import { importPlanText, type ImportResult } from '@/lib/library/import-plan';
import { syncSchedule } from '@/lib/schedule/notifications';
import { listPlanOverviews, type PlanOverview } from '@/lib/plan/queries';

// Plans tab: one card per plan, with its current section and item counts by status.

export default function PlansScreen() {
  const db = useDb();
  const [plans, setPlans] = useState<PlanOverview[] | null>(null);
  const [importResult, setImportResult] = useState<(ImportResult & { fileName: string }) | null>(null);

  const reload = useCallback(async () => {
    setPlans(await listPlanOverviews(db));
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      reload();
    }, [reload]),
  );

  async function importPlan() {
    try {
      // Markdown files have no reliable MIME type on Android, so allow any file.
      const picked = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
      if (picked.canceled) return;
      const asset = picked.assets[0];
      const text = await new File(asset.uri).text();
      const result = await importPlanText(db, text);
      setImportResult({ ...result, fileName: asset.name });
      await reload();
      if (result.ok) syncSchedule(db).catch(() => {});
    } catch (e) {
      Alert.alert('Import failed', e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <ThemedView style={styles.container}>
      <ScrollView contentContainerStyle={styles.content}>
        {plans?.map((p) => (
          <Link key={p.id} href={{ pathname: '/plan/[planId]', params: { planId: p.id } }} asChild>
            <Pressable>
              <ThemedView type="backgroundElement" style={styles.card}>
                <ThemedText type="subtitle" style={styles.cardTitle}>
                  {p.title}
                </ThemedText>
                <ThemedText type="small">
                  {p.current ? `Now: ${p.current.num}. ${p.current.title}` : 'All sections done'}
                </ThemedText>
                <ProgressBar read={p.counts.read} total={p.total} />
                <ThemedText type="small" themeColor="textSecondary">
                  {p.counts.reading} reading · {p.counts.due} due · {p.counts.unread} unread · {p.counts.read} read
                </ThemedText>
              </ThemedView>
            </Pressable>
          </Link>
        ))}

        {plans && plans.length === 0 ? (
          <ThemedText type="small" themeColor="textSecondary">
            No plans yet. Import a .plan.md file to start.
          </ThemedText>
        ) : null}

        <Pressable style={styles.button} onPress={importPlan}>
          <ThemedText type="smallBold">Import plan</ThemedText>
        </Pressable>
        {importResult ? <ImportResultCard result={importResult} onDismiss={() => setImportResult(null)} /> : null}
      </ScrollView>
    </ThemedView>
  );
}

function ProgressBar({ read, total }: { read: number; total: number }) {
  const pct = total ? Math.round((read / total) * 100) : 0;
  return (
    <View style={styles.barTrack}>
      <View style={[styles.barFill, { width: `${pct}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  content: { padding: Spacing.three, gap: Spacing.three },
  card: { padding: Spacing.three, borderRadius: Spacing.two, gap: Spacing.two },
  cardTitle: { fontSize: 20, lineHeight: 26 },
  button: {
    padding: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: '#888',
    alignItems: 'center',
  },
  barTrack: { height: 6, borderRadius: 3, backgroundColor: '#8884', overflow: 'hidden' },
  barFill: { height: 6, backgroundColor: '#208AEF' },
});

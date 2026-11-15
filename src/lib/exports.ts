import { format } from 'date-fns';
import { Alert } from 'react-native';

import type { Db } from './db/types';
import { confusionsMarkdown, planProgress, progressMarkdown } from './progress';
import { shareMarkdown } from './share';

// Share-sheet exports for Claude (design doc sections 4 and 8).

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export async function exportConfusions(db: Db, planId: string): Promise<void> {
  try {
    const text = await confusionsMarkdown(db, planId);
    if (!text) {
      Alert.alert('No open confusions', 'Mark passages as Confused in the reader first.');
      return;
    }
    await shareMarkdown(`confusions-${planId}-${format(new Date(), 'yyyy-MM-dd')}.md`, text, 'Export confusions');
  } catch (e) {
    Alert.alert('Export failed', message(e));
  }
}

export async function exportProgress(db: Db, planId: string): Promise<void> {
  try {
    const p = await planProgress(db, planId);
    if (!p) return;
    await shareMarkdown(
      `progress-${planId}-${format(new Date(), 'yyyy-MM-dd')}.md`,
      progressMarkdown(p),
      'Export progress',
    );
  } catch (e) {
    Alert.alert('Export failed', message(e));
  }
}

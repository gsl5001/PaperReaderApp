import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, TextInput, View } from 'react-native';

import { ThemedText } from '@/components/themed-text';
import { Spacing } from '@/constants/theme';
import { getApiKey, getRunner, setApiKey } from '@/lib/ai/app';
import { spendSummary, type SpendSummary } from '@/lib/ai/client';
import type { Db } from '@/lib/db/types';
import { getSettings, setSetting } from '@/lib/settings';

// Settings for model requests (design doc section 5): API key (secure storage), endpoint,
// model and prices for the spend estimate, the estimate itself, and a connection test.

export function AiSettings({ db }: { db: Db }) {
  const [hasKey, setHasKey] = useState(false);
  const [key, setKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [priceIn, setPriceIn] = useState('');
  const [priceOut, setPriceOut] = useState('');
  const [spend, setSpend] = useState<SpendSummary | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    setHasKey(!!(await getApiKey().catch(() => null)));
    const s = await getSettings(db);
    setBaseUrl(s.aiBaseUrl);
    setModel(s.aiModel);
    setPriceIn(String(s.aiPriceInGbp));
    setPriceOut(String(s.aiPriceOutGbp));
    setSpend(await spendSummary(db));
    const err = await db.first<{ at: string; feature: string; error: string }>(
      'SELECT at, feature, error FROM ai_calls WHERE ok = 0 ORDER BY id DESC LIMIT 1',
    );
    setLastError(err ? `${new Date(err.at).toLocaleString()} (${err.feature}): ${err.error}` : null);
  }, [db]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load]),
  );

  async function save() {
    const pIn = Number(priceIn);
    const pOut = Number(priceOut);
    if (!baseUrl.trim() || !model.trim() || !(pIn >= 0) || !(pOut >= 0)) {
      Alert.alert('Check the fields', 'Endpoint and model are required; prices must be numbers.');
      return;
    }
    try {
      if (key.trim()) await setApiKey(key);
      await setSetting(db, 'aiBaseUrl', baseUrl.trim());
      await setSetting(db, 'aiModel', model.trim());
      await setSetting(db, 'aiPriceInGbp', pIn);
      await setSetting(db, 'aiPriceOutGbp', pOut);
      setKey('');
      setStatus('Saved.');
      await load();
    } catch (e) {
      Alert.alert('Could not save', e instanceof Error ? e.message : String(e));
    }
  }

  async function removeKey() {
    await setApiKey(null);
    setStatus('Key removed. Model requests are off.');
    await load();
  }

  async function test() {
    setStatus('Testing…');
    try {
      const run = await getRunner(db);
      if (!run) {
        setStatus('No API key saved.');
        return;
      }
      await run<{ ok: boolean }>('test', {
        system: 'Reply with the JSON requested.',
        user: 'Return {"ok": true}.',
        schemaName: 'test',
        schema: {
          type: 'object',
          properties: { ok: { type: 'boolean' } },
          required: ['ok'],
          additionalProperties: false,
        },
        validate: (raw) => ((raw as { ok?: unknown })?.ok === true ? { ok: true } : { error: 'unexpected reply' }),
      });
      setStatus('Connection works.');
    } catch (e) {
      setStatus(`Test failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    await load();
  }

  return (
    <View style={styles.block}>
      <ThemedText type="small" themeColor="textSecondary">
        Used for retry variants, explanations of Confused marks, and extra section quiz questions. Without a key the app
        uses the plan&apos;s questions and the manual export/import.
      </ThemedText>
      <ThemedText type="small">API key: {hasKey ? 'saved' : 'not set'}</ThemedText>
      <TextInput
        style={styles.input}
        value={key}
        onChangeText={setKey}
        placeholder={hasKey ? 'Paste a new key to replace it' : 'Paste the API key'}
        placeholderTextColor="#888"
        secureTextEntry
        autoCapitalize="none"
        autoCorrect={false}
      />
      <Field label="Endpoint" value={baseUrl} onChange={setBaseUrl} />
      <Field label="Model" value={model} onChange={setModel} />
      <Field label="£ per million input tokens" value={priceIn} onChange={setPriceIn} numeric />
      <Field label="£ per million output tokens" value={priceOut} onChange={setPriceOut} numeric />
      <View style={styles.row}>
        <Pressable style={styles.button} onPress={save}>
          <ThemedText type="smallBold">Save</ThemedText>
        </Pressable>
        <Pressable style={styles.button} onPress={test}>
          <ThemedText type="smallBold">Test connection</ThemedText>
        </Pressable>
        {hasKey ? (
          <Pressable style={styles.button} onPress={removeKey}>
            <ThemedText type="smallBold">Remove key</ThemedText>
          </Pressable>
        ) : null}
      </View>
      {status ? <ThemedText type="small">{status}</ThemedText> : null}
      {spend ? (
        <ThemedText type="small">
          Estimated spend: £{spend.totalGbp.toFixed(2)} over {spend.calls} request{spend.calls === 1 ? '' : 's'}
          {spend.failed ? ` (${spend.failed} failed or rejected)` : ''}
          {spend.since ? ` since ${new Date(spend.since).toLocaleDateString()}` : ''}. A notification comes at every £5.
        </ThemedText>
      ) : null}
      {lastError ? (
        <ThemedText type="small" themeColor="textSecondary">
          Last error: {lastError}
        </ThemedText>
      ) : null}
    </View>
  );
}

function Field({
  label,
  value,
  onChange,
  numeric,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  numeric?: boolean;
}) {
  return (
    <View style={styles.field}>
      <ThemedText type="small" style={styles.fieldLabel}>
        {label}
      </ThemedText>
      <TextInput
        style={[styles.input, styles.fieldInput]}
        value={value}
        onChangeText={onChange}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={numeric ? 'decimal-pad' : 'default'}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { gap: Spacing.two },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.two },
  field: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two },
  fieldLabel: { width: 130 },
  fieldInput: { flex: 1 },
  input: {
    borderWidth: 1,
    borderColor: '#888',
    borderRadius: Spacing.two,
    paddingHorizontal: Spacing.two,
    paddingVertical: Spacing.one,
    color: '#888',
  },
  button: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: '#888',
  },
});

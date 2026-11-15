import * as Clipboard from 'expo-clipboard';
import * as DocumentPicker from 'expo-document-picker';
import { File } from 'expo-file-system';
import { Stack } from 'expo-router';
import { useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { PDF_JS_VERSION, PDF_VIEWER_HTML } from '@/lib/reader/pdf-viewer-html.generated';

// Design doc, next step 3: test loading a large PDF into the WebView as base64,
// with the PDF.js text layer and text selection, in a continuous scroll.
// WebView<object>: the package types default P to undefined, and WebViewProps & undefined is never.

interface Timings {
  file?: string;
  sizeMB?: number;
  readMs?: number;
  sendMs?: number;
  decodeMs?: number;
  openMs?: number;
  numPages?: number;
}

interface Selection {
  text: string;
  pageStart: number;
  pageEnd: number;
  rects: { page: number; x: number; y: number; w: number; h: number }[];
}

interface PageResult {
  page: number;
  renderMs: number;
  textMs: number;
  textItems: number;
}

export default function PdfTestScreen() {
  const webview = useRef<WebView<object>>(null);
  const sentAt = useRef(0);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [timings, setTimings] = useState<Timings>({});
  const [pages, setPages] = useState<PageResult[]>([]);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [position, setPosition] = useState<{ page: number; offset: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const addError = (e: string) => setErrors((prev) => [...prev, e]);

  async function pickAndLoad() {
    try {
      const result = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
      if (result.canceled) return;
      const asset = result.assets[0];
      setBusy(true);
      setPages([]);
      setSelection(null);
      setPosition(null);
      setErrors([]);
      setTimings({ file: asset.name, sizeMB: asset.size ? +(asset.size / 1e6).toFixed(1) : undefined });

      const t0 = Date.now();
      const base64 = await new File(asset.uri).base64();
      const readMs = Date.now() - t0;
      setTimings((t) => ({ ...t, readMs }));

      sentAt.current = Date.now();
      webview.current?.postMessage('LOAD:' + base64);
    } catch (e) {
      setBusy(false);
      addError(`Pick/read failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  function onMessage(e: WebViewMessageEvent) {
    const msg = JSON.parse(e.nativeEvent.data);
    switch (msg.type) {
      case 'ready':
        setReady(true);
        break;
      case 'received':
        setTimings((t) => ({ ...t, sendMs: msg.at - sentAt.current }));
        break;
      case 'loaded':
        setBusy(false);
        setTimings((t) => ({ ...t, decodeMs: msg.decodeMs, openMs: msg.openMs, numPages: msg.numPages }));
        break;
      case 'rendered':
        // Only page 1 is reported: the first render after opening the PDF.
        if (msg.page === 1) setPages([msg]);
        break;
      case 'position':
        setPosition({ page: msg.page, offset: msg.offset });
        break;
      case 'selection':
        setSelection(msg);
        break;
      case 'error':
        setBusy(false);
        addError(msg.message);
        break;
    }
  }

  const ms = (v?: number) => (v === undefined ? '—' : `${v} ms`);
  const selectionLine = selection
    ? `p.${selection.pageStart}${selection.pageEnd !== selection.pageStart ? '–' + selection.pageEnd : ''}: ${selection.text}`
    : '—';
  const report = [
    `PDF loading test (pdf.js ${PDF_JS_VERSION})`,
    `File: ${timings.file ?? '—'} (${timings.sizeMB ?? '?'} MB, ${timings.numPages ?? '?'} pages)`,
    `Read as base64: ${ms(timings.readMs)}`,
    `Send to WebView: ${ms(timings.sendMs)}`,
    `Decode base64: ${ms(timings.decodeMs)}`,
    `Open PDF: ${ms(timings.openMs)}`,
    ...pages.map((p) => `Page ${p.page}: render ${p.renderMs} ms, text layer ${p.textMs} ms (${p.textItems} items)`),
    `Position: ${position ? `p.${position.page}, ${Math.round(position.offset * 100)}% down` : '—'}`,
    `Selection: ${selectionLine}`,
    ...(selection ? selection.rects.map((r) => `  rect p.${r.page}: x ${r.x}, y ${r.y}, w ${r.w}, h ${r.h}`) : []),
    ...errors.map((e) => `Error: ${e}`),
  ].join('\n');

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen options={{ title: 'PDF loading test' }} />
      <ScrollView style={styles.panel} contentContainerStyle={styles.panelContent}>
        <View style={styles.row}>
          <Pressable style={[styles.button, !ready && styles.disabled]} disabled={!ready || busy} onPress={pickAndLoad}>
            <ThemedText type="smallBold">{ready ? (busy ? 'Working…' : 'Pick PDF') : 'Loading pdf.js…'}</ThemedText>
          </Pressable>
          <Pressable style={styles.button} onPress={() => Clipboard.setStringAsync(report)}>
            <ThemedText type="smallBold">Copy results</ThemedText>
          </Pressable>
        </View>
        <ThemedText type="small">{report}</ThemedText>
      </ScrollView>
      <WebView<object>
        ref={webview}
        style={styles.webview}
        originWhitelist={['*']}
        source={{ html: PDF_VIEWER_HTML, baseUrl: 'https://pdf-viewer.local/' }}
        onMessage={onMessage}
        javaScriptEnabled
      />
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  panel: { maxHeight: 260 },
  panelContent: { padding: Spacing.two, gap: Spacing.two },
  row: { flexDirection: 'row', gap: Spacing.two, flexWrap: 'wrap', alignItems: 'center' },
  button: {
    paddingVertical: Spacing.two,
    paddingHorizontal: Spacing.three,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: '#888',
  },
  disabled: { opacity: 0.5 },
  webview: { flex: 1 },
});

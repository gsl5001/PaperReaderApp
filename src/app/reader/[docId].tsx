import { File } from 'expo-file-system';
import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Pressable, StyleSheet, View } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { MarkSheet, MarksPanel } from '@/components/marks';
import { NoteModal } from '@/components/note-modal';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { Spacing } from '@/constants/theme';
import { addReadingTime } from '@/lib/progress';
import { useDb } from '@/lib/db/use-db';
import { getDocument, type LibraryDocument } from '@/lib/library/queries';
import {
  createMark,
  deleteMark,
  listMarks,
  setMarkNote,
  setMarkStatus,
  type Mark,
  type MarkKind,
  type MarkRect,
} from '@/lib/marks/queries';
import {
  getItem,
  getReadingPosition,
  openRangedItemsForDoc,
  saveReadingPosition,
  setItemDone,
  type PlanItemRow,
} from '@/lib/plan/queries';
import { PDF_VIEWER_HTML } from '@/lib/reader/pdf-viewer-html.generated';
import { afterItemDone, explainMark, getApiKey } from '@/lib/ai/app';
import { getPageTexts, missingItemPages, savePageTexts } from '@/lib/ai/page-text';
import { announceQuizReady, syncSchedule } from '@/lib/schedule/notifications';

// The PDF reader (design doc section 3).
// - Resume: opens at the saved position; saves the position as you scroll (debounced)
//   and when the app goes to the background.
// - A page param opens at that page (quiz answers' "See p.N" links).
// - Opened from a plan item (itemId param) whose page range doesn't include the saved
//   position: a banner offers to jump to the start of the item's range.
// - Scrolling forward onto the last page of a not-done item's range asks whether to mark it done. When
//   opened from an item, only that item is asked about; otherwise any of the document's items.
// - Marks: selecting text shows Highlight / Confused / Note in place of the system menu.
//   Marks are drawn on the page; tapping one opens its details; the Marks button lists them.
// WebView<object>: the package types default P to undefined, and WebViewProps & undefined is never.

const SAVE_DELAY_MS = 1000;

const MENU_ITEMS: { label: string; key: MarkKind }[] = [
  { label: 'Highlight', key: 'highlight' },
  { label: 'Confused', key: 'confused' },
  { label: 'Note', key: 'note' },
];

type Selection = { text: string; rects: MarkRect[] };
const normalise = (t: string) => t.replace(/\s+/g, ' ').trim();

export default function ReaderScreen() {
  const { docId, itemId, page } = useLocalSearchParams<{ docId: string; itemId?: string; page?: string }>();
  const db = useDb();
  const webview = useRef<WebView<object>>(null);
  const [doc, setDoc] = useState<LibraryDocument | null>(null);
  const [base64, setBase64] = useState<string | null>(null);
  const [viewerReady, setViewerReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jumpTo, setJumpTo] = useState<number | null>(null);

  const startPosition = useRef<{ page: number; offset: number } | null>(null);
  const pendingPosition = useRef<{ page: number; offset: number } | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const candidates = useRef<PlanItemRow[]>([]);
  const prompted = useRef(new Set<number>());
  const lastPage = useRef<number | null>(null);
  const planIdForMarks = useRef<string | null>(null);
  const lastSelection = useRef<Selection | null>(null);

  // Page text requests to the viewer (TEXT:<id>:<from>:<to>), answered by 'text' messages.
  const textRequests = useRef(new Map<number, (pages: { page: number; text: string }[]) => void>());
  const nextTextId = useRef(1);
  const [explaining, setExplaining] = useState<Set<number>>(new Set());

  const [marks, setMarks] = useState<Mark[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [openMark, setOpenMark] = useState<Mark | null>(null);
  // A pending note: either a new Note mark (selection) or editing an existing mark's note.
  const [noteDraft, setNoteDraft] = useState<{ selection?: Selection; mark?: Mark } | null>(null);

  // Load the document, saved position and items to watch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const d = await getDocument(db, docId);
        if (cancelled) return;
        setDoc(d);
        if (!d?.filePath) {
          setError('This document has no PDF attached.');
          return;
        }
        const pos = await getReadingPosition(db, docId);
        // A page param (a quiz answer's "See p.N") opens there; otherwise resume.
        startPosition.current = page ? { page: Number(page), offset: 0 } : pos;

        const item = itemId ? await getItem(db, Number(itemId)) : null;
        planIdForMarks.current = item?.planId ?? null;
        candidates.current = item
          ? item.pageTo != null && !item.done
            ? [item]
            : []
          : await openRangedItemsForDoc(db, docId);
        if (item?.pageFrom != null && item.pageTo != null) {
          const inside = pos != null && pos.page >= item.pageFrom && pos.page <= item.pageTo;
          if (!inside) {
            if (pos == null) startPosition.current = { page: item.pageFrom, offset: 0 };
            else setJumpTo(item.pageFrom);
          }
        }

        const data = await new File(d.filePath).base64();
        if (!cancelled) setBase64(data);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [db, docId, itemId, page]);

  // Send the PDF once both the file is read and pdf.js is ready.
  useEffect(() => {
    if (viewerReady && base64) webview.current?.postMessage('LOAD:' + base64);
  }, [viewerReady, base64]);

  const flushPosition = useCallback(async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = null;
    const pos = pendingPosition.current;
    pendingPosition.current = null;
    if (pos) await saveReadingPosition(db, docId, pos.page, pos.offset);
  }, [db, docId]);

  // Save when the app goes to the background and when leaving the reader.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') flushPosition();
    });
    return () => {
      sub.remove();
      flushPosition();
    };
  }, [flushPosition]);

  // Reading time (design doc section 3): time with the reader on screen and the app in the foreground.
  useFocusEffect(
    useCallback(() => {
      let since: number | null = AppState.currentState === 'active' ? Date.now() : null;
      const stop = () => {
        if (since != null) addReadingTime(db, docId, (Date.now() - since) / 1000);
        since = null;
      };
      const sub = AppState.addEventListener('change', (state) => {
        if (state === 'active') since ??= Date.now();
        else stop();
      });
      return () => {
        sub.remove();
        stop();
      };
    }, [db, docId]),
  );

  function onPosition(page: number, offset: number) {
    pendingPosition.current = { page, offset };
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flushPosition, SAVE_DELAY_MS);

    // Only when scrolling forward onto an item's last page, not when the reader opens there.
    const previous = lastPage.current;
    lastPage.current = page;
    if (previous == null || previous >= page) return;
    for (const item of candidates.current) {
      if (item.pageTo === page && !prompted.current.has(item.id)) {
        prompted.current.add(item.id);
        Alert.alert(`Mark "${item.text}" done?`, `You've reached p.${page}, the end of this reading.`, [
          { text: 'Not yet', style: 'cancel' },
          {
            text: 'Mark done',
            onPress: async () => {
              await setItemDone(db, item.id, true);
              syncSchedule(db).catch(() => {});
              announceQuizReady(db, item.id).catch(() => {});
              afterItemDone(db, item.id);
              candidates.current = candidates.current.filter((c) => c.id !== item.id);
            },
          },
        ]);
        break;
      }
    }
  }

  const reloadMarks = useCallback(async () => {
    const list = await listMarks(db, docId);
    setMarks(list);
    webview.current?.postMessage(
      'MARKS:' + JSON.stringify(list.map((m) => ({ id: m.id, kind: m.kind, rects: m.rects }))),
    );
    return list;
  }, [db, docId]);

  function requestText(from: number, to: number): Promise<{ page: number; text: string }[]> {
    const id = nextTextId.current++;
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        textRequests.current.delete(id);
        resolve([]);
      }, 30_000);
      textRequests.current.set(id, (pages) => {
        clearTimeout(timer);
        resolve(pages);
      });
      webview.current?.postMessage(`TEXT:${id}:${from}:${to}`);
    });
  }

  // With an API key set: store the text of the pages plan items cover, a few pages at a
  // time, for the model requests (section quiz questions, confusion explanations).
  async function extractItemPages(numPages: number) {
    if (!(await getApiKey().catch(() => null))) return;
    for (const [from, to] of await missingItemPages(db, docId, numPages)) {
      for (let a = from; a <= to; a += 5) {
        const pages = await requestText(a, Math.min(to, a + 4));
        if (!pages.length) return;
        await savePageTexts(db, docId, pages);
      }
    }
  }

  /** Ask the model to explain a Confused mark; `manual` shows errors, the automatic call stays quiet. */
  async function explain(mark: Mark, manual: boolean) {
    setExplaining((s) => new Set(s).add(mark.id));
    try {
      const have = await getPageTexts(db, docId, mark.page, mark.pageEnd);
      if (have.length < mark.pageEnd - mark.page + 1)
        await savePageTexts(db, docId, await requestText(mark.page, mark.pageEnd));
      const asked = await explainMark(db, mark.id);
      if (!asked && manual) Alert.alert('No API key', 'Add the API key in Settings first.');
      const list = await reloadMarks();
      setOpenMark((open) => (open?.id === mark.id ? (list.find((m) => m.id === mark.id) ?? null) : open));
    } catch (e) {
      if (manual) Alert.alert('Explanation failed', e instanceof Error ? e.message : String(e));
      else console.warn('Explanation failed', e);
    } finally {
      setExplaining((s) => {
        const next = new Set(s);
        next.delete(mark.id);
        return next;
      });
    }
  }

  async function addMark(kind: MarkKind, selection: Selection, note?: string) {
    try {
      const created = await createMark(db, {
        docId,
        kind,
        text: selection.text,
        rects: selection.rects,
        note,
        preferPlanId: planIdForMarks.current,
      });
      webview.current?.postMessage('CLEARSEL');
      await reloadMarks();
      if (kind === 'confused' && created.planId != null) explain(created, false);
    } catch (e) {
      Alert.alert('Could not save the mark', e instanceof Error ? e.message : String(e));
    }
  }

  function onMenu(e: { nativeEvent: { key: string; selectedText: string } }) {
    const { key, selectedText } = e.nativeEvent;
    const sel = lastSelection.current;
    // The viewer reports the selection's rectangles as it changes; use the report that
    // matches the text the menu was opened on.
    if (!sel || (selectedText && normalise(sel.text) !== normalise(selectedText))) {
      Alert.alert('Selection changed', 'Select the text again and choose an option once the selection has settled.');
      return;
    }
    if (key === 'note') setNoteDraft({ selection: sel });
    else addMark(key as MarkKind, sel);
  }

  async function saveNote(note: string) {
    const draft = noteDraft;
    setNoteDraft(null);
    if (!draft) return;
    if (draft.selection) await addMark('note', draft.selection, note);
    else if (draft.mark) {
      await setMarkNote(db, draft.mark.id, note);
      const list = await reloadMarks();
      setOpenMark(list.find((m) => m.id === draft.mark!.id) ?? null);
    }
  }

  async function toggleResolved(m: Mark) {
    await setMarkStatus(db, m.id, m.status === 'resolved' ? 'open' : 'resolved');
    const list = await reloadMarks();
    setOpenMark(list.find((x) => x.id === m.id) ?? null);
  }

  function confirmDelete(m: Mark) {
    Alert.alert('Delete this mark?', m.text.slice(0, 120), [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          await deleteMark(db, m.id);
          setOpenMark(null);
          await reloadMarks();
        },
      },
    ]);
  }

  function jumpToMark(m: Mark) {
    const first = m.rects.find((r) => r.page === m.page) ?? m.rects[0];
    // Put the mark a little below the top of the screen.
    webview.current?.postMessage(`GOTO:${m.page}:${Math.max(0, (first?.y ?? 0) - 0.05)}`);
    setPanelOpen(false);
  }

  function onMessage(e: WebViewMessageEvent) {
    const msg = JSON.parse(e.nativeEvent.data);
    switch (msg.type) {
      case 'ready':
        setViewerReady(true);
        break;
      case 'loaded': {
        setLoaded(true);
        reloadMarks();
        extractItemPages(msg.numPages).catch((e) => console.warn('Page text extraction failed', e));
        const start = startPosition.current;
        if (start) webview.current?.postMessage(`GOTO:${start.page}:${start.offset}`);
        break;
      }
      case 'position':
        onPosition(msg.page, msg.offset);
        break;
      case 'selection':
        lastSelection.current = { text: msg.text, rects: msg.rects };
        break;
      case 'markTap':
        setOpenMark(marks.find((m) => m.id === msg.id) ?? null);
        break;
      case 'text': {
        const resolve = textRequests.current.get(msg.id);
        textRequests.current.delete(msg.id);
        resolve?.(msg.pages ?? []);
        break;
      }
      case 'error':
        setError(msg.message);
        break;
    }
  }

  return (
    <ThemedView style={styles.container}>
      <Stack.Screen
        options={{
          title: doc?.title ?? '',
          headerRight: () =>
            loaded ? (
              <Pressable hitSlop={12} onPress={() => setPanelOpen(true)}>
                <ThemedText type="smallBold">Marks ({marks.length})</ThemedText>
              </Pressable>
            ) : null,
        }}
      />
      {error ? (
        <ThemedText type="small" style={styles.error}>
          {error}
        </ThemedText>
      ) : null}
      {jumpTo != null && loaded ? (
        <ThemedView type="backgroundElement" style={styles.banner}>
          <ThemedText type="small" style={styles.bannerText}>
            This reading starts on p.{jumpTo}.
          </ThemedText>
          <Pressable
            style={styles.bannerButton}
            onPress={() => {
              webview.current?.postMessage(`GOTO:${jumpTo}:0`);
              setJumpTo(null);
            }}>
            <ThemedText type="smallBold">Jump to p. {jumpTo}</ThemedText>
          </Pressable>
          <Pressable hitSlop={8} onPress={() => setJumpTo(null)}>
            <ThemedText type="smallBold">✕</ThemedText>
          </Pressable>
        </ThemedView>
      ) : null}
      <WebView<object>
        ref={webview}
        style={styles.webview}
        originWhitelist={['*']}
        source={{ html: PDF_VIEWER_HTML, baseUrl: 'https://pdf-viewer.local/' }}
        onMessage={onMessage}
        javaScriptEnabled
        menuItems={MENU_ITEMS}
        onCustomMenuSelection={onMenu}
      />
      <MarksPanel visible={panelOpen} marks={marks} onSelect={jumpToMark} onClose={() => setPanelOpen(false)} />
      <MarkSheet
        mark={openMark}
        onEditNote={() => openMark && setNoteDraft({ mark: openMark })}
        onToggleResolved={() => openMark && toggleResolved(openMark)}
        onExplain={openMark?.planId != null ? () => openMark && explain(openMark, true) : undefined}
        explaining={openMark != null && explaining.has(openMark.id)}
        onDelete={() => openMark && confirmDelete(openMark)}
        onClose={() => setOpenMark(null)}
      />
      <NoteModal
        visible={!!noteDraft}
        title={noteDraft?.mark ? 'Edit note' : 'New note'}
        quote={noteDraft?.selection?.text ?? noteDraft?.mark?.text}
        initial={noteDraft?.mark?.note}
        onSave={saveNote}
        onCancel={() => setNoteDraft(null)}
      />
      {!loaded && !error ? (
        <View style={styles.loading} pointerEvents="none">
          <ActivityIndicator size="large" />
        </View>
      ) : null}
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webview: { flex: 1 },
  error: { padding: Spacing.three },
  banner: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, padding: Spacing.two },
  bannerText: { flex: 1 },
  bannerButton: {
    paddingVertical: Spacing.one,
    paddingHorizontal: Spacing.two,
    borderRadius: Spacing.two,
    borderWidth: 1,
    borderColor: '#888',
  },
  loading: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'center' },
});

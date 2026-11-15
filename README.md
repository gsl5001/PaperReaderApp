# PaperReaderApp

An Android app for working through a reading plan of textbooks and papers. You import a plan file, read the PDFs in the app, mark passages you find confusing, and take quizzes on each section. Built with Expo and React Native.

## What it does

- **Plans**: import a `plan/v1` file (YAML frontmatter plus markdown sections) listing the documents, the reading for each section with page ranges, and quiz questions. Several plans can run at once. See `plans/counterfactual-models.plan.md` for an example and `skills/learning-plan-writer/references/format.md` for the format.
- **Today**: the next reading and listening sessions for each plan, with notifications at scheduled slots (Start, Snooze, Skip). Plans without slots just list the next items.
- **Reader**: PDF viewer (pdf.js in a WebView) that resumes where you left off. Highlight, add notes, or mark a passage as Confused. Reading time is logged per document.
- **Quizzes**: one per section, unlocked when its reading is done. Multiple choice or self-graded open questions. Missed questions come back in the next section's quiz and in reviews 7 days later until answered correctly twice.
- **Confusion loop**: export your confused passages, have an explanation and questions written for them (by hand, with Claude, or through the optional model integration below), and import the result as a `questions/v1` file. The questions are added to your next quiz.
- **Marks** tab: all highlights, notes and confusions, filterable by document and status.
- **Progress**: sections done, confusions, reading time, and a markdown export per plan.

## Optional model integration

With an API key for an OpenAI-compatible chat completions endpoint, the app can:

- reword a question after you get it wrong, so the retry tests understanding rather than memory;
- explain a passage marked Confused and write 2–3 questions about it;
- write 3 extra questions for a section from the text of its pages.

Enter the key, endpoint, model and prices in **Settings**. The key is stored on the phone with `expo-secure-store` and is never part of the app bundle. Each request is logged with an estimated cost, and a notification is sent each time the total passes another £5. Without a key, everything works through the manual export and import.

## Writing plans with Claude

`skills/learning-plan-writer` is a Claude skill that writes `plan/v1` files: give it a goal or an existing reading list and it produces an importable plan with real PDF page ranges and quiz questions. `skills/learning-plan-writer/evals` holds its test cases.

## Development

```bash
npm install
npm run build:viewer   # rebuilds src/lib/reader/pdf-viewer-html.generated.ts after changes to the viewer
npx tsc --noEmit       # typecheck
npx expo lint          # lint
npx jest               # tests
```

The generated viewer file is committed, so a fresh clone builds without running `build:viewer`.

## Building and shipping

Builds and updates go through [EAS](https://docs.expo.dev/eas/). To use your own Expo account, change `owner` and `extra.eas.projectId` in `app.json` (or run `npx eas-cli init`).

```bash
# Install build (APK), needed once and again whenever native modules change
npx eas-cli build --platform android --profile preview

# Ship JavaScript changes to installed apps
npx eas-cli update --branch preview --environment preview --message "..."
```

In the app, **Settings → Check for update** fetches the latest update.

## Layout

- `src/app`: screens (expo-router)
- `src/lib`: plan parsing, database (expo-sqlite), scheduling, quizzes, marks, confusions, model requests
- `src/lib/reader`: the pdf.js viewer that runs in the WebView
- `scripts/build-pdf-viewer.mjs`: bundles the viewer
- `plans`: example plan
- `skills/learning-plan-writer`: Claude skill for writing plans

## Licence

MIT. See `LICENSE`.
